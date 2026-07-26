from __future__ import annotations

import logging
import os
from typing import Any

import numpy as np

from analyzer.config import Settings
from analyzer.detect.base import Detection

logger = logging.getLogger(__name__)

# Canonical class order the pipeline speaks: COCO-80, person == 0
# (analyzer.detect.base.PERSON_CLASS). RF-DETR's pretrained checkpoints emit
# the 91-entry COCO indexing where person == 1, so ids are translated by NAME
# at startup rather than by a hardcoded offset — a fine-tuned checkpoint may
# use any ordering at all.
COCO80: tuple[str, ...] = (
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck",
    "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench",
    "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
    "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove",
    "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup",
    "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
    "hair drier", "toothbrush",
)
_CANONICAL = {name: idx for idx, name in enumerate(COCO80)}

_SIZES = ("nano", "small", "medium", "large")
RESOLUTION_STEP = 56  # RF-DETR requires input resolution divisible by 56

# DETR-family scores are calibrated differently from YOLO's: the model emits
# hundreds of query proposals per frame, and YOLO's 0.3 lets through boxes an
# NMS pipeline would never have produced. Inheriting yolo_conf here is what
# caused the zone false positives on прод right after the switch. Same class
# of bug as running OSNet on the histogram thresholds — so the fix is the
# same: the backend states its own default and logs it.
DEFAULT_CONF = 0.5


def _round_resolution(value: int) -> int:
    """Snap to the nearest valid resolution; RF-DETR rejects anything else."""
    snapped = max(RESOLUTION_STEP, round(value / RESOLUTION_STEP) * RESOLUTION_STEP)
    if snapped != value:
        logger.warning(
            "rfdetr: resolution %d is not divisible by %d, using %d",
            value, RESOLUTION_STEP, snapped,
        )
    return snapped


def _class_names(model: Any) -> dict[int, str] | None:
    """Native class id -> name, whatever shape the package exposes it in."""
    names = getattr(model, "class_names", None)
    if isinstance(names, dict):
        return {int(k): str(v) for k, v in names.items()}
    if isinstance(names, (list, tuple)):
        return {i: str(n) for i, n in enumerate(names)}
    return None


class RfDetrDetector:
    """RF-DETR (Apache-2.0) behind the Detector protocol.

    Only Nano/Small/Medium/Large are allowed: XL/2XL ship under a separate
    licence and are out of scope for this product (docs/commercial/
    01_LICENSE_REMEDIATION.md, decision 1).
    """

    name = "rfdetr"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        size = settings.rfdetr_size.lower()
        if size not in _SIZES:
            raise ValueError(f"rfdetr_size must be one of {_SIZES}, got {size!r}")

        import rfdetr  # imported here so the module is optional at import time

        cls = {
            "nano": rfdetr.RFDETRNano,
            "small": rfdetr.RFDETRSmall,
            "medium": rfdetr.RFDETRMedium,
            "large": rfdetr.RFDETRLarge,
        }[size]

        kwargs: dict[str, Any] = {"resolution": _round_resolution(settings.imgsz())}
        weights = settings.rfdetr_weights.strip()
        if weights:
            if not os.path.exists(weights):
                raise FileNotFoundError(f"rfdetr_weights not found: {weights}")
            kwargs["pretrain_weights"] = weights
        if settings.analyzer_device:
            kwargs["device"] = settings.analyzer_device

        self._model = cls(**kwargs)
        self._version = os.path.basename(weights) if weights else f"coco-{size}"
        # yolo_conf is NOT a fallback here — see DEFAULT_CONF.
        self._conf = (settings.detector_conf if settings.detector_conf is not None
                      else DEFAULT_CONF)
        self._native_to_canonical = self._build_class_map()

        # torch.compile-based speedup; never fatal — an unoptimised model is
        # slower but correct, and a hard failure here would take the worker down.
        try:
            self._model.optimize_for_inference()
        except Exception as exc:  # noqa: BLE001 - third-party surface
            logger.warning("rfdetr: optimize_for_inference failed (%s), continuing", exc)

    def _build_class_map(self) -> dict[int, int]:
        """Native ids -> canonical COCO-80 ids, resolved by class name.

        A wrong mapping here is invisible downstream (people counted as
        bicycles, zones never firing), so the person id is logged explicitly
        and an unresolvable mapping is a hard startup error.
        """
        names = _class_names(self._model)
        if names is None:
            raise RuntimeError(
                "rfdetr: model exposes no class_names; cannot map class ids safely"
            )

        mapping: dict[int, int] = {}
        for native_id, raw in names.items():
            canonical = _CANONICAL.get(raw.strip().lower())
            if canonical is not None:
                mapping[native_id] = canonical

        person_native = [n for n, c in mapping.items() if c == 0]
        if not person_native:
            raise RuntimeError(
                f"rfdetr: no 'person' class among {sorted(names.values())[:10]}...; "
                "a custom checkpoint must expose a class literally named 'person'"
            )
        logger.info(
            "rfdetr: %s, resolution %s, conf %.2f (%s), person native id=%d -> "
            "canonical 0, %d of %d classes mapped",
            self._version,
            _round_resolution(self.settings.imgsz()),
            self._conf,
            "DETECTOR_CONF" if self.settings.detector_conf is not None
            else f"default for rfdetr; yolo_conf={self.settings.yolo_conf} ignored",
            person_native[0],
            len(mapping),
            len(names),
        )
        return mapping

    @property
    def model_version(self) -> str:
        return f"{self.name}:{self.settings.rfdetr_size}:{self._version}"

    def detect(self, frame: np.ndarray, classes: list[int]) -> list[Detection]:
        """`classes` are canonical COCO-80 ids; RF-DETR has no class filter of
        its own, so filtering happens after translation.
        """
        wanted = set(classes)
        result = self._model.predict(frame, threshold=self._conf)

        xyxy = getattr(result, "xyxy", None)
        if xyxy is None or len(xyxy) == 0:
            return []
        confidence = result.confidence
        class_id = result.class_id

        out: list[Detection] = []
        for box, conf, native in zip(xyxy, confidence, class_id):
            canonical = self._native_to_canonical.get(int(native))
            if canonical is None or (wanted and canonical not in wanted):
                continue
            out.append(
                Detection(
                    bbox=(float(box[0]), float(box[1]), float(box[2]), float(box[3])),
                    confidence=float(conf),
                    class_id=canonical,
                )
            )
        return out
