# Graph Report - aipvzanalityc  (2026-07-20)

## Corpus Check
- 161 files · ~86,016 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1404 nodes · 2818 edges · 95 communities (79 shown, 16 thin omitted)
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 363 edges (avg confidence: 0.52)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9d802b0e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Analyzer Config & Settings|Analyzer Config & Settings]]
- [[_COMMUNITY_Architecture & Data Model|Architecture & Data Model]]
- [[_COMMUNITY_JSON Schema Definitions|JSON Schema Definitions]]
- [[_COMMUNITY_API Dependencies|API Dependencies]]
- [[_COMMUNITY_Web Dependencies|Web Dependencies]]
- [[_COMMUNITY_Zone Engine|Zone Engine]]
- [[_COMMUNITY_Shared Events Schema|Shared Events Schema]]
- [[_COMMUNITY_Drizzle DB Schema & Enums|Drizzle DB Schema & Enums]]
- [[_COMMUNITY_API TypeScript Config|API TypeScript Config]]
- [[_COMMUNITY_API Events Routes & Queues|API Events Routes & Queues]]
- [[_COMMUNITY_Web API Client & Clips|Web API Client & Clips]]
- [[_COMMUNITY_Web TypeScript Config|Web TypeScript Config]]
- [[_COMMUNITY_Video Grid (WebRTC)|Video Grid (WebRTC)]]
- [[_COMMUNITY_API Auth (JWT)|API Auth (JWT)]]
- [[_COMMUNITY_Alerts Worker|Alerts Worker]]
- [[_COMMUNITY_Zone Editor (Canvas)|Zone Editor (Canvas)]]
- [[_COMMUNITY_Events Page (Web)|Events Page (Web)]]
- [[_COMMUNITY_Event Log & Store|Event Log & Store]]
- [[_COMMUNITY_Web Zod Schemas|Web Zod Schemas]]
- [[_COMMUNITY_API DB Client & Analytics|API DB Client & Analytics]]
- [[_COMMUNITY_Dashboard & Event Stream|Dashboard & Event Stream]]
- [[_COMMUNITY_Clips Worker & MinIO|Clips Worker & MinIO]]
- [[_COMMUNITY_Cameras Routes & go2rtc Sync|Cameras Routes & go2rtc Sync]]
- [[_COMMUNITY_API Event Consumer (Redis)|API Event Consumer (Redis)]]
- [[_COMMUNITY_Deploy Script|Deploy Script]]
- [[_COMMUNITY_Install Script|Install Script]]
- [[_COMMUNITY_Update Script|Update Script]]
- [[_COMMUNITY_Web Root Layout & Providers|Web Root Layout & Providers]]
- [[_COMMUNITY_Init Script|Init Script]]
- [[_COMMUNITY_WebSocket Hub|WebSocket Hub]]
- [[_COMMUNITY_Web Auth Middleware|Web Auth Middleware]]
- [[_COMMUNITY_Home Page|Home Page]]
- [[_COMMUNITY_API Route POST|API Route POST]]
- [[_COMMUNITY_Next.js Config|Next.js Config]]
- [[_COMMUNITY_Tailwind Config|Tailwind Config]]
- [[_COMMUNITY_Next Env Types|Next Env Types]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 227|Community 227]]
- [[_COMMUNITY_Community 229|Community 229]]
- [[_COMMUNITY_Community 230|Community 230]]
- [[_COMMUNITY_Community 232|Community 232]]

## God Nodes (most connected - your core abstractions)
1. `Settings` - 111 edges
2. `Event` - 72 edges
3. `FrameContext` - 48 edges
4. `apiFetch()` - 38 edges
5. `Zone` - 26 edges
6. `ZoneEngine` - 26 edges
7. `cn()` - 26 edges
8. `AnalyzerWorker` - 25 edges
9. `Detection` - 24 edges
10. `PluginManager` - 24 edges

