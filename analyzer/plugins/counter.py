from __future__ import annotations

import json
from typing import Any

import redis.asyncio as aioredis

from analyzer.config import Settings
from analyzer.plugins.base import BasePlugin, FrameContext
from analyzer.zones.engine import Event, local_datetime


class CounterPlugin(BasePlugin):
    """People counting / occupancy. Produces no events — writes throttled
    metrics to Redis for the API/dashboard:

      occupancy:{tenant_id}:{camera_id}  (string, TTL)  {occupancy, ts}
      visitors:{tenant_id}               (hash)  site_id -> {visitors, day, ts}

    Two different questions, deliberately answered differently:

    * **Occupancy** — how many people are in view of this camera right now.
      Everyone counts, staff included: on a shop floor everyone is staff, and
      a number that excluded them would read 0 on a correctly trained site.
    * **Visitors** — how many distinct people came to this SITE today. Staff
      are excluded here, because an employee walking past a camera all day is
      not a visitor. With the reid feature on, distinct global identities are
      used, so one person seen by four cameras counts once.

    config:
      interval_seconds   float  occupancy flush cadence (default 10)
      window_seconds     float  smoothing window for occupancy (default 10)
      include_staff      bool   count staff in occupancy (default true)
    """

    feature_id = "counter"

    # A dead analyzer or an unplugged camera must not leave a number frozen on
    # the dashboard forever, so the occupancy key expires on its own. Redis is
    # the one place that keeps working while the writer is gone.
    _MIN_TTL = 30

    def __init__(self, settings: Settings, redis: aioredis.Redis) -> None:
        self.settings = settings
        self.redis = redis
        self._cfg: dict[str, Any] = {}
        self._seen: dict[str, set[str]] = {}        # site_id -> person keys seen today
        self._day: dict[str, str] = {}              # site_id -> local date of _seen
        self._last_flush: dict[str, float] = {}     # camera_id -> ts (occupancy)
        self._last_site_flush: dict[str, float] = {}  # site_id -> ts (visitors)
        self._window: dict[str, list[tuple[float, int]]] = {}  # camera_id -> (ts, count)

    def is_enabled(self, tenant_features: dict[str, Any]) -> bool:
        feat = tenant_features.get(self.feature_id)
        if not feat or not feat.get("enabled"):
            return False
        self._cfg = feat.get("config") or {}
        return True

    async def on_frame(self, ctx: FrameContext) -> list[Event]:
        counter_zone_ids = {z.id for z in ctx.zones if z.kind == "counter"}
        if counter_zone_ids:
            in_view = [t for t in ctx.tracks if t.zone_ids & counter_zone_ids]
        else:
            in_view = ctx.tracks

        include_staff = bool(self._cfg.get("include_staff", True))
        present = in_view if include_staff else [t for t in in_view if not t.staff]

        # ── occupancy ────────────────────────────────────────────
        # Smoothed over a short window rather than reported straight from the
        # frame: the detector drops a person for a frame now and then, and a
        # raw sample would make the dashboard flicker to 0 while they are
        # plainly standing there. The maximum over a few seconds is what a
        # human watching the same feed would say.
        window = float(self._cfg.get("window_seconds", 10.0))
        samples = self._window.setdefault(ctx.camera_id, [])
        samples.append((ctx.ts, len(present)))
        cutoff = ctx.ts - window
        while samples and samples[0][0] < cutoff:
            samples.pop(0)
        occupancy = max(c for _, c in samples) if samples else 0

        interval = float(self._cfg.get("interval_seconds", 10.0))
        last = self._last_flush.get(ctx.camera_id)
        if last is None or ctx.ts - last >= interval:
            self._last_flush[ctx.camera_id] = ctx.ts
            ttl = max(self._MIN_TTL, int(interval * 3))
            await self.redis.setex(
                f"occupancy:{ctx.tenant_id}:{ctx.camera_id}",
                ttl,
                json.dumps({"occupancy": occupancy, "ts": ctx.ts}),
            )

        # ── visitors (per site, per LOCAL day) ───────────────────
        # The day rolls over at local midnight, not at 00:00 UTC. On UTC the
        # counter reset at 03:00 Moscow time: the owner's "visitors today"
        # dropped to zero in the middle of the night shift and the analytics
        # chart attributed those hours to the wrong day.
        day = local_datetime(ctx.ts, ctx.tz).strftime("%Y-%m-%d")
        if self._day.get(ctx.site_id) != day:
            self._day[ctx.site_id] = day
            self._seen[ctx.site_id] = set()
            self._last_site_flush.pop(ctx.site_id, None)  # flush right after reset

        seen = self._seen.setdefault(ctx.site_id, set())
        for t in in_view:
            if t.staff:
                continue  # an employee is not a visitor
            # reid on but identity unresolved yet: don't count noise as a visitor
            if t.reid_pending:
                continue
            # global identity dedupes across cameras; fallback keeps old behavior
            seen.add(t.global_id or f"{ctx.camera_id}:{t.track_id}")

        site_interval = max(interval, 60.0)
        last_site = self._last_site_flush.get(ctx.site_id)
        if last_site is None or ctx.ts - last_site >= site_interval:
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
