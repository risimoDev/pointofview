from __future__ import annotations

import asyncio
import logging
import math
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from analyzer.config import Settings
from analyzer.plugins.base import BasePlugin, FrameContext, TrackInfo
from analyzer.zones.engine import Event

logger = logging.getLogger(__name__)

# COCO-17 keypoint indices used by the fall heuristic
_L_SHOULDER, _R_SHOULDER, _L_HIP, _R_HIP = 5, 6, 11, 12
_KP_MIN_CONF = 0.3


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter)


@dataclass(slots=True)
class _DownState:
    streak: int = 0
    since: float = 0.0
    last_seen: float = 0.0


class PosePlugin(BasePlugin):
    """Fall detection via pose estimation (yolov8-pose, ready-made model).

    A person is "down" when the torso (mid-shoulders → mid-hips vector) leans
    more than fall_angle_deg from vertical; if the torso keypoints are not
    confident the bbox aspect ratio is the fallback signal. The state must
    persist for min_checks_down consecutive checks before a `fall_detected`
    event fires (tracking flicker and bending over must not alert).

    config:
      model                  str    weights (default Settings.pose_model)
      zone_ids               list   restrict to zones (default: whole frame)
      fall_angle_deg         float  65 — torso angle from vertical
      aspect_ratio           float  1.4 — bbox w/h fallback threshold
      min_checks_down        int    3
      min_person_px          int    80 — bbox height
      min_confidence         float  0.4
      cooldown_seconds       float  300 — per identity
      check_interval_seconds float  0.7
    """

    feature_id = "pose"
    version = "0.1"

    def __init__(self, settings: Settings, gpu_pool: ThreadPoolExecutor | None = None) -> None:
        self.settings = settings
        self._gpu_pool = gpu_pool
        self._cfg: dict[str, Any] = {}
        self._model: Any = None
        self._last_infer: dict[str, float] = {}      # camera_id → ts
        self._down: dict[str, _DownState] = {}       # identity → streak state
        self._cooldown: dict[str, float] = {}        # identity → last alert ts

    # ── lifecycle ─────────────────────────────────────────────
    async def setup(self, cfg: dict[str, Any]) -> None:
        # Resolution order (rule 10.4: degrade, don't die):
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
                (c for c in (self.settings.pose_model, "/models/yolov8n-pose.pt")
                 if not is_path(c) or os.path.isfile(c)),
                "yolov8n-pose.pt",
            )
        from ultralytics import YOLO

        model = YOLO(path)  # bare name may auto-download; failure → error status
        model.to(self.settings.analyzer_device)
        self._model = model
        self.model_version = f"pose:{os.path.basename(path)}"
        logger.info("pose: model %s", path)

    async def teardown(self) -> None:
        self._model = None
        self._down.clear()
        self._last_infer.clear()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass

    # ── inference (runs on the shared GPU thread) ─────────────
    def _predict(self, frame: Any) -> list[dict[str, Any]]:
        result = self._model.predict(
            frame,
            conf=float(self._cfg.get("min_confidence", 0.4)),
            imgsz=self.settings.yolo_imgsz,
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
        out = []
        for i in range(len(xyxy)):
            out.append({
                "bbox": tuple(float(v) for v in xyxy[i]),
                "kp_xy": kp_xy[i] if kp_xy is not None else None,
                "kp_conf": kp_conf[i] if kp_conf is not None else None,
            })
        return out

    # ── fall heuristic ────────────────────────────────────────
    def _is_down(self, det: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
        kp_xy, kp_conf = det["kp_xy"], det["kp_conf"]
        if kp_xy is not None and kp_conf is not None:
            def _mid(i: int, j: int) -> tuple[float, float] | None:
                pts = [kp_xy[k] for k in (i, j) if float(kp_conf[k]) >= _KP_MIN_CONF]
                if not pts:
                    return None
                return (
                    sum(float(p[0]) for p in pts) / len(pts),
                    sum(float(p[1]) for p in pts) / len(pts),
                )

            shoulders = _mid(_L_SHOULDER, _R_SHOULDER)
            hips = _mid(_L_HIP, _R_HIP)
            if shoulders and hips:
                dx = hips[0] - shoulders[0]
                dy = hips[1] - shoulders[1]  # +y is down; dy<=0 → upside down
                if dy <= 0:
                    return True, {"method": "torso", "angle_deg": 180.0}
                angle = math.degrees(math.atan2(abs(dx), dy))
                threshold = float(self._cfg.get("fall_angle_deg", 65.0))
                return angle >= threshold, {"method": "torso", "angle_deg": round(angle, 1)}

        x1, y1, x2, y2 = det["bbox"]
        h = max(1.0, y2 - y1)
        ratio = (x2 - x1) / h
        threshold = float(self._cfg.get("aspect_ratio", 1.4))
        return ratio >= threshold, {"method": "aspect", "aspect": round(ratio, 2)}

    # ── per-frame hook ────────────────────────────────────────
    async def on_frame(self, ctx: FrameContext) -> list[Event]:
        if self._model is None or ctx.frame is None:
            return []
        zone_ids = set(self._cfg.get("zone_ids") or [])
        min_px = int(self._cfg.get("min_person_px", 80))
        tracks = [
            t for t in ctx.tracks
            if (t.bbox[3] - t.bbox[1]) >= min_px
            and (not zone_ids or t.zone_ids & zone_ids)
        ]
        now = ctx.ts
        self._gc_state(now)
        if not tracks:
            return []

        interval = float(self._cfg.get("check_interval_seconds", 0.7))
        if now - self._last_infer.get(ctx.camera_id, 0.0) < interval:
            return []
        self._last_infer[ctx.camera_id] = now

        loop = asyncio.get_running_loop()
        detections = await loop.run_in_executor(self._gpu_pool, self._predict, ctx.frame)
        if not detections:
            return []

        min_checks = int(self._cfg.get("min_checks_down", 3))
        cooldown = float(self._cfg.get("cooldown_seconds", 300.0))

        events: list[Event] = []
        matched: set[str] = set()
        for track in tracks:
            det = self._match(track, detections)
            if det is None:
                continue
            ident = track.identity_key()
            matched.add(ident)
            down, details = self._is_down(det)
            st = self._down.setdefault(ident, _DownState())
            st.last_seen = now
            if not down:
                st.streak = 0
                continue
            if st.streak == 0:
                st.since = now
            st.streak += 1
            if st.streak < min_checks:
                continue
            last_alert = self._cooldown.get(ident)
            if last_alert is not None and now - last_alert < cooldown:
                continue
            self._cooldown[ident] = now
            x1, y1, x2, y2 = track.bbox
            zone_id = next(iter(track.zone_ids & zone_ids), None) if zone_ids \
                else next(iter(track.zone_ids), None)
            events.append(Event(
                tenant_id=ctx.tenant_id, site_id=ctx.site_id,
                camera_id=ctx.camera_id, zone_id=zone_id,
                type="fall_detected", severity="critical",
                track_id=track.track_id, confidence=track.confidence,
                bbox={"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                meta={
                    **details,
                    "down_sec": round(now - st.since, 1),
                    "global_id": track.global_id,
                },
                ts_start=now,
            ))
        # tracks that vanished from view shouldn't keep a live streak
        for ident, st in self._down.items():
            if ident not in matched and st.last_seen < now:
                st.streak = 0
        return events

    @staticmethod
    def _match(track: TrackInfo, detections: list[dict[str, Any]]) -> dict[str, Any] | None:
        best, best_iou = None, 0.3  # minimum overlap to trust the association
        for det in detections:
            iou = _iou(track.bbox, det["bbox"])
            if iou > best_iou:
                best, best_iou = det, iou
        return best

    def _gc_state(self, now: float) -> None:
        stale = [k for k, st in self._down.items() if now - st.last_seen > 60.0]
        for k in stale:
            del self._down[k]
