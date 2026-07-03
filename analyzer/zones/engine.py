from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as aioredis

from analyzer.config import Settings

logger = logging.getLogger(__name__)

# kind groups
DWELL_KINDS = {"counter", "desk", "queue"}        # entry/exit + dwell → queue_alert
ENTRY_EXIT_KINDS = {"counter", "desk", "queue", "shelf"}
# forbidden → immediate violation, handled separately


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _point_in_polygon(x: float, y: float, poly: list[tuple[float, float]]) -> bool:
    """Ray casting. poly = normalized [(x,y), ...]."""
    inside = False
    n = len(poly)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


@dataclass(slots=True)
class TrackEvent:
    """Internal track event fed from worker after ByteTrack (pixel bbox)."""

    tenant_id: str
    site_id: str
    camera_id: str
    track_id: int
    bbox: tuple[float, float, float, float]  # x1,y1,x2,y2 in pixels
    frame_w: int
    frame_h: int
    confidence: float
    ts: float

    def center_norm(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.bbox
        return ((x1 + x2) / 2.0 / self.frame_w, (y1 + y2) / 2.0 / self.frame_h)

    def bbox_dict(self) -> dict[str, float]:
        x1, y1, x2, y2 = self.bbox
        return {"x1": x1, "y1": y1, "x2": x2, "y2": y2}


@dataclass(slots=True)
class Zone:
    id: str
    kind: str
    polygon: list[tuple[float, float]]
    config: dict[str, Any]
    active: bool

    @classmethod
    def from_json(cls, raw: str) -> "Zone":
        d = json.loads(raw)
        poly = [(float(p[0]), float(p[1])) for p in d["polygon"]]
        return cls(
            id=str(d["id"]),
            kind=str(d["kind"]),
            polygon=poly,
            config=d.get("config") or {},
            active=bool(d.get("active", True)),
        )


@dataclass(slots=True)
class EntryState:
    entered_at: float
    last_seen_at: float
    alerted: bool = False
    last_alert_at: float | None = None  # debounce anchor


@dataclass(slots=True)
class Event:
    tenant_id: str
    site_id: str
    camera_id: str
    zone_id: str | None
    type: str
    severity: str
    # frame-level events (crowd, occupancy) have no single track → track_id None
    track_id: int | None = None
    confidence: float = 0.0
    bbox: dict[str, float] = field(default_factory=dict)
    meta: dict[str, Any] = field(default_factory=dict)
    ts_start: float = 0.0
    ts_end: float | None = None

    def payload(self) -> dict[str, Any]:
        return {
            "stream": "events",
            "tenant_id": self.tenant_id,
            "site_id": self.site_id,
            "camera_id": self.camera_id,
            "zone_id": self.zone_id,
            "type": self.type,
            "severity": self.severity,
            "track_id": self.track_id,
            "confidence": self.confidence,
            "bbox": self.bbox,
            "meta": self.meta,
            "ts_start": _iso(self.ts_start),
            "ts_end": _iso(self.ts_end) if self.ts_end is not None else None,
        }


class ZoneEngine:
    """Geofencing + dwell tracking. process() is pure/sync (testable);
    emit() and the 30s refresh loop are the only async parts.
    """

    def __init__(self, redis: aioredis.Redis, settings: Settings) -> None:
        self.redis = redis
        self.settings = settings
        self._zones: dict[str, list[Zone]] = {}
        self._state: dict[tuple[str, str, str], EntryState] = {}

    # ── zone loading ──────────────────────────────────────────
    async def load_zones(self, camera_ids: list[str]) -> None:
        for cam in camera_ids:
            await self._reload_one(cam)

    async def _reload_one(self, camera_id: str) -> None:
        # zones:{camera_id} is a hash {zone_id -> zone JSON}
        h = await self.redis.hgetall(f"zones:{camera_id}")
        zones: list[Zone] = []
        for raw in h.values():
            try:
                zones.append(Zone.from_json(raw))
            except (KeyError, ValueError, TypeError):
                logger.exception("camera %s: bad zone payload", camera_id)
        self._zones[camera_id] = zones

    async def run_refresh(self) -> None:
        while True:
            await asyncio.sleep(self.settings.zone_refresh_seconds)
            for cam in list(self._zones.keys()):
                try:
                    await self._reload_one(cam)
                except Exception:  # noqa: BLE001
                    logger.exception("zone refresh failed for camera %s", cam)
            # evict tracks lost between frames → synthetic exits
            stale = self.sweep(_now())
            if stale:
                await self.emit(stale)

    # ── core geofencing ───────────────────────────────────────
    def process(self, te: TrackEvent) -> list[Event]:
        zones = self._zones.get(te.camera_id)
        if not zones:
            return []
        cx, cy = te.center_norm()
        now = te.ts
        out: list[Event] = []

        for zone in zones:
            if not zone.active:
                continue
            inside = _point_in_polygon(cx, cy, zone.polygon)
            key = (te.camera_id, str(te.track_id), zone.id)
            state = self._state.get(key)

            if inside:
                if state is None:
                    state = EntryState(entered_at=now, last_seen_at=now)
                    self._state[key] = state
                    if zone.kind == "forbidden":
                        state.alerted = True
                        state.last_alert_at = now
                        out.append(self._event(te, zone, "zone_violation", "critical",
                                               {"kind": zone.kind}))
                    elif zone.kind in ENTRY_EXIT_KINDS:
                        out.append(self._event(te, zone, "zone_entry", "info",
                                               {"kind": zone.kind}))
                else:
                    state.last_seen_at = now
                    dwell = now - state.entered_at
                    if zone.kind in DWELL_KINDS:
                        limit = zone.config.get("dwell_seconds")
                        if (limit and dwell >= float(limit)
                                and self._cooldown_ok(zone, state, now)):
                            state.alerted = True
                            state.last_alert_at = now
                            out.append(self._event(te, zone, "queue_alert", "warn",
                                                   {"kind": zone.kind, "dwell_sec": dwell}))
                    elif zone.kind == "forbidden":
                        # still inside → re-alert no more than cooldown
                        if self._cooldown_ok(zone, state, now):
                            state.last_alert_at = now
                            out.append(self._event(te, zone, "zone_violation", "critical",
                                                   {"kind": zone.kind, "dwell_sec": dwell}))
            else:
                if state is not None:
                    del self._state[key]
                    if zone.kind in ENTRY_EXIT_KINDS:
                        out.append(self._exit_event(te, zone, state))

        return out

    # ── plugin support (read-only views over loaded zones) ────
    def active_zones(self, camera_id: str) -> list[Zone]:
        return [z for z in self._zones.get(camera_id, ()) if z.active]

    def zones_containing(self, camera_id: str, cx: float, cy: float) -> list[str]:
        """IDs of active zones whose polygon contains the normalized point."""
        return [z.id for z in self.active_zones(camera_id)
                if _point_in_polygon(cx, cy, z.polygon)]

    def sweep(self, now: float) -> list[Event]:
        """Emit zone_exit for tracks not seen within track_lost_seconds."""
        timeout = self.settings.track_lost_seconds
        out: list[Event] = []
        for key in list(self._state.keys()):
            state = self._state[key]
            if now - state.last_seen_at <= timeout:
                continue
            cam, track, zone_id = key
            del self._state[key]
            zone = self._find_zone(cam, zone_id)
            if zone and zone.kind in ENTRY_EXIT_KINDS:
                out.append(Event(
                    tenant_id="", site_id="", camera_id=cam, zone_id=zone_id,
                    type="zone_exit", severity="info", track_id=int(track),
                    confidence=0.0, bbox={}, meta={"kind": zone.kind, "lost": True},
                    ts_start=state.entered_at, ts_end=state.last_seen_at,
                ))
        return out

    # ── emit ──────────────────────────────────────────────────
    async def emit(self, events: list[Event]) -> None:
        for ev in events:
            await self.redis.xadd(
                self.settings.events_stream,
                {"data": json.dumps(ev.payload())},
                maxlen=self.settings.stream_maxlen,
                approximate=True,
            )

    # ── helpers ───────────────────────────────────────────────
    def _cooldown_ok(self, zone: Zone, state: EntryState, now: float) -> bool:
        cooldown = float(zone.config.get("cooldown_seconds",
                                         self.settings.default_cooldown_seconds))
        return state.last_alert_at is None or (now - state.last_alert_at) >= cooldown

    def _find_zone(self, camera_id: str, zone_id: str) -> Zone | None:
        for z in self._zones.get(camera_id, ()):
            if z.id == zone_id:
                return z
        return None

    def _event(self, te: TrackEvent, zone: Zone, type_: str, severity: str,
               meta: dict[str, Any]) -> Event:
        return Event(
            tenant_id=te.tenant_id, site_id=te.site_id, camera_id=te.camera_id,
            zone_id=zone.id, type=type_, severity=severity, track_id=te.track_id,
            confidence=te.confidence, bbox=te.bbox_dict(), meta=meta, ts_start=te.ts,
        )

    def _exit_event(self, te: TrackEvent, zone: Zone, state: EntryState) -> Event:
        return Event(
            tenant_id=te.tenant_id, site_id=te.site_id, camera_id=te.camera_id,
            zone_id=zone.id, type="zone_exit", severity="info", track_id=te.track_id,
            confidence=te.confidence, bbox=te.bbox_dict(),
            meta={"kind": zone.kind, "dwell_sec": state.last_seen_at - state.entered_at},
            ts_start=state.entered_at, ts_end=te.ts,
        )


def _now() -> float:
    import time
    return time.time()
