from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process config from env / .env (pydantic-settings)."""

    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="", extra="ignore", case_sensitive=False
    )

    redis_url: str = "redis://localhost:6379"
    tenant_id: str  # this worker serves one tenant: reads cameras:{tenant_id}

    analyzer_device: Literal["cuda", "cpu"] = "cuda"
    # "rfdetr" (Apache-2.0) is the target; "yolo" (ultralytics, AGPL-3.0) is
    # kept only until the migration is verified on прод — see
    # docs/commercial/01_LICENSE_REMEDIATION.md.
    detector_kind: Literal["yolo", "rfdetr"] = "yolo"
    yolo_model: str = "yolov8n.pt"
    yolo_conf: float = 0.3
    yolo_imgsz: int = 640

    # RF-DETR: nano/small/medium/large only (XL/2XL are licensed separately).
    rfdetr_size: str = "small"
    rfdetr_weights: str = ""  # empty = pretrained COCO; else a fine-tuned .pth

    # Detector-neutral knobs. Default to the yolo_* values so existing .env
    # files keep working; set these to move off the yolo-prefixed names.
    detector_conf: float | None = None
    detector_imgsz: int | None = None

    # docker-compose passes unset variables as an empty string (`${X:-}`),
    # which would otherwise fail int/float parsing and take the worker down
    # on startup. Treat empty as "not configured".
    @field_validator("detector_conf", "detector_imgsz", mode="before")
    @classmethod
    def _blank_is_none(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    def conf(self) -> float:
        return self.detector_conf if self.detector_conf is not None else self.yolo_conf

    def imgsz(self) -> int:
        return self.detector_imgsz if self.detector_imgsz is not None else self.yolo_imgsz
    # ByteTrack only assigns a stable track_id after this many CONSECUTIVE
    # detections (supervision default is 1 — instant). At night, IR noise
    # (reflections, insects near the illuminator) produces single-frame
    # "person" detections that would otherwise mint a track inside a
    # forbidden zone and fire a critical event with nobody actually there —
    # the exact false-positive reported from прод (200+ ложных «Нарушение
    # зоны» с пустым кадром). 3 frames filters flicker without losing real
    # fast walk-throughs (segment_seconds-scale movement still spans several
    # frames at any reasonable frame_skip).
    track_min_consecutive_frames: int = 3

    # Soft VRAM budget (MB) for plugin models: a plugin whose setup pushes
    # torch allocation past the budget is torn down and marked vram_exceeded
    # instead of starving the main detector. 0 = unlimited.
    vram_budget_mb: int = 0

    # Plugin model weights. Paths point at the /models mount in prod
    # (${DATA_ROOT}/models); pose falls back to an ultralytics model name
    # (auto-download) for dev. Missing file = plugin reports "model missing"
    # and stays inactive — never kills the worker.
    ppe_model: str = "/models/ppe.pt"
    pose_model: str = "yolov8n-pose.pt"

    default_frame_skip: int = 0
    max_backoff_seconds: float = 60.0

    track_events_stream: str = "track_events"
    events_stream: str = "events"
    stream_maxlen: int = 10000  # approximate cap on XADD

    zone_refresh_seconds: int = 30
    track_lost_seconds: float = 5.0
    default_cooldown_seconds: float = 60.0

    # dev override: comma-separated feature ids to force-enable without the
    # DB/API populating features:{tenant_id}. Empty in prod.
    enabled_plugins: str = ""

    def enabled_plugin_ids(self) -> list[str]:
        return [p.strip() for p in self.enabled_plugins.split(",") if p.strip()]

    # staff face-id (OpenCV YuNet + SFace); missing files disable the path
    face_detect_onnx: str = "/opt/models/face_detection_yunet.onnx"
    face_recog_onnx: str = "/opt/models/face_recognition_sface.onnx"

    # archive recorder
    archive_root: str = "/mnt/archive"
    segment_seconds: int = 300
    ffmpeg_bin: str = "ffmpeg"
    internal_api_url: str = "http://localhost:3000"
    internal_token: str = ""

    log_level: str = "INFO"


class CameraConfig(BaseModel):
    """One camera entry from Redis key cameras:{tenant_id} (JSON array)."""

    model_config = ConfigDict(strict=True, extra="ignore")

    id: str
    site_id: str
    source_type: Literal["rtsp_pull", "srt_push", "file"]
    url_main: str | None = None
    url_sub: str | None = None
    tz: str = "Europe/Moscow"  # site timezone (zone schedules)
    config: dict[str, Any] = Field(default_factory=dict)

    def ai_url(self) -> str:
        """Sub-stream is used for AI; fall back to main."""
        url = self.url_sub or self.url_main
        if not url:
            raise ValueError(f"camera {self.id}: no url_sub/url_main")
        return url

    def frame_skip(self, default: int) -> int:
        value = self.config.get("frame_skip", default)
        return int(value)