## Surprising Connections (you probably didn't know these)
- `pydantic + pydantic-settings` --conceptually_related_to--> `Analyzer (Python GPU worker)`  [INFERRED]
  analyzer/requirements.txt → CLAUDE.md
- `ultralytics (YOLOv8)` --conceptually_related_to--> `Analyzer (Python GPU worker)`  [INFERRED]
  analyzer/requirements.txt → CLAUDE.md
- `redis-py` --conceptually_related_to--> `Redis Streams (inter-service messaging)`  [INFERRED]
  analyzer/requirements.txt → CLAUDE.md
- `go2rtc service (compose)` --implements--> `go2rtc (RTSP to WebRTC proxy)`  [INFERRED]
  infra/docker-compose.dev.yml → CLAUDE.md
- `ndarray` --uses--> `Settings`  [INFERRED]
  analyzer/reid/face.py → analyzer/config.py

## Import Cycles
- 1-file cycle: `analyzer/ingest/recorder.py -> analyzer/ingest/recorder.py`

## Hyperedges (group relationships)
- **Frame processing flow via Redis Streams** — claude_ingest, claude_analyzer, claude_zone_engine, claude_feature_plugins, claude_api_service, claude_redis_streams [EXTRACTED 1.00]
- **Dev infrastructure services** — docker_compose_dev_postgres, docker_compose_dev_redis, docker_compose_dev_minio, docker_compose_dev_go2rtc, docker_compose_dev_wireguard [EXTRACTED 1.00]
- **Tenant data model hierarchy** — claude_tenant_entity, claude_site_entity, claude_camera_entity, claude_zone_entity, claude_event_entity [EXTRACTED 1.00]

## Communities (95 total, 16 thin omitted)

### Community 0 - "Analyzer Config & Settings"
Cohesion: 0.20
Nodes (12): Detection, Detection, One detected object, pipeline-neutral (no ultralytics/supervision types)., _iso(), Person detections → sv.Detections for ByteTrack (its native input)., _to_sv(), Detections, Frame (+4 more)

### Community 1 - "Architecture & Data Model"
Cohesion: 0.06
Nodes (43): alert_rule (data model), Alerts (Telegram/Email/Webhook), Analyzer (Python GPU worker), Backend API (Fastify/Node.js), BullMQ Queues, camera (data model), Clips (ffmpeg -c copy), Deployment Modes (cloud/on-premise) (+35 more)

### Community 2 - "JSON Schema Definitions"
Cohesion: 0.13
Nodes (15): $ref, format, type, type, type, bbox, camera_id, class_id (+7 more)

### Community 3 - "API Dependencies"
Cohesion: 0.05
Nodes (42): dependencies, bcryptjs, bullmq, dotenv, drizzle-orm, exceljs, fastify, @fastify/jwt (+34 more)

### Community 4 - "Web Dependencies"
Cohesion: 0.06
Nodes (33): dependencies, animejs, class-variance-authority, clsx, next, @radix-ui/react-label, @radix-ui/react-select, @radix-ui/react-slot (+25 more)

### Community 5 - "Zone Engine"
Cohesion: 0.16
Nodes (24): Event, Event, FrameContext, Redis, Settings, Any, Event, FrameContext (+16 more)

### Community 6 - "Shared Events Schema"
Cohesion: 0.22
Nodes (9): properties, x1, x2, y1, y2, type, type, type (+1 more)

### Community 7 - "Drizzle DB Schema & Enums"
Cohesion: 0.07
Nodes (31): Bbox, Camera, cameraStatusEnum, deploymentModeEnum, eventSeverityEnum, eventTypeEnum, featureIdEnum, NewAlertRule (+23 more)

### Community 8 - "API TypeScript Config"
Cohesion: 0.07
Nodes (26): compilerOptions, allowJs, baseUrl, esModuleInterop, exactOptionalPropertyTypes, incremental, isolatedModules, jsx (+18 more)

