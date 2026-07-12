from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from analyzer.zones.engine import Event, Zone


@dataclass(slots=True)
class TrackInfo:
    """One tracked person in the current frame, with its zone membership."""

    track_id: int
    bbox: tuple[float, float, float, float]   # pixels x1,y1,x2,y2
    center_norm: tuple[float, float]          # 0..1
    confidence: float
    zone_ids: frozenset[str] = frozenset()    # active zones containing the center
    # cross-camera identity (reid feature); None when reid is disabled
    global_id: str | None = None
    staff: bool = False                        # matched the staff gallery


@dataclass(slots=True)
class FrameContext:
    """Per-frame snapshot handed to every active plugin after geofencing."""

    tenant_id: str
    site_id: str
    camera_id: str
    frame_w: int
    frame_h: int
    ts: float
    tracks: list[TrackInfo]
    zones: list[Zone]
    frame: Any = None  # raw BGR ndarray; for vision plugins (PPE/face), unused by crowd/counter

    def tracks_in_zone(self, zone_id: str) -> list[TrackInfo]:
        return [t for t in self.tracks if zone_id in t.zone_ids]


@runtime_checkable
class FeaturePlugin(Protocol):
    """Per-frame feature detector. One instance per worker; plugins own their
    own state and must not raise — the manager isolates failures, but a plugin
    should return [] rather than throw on bad input.

    on_frame is async so plugins may do IO (metrics, later VLM/face calls).
    Geometry-only plugins just define it async and never await.
    """

    feature_id: str

    def is_enabled(self, tenant_features: dict[str, Any]) -> bool: ...

    async def on_frame(self, ctx: FrameContext) -> list[Event]: ...
