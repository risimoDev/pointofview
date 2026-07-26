#!/usr/bin/env python3
"""Fine-tune the PPE (helmet/vest) detector on RF-DETR.

Replaces the ultralytics PPE model — the last AGPL-3.0 component in the
analyzer. Runs on the GPU server, not the dev PC.

    python scripts/train_ppe.py check   --data /data/ppe        # pre-flight
    python scripts/train_ppe.py train   --data /data/ppe --epochs 30
    python scripts/train_ppe.py eval    --data /data/ppe --weights out/best.pth \\
                                        --baseline /models/ppe_prev.pth

Dataset layout is the COCO export Roboflow produces:

    /data/ppe/train/_annotations.coco.json  + images
    /data/ppe/valid/_annotations.coco.json  + images

`check` runs first for a reason: the analyzer resolves PPE classes BY NAME
(analyzer/plugins/ppe.py), so a dataset whose classes are called "class_0" or
"ppe" trains fine and is then unusable. Catching that costs a second; finding
it after a night of GPU time costs a night.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

# The report is Russian and uses non-ASCII symbols; a Windows console defaults
# to cp1251 and raises UnicodeEncodeError mid-report. The server is UTF-8, the
# dev PC is not, and the script must run on both.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass

# Mirrors _ITEM_KEYWORDS in analyzer/plugins/ppe.py — keep in sync.
ITEM_KEYWORDS: dict[str, tuple[str, ...]] = {
    "helmet": ("helmet", "hardhat", "hard-hat"),
    "vest": ("vest", "waistcoat"),
}
NEGATIVE_PREFIXES = ("no-", "no_", "no ")


def load_coco(split_dir: Path) -> dict[str, Any]:
    f = split_dir / "_annotations.coco.json"
    if not f.is_file():
        raise FileNotFoundError(f"{f} not found — expected a COCO export")
    with open(f, encoding="utf-8") as fh:
        return json.load(fh)


def classify_names(categories: list[dict[str, Any]]) -> tuple[dict[int, str], list[str]]:
    """Category id → PPE item, plus the names the analyzer will ignore."""
    mapped: dict[int, str] = {}
    ignored: list[str] = []
    for c in categories:
        name = str(c.get("name", "")).lower()
        if name.startswith(NEGATIVE_PREFIXES):
            ignored.append(f"{c['name']} (отрицательный класс, отсутствие выводим сами)")
            continue
        hit = next((item for item, kws in ITEM_KEYWORDS.items()
                    if any(k in name for k in kws)), None)
        if hit:
            mapped[int(c["id"])] = hit
        else:
            ignored.append(str(c["name"]))
    return mapped, ignored


def cmd_check(args: argparse.Namespace) -> int:
    root = Path(args.data)
    ok = True
    for split in ("train", "valid"):
        d = root / split
        try:
            coco = load_coco(d)
        except FileNotFoundError as exc:
            print(f"[x] {exc}", file=sys.stderr)
            ok = False
            continue

        mapped, ignored = classify_names(coco.get("categories", []))
        counts: dict[int, int] = defaultdict(int)
        for a in coco.get("annotations", []):
            counts[int(a["category_id"])] += 1

        print(f"[+] {split}: {len(coco.get('images', []))} изображений, "
              f"{len(coco.get('annotations', []))} разметок")
        for cid, item in sorted(mapped.items()):
            name = next(c["name"] for c in coco["categories"] if int(c["id"]) == cid)
            print(f"      {name!r} -> {item}: {counts[cid]} шт")
        if ignored:
            print(f"      анализатор проигнорирует: {', '.join(ignored)}")

        if not mapped:
            print(f"[x] {split}: ни один класс не распознан как каска или жилет. "
                  f"Переименуйте классы (helmet/hardhat, vest) или задайте "
                  f"config.class_map у фичи ppe.", file=sys.stderr)
            ok = False
        else:
            for item in ITEM_KEYWORDS:
                total = sum(counts[cid] for cid, it in mapped.items() if it == item)
                if total == 0:
                    print(f"[!] {split}: класса «{item}» нет ни в одной разметке — "
                          f"модель его не выучит")
                elif total < 200:
                    print(f"[!] {split}: «{item}» всего {total} разметок — мало, "
                          f"ожидайте низкую точность")
    return 0 if ok else 1


def cmd_train(args: argparse.Namespace) -> int:
    if cmd_check(args) != 0:
        print("[x] проверка датасета не пройдена, обучение не запускаем", file=sys.stderr)
        return 1

    import rfdetr

    cls = {
        "nano": rfdetr.RFDETRNano, "small": rfdetr.RFDETRSmall,
        "medium": rfdetr.RFDETRMedium, "large": rfdetr.RFDETRLarge,
    }[args.size]
    # Resolution must stay a multiple of 56 and should match what the analyzer
    # runs at, otherwise the model is tuned for a scale it never sees.
    model = cls(resolution=args.resolution)
    print(f"[+] обучение {args.size}, разрешение {args.resolution}, {args.epochs} эпох")
    model.train(
        dataset_dir=args.data,
        epochs=args.epochs,
        batch_size=args.batch,
        grad_accum_steps=args.grad_accum,
        lr=args.lr,
        output_dir=args.out,
    )
    print(f"[+] чекпоинты в {args.out}")
    print("    дальше: python scripts/train_ppe.py eval --data ... --weights "
          f"{args.out}/checkpoint_best_total.pth")
    return 0


# ── evaluation ────────────────────────────────────────────────
def iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    aa = (a[2] - a[0]) * (a[3] - a[1])
    bb = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (aa + bb - inter)


def evaluate(weights: str, root: Path, size: str, resolution: int,
             conf: float, iou_thr: float) -> dict[str, dict[str, float]]:
    """Precision/recall/F1 per PPE item on the valid split.

    Deliberately our own metric rather than a framework's: it is computed on
    the two classes the product actually uses, at the confidence the analyzer
    actually runs at, so the number means what the operator will see.
    """
    import numpy as np
    import rfdetr
    from PIL import Image

    coco = load_coco(root / "valid")
    mapped, _ = classify_names(coco.get("categories", []))
    by_image: dict[int, list[tuple[str, tuple[float, float, float, float]]]] = defaultdict(list)
    for a in coco.get("annotations", []):
        item = mapped.get(int(a["category_id"]))
        if item is None:
            continue
        x, y, w, h = a["bbox"]
        by_image[int(a["image_id"])].append((item, (x, y, x + w, y + h)))

    cls = {
        "nano": rfdetr.RFDETRNano, "small": rfdetr.RFDETRSmall,
        "medium": rfdetr.RFDETRMedium, "large": rfdetr.RFDETRLarge,
    }[size]
    model = cls(resolution=resolution, pretrain_weights=weights)
    names = getattr(model, "class_names", None)
    pred_map, _ = classify_names(
        [{"id": k, "name": v} for k, v in (
            names.items() if isinstance(names, dict) else enumerate(names or [])
        )]
    )

    stat = {item: {"tp": 0.0, "fp": 0.0, "fn": 0.0} for item in ITEM_KEYWORDS}
    for img in coco.get("images", []):
        path = root / "valid" / str(img["file_name"])
        if not path.is_file():
            continue
        frame = np.asarray(Image.open(path).convert("RGB"))
        res = model.predict(frame, threshold=conf)
        preds: list[tuple[str, tuple[float, float, float, float]]] = []
        xyxy = getattr(res, "xyxy", None)
        if xyxy is not None:
            for b, k in zip(xyxy, res.class_id):
                item = pred_map.get(int(k))
                if item:
                    preds.append((item, (float(b[0]), float(b[1]), float(b[2]), float(b[3]))))

        truth = by_image.get(int(img["id"]), [])
        used = set()
        for pitem, pbox in preds:
            best, best_i = -1, iou_thr
            for i, (titem, tbox) in enumerate(truth):
                if i in used or titem != pitem:
                    continue
                v = iou(pbox, tbox)
                if v >= best_i:
                    best, best_i = i, v
            if best >= 0:
                used.add(best)
                stat[pitem]["tp"] += 1
            else:
                stat[pitem]["fp"] += 1
        for i, (titem, _) in enumerate(truth):
            if i not in used:
                stat[titem]["fn"] += 1

    out: dict[str, dict[str, float]] = {}
    for item, s in stat.items():
        p = s["tp"] / (s["tp"] + s["fp"]) if s["tp"] + s["fp"] else 0.0
        r = s["tp"] / (s["tp"] + s["fn"]) if s["tp"] + s["fn"] else 0.0
        f1 = 2 * p * r / (p + r) if p + r else 0.0
        out[item] = {"precision": p, "recall": r, "f1": f1}
    return out


def cmd_eval(args: argparse.Namespace) -> int:
    root = Path(args.data)
    new = evaluate(args.weights, root, args.size, args.resolution, args.conf, args.iou)
    print(f"[+] {args.weights}")
    for item, m in new.items():
        print(f"      {item}: точность {m['precision']:.3f} "
              f"полнота {m['recall']:.3f} F1 {m['f1']:.3f}")

    if not args.baseline:
        return 0

    old = evaluate(args.baseline, root, args.size, args.resolution, args.conf, args.iou)
    print(f"[+] базовая {args.baseline}")
    worse = []
    for item in new:
        d = new[item]["f1"] - old[item]["f1"]
        mark = "хуже" if d < -args.tolerance else "лучше" if d > args.tolerance else "как было"
        print(f"      {item}: F1 {old[item]['f1']:.3f} -> {new[item]['f1']:.3f} ({mark})")
        if d < -args.tolerance:
            worse.append(item)

    if worse:
        # The gate exists because "the new model is obviously better" is the
        # single most expensive assumption in this pipeline.
        print(f"[x] новая модель хуже по: {', '.join(worse)} — НЕ выкатывать",
              file=sys.stderr)
        return 1
    print("[+] новая модель не хуже базовой, можно выкатывать")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--data", required=True, help="каталог с train/ и valid/")
        p.add_argument("--size", default="small", choices=("nano", "small", "medium", "large"))
        p.add_argument("--resolution", type=int, default=672, help="кратно 56")

    c = sub.add_parser("check"); common(c)
    t = sub.add_parser("train"); common(t)
    t.add_argument("--epochs", type=int, default=30)
    t.add_argument("--batch", type=int, default=4)
    t.add_argument("--grad-accum", type=int, default=4)
    t.add_argument("--lr", type=float, default=1e-4)
    t.add_argument("--out", default="out/ppe")
    e = sub.add_parser("eval"); common(e)
    e.add_argument("--weights", required=True)
    e.add_argument("--baseline", help="предыдущая модель для сравнения")
    e.add_argument("--conf", type=float, default=0.5)
    e.add_argument("--iou", type=float, default=0.5)
    e.add_argument("--tolerance", type=float, default=0.01)

    args = ap.parse_args()
    if args.resolution % 56:
        print(f"[x] resolution {args.resolution} не кратно 56", file=sys.stderr)
        return 2
    return {"check": cmd_check, "train": cmd_train, "eval": cmd_eval}[args.cmd](args)


if __name__ == "__main__":
    raise SystemExit(main())
