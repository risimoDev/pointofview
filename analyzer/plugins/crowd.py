from __future__ import annotations

from typing import Any

from analyzer.config import Settings
from analyzer.plugins.base import BasePlugin, FrameContext
from analyzer.zones.engine import Event


class CrowdPlugin(BasePlugin):
    """People-count safety rules: crowding and lone work.

    Crowd: emits a `crowd` event when too many people are present at once.
    Frame-wide by default; scope to specific zones with config zone_ids.
    config:
      max_count       int    threshold (default 10)
      cooldown_seconds float  re-alert debounce (default settings default)
      zone_ids        list[str]  restrict counting to these zones

    Lone worker (работа в одиночку, docs/architecture/14_FACTORY_MODULES.md,
    10): the inverse rule, per zone. A zone with `config.min_people >= 2`
    alerts when 0 < people-in-zone < min_people persistently — a labor-safety
    requirement for hazardous work. No extra model: pure geometry over the
    zones this plugin already sees. Staff COUNT here (workers are the
    subjects), unlike the crowd rule which ignores them.
    Zone config:
      min_people          int    2+ enables the rule for the zone
      min_people_seconds  float  30 — how long the condition must persist
      cooldown_seconds    float  300 — re-alert debounce per zone
    """

    feature_id = "crowd"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._cfg: dict[str, Any] = {}
        self._last_alert: dict[str, float] = {}   # camera_id -> ts (per-camera cooldown)
        self._lone_since: dict[tuple[str, str], float] = {}  # (camera, zone) -> ts
        self._lone_alert: dict[tuple[str, str], float] = {}  # (camera, zone) -> last alert ts

    def is_enabled(self, tenant_features: dict[str, Any]) -> bool:
        feat = tenant_features.get(self.feature_id)
        if not feat or not feat.get("enabled"):
            return False
        self._cfg = feat.get("config") or {}
        return True

    async def on_frame(self, ctx: FrameContext) -> list[Event]:
        return self._crowd(ctx) + self._lone_worker(ctx)

    # ── crowd ─────────────────────────────────────────────────
    def _crowd(self, ctx: FrameContext) -> list[Event]:
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

    # ── lone worker ───────────────────────────────────────────
    def _lone_worker(self, ctx: FrameContext) -> list[Event]:
        events: list[Event] = []
        for zone in ctx.zones:
            try:
                min_people = int(zone.config.get("min_people") or 0)
            except (TypeError, ValueError):
                continue
            if min_people < 2:
                continue
            key = (ctx.camera_id, zone.id)
            count = len(ctx.tracks_in_zone(zone.id))
            if count == 0 or count >= min_people:
                self._lone_since.pop(key, None)
                continue

            since = self._lone_since.setdefault(key, ctx.ts)
            min_seconds = float(zone.config.get("min_people_seconds", 30.0))
            if ctx.ts - since < min_seconds:
                continue  # brief pass-through is not lone work
            cooldown = float(zone.config.get("cooldown_seconds", 300.0))
            last = self._lone_alert.get(key)
            if last is not None and ctx.ts - last < cooldown:
                continue
            self._lone_alert[key] = ctx.ts

            events.append(Event(
                tenant_id=ctx.tenant_id, site_id=ctx.site_id,
                camera_id=ctx.camera_id, zone_id=zone.id,
                type="lone_worker", severity="critical",
                meta={
                    "count": count,
                    "min_people": min_people,
                    "duration_sec": round(ctx.ts - since, 1),
                },
                ts_start=ctx.ts,
            ))
        return events