### Community 9 - "API Events Routes & Queues"
Cohesion: 0.17
Nodes (16): CameraConfig, One camera entry from Redis key cameras:{tenant_id} (JSON array)., Sub-stream is used for AI; fall back to main., CameraConfig, Redis, Settings, AsyncClient, BaseModel (+8 more)

### Community 10 - "Web API Client & Clips"
Cohesion: 0.04
Nodes (64): StatusDot(), AdminSite, AdminSiteSchema, AdminSitesSchema, AdminUserSchema, AdminUsersSchema, AlertRuleSchema, AlertRulesSchema (+56 more)

### Community 11 - "Web TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, lib, module, moduleResolution, noImplicitAny (+11 more)

### Community 12 - "Video Grid (WebRTC)"
Cohesion: 0.07
Nodes (27): ndarray, ndarray, Settings, ndarray, Redis, Settings, cosine(), HistogramEmbedder (+19 more)

### Community 13 - "API Auth (JWT)"
Cohesion: 0.12
Nodes (16): 1. Текущее состояние (что работает), 2. Нерешённые проблемы (проверить в первую очередь), 3. Принятые решения (не пересматривать без причины), 4. План улучшений (приоритетный), 5. Полезное для новой сессии, ViziAI — план развития и контекст сессии (обновлено 2026-07-12), Блок A — быстрые победы (по дню, делать первыми), Блок B — вау + продажи (+8 more)

### Community 14 - "Alerts Worker"
Cohesion: 0.17
Nodes (21): Notification, buildText(), Channel, Channels, DigestEntry, escapeHtml(), EventCtx, inQuietHours() (+13 more)

### Community 15 - "Zone Editor (Canvas)"
Cohesion: 0.09
Nodes (31): SOURCES, STATUSES, ZoneEditor(), OBJECT_TYPES, createCamera(), createOrg(), deleteCamera(), enterOrg() (+23 more)

### Community 16 - "Events Page (Web)"
Cohesion: 0.17
Nodes (11): ClipCell(), severityVariant, useClipRequest(), getEventSnapshotUrl(), resolveEvent(), Table, TableBody, TableCell (+3 more)

### Community 17 - "Event Log & Store"
Cohesion: 0.06
Nodes (38): DOW_LABELS, DWELL_KIND_LABELS, Period, TYPE_COLORS, CameraRow(), CameraStream(), StreamState, EventLog() (+30 more)

### Community 18 - "Web Zod Schemas"
Cohesion: 0.13
Nodes (24): pool, ArchiveSegment, Event, internalRoutes(), ReidCropBody, Config, EnvSchema, ensureBucket() (+16 more)

### Community 19 - "API DB Client & Analytics"
Cohesion: 0.12
Nodes (15): 0. Перед началом — чеклист, 1. Скачать ISO (на рабочем dev-ПК), 2. Загрузочная флешка (Rufus), 3. Настройки BIOS (Gigabyte H610M), 4. Установка (по экранам), 5.1 Обновление и часовой пояс, 5.2 Постоянный IP-адрес, 5.3 SSH по ключу (с dev-ПК) (+7 more)

### Community 20 - "Dashboard & Event Stream"
Cohesion: 0.08
Nodes (25): ClipState, ClipStatus, AdminUser, apiFetch(), createInvite(), createSite(), createStaff(), createUser() (+17 more)

### Community 22 - "Cameras Routes & go2rtc Sync"
Cohesion: 0.06
Nodes (27): ALERTING_KINDS, DWELL_KINDS, EditZone, Kind, Point, CreateZoneInput, deleteZone(), getWsTicket() (+19 more)

### Community 23 - "API Event Consumer (Redis)"
Cohesion: 0.20
Nodes (9): startGo2rtcReconciler(), eventsRoutes(), startCameraWatchdog(), FastifyInstance, main(), makeRedis(), startRetention(), startVisitorSnapshot() (+1 more)

