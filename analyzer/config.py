from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process config from env / .env (pydantic-settings)."""

    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="", extra="ignore", case_sensitive=False
    )

    redis_url: str = "redis://localhost:6379"
    tenant_id: str  # this worker serves one tenant: reads cameras:{tenant_id}

    analyzer_device: Literal["cuda", "cpu"] = "cuda"
    yolo_model: str = "yolov8n.pt"
    yolo_conf: float = 0.3
    yolo_imgsz: int = 640

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
