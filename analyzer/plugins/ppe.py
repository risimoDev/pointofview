from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from analyzer.config import Settings
from analyzer.plugins.base import BasePlugin, FrameContext, TrackInfo
from analyzer.zones.engine import Event

logger = logging.getLogger(__name__)

# PPE items we support in v1. Helmet + vest only — deliberately (docs/
# architecture/14_FACTORY_MODULES.md, 5.1): glasses/gloves detect too poorly
# on a CCTV frame to act on.
_ITEM_KEYWORDS = {
    "helmet": ("helmet", "hardhat", "hard-hat"),
    "vest": ("vest", "waistcoat"),
}


@dataclass(slots=True)
class _PersonState:
    first_seen: float
    last_seen: float
    missing_streak: int = 0
    last_missing: list[str] = field(default_factory=list)


class PpePlugin(BasePlugin):
    """PPE (helmet/vest) control in `required_ppe` zones.

    Own auxiliary YOLO model (weights are a deploy artifact, not part of the
    image): loaded in setup(), freed in teardown(). PPE items are detected but
    NOT tracked — each check they are geometrically associated with tracked
    persons (helmet → top band of the person bbox, vest → torso band).

    Protections (docs 14_FACTORY_MODULES.md, 5.4): grace period after a person
    appears in the zone, N consecutive missing checks, confidence and person
    size thresholds, per-identity cooldown.

    config:
      model                 str    weights path (default Settings.ppe_model)
      required              list   default required items (zone.config.required wins)
      grace_seconds         float  5 — time to put the helmet on after entering
      min_checks_without    int    3  — consecutive checks without PPE before the event
      min_confidence        float  0.6
      min_person_px         int    80 — bbox height (people are small on a PVZ
                                   camera; 120 px silently skipped everyone)
      cooldown_seconds      float  300 — per identity (re-id), not per camera
      check_interval_seconds float 1.0 — PPE inference at most once per N sec
    """

    feature_id = "ppe"
    version = "0.1"

    def __init__(self, settings: Settings, gpu_pool: ThreadPoolExecutor | None = None) -> None:
        self.settings = settings
        self._gpu_pool = gpu_pool
        self._cfg: dict[str, Any] = {}
        self._model: Any = None
        self._class_map: dict[int, str] = {}          # model class id → item
        self._last_infer: dict[str, float] = {}       # camera_id → ts
        self._state: dict[tuple[str, str, str], _PersonState] = {}  # (camera, zone, ident)
        self._cooldown: dict[str, float] = {}         # ident → last alert ts

    # ── lifecycle ─────────────────────────────────────────────
    async def setup(self, cfg: dict[str, Any]) -> None:
        path = str(cfg.get("model") or self.settings.ppe_model)
        if not os.path.isfile(path):
            raise FileNotFoundError(
                f"PPE model not found: {path} — put trained weights into the /models mount"
            )
        from ultralytics import YOLO  # deferred: only pay when the feature is on

        model = YOLO(path)
        model.to(self.settings.analyzer_device)
        class_map: dict[int, str] = {}
        names = getattr(model, "names", None) or {}
        for cid, raw_name in names.items():
            name = str(raw_name).lower()
            if name.startswith(("no-", "no_", "no ")):
                continue  # negative classes (no-helmet) — we infer absence ourselves
            for item, keywords in _ITEM_KEYWORDS.items():
                if any(k in name for k in keywords):
                    class_map[int(cid)] = item
        # explicit override for models with non-obvious class names
        for item, ids in (cfg.get("class_map") or {}).items():
            if item in _ITEM_KEYWORDS:
                for cid in ids:
                    class_map[int(cid)] = item
        if not class_map:
            raise ValueError(
                f"PPE model {path}: no helmet/vest classes recognized in {names} — "
                "set config.class_map"
            )
        self._model = model
        self._class_map = class_map
        self.model_version = f"ppe:{os.path.basename(path)}"
        logger.info("ppe: model %s, classes %s", path, class_map)

    async def teardown(self) -> None:
        self._model = None
        self._class_map = {}
        self._state.clear()
        self._last_infer.clear()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()  # return freed blocks to the driver
        except Exception:  # noqa: BLE001
            pass

    # ── inference (runs on the shared GPU thread) ─────────────
    def _predict(self, frame: Any) -> list[tuple[str, tuple[float, float, float, float], float]]:
        result = self._model.predict(
            frame,
            conf=float(self._cfg.get("min_confidence", 0.6)),
            imgsz=self.settings.yolo_imgsz,
            device=self.settings.analyzer_device,
            verbose=False,
        )[0]
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return []
        out = []
        xyxy = boxes.xyxy.cpu().numpy()
        conf = boxes.conf.cpu().numpy()
        cls = boxes.cls.cpu().numpy()
        for x, c, k in zip(xyxy, conf, cls):
            item = self._class_map.get(int(k))
            if item:
                out.append((item, (float(x[0]), float(x[1]), float(x[2]), float(x[3])), float(c)))
        return out

    # ── geometry: assign PPE detections to a person ───────────
    @staticmethod
    def _has_item(
        item: str,
        person: tuple[float, float, float, float],
        detections: list[tuple[str, tuple[float, float, float, float], float]],
    ) -> bool:
        px1, py1, px2, py2 = person
        pw = px2 - px1
        ph = py2 - py1
        for kind, (x1, y1, x2, y2), _c in detections:
            if kind != item:
                continue
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0
            if not (px1 - 0.1 * pw <= cx <= px2 + 0.1 * pw):
                continue
            if item == "helmet" and py1 - 0.1 * ph <= cy <= py1 + 0.4 * ph:
                return True  # head band (helmet sits at/above the bbox top)
            if item == "vest" and py1 + 0.2 * ph <= cy <= py1 + 0.75 * ph:
                return True  # torso band
        return False

    # ── per-frame hook ────────────────────────────────────────
    async def on_frame(self, ctx: FrameContext) -> list[Event]:
        if self._model is None or ctx.frame is None:
            return []
        ppe_zones = [z for z in ctx.zones if z.kind == "required_ppe"]
        if not ppe_zones:
            return []

        min_px = int(self._cfg.get("min_person_px", 80))
        candidates: list[tuple[TrackInfo, list[Any]]] = []
        for t in ctx.tracks:
            if (t.bbox[3] - t.bbox[1]) < min_px:
                continue  # too far away to judge
            zones = [z for z in ppe_zones if z.id in t.zone_ids]
            if zones:
                candidates.append((t, zones))
        now = ctx.ts
        self._gc_state(now)
        if not candidates:
            return []

        interval = float(self._cfg.get("check_interval_seconds", 1.0))
        last = self._last_infer.get(ctx.camera_id, 0.0)
        if now - last < interval:
            return []
        self._last_infer[ctx.camera_id] = now

        loop = asyncio.get_running_loop()
        detections = await loop.run_in_executor(self._gpu_pool, self._predict, ctx.frame)

        grace = float(self._cfg.get("grace_seconds", 5.0))
        min_checks = int(self._cfg.get("min_checks_without", 3))
        cooldown = float(self._cfg.get("cooldown_seconds", 300.0))
        default_required = list(self._cfg.get("required") or ["helmet"])

        events: list[Event] = []
        for track, zones in candidates:
            ident = track.identity_key()
            for zone in zones:
                required = list(zone.config.get("required") or default_required)
                required = [r for r in required if r in _ITEM_KEYWORDS]
                if not required:
                    continue
                present = [r for r in required if self._has_item(r, track.bbox, detections)]
                missing = [r for r in required if r not in present]

                key = (ctx.camera_id, zone.id, ident)
                st = self._state.get(key)
                if st is None:
                    st = self._state[key] = _PersonState(first_seen=now, last_seen=now)
                st.last_seen = now
                if not missing:
                    st.missing_streak = 0
                    continue
                if now - st.first_seen < grace:
                    continue  # still putting the helmet on at the entrance
                st.missing_streak += 1
                st.last_missing = missing
                if st.missing_streak < min_checks:
                    continue
                last_alert = self._cooldown.get(ident)
                if last_alert is not None and now - last_alert < cooldown:
                    continue
                self._cooldown[ident] = now
                st.missing_streak = 0
                x1, y1, x2, y2 = track.bbox
                events.append(Event(
                    tenant_id=ctx.tenant_id, site_id=ctx.site_id,
                    camera_id=ctx.camera_id, zone_id=zone.id,
                    type="ppe_violation", severity="critical",
                    track_id=track.track_id, confidence=track.confidence,
                    bbox={"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                    meta={
                        "missing": missing,
                        "present": present,
                        "duration_sec": round(now - st.first_seen, 1),
                        "global_id": track.global_id,
                    },
                    ts_start=now,
                ))
        return events

    def _gc_state(self, now: float) -> None:
        stale = [k for k, st in self._state.items() if now - st.last_seen > 60.0]
        for k in stale:
            del self._state[k]
