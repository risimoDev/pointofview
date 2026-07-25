from __future__ import annotations

import logging
import os

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Appearance embedding for person re-identification.
#
# Three interchangeable backends, chosen by env, all producing an L2-normalized
# vector so the matching logic never changes:
#
#   histogram  HSV over body halves. No dependencies, blind at night (IR).
#   dinov2     DINOv2 ViT (Apache-2.0). The licence-clean default — the OSNet
#              checkpoints in circulation are trained on research-only datasets
#              (Market-1501/MSMT17) and carry no usable licence of their own.
#              See docs/commercial/01_LICENSE_REMEDIATION.md, decision 3.
#   osnet      Legacy path, kept so прод can roll back mid-migration.
#
# Every backend declares its own default thresholds: cosine scales differ
# almost twofold between them, and a mismatched threshold is what produced the
# "288 посетителей за день" bug.

_H_BINS, _S_BINS, _V_BINS = 12, 4, 4
_CROP_W, _CROP_H = 64, 128
EMBED_DIM = _H_BINS * _S_BINS * _V_BINS * 2  # two body halves

# (input W, H, match, staff) per ONNX backend
_ONNX_PROFILES: dict[str, tuple[int, int, float, float]] = {
    # OSNet: trained for person re-id, tight cosine scale
    "osnet": (128, 256, 0.70, 0.75),
    # DINOv2: general-purpose features — unrelated crops already sit high on
    # the cosine scale, so the bar has to be higher. STARTING POINT, expect to
    # tune it on site; the resolved values are logged at startup.
    "dinov2": (224, 224, 0.82, 0.86),
}


class HistogramEmbedder:
    """HSV histogram of upper/lower body halves, L2-normalized."""

    dim = EMBED_DIM
    kind = "histogram"
    color_based = True  # unreliable on near-grayscale (night/IR) frames
    def_match = 0.88
    def_staff = 0.90

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
    """Any ONNX image embedder (DINOv2, OSNet, …). Needs onnxruntime."""

    color_based = False

    def __init__(self, model_path: str, kind: str) -> None:
        import onnxruntime as ort  # optional dep; import only when configured

        w, h, self.def_match, self.def_staff = _ONNX_PROFILES[kind]
        self.kind = kind
        self._sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        inp = self._sess.get_inputs()[0]
        self._input = inp.name
        # Trust the graph over the profile when it pins a static size — a
        # wrong input size silently degrades the embedding instead of failing.
        shape = list(inp.shape)
        if len(shape) == 4:
            if isinstance(shape[2], int) and shape[2] > 0:
                h = shape[2]
            if isinstance(shape[3], int) and shape[3] > 0:
                w = shape[3]
        self._size = (w, h)
        out_shape = self._sess.get_outputs()[0].shape
        self.dim = int(out_shape[-1]) if isinstance(out_shape[-1], int) else 0

    def __call__(self, crop_bgr: np.ndarray) -> np.ndarray:
        img = cv2.resize(crop_bgr, self._size, interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb = (rgb - np.array([0.485, 0.456, 0.406], dtype=np.float32)) \
            / np.array([0.229, 0.224, 0.225], dtype=np.float32)
        x = rgb.transpose(2, 0, 1)[None]
        raw = np.asarray(self._sess.run(None, {self._input: x})[0], dtype=np.float32)
        # (1, dim) for CNN heads; (1, tokens, dim) for ViT — take the CLS token
        out = raw[0, 0] if raw.ndim == 3 else raw[0]
        norm = float(np.linalg.norm(out))
        return out / norm if norm > 0 else out


def make_embedder() -> HistogramEmbedder | OnnxEmbedder:
    """ONNX when REID_ONNX points at a usable model, histograms otherwise.

    The choice is logged loudly with the thresholds it expects: a silent
    fallback looks exactly like a working upgrade from the outside, while the
    thresholds differ almost twofold between backends.
    """
    path = os.environ.get("REID_ONNX", "")
    # Default is osnet, not dinov2: an existing install already has REID_ONNX
    # pointing at an OSNet file, and flipping its profile on a routine rebuild
    # would quietly move the recommended thresholds. Switching is an explicit
    # act — set REID_ONNX_KIND=dinov2 together with the new model file.
    kind = os.environ.get("REID_ONNX_KIND", "osnet").strip().lower()
    if kind not in _ONNX_PROFILES:
        logger.error("REID_ONNX_KIND=%s unknown, expected one of %s — using dinov2",
                     kind, sorted(_ONNX_PROFILES))
        kind = "dinov2"
    if path:
        if not os.path.isfile(path):
            logger.error("REID_ONNX=%s not found — falling back to histograms", path)
        else:
            try:
                emb = OnnxEmbedder(path, kind)
                logger.info(
                    "reid embedder: ONNX %s kind=%s (dim %d, вход %dx%d) — "
                    "пороги %.2f/%.2f",
                    path, kind, emb.dim, emb._size[0], emb._size[1],
                    emb.def_match, emb.def_staff,
                )
                return emb
            except Exception:  # noqa: BLE001 — fall back rather than kill the worker
                logger.exception("REID_ONNX=%s failed to load — using histograms", path)
    hist = HistogramEmbedder()
    logger.info("reid embedder: HSV histograms (dim %d) — пороги %.2f/%.2f",
                hist.dim, hist.def_match, hist.def_staff)
    return hist


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Both inputs are L2-normalized → plain dot product."""
    return float(np.dot(a, b))
