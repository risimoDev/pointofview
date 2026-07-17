from __future__ import annotations

import os

import numpy as np
from ultralytics import YOLO

from analyzer.config import Settings
from analyzer.detect.base import Detection


class YoloDetector:
    """Ultralytics YOLO behind the Detector protocol (current default)."""

    name = "yolo"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model = YOLO(settings.yolo_model)
        self._model.to(settings.analyzer_device)
        self._version = os.path.basename(settings.yolo_model)

    @property
    def model_version(self) -> str:
        return f"{self.name}:{self._version}"

    def detect(self, frame: np.ndarray, classes: list[int]) -> list[Detection]:
        result = self._model.predict(
            frame,
            classes=classes,
            conf=self.settings.yolo_conf,
            imgsz=self.settings.yolo_imgsz,
            device=self.settings.analyzer_device,
            verbose=False,
        )[0]
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return []
        xyxy = boxes.xyxy.cpu().numpy()
        conf = boxes.conf.cpu().numpy()
        cls = boxes.cls.cpu().numpy()
        return [
            Detection(
                bbox=(float(x[0]), float(x[1]), float(x[2]), float(x[3])),
                confidence=float(c),
                class_id=int(k),
            )
            for x, c, k in zip(xyxy, conf, cls)
        ]
