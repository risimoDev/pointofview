from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import numpy as np

from analyzer.config import Settings

logger = logging.getLogger(__name__)

PERSON_CLASS = 0  # COCO person


@dataclass(slots=True)
class Detection:
    """One detected object, pipeline-neutral (no ultralytics/supervision types)."""

    bbox: tuple[float, float, float, float]  # x1,y1,x2,y2 pixels
    confidence: float
    class_id: int


@runtime_checkable
class Detector(Protocol):
    """Replaceable object detector. The implementation (YOLO, TensorRT, ONNX,
    OpenVINO) must not leak into the pipeline — only Detection does.
    """

    name: str

    @property
    def model_version(self) -> str: ...

    def detect(self, frame: np.ndarray, classes: list[int]) -> list[Detection]:
        """Synchronous GPU/CPU inference; the caller serializes GPU access."""
        ...


def make_detector(settings: Settings) -> Detector:
    """Factory by the make_embedder() pattern: pick by config. There is no
    silent fallback for the main detector — without it the worker is useless,
    so a load failure must crash loudly at startup, not degrade.
    """
    kind = settings.detector_kind
    if kind == "yolo":
        from analyzer.detect.yolo import YoloDetector

        return YoloDetector(settings)
    raise ValueError(f"unknown detector_kind: {kind}")