### Community 24 - "Deploy Script"
Cohesion: 0.73
Nodes (5): deploy.sh script, err(), info(), wait_healthy(), warn()

### Community 25 - "Install Script"
Cohesion: 0.53
Nodes (5): install.sh script, DEBIAN_FRONTEND, err(), info(), warn()

### Community 26 - "Update Script"
Cohesion: 0.57
Nodes (5): update.sh script, err(), has(), info(), wait_api()

### Community 27 - "Web Root Layout & Providers"
Cohesion: 0.11
Nodes (16): display, metadata, Providers(), AdminNav(), ITEMS, NavIcon, Scope, AppNav() (+8 more)

### Community 28 - "Init Script"
Cohesion: 0.70
Nodes (4): init.sh script, err(), info(), warn()

### Community 29 - "WebSocket Hub"
Cohesion: 0.13
Nodes (19): buildChannels(), EMPTY_FORM, EVENT_TYPES, eventTypeLabel(), formToInput(), NON_ALERTABLE, RuleFormState, RuleRow() (+11 more)

### Community 30 - "Web Auth Middleware"
Cohesion: 0.11
Nodes (11): metadata, DemoForm(), AUDIENCES, BARS, FEATURES, H1_WORDS, Landing(), STEPS (+3 more)

### Community 31 - "Home Page"
Cohesion: 0.10
Nodes (24): camerasRoutes(), go2rtcSource(), reconcileGo2rtc(), registerGo2rtc(), VIDEO_EXT, featuresRoutes(), BboxSchema, CameraIdParams (+16 more)

### Community 46 - "Community 46"
Cohesion: 0.13
Nodes (14): Analyzer (Python 3.12) — единственный Python-сервис, Backend API (Node.js 22 LTS + TypeScript strict), Frontend (Node.js 22 LTS + TypeScript strict), graphify, ViziAI — VMS-платформа видеоаналитики для ПВЗ и производств (РФ), Инфраструктура, Ключевые интерфейсы, Модель данных (+6 more)

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (14): 0. Что нужно заранее, 1. VPS: база, 2. VPS: WireGuard-хаб (AmneziaWG), 3. VPS: nginx + TLS, 4.1 Система и драйверы — `scripts/install.sh`, 4.2 WireGuard-клиент (AmneziaWG), 4.3 Файрвол, 4.4 Запуск стека — `scripts/init.sh` + `scripts/deploy.sh` (+6 more)

### Community 48 - "Community 48"
Cohesion: 0.15
Nodes (12): 1. Сводка, 2. По компонентам, 3. Что осталось доделать (по всему проекту), 4. Как запустить локально, A. Требует сервера / GPU (нельзя локально), Analyzer (Python), API (Node/Fastify) — **[Готово]**, typecheck чистый, запущен, B. Доделать локально (можно сейчас) (+4 more)

### Community 49 - "Community 49"
Cohesion: 0.22
Nodes (10): build(), C, { FaVideo, FaChartBar, FaBell, FaShieldAlt, FaCloud, FaServer,
        FaCheckCircle, FaRocket, FaUsers, FaIndustry, FaBoxOpen,
        FaLock, FaDatabase, FaBolt, FaCogs, FaMapMarkerAlt }, iconBase64(), makeShadow(), { MdAnalytics, MdSecurity, MdSpeed }, pptxgen, React (+2 more)

### Community 50 - "Community 50"
Cohesion: 0.12
Nodes (16): type, properties, type, confidence, meta, severity, stream, ts_end (+8 more)

### Community 51 - "Community 51"
Cohesion: 0.22
Nodes (8): additionalProperties, required, type, definitions, Bbox, $id, $schema, title

### Community 52 - "Community 52"
Cohesion: 0.18
Nodes (6): Settings, _now(), Geofencing + dwell tracking. process() is pure/sync (testable);     emit() and t, IDs of active zones whose polygon contains the normalized point., Emit zone_exit for tracks not seen within track_lost_seconds., ZoneEngine

