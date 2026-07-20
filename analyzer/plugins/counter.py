from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as aioredis

from analyzer.config import Settings
from analyzer.plugins.base import BasePlugin, FrameContext
from analyzer.zones.engine import Event


class CounterPlugin(BasePlugin):
    """People counting / occupancy. Produces no events — writes throttled
    metrics to Redis for the API/dashboard:

      occupancy:{tenant_id}  (hash)  camera_id -> {occupancy, ts}
      visitors:{tenant_id}   (hash)  site_id   -> {visitors, day, ts}

    Occupancy = live non-staff track count (within `counter` zones if any exist
    on the camera, else frame-wide). Visitors = per-SITE distinct people per
    day: when the reid feature is on, distinct global identities (one person
    walking across 4 cameras counts once); otherwise per-camera track ids are
    used as a fallback. Staff never count as visitors.
    config:
      interval_seconds  float  metric flush cadence (default 60)
    """

    feature_id = "counter"

    def __init__(self, settings: Settings, redis: aioredis.Redis) -> None:
        self.settings = settings
        self.redis = redis
        self._cfg: dict[str, Any] = {}
        self._seen: dict[str, set[str]] = {}        # site_id -> person keys seen today
        self._day: dict[str, str] = {}              # site_id -> UTC date of _seen
        self._last_flush: dict[str, float] = {}     # camera_id -> ts (occupancy)
        self._last_site_flush: dict[str, float] = {}  # site_id -> ts (visitors)

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
        present = [t for t in present if not t.staff]

        # visitors: per-site distinct people per day (UTC day rollover)
        day = datetime.fromtimestamp(ctx.ts, tz=timezone.utc).strftime("%Y-%m-%d")
        if self._day.get(ctx.site_id) != day:
            self._day[ctx.site_id] = day
            self._seen[ctx.site_id] = set()
            self._last_site_flush.pop(ctx.site_id, None)  # flush right after reset

        seen = self._seen.setdefault(ctx.site_id, set())
        for t in present:
            # reid on but identity unresolved yet: don't count noise as a visitor
            if t.reid_pending:
                continue
            # global identity dedupes across cameras; fallback keeps old behavior
            seen.add(t.global_id or f"{ctx.camera_id}:{t.track_id}")

        interval = float(self._cfg.get("interval_seconds", 60.0))

        last = self._last_flush.get(ctx.camera_id)
        if last is None or ctx.ts - last >= interval:
            self._last_flush[ctx.camera_id] = ctx.ts
            await self.redis.hset(
                f"occupancy:{ctx.tenant_id}",
                ctx.camera_id,
                json.dumps({"occupancy": len(present), "ts": ctx.ts}),
            )

        last_site = self._last_site_flush.get(ctx.site_id)
        if last_site is None or ctx.ts - last_site >= interval:
            self._last_site_flush[ctx.site_id] = ctx.ts
            # Retro-cleanup: a staff member who failed to match early minted
            # phantom visitor identities that already landed in `seen`. Once
            # they're absorbed into staff (absorbed:{site}, written by the
            # analyzer and the «Люди» page) — or the person is marked staff
            # directly — subtract them so the day counter self-heals instead
            # of keeping «2 курьера = 44 посетителя» forever.
            try:
                absorbed = await self.redis.smembers(f"absorbed:{ctx.site_id}")
                staff_gids = await self.redis.hkeys(
                    f"reid:staff:{ctx.tenant_id}")
                seen -= set(absorbed) | set(staff_gids)
            except Exception:  # noqa: BLE001 — cleanup is best-effort
                pass
            await self.redis.hset(
                f"visitors:{ctx.tenant_id}",
                ctx.site_id,
                json.dumps({"visitors": len(seen), "day": day, "ts": ctx.ts}),
            )
        return []
