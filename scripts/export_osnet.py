"""Export a pretrained OSNet re-id model to ONNX for the analyzer.

torchreid is NOT installed as a package on purpose: its setup.py imports the
whole library (scipy, PIL, h5py, tb-nightly …) just to read the version, which
turns a two-minute job into a dependency hunt. Only `torchreid/models/osnet.py`
is needed — it imports torch and nothing else — so the repo is cloned and that
one module is loaded directly.

    docker run --rm -v "$PWD:/w" -w /w python:3.12 bash -c "
      pip install -q torch --index-url https://download.pytorch.org/whl/cpu &&
      pip install -q numpy gdown onnx onnxscript &&
      git clone --depth 1 https://github.com/KaiyangZhou/deep-person-reid.git /tmp/reid &&
      python scripts/export_osnet.py --repo /tmp/reid"

Output: osnet_x0_25.onnx — see docs/REID-OSNET.md for deployment.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path
from types import ModuleType


def load_osnet_module(repo: Path) -> ModuleType:
    """Import torchreid/models/osnet.py without importing the package."""
    path = repo / "torchreid" / "models" / "osnet.py"
    if not path.is_file():
        raise FileNotFoundError(
            f"{path} not found — clone the repo first:\n"
            "  git clone --depth 1 "
            "https://github.com/KaiyangZhou/deep-person-reid.git /tmp/reid"
        )
    spec = importlib.util.spec_from_file_location("osnet_standalone", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="/tmp/reid",
                    help="path to a cloned deep-person-reid checkout")
    ap.add_argument("--model", default="osnet_x0_25",
                    help="osnet_x0_25 (light, ~5 ms/crop on CPU) or osnet_x1_0")
    ap.add_argument("--out", default="")
    ap.add_argument("--opset", type=int, default=12)
    ap.add_argument("--weights", default="",
                    help="optional re-id checkpoint (.pth); without it the "
                         "bundled pretrained weights are downloaded")
    args = ap.parse_args()
    out = args.out or f"{args.model}.onnx"

    try:
        import torch
    except ImportError:
        print("missing torch: pip install torch --index-url "
              "https://download.pytorch.org/whl/cpu", file=sys.stderr)
        return 1
    try:
        import onnxscript  # noqa: F401 — torch>=2.6 exports ONNX through it
    except ImportError:
        print("missing onnxscript: pip install numpy onnx onnxscript",
              file=sys.stderr)
        return 1

    osnet = load_osnet_module(Path(args.repo))
    builder = getattr(osnet, args.model, None)
    if builder is None:
        print(f"unknown model {args.model}", file=sys.stderr)
        return 1

    if args.weights:
        model = builder(num_classes=1, pretrained=False)
        state = torch.load(args.weights, map_location="cpu")
        state = state.get("state_dict", state)
        # checkpoints are saved from DataParallel → strip the module. prefix
        state = {k.replace("module.", "", 1): v for k, v in state.items()}
        missing, unexpected = model.load_state_dict(state, strict=False)
        print(f"weights: {args.weights} "
              f"(missing {len(missing)}, unexpected {len(unexpected)})")
    else:
        try:
            model = builder(num_classes=1, pretrained=True)
        except Exception as err:  # noqa: BLE001 — the download is the fragile part
            print(f"pretrained download failed: {err}\n"
                  "pip install gdown, or pass --weights with a checkpoint from "
                  "the torchreid model zoo", file=sys.stderr)
            return 1
        print("weights: bundled pretrained")

    # eval mode matters: OSNet returns the embedding instead of class logits
    model.eval()
    dummy = torch.randn(1, 3, 256, 128)  # N,C,H,W — analyzer/reid/embedding.py
    with torch.no_grad():
        feat = model(dummy)
    if feat.ndim != 2:
        print(f"unexpected output shape {tuple(feat.shape)}", file=sys.stderr)
        return 1

    torch.onnx.export(
        model, dummy, out,
        input_names=["input"], output_names=["feat"],
        opset_version=args.opset,
        dynamic_axes={"input": {0: "n"}, "feat": {0: "n"}},
    )
    print(f"OK: {out} (embedding dim {int(feat.shape[1])})")
    print("Next: copy to ${DATA_ROOT}/models on the server, set "
          f"REID_ONNX=/models/{out}, rebuild analyzer, then reset identities "
          "on «Люди» and set thresholds 0.70/0.75.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