### Community 53 - "Community 53"
Cohesion: 0.57
Nodes (6): diag-stream2.sh script, cleanup(), line(), pyjson(), show_medias(), test_mjpeg()

### Community 54 - "Community 54"
Cohesion: 0.40
Nodes (5): Event, additionalProperties, description, required, type

### Community 55 - "Community 55"
Cohesion: 0.18
Nodes (10): ActorCfg, ACTORS, ActorState, Follower, gridLines(), HeroScene(), L, Pose (+2 more)

### Community 56 - "Community 56"
Cohesion: 0.83
Nodes (3): diag-stream-verify.sh script, line(), pyjson()

### Community 57 - "Community 57"
Cohesion: 0.40
Nodes (5): TrackEvent, additionalProperties, description, required, type

### Community 58 - "Community 58"
Cohesion: 0.83
Nodes (3): diag-stream.sh script, line(), pyjson()

### Community 59 - "Community 59"
Cohesion: 0.12
Nodes (8): TenantFeature, faceEnrollKey(), FaceStaffJson, GalleryJson, peopleRoutes(), queueFaceEnrollFromCrop(), StaffBody, StaffJson

### Community 60 - "Community 60"
Cohesion: 0.67
Nodes (3): type, enum, type

### Community 61 - "Community 61"
Cohesion: 0.67
Nodes (3): zone_id, format, type

### Community 62 - "Community 62"
Cohesion: 0.67
Nodes (3): site_id, format, type

### Community 64 - "Community 64"
Cohesion: 0.08
Nodes (25): Process config from env / .env (pydantic-settings)., Settings, ndarray, Settings, Detection, ndarray, Settings, Event (+17 more)

### Community 67 - "Community 67"
Cohesion: 0.29
Nodes (6): FeaturePlugin, PluginManager, Union of extra class ids the active plugins want from the MAIN         detector, Torch-allocated VRAM of this process, MB. None on CPU-only., Loads the tenant's enabled feature plugins and dispatches each frame.      Enabl, _vram_allocated_mb()

### Community 71 - "Community 71"
Cohesion: 0.83
Nodes (3): diag-tunnel-camera.sh script, line(), tcp_open()

### Community 72 - "Community 72"
Cohesion: 0.67
Nodes (3): tenant_id, format, type

### Community 73 - "Community 73"
Cohesion: 0.19
Nodes (10): Any, EntryState, _in_window(), _iso(), _local_hhmm(), _point_in_polygon(), [frm, to) window in HH:MM, may wrap midnight. Empty/equal → False., Ray casting. poly = normalized [(x,y), ...]. (+2 more)

### Community 74 - "Community 74"
Cohesion: 0.16
Nodes (10): getServerSettings(), getSystemInfo(), saveServerSettings(), ServerSetting, SystemInfo, AdminSettingsPage(), fmtBytes(), fmtUptime() (+2 more)

### Community 76 - "Community 76"
Cohesion: 0.60
Nodes (3): diag-features.sh script, line(), psql_()

### Community 77 - "Community 77"
Cohesion: 0.22
Nodes (10): authPlugin(), FastifyInstance, FastifyJWT, FastifyRequest, JwtPayload, effectivePerms(), hasPerm(), PermissionCode (+2 more)

### Community 78 - "Community 78"
Cohesion: 0.18
Nodes (12): buildSafetyPdf(), buildSafetyXlsx(), findFont(), fmtDate(), ReportQuery, ReportQueryT, SAFETY_TYPES, SAFETY_TYPES_SQL (+4 more)

### Community 79 - "Community 79"
Cohesion: 0.14
Nodes (10): CATALOG, FEATURE_META, FeatureMeta, FieldDef, STATE_LABELS, Feature, getFeatures(), getFeatureStatus() (+2 more)

