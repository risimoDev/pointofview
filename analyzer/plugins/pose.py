from __future__ import annotations

import asyncio
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from analyzer.config import Settings
from analyzer.plugins.base import BasePlugin, FrameContext, TrackInfo
from analyzer.pose.base import (
    L_ANKLE, L_HIP, L_KNEE, L_SHOULDER, PoseDetection, R_ANKLE, R_HIP, R_KNEE,
    R_SHOULDER, make_pose_estimator,
)
from analyzer.zones.engine import Event

logger = logging.getLogger(__name__)

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
    """Fall detection via pose estimation; the backend is replaceable
    (analyzer/pose/: rtmo = Apache-2.0, yolo = legacy ultralytics).

    "Down" is judged on the WHOLE body axis (mid-shoulders → mid-ankles, knees
    or hips as fallback), not on the torso alone: bending over a parcel and
    squatting both tilt the torso while the body axis stays upright, and the
    torso-only rule made exactly those two the most common false alarm. The
    bbox must also be non-tall (a lying person is wide) and the state must hold
    for min_checks_down checks AND min_down_seconds — a real fall stays down,
    a bend does not.

    config:
      backend                str    rtmo | yolo (default Settings.pose_backend)
      model                  str    weights path (default per backend)
      zone_ids               list   restrict to zones (default: whole frame)
      fall_angle_deg         float  65 — body axis angle from vertical
      aspect_ratio           float  1.4 — bbox w/h fallback threshold
      min_aspect_down        float  0.85 — bbox w/h required to confirm a fall
      min_down_seconds       float  5 — how long the person must stay down
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
        self._model = make_pose_estimator(self.settings, cfg)
        self.model_version = self._model.model_version

    async def teardown(self) -> None:
        if self._model is not None:
            self._model.close()
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
    def _predict(self, frame: Any) -> list[PoseDetection]:
        return self._model.predict(
            frame, float(self._cfg.get("min_confidence", 0.4)),
        )

    # ── fall heuristic ────────────────────────────────────────
    def _is_down(
        self, det: PoseDetection, track_bbox: tuple[float, float, float, float],
    ) -> tuple[bool, dict[str, Any]]:
        # Aspect comes from the TRACK box, not the pose box: RTMO returns no
        # person box and a keypoint-derived one hugs the skeleton, which would
        # silently shift min_aspect_down. The track box has the same meaning on
        # every backend.
        x1, y1, x2, y2 = track_bbox
        h = max(1.0, y2 - y1)
        ratio = (x2 - x1) / h
        kp_xy, kp_conf = det.kp_xy, det.kp_conf
        if kp_xy is not None and kp_conf is not None:
            def _mid(*idx: int) -> tuple[float, float] | None:
                pts = [kp_xy[k] for k in idx if float(kp_conf[k]) >= _KP_MIN_CONF]
                if not pts:
                    return None
                return (
                    sum(float(p[0]) for p in pts) / len(pts),
                    sum(float(p[1]) for p in pts) / len(pts),
                )

            top = _mid(L_SHOULDER, R_SHOULDER)
            # legs first: bending over keeps the feet under the body, so the
            # shoulders→ankles axis stays vertical while the torso is horizontal
            bottom = _mid(L_ANKLE, R_ANKLE) or _mid(L_KNEE, R_KNEE)
            method = "body"
            if bottom is None:
                bottom = _mid(L_HIP, R_HIP)
                method = "torso"
            if top and bottom:
                dx = bottom[0] - top[0]
                dy = bottom[1] - top[1]  # +y is down; dy<=0 → head below feet
                angle = 180.0 if dy <= 0 else math.degrees(math.atan2(abs(dx), dy))
                threshold = float(self._cfg.get("fall_angle_deg", 65.0))
                details = {"method": method, "angle_deg": round(angle, 1),
                           "aspect": round(ratio, 2)}
                if angle < threshold:
                    return False, details
                # corroboration: a person on the floor is wide in the frame.
                # Without it a torso-only judgement (legs hidden behind a rack
                # or a counter) still fires on someone leaning over.
                min_aspect = float(self._cfg.get("min_aspect_down", 0.85))
                return ratio >= min_aspect, details

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
        min_down_sec = float(self._cfg.get("min_down_seconds", 5.0))
        cooldown = float(self._cfg.get("cooldown_seconds", 300.0))

        events: list[Event] = []
        matched: set[str] = set()
        for track in tracks:
            det = self._match(track, detections)
            if det is None:
                continue
            ident = track.identity_key()
            matched.add(ident)
            down, details = self._is_down(det, track.bbox)
            st = self._down.setdefault(ident, _DownState())
            st.last_seen = now
            if not down:
                st.streak = 0
                continue
            if st.streak == 0:
                st.since = now
            st.streak += 1
            # both gates: N checks (anti-flicker) and wall-clock seconds — a
            # bend or a squat is over in a second or two, a fall is not
            if st.streak < min_checks or now - st.since < min_down_sec:
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
    def _match(track: TrackInfo, detections: list[PoseDetection]) -> PoseDetection | None:
        best, best_iou = None, 0.3  # minimum overlap to trust the association
        for det in detections:
            iou = _iou(track.bbox, det.bbox)
            if iou > best_iou:
                best, best_iou = det, iou
        return best

    def _gc_state(self, now: float) -> None:
        stale = [k for k, st in self._down.items() if now - st.last_seen > 60.0]
        for k in stale:
            del self._down[k]
