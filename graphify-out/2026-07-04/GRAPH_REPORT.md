# Graph Report - aipvzanalityc  (2026-07-04)

## Corpus Check
- 101 files · ~36,509 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 870 nodes · 1627 edges · 62 communities (59 shown, 3 thin omitted)
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 241 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a18b95c4`
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

## God Nodes (most connected - your core abstractions)
1. `Settings` - 67 edges
2. `Event` - 51 edges
3. `FrameContext` - 46 edges
4. `Zone` - 25 edges
5. `ZoneEngine` - 24 edges
6. `apiFetch()` - 22 edges
7. `cn()` - 21 edges
8. `compilerOptions` - 21 edges
9. `CameraConfig` - 20 edges
10. `AnalyzerWorker` - 20 edges

## Surprising Connections (you probably didn't know these)
- `pydantic + pydantic-settings` --conceptually_related_to--> `Analyzer (Python GPU worker)`  [INFERRED]
  analyzer/requirements.txt → CLAUDE.md
- `ultralytics (YOLOv8)` --conceptually_related_to--> `Analyzer (Python GPU worker)`  [INFERRED]
  analyzer/requirements.txt → CLAUDE.md
- `redis-py` --conceptually_related_to--> `Redis Streams (inter-service messaging)`  [INFERRED]
  analyzer/requirements.txt → CLAUDE.md
- `go2rtc service (compose)` --implements--> `go2rtc (RTSP to WebRTC proxy)`  [INFERRED]
  infra/docker-compose.dev.yml → CLAUDE.md
- `supervision (ByteTrack)` --conceptually_related_to--> `Detect (YOLOv8 + ByteTrack)`  [INFERRED]
  analyzer/requirements.txt → CLAUDE.md

## Import Cycles
- 1-file cycle: `analyzer/ingest/recorder.py -> analyzer/ingest/recorder.py`

## Hyperedges (group relationships)
- **Frame processing flow via Redis Streams** — claude_ingest, claude_analyzer, claude_zone_engine, claude_feature_plugins, claude_api_service, claude_redis_streams [EXTRACTED 1.00]
- **Dev infrastructure services** — docker_compose_dev_postgres, docker_compose_dev_redis, docker_compose_dev_minio, docker_compose_dev_go2rtc, docker_compose_dev_wireguard [EXTRACTED 1.00]
- **Tenant data model hierarchy** — claude_tenant_entity, claude_site_entity, claude_camera_entity, claude_zone_entity, claude_event_entity [EXTRACTED 1.00]

## Communities (62 total, 3 thin omitted)

### Community 0 - "Analyzer Config & Settings"
Cohesion: 0.07
Nodes (30): CameraConfig, One camera entry from Redis key cameras:{tenant_id} (JSON array)., Sub-stream is used for AI; fall back to main., CameraConfig, Settings, BaseModel, AnalyzerWorker, _iso() (+22 more)

### Community 1 - "Architecture & Data Model"
Cohesion: 0.06
Nodes (43): alert_rule (data model), Alerts (Telegram/Email/Webhook), Analyzer (Python GPU worker), Backend API (Fastify/Node.js), BullMQ Queues, camera (data model), Clips (ffmpeg -c copy), Deployment Modes (cloud/on-premise) (+35 more)

### Community 2 - "JSON Schema Definitions"
Cohesion: 0.17
Nodes (12): format, type, type, type, camera_id, class_id, dwell_sec, stream (+4 more)

### Community 3 - "API Dependencies"
Cohesion: 0.05
Nodes (38): dependencies, bcryptjs, bullmq, dotenv, drizzle-orm, fastify, @fastify/jwt, fastify-plugin (+30 more)

### Community 4 - "Web Dependencies"
Cohesion: 0.06
Nodes (31): dependencies, class-variance-authority, clsx, next, @radix-ui/react-label, @radix-ui/react-select, @radix-ui/react-slot, @radix-ui/react-toggle-group (+23 more)

### Community 5 - "Zone Engine"
Cohesion: 0.07
Nodes (60): Process config from env / .env (pydantic-settings)., Settings, Any, Event, Any, Event, FrameContext, Redis (+52 more)

### Community 6 - "Shared Events Schema"
Cohesion: 0.15
Nodes (13): additionalProperties, properties, required, type, Bbox, x1, x2, y1 (+5 more)

### Community 7 - "Drizzle DB Schema & Enums"
Cohesion: 0.08
Nodes (23): Bbox, cameraStatusEnum, deploymentModeEnum, eventSeverityEnum, eventTypeEnum, featureIdEnum, NewAlertRule, NewAppUser (+15 more)

### Community 8 - "API TypeScript Config"
Cohesion: 0.07
Nodes (26): compilerOptions, allowJs, baseUrl, esModuleInterop, exactOptionalPropertyTypes, incremental, isolatedModules, jsx (+18 more)

### Community 9 - "API Events Routes & Queues"
Cohesion: 0.19
Nodes (10): Event, eventsRoutes(), AlertJob, alertsQueue, bullConnection, ClipJob, clipsQueue, EventIdParams (+2 more)

### Community 10 - "Web API Client & Clips"
Cohesion: 0.06
Nodes (48): CATALOG, AdminSite, AdminSiteSchema, AdminSitesSchema, AdminUser, AdminUserSchema, AdminUsersSchema, AlertRuleInput (+40 more)

### Community 11 - "Web TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, lib, module, moduleResolution, noImplicitAny (+11 more)

### Community 12 - "Video Grid (WebRTC)"
Cohesion: 0.12
Nodes (17): StatusDot(), CameraRow(), SOURCES, STATUSES, FEATURE_META, FeatureMeta, FieldDef, createCamera() (+9 more)

### Community 13 - "API Auth (JWT)"
Cohesion: 0.13
Nodes (13): ArchiveSegment, FastifyInstance, FastifyJWT, FastifyRequest, JwtPayload, internalRoutes(), Config, EnvSchema (+5 more)

### Community 14 - "Alerts Worker"
Cohesion: 0.19
Nodes (15): AlertRule, Notification, buildText(), Channel, Channels, escapeHtml(), EventCtx, log() (+7 more)

### Community 15 - "Zone Editor (Canvas)"
Cohesion: 0.15
Nodes (13): RuleRow(), tgChatId(), AlertRule, createAlertRule(), deleteAlertRule(), simulateEvent(), updateAlertRule(), ROLES (+5 more)

### Community 16 - "Events Page (Web)"
Cohesion: 0.13
Nodes (16): ClipCell(), severityVariant, ClipState, ClipStatus, useClipRequest(), getClipUrl(), requestClip(), Badge() (+8 more)

### Community 17 - "Event Log & Store"
Cohesion: 0.13
Nodes (19): EventLog(), severityVariant, CameraTile(), COLS, startWhep(), VideoGrid(), waitIceGathering(), DashboardPage() (+11 more)

### Community 18 - "Web Zod Schemas"
Cohesion: 0.14
Nodes (12): ApiEvent, ApiEventSchema, BboxSchema, CameraSchema, CamerasSchema, CameraStatus, EventsPage, EventsPageSchema (+4 more)

### Community 19 - "API DB Client & Analytics"
Cohesion: 0.12
Nodes (15): 0. Перед началом — чеклист, 1. Скачать ISO (на рабочем dev-ПК), 2. Загрузочная флешка (Rufus), 3. Настройки BIOS (Gigabyte H610M), 4. Установка (по экранам), 5.1 Обновление и часовой пояс, 5.2 Постоянный IP-адрес, 5.3 SSH по ключу (с dev-ПК) (+7 more)

### Community 20 - "Dashboard & Event Stream"
Cohesion: 0.22
Nodes (11): CameraConfig, Redis, Settings, AsyncClient, _load_cameras(), main(), main_async(), _parse_started() (+3 more)

### Community 21 - "Clips Worker & MinIO"
Cohesion: 0.31
Nodes (8): Camera, ensureBucket(), minio, ffmpegEscape(), log(), main(), processClip(), runFfmpeg()

### Community 22 - "Cameras Routes & go2rtc Sync"
Cohesion: 0.15
Nodes (9): Site, Zone, adminRoutes(), camerasRoutes(), featuresRoutes(), writeAudit(), CameraIdParams, CreateZoneBody (+1 more)

### Community 23 - "API Event Consumer (Redis)"
Cohesion: 0.29
Nodes (3): EventMessage, EventConsumer, fieldValue()

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
Cohesion: 0.18
Nodes (8): display, metadata, Providers(), AppNav(), NAV, NavIcon, Theme, ThemeToggle()

### Community 28 - "Init Script"
Cohesion: 0.70
Nodes (4): init.sh script, err(), info(), warn()

### Community 29 - "WebSocket Hub"
Cohesion: 0.11
Nodes (21): db, pool, AppUser, AuditLog, TenantFeature, AlertRuleBody, RoleEnum, analyticsRoutes() (+13 more)

### Community 30 - "Web Auth Middleware"
Cohesion: 0.50
Nodes (4): config, middleware(), PUBLIC, roleFromToken()

### Community 43 - "Next Env Types"
Cohesion: 0.20
Nodes (8): EditZone, Kind, Point, ZoneEditor(), createZone(), CreateZoneInput, getSnapshotObjectUrl(), Zone

### Community 46 - "Community 46"
Cohesion: 0.13
Nodes (14): Analyzer (Python 3.12) — единственный Python-сервис, Backend API (Node.js 22 LTS + TypeScript strict), Frontend (Node.js 22 LTS + TypeScript strict), graphify, ViziAI — VMS-платформа видеоаналитики для ПВЗ и производств (РФ), Инфраструктура, Ключевые интерфейсы, Модель данных (+6 more)

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (14): 0. Что нужно заранее, 1. VPS: база, 2. VPS: WireGuard-хаб, 3. VPS: nginx + TLS, 4.1 Система и драйверы — `scripts/install.sh`, 4.2 WireGuard-клиент, 4.3 Файрвол, 4.4 Запуск стека — `scripts/init.sh` + `scripts/deploy.sh` (+6 more)

### Community 48 - "Community 48"
Cohesion: 0.15
Nodes (12): 1. Сводка, 2. По компонентам, 3. Что осталось доделать (по всему проекту), 4. Как запустить локально, A. Требует сервера / GPU (нельзя локально), Analyzer (Python), API (Node/Fastify) — **[Готово]**, typecheck чистый, запущен, B. Доделать локально (можно сейчас) (+4 more)

### Community 49 - "Community 49"
Cohesion: 0.22
Nodes (10): build(), C, { FaVideo, FaChartBar, FaBell, FaShieldAlt, FaCloud, FaServer,
        FaCheckCircle, FaRocket, FaUsers, FaIndustry, FaBoxOpen,
        FaLock, FaDatabase, FaBolt, FaCogs, FaMapMarkerAlt }, iconBase64(), makeShadow(), { MdAnalytics, MdSecurity, MdSpeed }, pptxgen, React (+2 more)

### Community 50 - "Community 50"
Cohesion: 0.20
Nodes (10): $ref, type, properties, type, bbox, confidence, meta, site_id (+2 more)

### Community 51 - "Community 51"
Cohesion: 0.20
Nodes (9): definitions, TrackEvent, $id, $schema, title, additionalProperties, description, required (+1 more)

### Community 53 - "Community 53"
Cohesion: 0.40
Nodes (3): AdminNav(), ITEMS, NavIcon

### Community 54 - "Community 54"
Cohesion: 0.40
Nodes (5): Event, additionalProperties, description, required, type

### Community 55 - "Community 55"
Cohesion: 0.67
Nodes (3): severity, enum, type

### Community 56 - "Community 56"
Cohesion: 0.67
Nodes (3): tenant_id, format, type

### Community 57 - "Community 57"
Cohesion: 0.67
Nodes (3): ts, format, type

### Community 58 - "Community 58"
Cohesion: 0.67
Nodes (3): ts_end, format, type

### Community 59 - "Community 59"
Cohesion: 0.67
Nodes (3): ts_start, format, type

### Community 60 - "Community 60"
Cohesion: 0.67
Nodes (3): type, enum, type

### Community 61 - "Community 61"
Cohesion: 0.67
Nodes (3): zone_id, format, type

## Knowledge Gaps
- **313 isolated node(s):** `VideoCapture`, `deploymentModeEnum`, `sourceTypeEnum`, `cameraStatusEnum`, `zoneKindEnum` (+308 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Settings` connect `Zone Engine` to `Analyzer Config & Settings`, `Dashboard & Event Stream`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `cn()` connect `Video Grid (WebRTC)` to `Zone Editor (Canvas)`, `Events Page (Web)`, `Event Log & Store`, `Community 52`, `Community 53`, `Web Root Layout & Providers`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Why does `Event` connect `Zone Engine` to `Analyzer Config & Settings`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Are the 53 inferred relationships involving `Settings` (e.g. with `CameraConfig` and `Settings`) actually correct?**
  _`Settings` has 53 INFERRED edges - model-reasoned connections that need verification._
- **Are the 38 inferred relationships involving `Event` (e.g. with `Any` and `Event`) actually correct?**
  _`Event` has 38 INFERRED edges - model-reasoned connections that need verification._
- **Are the 34 inferred relationships involving `FrameContext` (e.g. with `Any` and `Event`) actually correct?**
  _`FrameContext` has 34 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `Zone` (e.g. with `Any` and `Event`) actually correct?**
  _`Zone` has 16 INFERRED edges - model-reasoned connections that need verification._