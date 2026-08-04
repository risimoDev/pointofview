from __future__ import annotations

import logging
import os
from typing import Any, Protocol, runtime_checkable

import numpy as np

from analyzer.config import Settings
from analyzer.detect.base import Detection

logger = logging.getLogger(__name__)

# Auxiliary detectors are the second kind of model in the pipeline: PPE items,
# and later forklifts, fire, open guards. They differ from the MAIN detector
# (analyzer/detect/base.py) in one way that matters — their classes are
# arbitrary and model-specific, so there is no canonical COCO mapping and no
# required "person" class. Class ids come through natively and the caller
# resolves them by name.


@runtime_checkable
class AuxDetector(Protocol):
    """Replaceable auxiliary model with a model-specific class set."""

    name: str

    @property
    def model_version(self) -> str: ...

    @property
    def class_names(self) -> dict[int, str]:
        """Native class id → name; empty when the file carries no names."""
        ...

    def predict(self, frame: np.ndarray, min_confidence: float) -> list[Detection]: ...

    def close(self) -> None: ...


class YoloAuxDetector:
    """ultralytics (AGPL-3.0) — legacy backend, kept for the test bench."""

    name = "yolo"

    def __init__(self, settings: Settings, path: str) -> None:
        try:
            from ultralytics import YOLO
        except ImportError as exc:  # image built with WITH_ULTRALYTICS=0
            raise RuntimeError(
                "PPE backend=yolo needs ultralytics, which this image was built "
                "without (WITH_ULTRALYTICS=0). Train a checkpoint with "
                "scripts/train_ppe.py and set PPE_BACKEND=rfdetr."
            ) from exc

        self.settings = settings
        model = YOLO(path)
        model.to(settings.analyzer_device)
        self._model = model
        self._version = os.path.basename(path)
        raw = getattr(model, "names", None) or {}
        self._names = {int(k): str(v) for k, v in raw.items()}

    @property
    def model_version(self) -> str:
        return f"yolo:{self._version}"

    @property
    def class_names(self) -> dict[int, str]:
        return self._names

    def predict(self, frame: np.ndarray, min_confidence: float) -> list[Detection]:
        result = self._model.predict(
            frame,
            conf=min_confidence,
            imgsz=self.settings.imgsz(),
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

    def close(self) -> None:
        self._model = None


class RfDetrAuxDetector:
    """RF-DETR (Apache-2.0) fine-tuned on a custom class set.

    Requires a checkpoint trained with rfdetr — an ultralytics .pt cannot be
    loaded here. Until such a checkpoint exists (it needs pilot data), the
    yolo backend remains the only working option for PPE.
    """

    name = "rfdetr"

    def __init__(self, settings: Settings, path: str) -> None:
        import rfdetr

        from analyzer.detect.rfdetr import _round_resolution

        size = settings.rfdetr_size.lower()
        cls = {
            "nano": rfdetr.RFDETRNano,
            "small": rfdetr.RFDETRSmall,
            "medium": rfdetr.RFDETRMedium,
            "large": rfdetr.RFDETRLarge,
        }[size]
        self._model = cls(
            resolution=_round_resolution(settings.imgsz()),
            pretrain_weights=path,
            device=settings.analyzer_device,
        )
        self._version = os.path.basename(path)
        raw = getattr(self._model, "class_names", None)
        if isinstance(raw, dict):
            self._names = {int(k): str(v) for k, v in raw.items()}
        elif isinstance(raw, (list, tuple)):
            self._names = {i: str(n) for i, n in enumerate(raw)}
        else:
            self._names = {}
        try:
            self._model.optimize_for_inference()
        except Exception as exc:  # noqa: BLE001 - third-party surface
            logger.warning("rfdetr aux: optimize_for_inference failed (%s)", exc)

    @property
    def model_version(self) -> str:
        return f"rfdetr:{self._version}"

    @property
    def class_names(self) -> dict[int, str]:
        return self._names

    def predict(self, frame: np.ndarray, min_confidence: float) -> list[Detection]:
        result = self._model.predict(frame, threshold=min_confidence)
        xyxy = getattr(result, "xyxy", None)
        if xyxy is None or len(xyxy) == 0:
            return []
        return [
            Detection(
                bbox=(float(b[0]), float(b[1]), float(b[2]), float(b[3])),
                confidence=float(c),
                class_id=int(k),
            )
            for b, c, k in zip(xyxy, result.confidence, result.class_id)
        ]

    def close(self) -> None:
        self._model = None


def make_aux_detector(
    settings: Settings, cfg: dict[str, Any], default_path: str, backend: str,
) -> AuxDetector:
    """Load an auxiliary model. No silent fallback: a missing file or a wrong
    backend must surface as a plugin error in /admin/features, because a
    silently absent PPE model looks exactly like a site with no violations.
    """
    path = str(cfg.get("model") or default_path)
    if not os.path.isfile(path):
        raise FileNotFoundError(
            f"model not found: {path} — put trained weights into the /models mount"
        )
    kind = str(cfg.get("backend") or backend).strip().lower()
    if kind == "rfdetr":
        return RfDetrAuxDetector(settings, path)
    if kind == "yolo":
        logger.warning(
            "aux detector backend=yolo uses ultralytics (AGPL-3.0): not licensed "
            "for on-premise delivery. Needs a checkpoint retrained with rfdetr."
        )
        return YoloAuxDetector(settings, path)
    raise ValueError(f"unknown aux detector backend: {kind!r}")
