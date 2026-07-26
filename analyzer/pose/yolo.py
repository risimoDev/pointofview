from __future__ import annotations

import logging
import os
from typing import Any

import numpy as np

from analyzer.config import Settings
from analyzer.pose.base import PoseDetection

logger = logging.getLogger(__name__)


class YoloPoseEstimator:
    """ultralytics yolov8-pose (AGPL-3.0) — legacy backend, kept for rollback."""

    name = "yolo"

    def __init__(self, settings: Settings, cfg: dict[str, Any]) -> None:
        self.settings = settings
        # Resolution order (degrade, don't die):
        #   1. explicit config.model — must exist, no silent fallback
        #   2. Settings.pose_model (image-baked /opt/models copy)
        #   3. /models mount (drop the file there — no rebuild needed)
        #   4. bare ultralytics name → runtime auto-download (needs internet)
        def is_path(p: str) -> bool:
            return os.sep in p or "/" in p

        override = cfg.get("model")
        if override:
            path = str(override)
            if is_path(path) and not os.path.isfile(path):
                raise FileNotFoundError(f"pose model not found: {path}")
        else:
            path = next(
                (c for c in (settings.pose_model, "/models/yolov8n-pose.pt")
                 if not is_path(c) or os.path.isfile(c)),
                "yolov8n-pose.pt",
            )

        from ultralytics import YOLO

        model = YOLO(path)
        model.to(settings.analyzer_device)
        self._model = model
        self._version = os.path.basename(path)
        logger.info("pose: yolo backend, model %s", path)

    @property
    def model_version(self) -> str:
        return f"pose:{self._version}"

    def predict(self, frame: np.ndarray, min_confidence: float) -> list[PoseDetection]:
        result = self._model.predict(
            frame,
            conf=min_confidence,
            imgsz=self.settings.imgsz(),
            device=self.settings.analyzer_device,
            verbose=False,
        )[0]
        boxes = result.boxes
        kps = result.keypoints
        if boxes is None or len(boxes) == 0:
            return []
        xyxy = boxes.xyxy.cpu().numpy()
        kp_xy = kps.xy.cpu().numpy() if kps is not None else None
        kp_conf = (
            kps.conf.cpu().numpy()
            if kps is not None and kps.conf is not None else None
        )
        return [
            PoseDetection(
                bbox=(float(xyxy[i][0]), float(xyxy[i][1]),
                      float(xyxy[i][2]), float(xyxy[i][3])),
                kp_xy=kp_xy[i] if kp_xy is not None else None,
                kp_conf=kp_conf[i] if kp_conf is not None else None,
            )
            for i in range(len(xyxy))
        ]

    def close(self) -> None:
        self._model = None
