from __future__ import annotations

import logging
import os
from typing import Any

import numpy as np

from analyzer.config import Settings
from analyzer.pose.base import PoseDetection, bbox_from_keypoints

logger = logging.getLogger(__name__)

_KP_MIN_CONF = 0.3  # keypoint confidence used when deriving the box


class RtmoEstimator:
    """RTMO via rtmlib (Apache-2.0), pure ONNX Runtime — no mmcv, no torch.

    One-stage: the model finds people and their keypoints in a single pass, so
    unlike a detector+pose pipeline it needs no second model in VRAM. It
    returns keypoints only, so the person box is derived from them — see
    bbox_from_keypoints for why that does not shift the fall thresholds.

    The ONNX file is supplied by the operator (RTMO_MODEL / config.model), the
    same way ppe and re-id weights already are. Nothing is downloaded at
    runtime: an air-gapped install must work, and a silently auto-fetched
    model of unknown provenance is exactly what the licence audit is about.
    """

    name = "rtmo"

    def __init__(self, settings: Settings, cfg: dict[str, Any]) -> None:
        self.settings = settings
        path = str(cfg.get("model") or settings.rtmo_model)
        if not os.path.isfile(path):
            raise FileNotFoundError(
                f"RTMO model not found: {path}. Export or download the ONNX file "
                "and put it in ${DATA_ROOT}/models — see "
                "docs/operations/POSE-RTMO.md"
            )

        from rtmlib import RTMO

        device = "cuda" if settings.analyzer_device == "cuda" else "cpu"
        self._model = RTMO(
            onnx_model=path,
            model_input_size=(settings.rtmo_input, settings.rtmo_input),
            backend="onnxruntime",
            device=device,
        )
        self._version = os.path.basename(path)
        logger.info(
            "pose: rtmo backend, model %s, input %dx%d, device %s",
            path, settings.rtmo_input, settings.rtmo_input, device,
        )

    @property
    def model_version(self) -> str:
        return f"pose:rtmo:{self._version}"

    def predict(self, frame: np.ndarray, min_confidence: float) -> list[PoseDetection]:
        keypoints, scores = self._model(frame)
        if keypoints is None or len(keypoints) == 0:
            return []

        out: list[PoseDetection] = []
        for kp, sc in zip(keypoints, scores):
            kp_xy = np.asarray(kp, dtype=np.float32)
            kp_conf = np.asarray(sc, dtype=np.float32)
            # RTMO has no per-person score of its own; the mean keypoint
            # confidence stands in for it so min_confidence keeps its meaning.
            if float(kp_conf.mean()) < min_confidence:
                continue
            bbox = bbox_from_keypoints(kp_xy, kp_conf, _KP_MIN_CONF)
            if bbox is None:
                continue
            out.append(PoseDetection(bbox=bbox, kp_xy=kp_xy, kp_conf=kp_conf))
        return out

    def close(self) -> None:
        self._model = None