### Community 80 - "Community 80"
Cohesion: 0.29
Nodes (6): Any, Event, FrameContext, Settings, CrowdPlugin, People-count safety rules: crowding and lone work.      Crowd: emits a `crowd` e

### Community 81 - "Community 81"
Cohesion: 0.31
Nodes (8): Site, checkCameras(), publish(), deleteSegments(), freeGb(), runRetention(), Segment, settingNumber()

### Community 82 - "Community 82"
Cohesion: 0.38
Nodes (6): Home(), config, middleware(), PUBLIC, redirect(), roleFromToken()

### Community 83 - "Community 83"
Cohesion: 0.83
Nodes (3): backup.sh script, on_error(), write_status()

### Community 92 - "Community 92"
Cohesion: 0.16
Nodes (15): Any, Any, Event, FrameContext, Redis, Settings, ThreadPoolExecutor, Any (+7 more)

### Community 96 - "Community 96"
Cohesion: 0.10
Nodes (33): db, AlertRule, AppUser, AuditLog, SystemSetting, userInvite, adminRoutes(), AlertRuleBody (+25 more)

### Community 227 - "Community 227"
Cohesion: 0.18
Nodes (7): Any, Event, FrameContext, Settings, ThreadPoolExecutor, PpePlugin, PPE (helmet/vest) control in `required_ppe` zones.      Own auxiliary YOLO model

### Community 229 - "Community 229"
Cohesion: 0.15
Nodes (11): CameraConfig, AnalyzerWorker, main(), Capacity numbers the admin UI / future monitoring can read; until         these, Re-read reid config/staff gallery + persist dirty embeddings/crops., Re-read enabled features so admin toggles apply without a restart.         Reuse, Single GPU process. Runs all tenant cameras concurrently via asyncio;     YOLO i, RTSP pull via OpenCV with exponential-backoff reconnect.      One dead camera ne (+3 more)

### Community 230 - "Community 230"
Cohesion: 0.16
Nodes (9): Any, Event, FrameContext, Settings, ThreadPoolExecutor, TrackInfo, _iou(), PosePlugin (+1 more)

### Community 232 - "Community 232"
Cohesion: 0.25
Nodes (3): Any, FeaturePlugin, Per-frame feature detector. One instance per worker; plugins own their     own s

## Knowledge Gaps
- **416 isolated node(s):** `VideoCapture`, `deploymentModeEnum`, `sourceTypeEnum`, `cameraStatusEnum`, `zoneKindEnum` (+411 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Settings` connect `Community 64` to `Analyzer Config & Settings`, `Community 227`, `Community 67`, `Community 229`, `Zone Engine`, `Community 230`, `API Events Routes & Queues`, `Community 73`, `Video Grid (WebRTC)`, `Community 80`, `Community 52`, `Community 92`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `AnalyzerWorker` connect `Community 229` to `Analyzer Config & Settings`, `Community 64`, `API Events Routes & Queues`, `Community 73`, `Community 52`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `Event` connect `Zone Engine` to `Community 64`, `Community 227`, `Community 67`, `Community 230`, `Community 232`, `Community 73`, `Community 80`, `Community 52`, `Community 92`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Are the 91 inferred relationships involving `Settings` (e.g. with `ndarray` and `Settings`) actually correct?**
  _`Settings` has 91 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `Event` (e.g. with `Any` and `Event`) actually correct?**
  _`Event` has 57 INFERRED edges - model-reasoned connections that need verification._
- **Are the 34 inferred relationships involving `FrameContext` (e.g. with `Any` and `Event`) actually correct?**
  _`FrameContext` has 34 INFERRED edges - model-reasoned connections that need verification._
- **Are the 17 inferred relationships involving `Zone` (e.g. with `Any` and `Event`) actually correct?**
  _`Zone` has 17 INFERRED edges - model-reasoned connections that need verification._