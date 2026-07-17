from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from analyzer.detect.base import Detection
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
    # reid is on but this track has no identity yet (probation/low quality) —
    # visitor counting must skip it instead of falling back to the track id
    reid_pending: bool = False

    def identity_key(self) -> str:
        """Stable per-person key for plugin state/cooldowns: reid identity when
        available, otherwise the camera-local track id."""
        return self.global_id or f"track:{self.track_id}"


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
    # non-person detections from the MAIN detector (classes requested via
    # FeaturePlugin.detector_classes). Plugins with their own auxiliary model
    # ignore this and run their model in on_frame instead.
    detections: list[Detection] = field(default_factory=list)

    def tracks_in_zone(self, zone_id: str) -> list[TrackInfo]:
        return [t for t in self.tracks if zone_id in t.zone_ids]


@runtime_checkable
class FeaturePlugin(Protocol):
    """Per-frame feature detector. One instance per worker; plugins own their
    own state and must not raise from on_frame — the manager isolates failures,
    but a plugin should return [] rather than throw on bad input.

    Lifecycle: the manager awaits setup() when the feature turns on and
    teardown() when it turns off — a plugin loads its model (VRAM) in setup and
    MUST free it in teardown, so disabled features cost nothing. setup() may
    raise (e.g. model file missing): the manager marks the plugin errored and
    keeps it inactive — degradation, never a worker crash.

    on_frame is async so plugins may do IO (metrics, later VLM/face calls).
    Geometry-only plugins just define it async and never await.
    """

    feature_id: str
    version: str
    # extra class ids the MAIN detector should look for (delivered via
    # FrameContext.detections). Empty for plugins with their own model.
    detector_classes: frozenset[int]
    # weights identifier for event.meta.model_version; None → feature_id/version
    model_version: str | None

    def is_enabled(self, tenant_features: dict[str, Any]) -> bool: ...

    async def setup(self, cfg: dict[str, Any]) -> None: ...

    async def teardown(self) -> None: ...

    async def on_frame(self, ctx: FrameContext) -> list[Event]: ...


class BasePlugin:
    """Defaults for the FeaturePlugin contract. Existing geometry plugins
    inherit this and override nothing but on_frame; model plugins override
    setup/teardown."""

    feature_id = "base"
    version = "1"
    detector_classes: frozenset[int] = frozenset()
    model_version: str | None = None

    _cfg: dict[str, Any] = {}

    def is_enabled(self, tenant_features: dict[str, Any]) -> bool:
        feat = tenant_features.get(self.feature_id)
        if not feat or not feat.get("enabled"):
            return False
        self._cfg = feat.get("config") or {}
        return True

    async def setup(self, cfg: dict[str, Any]) -> None:  # noqa: B027 — default no-op
        pass

    async def teardown(self) -> None:  # noqa: B027 — default no-op
        pass
