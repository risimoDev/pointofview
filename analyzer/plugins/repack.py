from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from analyzer.config import Settings
from analyzer.plugins.base import BasePlugin, FrameContext
from analyzer.zones.engine import Event


@dataclass(slots=True)
class _Visit:
    first_seen: float
    emitted: bool = False


class RepackPlugin(BasePlugin):
    """Service / repack activity at a counter desk (ПВЗ).

    Heuristic MVP: a track that stays inside a `desk` zone longer than
    min_seconds is a real interaction (a parcel handled), not a passer-by →
    one `repack_event` per visit, re-armed once the track leaves the zone.
    config:
      min_seconds          float   dwell before it counts as a visit (default 8)
      zone_kinds           list    which zone kinds count (default ["desk"])
      require_second_person bool    only fire if >= 2 people in frame (default False)
    """

    feature_id = "repack"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._cfg: dict[str, Any] = {}
        # (camera_id, (track_id, zone_id)) -> visit state
        self._state: dict[tuple[str, tuple[int, str]], _Visit] = {}

    def is_enabled(self, tenant_features: dict[str, Any]) -> bool:
        feat = tenant_features.get(self.feature_id)
        if not feat or not feat.get("enabled"):
            return False
        self._cfg = feat.get("config") or {}
        return True

    async def on_frame(self, ctx: FrameContext) -> list[Event]:
        kinds = set(self._cfg.get("zone_kinds") or ["desk"])
        desk_zone_ids = {z.id for z in ctx.zones if z.kind in kinds}
        if not desk_zone_ids:
            return []

        min_seconds = float(self._cfg.get("min_seconds", 8.0))
        require_second = bool(self._cfg.get("require_second_person", False))

        out: list[Event] = []
        present: set[tuple[int, str]] = set()
        for t in ctx.tracks:
            for zid in t.zone_ids & desk_zone_ids:
                inner = (t.track_id, zid)
                present.add(inner)
                key = (ctx.camera_id, inner)
                visit = self._state.get(key)
                if visit is None:
                    self._state[key] = _Visit(first_seen=ctx.ts)
                    continue
                if visit.emitted or ctx.ts - visit.first_seen < min_seconds:
                    continue
                if require_second and len(ctx.tracks) < 2:
                    continue
                visit.emitted = True
                out.append(Event(
                    tenant_id=ctx.tenant_id, site_id=ctx.site_id, camera_id=ctx.camera_id,
                    zone_id=zid, type="repack_event", severity="info",
                    track_id=t.track_id, confidence=t.confidence,
                    meta={"dwell_sec": ctx.ts - visit.first_seen, "kind": "desk"},
                    ts_start=visit.first_seen, ts_end=ctx.ts,
                ))

        # re-arm: forget this camera's visits whose track left the desk zone
        for key in [k for k in self._state if k[0] == ctx.camera_id and k[1] not in present]:
            del self._state[key]
        return out
