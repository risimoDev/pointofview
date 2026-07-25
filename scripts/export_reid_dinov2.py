#!/usr/bin/env python3
"""Export DINOv2 (Apache-2.0) to ONNX for the re-id embedder.

Run on the dev PC, copy the result to ${DATA_ROOT}/models on the server.

    pip install torch transformers onnx
    python scripts/export_reid_dinov2.py --out dinov2_vits14.onnx

Why DINOv2 and not OSNet: the OSNet checkpoints in circulation are trained on
research-only datasets and ship without a usable licence, which blocks
on-premise delivery. DINOv2 was relicensed to Apache-2.0 by Meta in 2023.
DINOv3 is NOT a drop-in replacement here — it carries a restrictive custom
licence and must not be used. See docs/commercial/01_LICENSE_REMEDIATION.md.
"""

from __future__ import annotations

import argparse
import sys

MODELS = {
    "small": ("facebook/dinov2-small", 384),
    "base": ("facebook/dinov2-base", 768),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", choices=sorted(MODELS), default="small",
                    help="small = 384-dim, ~90 MB ONNX, enough for clothing re-id")
    ap.add_argument("--out", default="dinov2_vits14.onnx")
    ap.add_argument("--resolution", type=int, default=224,
                    help="must be a multiple of 14 (DINOv2 patch size)")
    args = ap.parse_args()

    if args.resolution % 14:
        print(f"resolution {args.resolution} is not a multiple of 14", file=sys.stderr)
        return 2

    import torch
    from transformers import AutoModel

    name, dim = MODELS[args.size]
    print(f"loading {name} …")
    model = AutoModel.from_pretrained(name).eval()

    class Wrapper(torch.nn.Module):
        """last_hidden_state only: the embedder takes the CLS token (index 0)."""

        def __init__(self, inner: torch.nn.Module) -> None:
            super().__init__()
            self.inner = inner

        def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
            return self.inner(pixel_values=pixel_values).last_hidden_state

    dummy = torch.randn(1, 3, args.resolution, args.resolution)
    torch.onnx.export(
        Wrapper(model), dummy, args.out,
        input_names=["pixel_values"], output_names=["tokens"],
        dynamic_axes={"pixel_values": {0: "batch"}, "tokens": {0: "batch"}},
        opset_version=17,
    )
    print(f"written {args.out} (dim {dim}, input {args.resolution}x{args.resolution})")
    print()
    print("On the server:")
    print(f"  scp {args.out} viziai-server:${{DATA_ROOT}}/models/")
    print("  .env.prod:  REID_ONNX=/models/" + args.out)
    print("              REID_ONNX_KIND=dinov2")
    print("  rebuild analyzer, then check the log line 'reid embedder: ONNX … dinov2'")
    print("  /admin/features → «Сброс обучения» → пороги 0.82/0.86 → отметить сотрудников заново")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
