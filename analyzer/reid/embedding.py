from __future__ import annotations

import os

import cv2
import numpy as np

# Appearance embedding for person re-identification.
#
# Default: HSV color histogram over vertical body halves — zero extra
# dependencies, stable within a day (clothing-based). Weak spot: two visitors
# in near-identical outfits. The interface is model-agnostic: when REID_ONNX
# points at an OSNet-style ONNX file the neural embedder takes over without
# touching any matching logic.

_H_BINS, _S_BINS, _V_BINS = 12, 4, 4
_CROP_W, _CROP_H = 64, 128
EMBED_DIM = _H_BINS * _S_BINS * _V_BINS * 2  # two body halves


class HistogramEmbedder:
    """HSV histogram of upper/lower body halves, L2-normalized."""

    dim = EMBED_DIM
    color_based = True  # unreliable on near-grayscale (night/IR) frames

    def __call__(self, crop_bgr: np.ndarray) -> np.ndarray:
        img = cv2.resize(crop_bgr, (_CROP_W, _CROP_H), interpolation=cv2.INTER_AREA)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        half = _CROP_H // 2
        parts = []
        for seg in (hsv[:half], hsv[half:]):
            hist = cv2.calcHist(
                [seg], [0, 1, 2], None,
                [_H_BINS, _S_BINS, _V_BINS],
                [0, 180, 0, 256, 0, 256],
            ).flatten()
            parts.append(hist)
        emb = np.concatenate(parts).astype(np.float32)
        norm = float(np.linalg.norm(emb))
        return emb / norm if norm > 0 else emb


class OnnxEmbedder:
    """OSNet-style ONNX Re-ID model (optional upgrade, needs onnxruntime)."""

    color_based = False

    def __init__(self, model_path: str) -> None:
        import onnxruntime as ort  # optional dep; import only when configured

        self._sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self._input = self._sess.get_inputs()[0].name
        self.dim = int(self._sess.get_outputs()[0].shape[-1])

    def __call__(self, crop_bgr: np.ndarray) -> np.ndarray:
        img = cv2.resize(crop_bgr, (128, 256), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb = (rgb - np.array([0.485, 0.456, 0.406], dtype=np.float32)) \
            / np.array([0.229, 0.224, 0.225], dtype=np.float32)
        x = rgb.transpose(2, 0, 1)[None]
        out = self._sess.run(None, {self._input: x})[0][0].astype(np.float32)
        norm = float(np.linalg.norm(out))
        return out / norm if norm > 0 else out


def make_embedder() -> HistogramEmbedder | OnnxEmbedder:
    path = os.environ.get("REID_ONNX", "")
    if path and os.path.isfile(path):
        try:
            return OnnxEmbedder(path)
        except Exception:  # noqa: BLE001 — fall back rather than kill the worker
            pass
    return HistogramEmbedder()


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Both inputs are L2-normalized → plain dot product."""
    return float(np.dot(a, b))
