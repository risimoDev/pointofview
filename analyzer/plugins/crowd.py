from __future__ import annotations

from typing import Any

from analyzer.config import Settings
from analyzer.plugins.base import BasePlugin, FrameContext
from analyzer.zones.engine import Event


class CrowdPlugin(BasePlugin):
    """Emits a `crowd` event when too many people are present at once.

    Frame-wide by default; scope to specific zones with config zone_ids.
    config:
      max_count       int    threshold (default 10)
      cooldown_seconds float  re-alert debounce (default settings default)
      zone_ids        list[str]  restrict counting to these zones
    """

    feature_id = "crowd"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._cfg: dict[str, Any] = {}
        self._last_alert: dict[str, float] = {}   # camera_id -> ts (per-camera cooldown)

    def is_enabled(self, tenant_features: dict[str, Any]) -> bool:
        feat = tenant_features.get(self.feature_id)
        if not feat or not feat.get("enabled"):
            return False
        self._cfg = feat.get("config") or {}
        return True

    async def on_frame(self, ctx: FrameContext) -> list[Event]:
        zone_ids = set(self._cfg.get("zone_ids") or [])
        # staff don't make a crowd (reid feature; staff=False when reid is off)
        people = [t for t in ctx.tracks if not t.staff]
        if zone_ids:
            count = sum(1 for t in people if t.zone_ids & zone_ids)
        else:
            count = len(people)

        max_count = int(self._cfg.get("max_count", 10))
        if count < max_count:
            return []

        cooldown = float(self._cfg.get("cooldown_seconds",
                                       self.settings.default_cooldown_seconds))
        last = self._last_alert.get(ctx.camera_id)
        if last is not None and ctx.ts - last < cooldown:
            return []
        self._last_alert[ctx.camera_id] = ctx.ts

        severity = "critical" if count >= max_count * 1.5 else "warn"
        scope_zone = next(iter(zone_ids)) if len(zone_ids) == 1 else None
        return [Event(
            tenant_id=ctx.tenant_id, site_id=ctx.site_id, camera_id=ctx.camera_id,
            zone_id=scope_zone, type="crowd", severity=severity,
            meta={"count": count, "threshold": max_count}, ts_start=ctx.ts,
        )]
