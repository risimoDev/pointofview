from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as aioredis

from analyzer.config import Settings
from analyzer.plugins.base import FrameContext
from analyzer.zones.engine import Event


class CounterPlugin:
    """People counting / occupancy. Produces no events — writes a throttled
    metric to Redis for the API/dashboard:

      occupancy:{tenant_id}  (hash)  camera_id -> {occupancy, visitors, ts}

    Occupancy = live track count (within `counter` zones if any exist on the
    camera, else frame-wide). Visitors = cumulative distinct track_ids.
    config:
      interval_seconds  float  metric flush cadence (default 60)
    """

    feature_id = "counter"

    def __init__(self, settings: Settings, redis: aioredis.Redis) -> None:
        self.settings = settings
        self.redis = redis
        self._cfg: dict[str, Any] = {}
        self._seen: dict[str, set[int]] = {}        # camera_id -> track_ids seen today
        self._day: dict[str, str] = {}              # camera_id -> UTC date of _seen
        self._last_flush: dict[str, float] = {}     # camera_id -> ts

    def is_enabled(self, tenant_features: dict[str, Any]) -> bool:
        feat = tenant_features.get(self.feature_id)
        if not feat or not feat.get("enabled"):
            return False
        self._cfg = feat.get("config") or {}
        return True

    async def on_frame(self, ctx: FrameContext) -> list[Event]:
        counter_zone_ids = {z.id for z in ctx.zones if z.kind == "counter"}
        if counter_zone_ids:
            present = [t for t in ctx.tracks if t.zone_ids & counter_zone_ids]
        else:
            present = ctx.tracks

        # visitors is a per-day distinct count → reset the set on UTC day rollover
        day = datetime.fromtimestamp(ctx.ts, tz=timezone.utc).strftime("%Y-%m-%d")
        if self._day.get(ctx.camera_id) != day:
            self._day[ctx.camera_id] = day
            self._seen[ctx.camera_id] = set()
            self._last_flush.pop(ctx.camera_id, None)   # flush immediately after reset

        seen = self._seen.setdefault(ctx.camera_id, set())
        seen.update(t.track_id for t in present)

        interval = float(self._cfg.get("interval_seconds", 60.0))
        last = self._last_flush.get(ctx.camera_id)
        if last is None or ctx.ts - last >= interval:
            self._last_flush[ctx.camera_id] = ctx.ts
            await self.redis.hset(
                f"occupancy:{ctx.tenant_id}",
                ctx.camera_id,
                json.dumps({
                    "occupancy": len(present),
                    "visitors": len(seen),
                    "day": day,
                    "ts": ctx.ts,
                }),
            )
        return []
