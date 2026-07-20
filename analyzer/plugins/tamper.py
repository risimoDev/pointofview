from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from analyzer.config import Settings
from analyzer.plugins.base import BasePlugin, FrameContext
from analyzer.zones.engine import Event

logger = logging.getLogger(__name__)

_GRID_W, _GRID_H = 64, 36  # downscale for reference comparison (cheap, CPU)


@dataclass(slots=True)
class _CamState:
    ref: np.ndarray | None = None      # EMA reference of the downscaled scene
    ref_blur: float = 0.0              # EMA of healthy-scene sharpness
    healthy_checks: int = 0
    streak: int = 0
    last_reason: str = ""
    last_check: float = 0.0
    last_alert: float = 0.0
    metrics: dict[str, float] = field(default_factory=dict)


class TamperPlugin(BasePlugin):
    """Camera tampering: blackout/blinding, covering/defocus, scene shift.

    Works on the raw frame (no models, CPU-cheap): brightness bounds, sharpness
    relative to the camera's own healthy baseline (absolute blur thresholds
    false-positive on plain scenes), and correlation of a downscaled grayscale
    against a slowly-adapting reference. The condition must persist for
    min_checks consecutive checks, then a critical `camera_tampered` event
    fires (per-camera cooldown). The reference keeps adapting only while the
    scene is healthy, so gradual lighting changes don't alarm; an instant
    day/night IR switch may produce one alert — cooldown absorbs the rest.

    config:
      check_interval_seconds 1.0
      min_brightness  18   — темнее = закрыта/сломана подсветка
      max_brightness  238  — ярче = ослепление фонарём
      blur_ratio      0.25 — резкость < 25% собственной нормы = расфокус/плёнка
      scene_threshold 0.35 — корреляция с эталоном ниже = сдвиг/поворот
      min_checks      8    — подряд проверок до события
      warmup_checks   15   — здоровых проверок до готовности эталона
      cooldown_seconds 600 — по камере
    """

    feature_id = "tamper"
    version = "0.1"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._cfg: dict[str, Any] = {}
        self._cams: dict[str, _CamState] = {}

    async def teardown(self) -> None:
        self._cams.clear()

    # ── analysis (pure numpy/cv2, ~64×36 px) ──────────────────
    def _analyze(self, frame: np.ndarray, st: _CamState) -> str | None:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (_GRID_W, _GRID_H), interpolation=cv2.INTER_AREA)
        smallf = small.astype(np.float32)
        brightness = float(smallf.mean())
        # sharpness on a mid-size crop: Laplacian variance
        mid = cv2.resize(gray, (320, 180), interpolation=cv2.INTER_AREA)
        blur = float(cv2.Laplacian(mid, cv2.CV_32F).var())
        st.metrics = {"brightness": round(brightness, 1), "sharpness": round(blur, 1)}

        if brightness < float(self._cfg.get("min_brightness", 18.0)):
            return "blackout"
        if brightness > float(self._cfg.get("max_brightness", 238.0)):
            return "blinded"

        warmed = st.healthy_checks >= int(self._cfg.get("warmup_checks", 15))
        if warmed and st.ref_blur > 1.0 \
                and blur < st.ref_blur * float(self._cfg.get("blur_ratio", 0.25)):
            return "defocus"

        if warmed and st.ref is not None:
            a = smallf - smallf.mean()
            b = st.ref - st.ref.mean()
            denom = float(np.sqrt((a * a).sum() * (b * b).sum())) + 1e-6
            corr = float((a * b).sum()) / denom
            st.metrics["scene_corr"] = round(corr, 2)
            if corr < float(self._cfg.get("scene_threshold", 0.35)):
                return "scene_change"

        # healthy: adapt the baselines (never while tampered — a covered
        # camera must not become the new normal)
        st.healthy_checks += 1
        alpha = 0.05
        st.ref = smallf if st.ref is None else (1 - alpha) * st.ref + alpha * smallf
        st.ref_blur = blur if st.ref_blur == 0.0 else (1 - alpha) * st.ref_blur + alpha * blur
        return None

    async def on_frame(self, ctx: FrameContext) -> list[Event]:
        if ctx.frame is None:
            return []
        now = ctx.ts
        st = self._cams.setdefault(ctx.camera_id, _CamState())
        interval = float(self._cfg.get("check_interval_seconds", 1.0))
        if now - st.last_check < interval:
            return []
        st.last_check = now

        reason = self._analyze(ctx.frame, st)
        if reason is None:
            if st.streak > 0:
                logger.info("tamper %s: recovered after %d checks (%s)",
                            ctx.camera_id, st.streak, st.last_reason)
            st.streak = 0
            return []

        st.streak += 1
        st.last_reason = reason
        if st.streak < int(self._cfg.get("min_checks", 8)):
            return []
        cooldown = float(self._cfg.get("cooldown_seconds", 600.0))
        if now - st.last_alert < cooldown:
            return []
        st.last_alert = now
        logger.warning("tamper %s: %s (%s)", ctx.camera_id, reason, st.metrics)
        return [Event(
            tenant_id=ctx.tenant_id, site_id=ctx.site_id, camera_id=ctx.camera_id,
            zone_id=None, type="camera_tampered", severity="critical",
            meta={"reason": reason, **st.metrics},
            ts_start=now,
        )]
