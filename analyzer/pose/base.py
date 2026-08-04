from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

import numpy as np

from analyzer.config import Settings

logger = logging.getLogger(__name__)

# COCO-17 keypoint indices shared by every backend
L_SHOULDER, R_SHOULDER, L_HIP, R_HIP = 5, 6, 11, 12
L_KNEE, R_KNEE, L_ANKLE, R_ANKLE = 13, 14, 15, 16


@dataclass(slots=True)
class PoseDetection:
    """One posed person, backend-neutral (no ultralytics/rtmlib types)."""

    bbox: tuple[float, float, float, float]  # x1,y1,x2,y2 pixels
    kp_xy: np.ndarray | None                 # (17, 2)
    kp_conf: np.ndarray | None               # (17,)


@runtime_checkable
class PoseEstimator(Protocol):
    """Replaceable pose model. Only PoseDetection reaches the plugin."""

    name: str

    @property
    def model_version(self) -> str: ...

    def predict(self, frame: np.ndarray, min_confidence: float) -> list[PoseDetection]:
        """Synchronous inference; the caller serializes GPU access."""
        ...

    def close(self) -> None: ...


def bbox_from_keypoints(
    kp_xy: np.ndarray, kp_conf: np.ndarray, min_conf: float,
) -> tuple[float, float, float, float] | None:
    """Enclosing box of the confident keypoints.

    One-stage models like RTMO return keypoints without a person box, and the
    plugin needs one to associate a pose with a track. Note this box hugs the
    skeleton and is tighter than a detector's person box — which is exactly
    why the fall heuristic takes its aspect ratio from the TRACK box instead,
    so the tuned thresholds mean the same thing on every backend.
    """
    good = [(float(p[0]), float(p[1])) for p, c in zip(kp_xy, kp_conf) if float(c) >= min_conf]
    if len(good) < 2:
        return None
    xs = [p[0] for p in good]
    ys = [p[1] for p in good]
    return min(xs), min(ys), max(xs), max(ys)


def make_pose_estimator(settings: Settings, cfg: dict[str, Any]) -> PoseEstimator:
    """Pick the backend by config. No silent fallback: a pose model that
    quietly isn't the one configured would change the fall thresholds without
    anyone noticing, so a load failure must surface as a plugin error.
    """
    backend = str(cfg.get("backend") or settings.pose_backend).strip().lower()
    if backend == "rtmo":
        from analyzer.pose.rtmo import RtmoEstimator

        return RtmoEstimator(settings, cfg)
    if backend == "yolo":
        try:
            from analyzer.pose.yolo import YoloPoseEstimator
        except ImportError as exc:  # image built with WITH_ULTRALYTICS=0
            raise RuntimeError(
                "pose_backend=yolo needs ultralytics, which this image was "
                "built without (WITH_ULTRALYTICS=0). Set POSE_BACKEND=rtmo and "
                "put rtmo.onnx into the /models mount."
            ) from exc

        logger.warning(
            "pose_backend=yolo uses ultralytics (AGPL-3.0): not licensed for "
            "on-premise delivery. Switch to pose_backend=rtmo."
        )
        return YoloPoseEstimator(settings, cfg)
    raise ValueError(f"unknown pose backend: {backend!r}")
