"""Export a pretrained OSNet re-id model to ONNX for the analyzer.

Run on the dev PC (internet required), then copy the file to the server:
    pip install "numpy<2" cython torch torchvision gdown
    # torchreid's setup.py imports numpy → build isolation must be off
    pip install --no-build-isolation git+https://github.com/KaiyangZhou/deep-person-reid.git
    python scripts/export_osnet.py

Output: osnet_x0_25.onnx — see docs/REID-OSNET.md for deployment.
"""

from __future__ import annotations

import argparse
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="osnet_x0_25",
                    help="torchreid model name (osnet_x0_25 is the light default)")
    ap.add_argument("--out", default="osnet_x0_25.onnx")
    ap.add_argument("--opset", type=int, default=12)
    ap.add_argument("--weights", default="",
                    help="optional re-id checkpoint (.pth) from the torchreid "
                         "model zoo; without it the ImageNet-pretrained "
                         "backbone is exported — still far better than the "
                         "colour histograms, but a market1501 checkpoint is better")
    args = ap.parse_args()

    try:
        import torch
        from torchreid.utils import FeatureExtractor
    except ImportError as err:
        print(f"missing dependency: {err}\n"
              "pip install torch torchvision gdown && "
              "pip install git+https://github.com/KaiyangZhou/deep-person-reid.git",
              file=sys.stderr)
        return 1

    extractor = FeatureExtractor(
        model_name=args.model, model_path=args.weights, device="cpu")
    model = extractor.model.eval()
    print(f"weights: {args.weights or 'pretrained backbone (no checkpoint given)'}")
    # N,C,H,W — must match the crop size in analyzer/reid/embedding.py
    dummy = torch.randn(1, 3, 256, 128)
    torch.onnx.export(
        model, dummy, args.out,
        input_names=["input"], output_names=["feat"],
        opset_version=args.opset,
        dynamic_axes={"input": {0: "n"}, "feat": {0: "n"}},
    )

    with torch.no_grad():
        dim = int(model(dummy).shape[1])
    print(f"OK: {args.out} (embedding dim {dim})")
    print("Next: copy to ${DATA_ROOT}/models on the server, set "
          "REID_ONNX=/models/" + args.out + ", rebuild analyzer, "
          "then reset identities on «Люди» and set thresholds 0.70/0.75.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
