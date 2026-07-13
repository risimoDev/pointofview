# Graph Report - aipvzanalityc  (2026-07-13)

## Corpus Check
- 137 files · ~65,750 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1179 nodes · 2206 edges · 77 communities (66 shown, 11 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 251 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b3e2bfba`
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

## God Nodes (most connected - your core abstractions)
1. `Settings` - 76 edges
2. `Event` - 51 edges
3. `FrameContext` - 46 edges
4. `apiFetch()` - 30 edges
5. `Zone` - 25 edges
6. `ZoneEngine` - 24 edges
7. `AnalyzerWorker` - 23 edges
8. `VideoRTC` - 22 edges
9. `cn()` - 21 edges
10. `compilerOptions` - 21 edges

## Surprising Connections (you probably didn't know these)
- `pydantic + pydantic-settings` --conceptually_related_to--> `Analyzer (Python GPU worker)`  [INFERRED]
  analyzer/requirements.txt → CLAUDE.md
- `ultralytics (YOLOv8)` --conceptually_related_to--> `Analyzer (Python GPU worker)`  [INFERRED]
  analyzer/requirements.txt → CLAUDE.md
- `redis-py` --conceptually_related_to--> `Redis Streams (inter-service messaging)`  [INFERRED]
  analyzer/requirements.txt → CLAUDE.md
- `go2rtc service (compose)` --implements--> `go2rtc (RTSP to WebRTC proxy)`  [INFERRED]
  infra/docker-compose.dev.yml → CLAUDE.md
- `Redis` --uses--> `Settings`  [INFERRED]
  analyzer/reid/identity.py → analyzer/config.py

## Import Cycles
- 1-file cycle: `analyzer/ingest/recorder.py -> analyzer/ingest/recorder.py`

## Hyperedges (group relationships)
- **Frame processing flow via Redis Streams** — claude_ingest, claude_analyzer, claude_zone_engine, claude_feature_plugins, claude_api_service, claude_redis_streams [EXTRACTED 1.00]
- **Dev infrastructure services** — docker_compose_dev_postgres, docker_compose_dev_redis, docker_compose_dev_minio, docker_compose_dev_go2rtc, docker_compose_dev_wireguard [EXTRACTED 1.00]
- **Tenant data model hierarchy** — claude_tenant_entity, claude_site_entity, claude_camera_entity, claude_zone_entity, claude_event_entity [EXTRACTED 1.00]

## Communities (77 total, 11 thin omitted)

### Community 0 - "Analyzer Config & Settings"
Cohesion: 0.07
Nodes (32): CameraConfig, One camera entry from Redis key cameras:{tenant_id} (JSON array)., Sub-stream is used for AI; fall back to main., CameraConfig, Settings, BaseModel, AnalyzerWorker, _iso() (+24 more)

### Community 1 - "Architecture & Data Model"
Cohesion: 0.06
Nodes (43): alert_rule (data model), Alerts (Telegram/Email/Webhook), Analyzer (Python GPU worker), Backend API (Fastify/Node.js), BullMQ Queues, camera (data model), Clips (ffmpeg -c copy), Deployment Modes (cloud/on-premise) (+35 more)

### Community 2 - "JSON Schema Definitions"
Cohesion: 0.13
Nodes (15): $ref, format, type, type, type, bbox, camera_id, class_id (+7 more)

### Community 3 - "API Dependencies"
Cohesion: 0.05
Nodes (39): dependencies, bcryptjs, bullmq, dotenv, drizzle-orm, fastify, @fastify/jwt, @fastify/multipart (+31 more)

### Community 4 - "Web Dependencies"
Cohesion: 0.06
Nodes (33): dependencies, animejs, class-variance-authority, clsx, next, @radix-ui/react-label, @radix-ui/react-select, @radix-ui/react-slot (+25 more)

### Community 5 - "Zone Engine"
Cohesion: 0.07
Nodes (59): Process config from env / .env (pydantic-settings)., Settings, Any, Event, Any, Event, FrameContext, Redis (+51 more)

### Community 6 - "Shared Events Schema"
Cohesion: 0.22
Nodes (9): properties, x1, x2, y1, y2, type, type, type (+1 more)

### Community 7 - "Drizzle DB Schema & Enums"
Cohesion: 0.08
Nodes (23): Bbox, cameraStatusEnum, deploymentModeEnum, eventSeverityEnum, eventTypeEnum, featureIdEnum, NewAlertRule, NewAppUser (+15 more)

### Community 8 - "API TypeScript Config"
Cohesion: 0.07
Nodes (26): compilerOptions, allowJs, baseUrl, esModuleInterop, exactOptionalPropertyTypes, incremental, isolatedModules, jsx (+18 more)

### Community 9 - "API Events Routes & Queues"
Cohesion: 0.22
Nodes (11): CameraConfig, Redis, Settings, AsyncClient, _load_cameras(), main(), main_async(), _parse_started() (+3 more)

### Community 10 - "Web API Client & Clips"
Cohesion: 0.04
Nodes (65): ClipState, ClipStatus, AdminSite, AdminSiteSchema, AdminSitesSchema, AdminUser, AdminUserSchema, AdminUsersSchema (+57 more)

### Community 11 - "Web TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, lib, module, moduleResolution, noImplicitAny (+11 more)

### Community 12 - "Video Grid (WebRTC)"
Cohesion: 0.09
Nodes (20): ndarray, ndarray, Redis, Settings, cosine(), HistogramEmbedder, make_embedder(), OnnxEmbedder (+12 more)

### Community 13 - "API Auth (JWT)"
Cohesion: 0.17
Nodes (11): 1. Текущее состояние (что работает), 2. Нерешённые проблемы (проверить в первую очередь), 3. Принятые решения (не пересматривать без причины), 4. План улучшений (приоритетный), 5. Полезное для новой сессии, ViziAI — план развития и контекст сессии (обновлено 2026-07-12), Блок A — быстрые победы (по дню, делать первыми), Блок B — вау + продажи (+3 more)

### Community 14 - "Alerts Worker"
Cohesion: 0.14
Nodes (22): Notification, AlertJob, settingSecret(), buildText(), Channel, Channels, escapeHtml(), EventCtx (+14 more)

### Community 15 - "Zone Editor (Canvas)"
Cohesion: 0.07
Nodes (34): StatusDot(), CameraRow(), SOURCES, STATUSES, CATALOG, FEATURE_META, FeatureMeta, FieldDef (+26 more)

### Community 16 - "Events Page (Web)"
Cohesion: 0.16
Nodes (12): ClipCell(), severityVariant, useClipRequest(), Badge(), BadgeProps, badgeVariants, Table, TableBody (+4 more)

### Community 17 - "Event Log & Store"
Cohesion: 0.07
Nodes (29): Period, TYPE_COLORS, CameraStream(), StreamState, EventLog(), severityVariant, CameraModal(), CameraTile() (+21 more)

### Community 18 - "Web Zod Schemas"
Cohesion: 0.14
Nodes (15): Event, Zone, FastifyInstance, FastifyJWT, FastifyRequest, JwtPayload, eventsRoutes(), Config (+7 more)

### Community 19 - "API DB Client & Analytics"
Cohesion: 0.12
Nodes (15): 0. Перед началом — чеклист, 1. Скачать ISO (на рабочем dev-ПК), 2. Загрузочная флешка (Rufus), 3. Настройки BIOS (Gigabyte H610M), 4. Установка (по экранам), 5.1 Обновление и часовой пояс, 5.2 Постоянный IP-адрес, 5.3 SSH по ключу (с dev-ПК) (+7 more)

### Community 20 - "Dashboard & Event Stream"
Cohesion: 0.12
Nodes (18): AlertRule, AuditLog, SystemSetting, adminRoutes(), AlertRuleBody, RoleEnum, DemoRequestBody, OBJECT_LABELS (+10 more)

### Community 22 - "Cameras Routes & go2rtc Sync"
Cohesion: 0.12
Nodes (14): getWsTicket(), ApiEvent, ApiEventSchema, BboxSchema, CameraSchema, CamerasSchema, CameraStatus, EventsPage (+6 more)

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
Cohesion: 0.16
Nodes (15): buildChannels(), EMPTY_FORM, eventTypeLabel(), formToInput(), RuleFormState, RuleRow(), ruleToForm(), SEVERITIES (+7 more)

### Community 30 - "Web Auth Middleware"
Cohesion: 0.06
Nodes (27): Home(), metadata, DemoForm(), ActorCfg, ACTORS, ActorState, Follower, gridLines() (+19 more)

### Community 31 - "Home Page"
Cohesion: 0.12
Nodes (19): Camera, analyticsRoutes(), OverviewQuery, SummaryRow, go2rtcSource(), reconcileGo2rtc(), registerGo2rtc(), VIDEO_EXT (+11 more)

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
Cohesion: 0.40
Nodes (3): AdminNav(), ITEMS, NavIcon

### Community 53 - "Community 53"
Cohesion: 0.57
Nodes (6): diag-stream2.sh script, cleanup(), line(), pyjson(), show_medias(), test_mjpeg()

### Community 54 - "Community 54"
Cohesion: 0.40
Nodes (5): Event, additionalProperties, description, required, type

### Community 55 - "Community 55"
Cohesion: 0.13
Nodes (12): ALERTING_KINDS, DWELL_KINDS, EditZone, Kind, Point, ZoneEditor(), CreateZoneInput, deleteZone() (+4 more)

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
Cohesion: 0.13
Nodes (13): db, pool, Site, TenantFeature, camerasRoutes(), featuresRoutes(), GalleryJson, peopleRoutes() (+5 more)

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
Cohesion: 0.22
Nodes (12): internalRoutes(), ReidCropBody, ensureBucket(), minio, ClipJob, SegmentBody, settingBool(), ffmpegEscape() (+4 more)

### Community 67 - "Community 67"
Cohesion: 0.17
Nodes (10): AppUser, authRoutes(), startGo2rtcReconciler(), startCameraWatchdog(), FastifyInstance, main(), makeRedis(), startRetention() (+2 more)

### Community 71 - "Community 71"
Cohesion: 0.83
Nodes (3): diag-tunnel-camera.sh script, line(), tcp_open()

### Community 72 - "Community 72"
Cohesion: 0.67
Nodes (3): tenant_id, format, type

### Community 73 - "Community 73"
Cohesion: 0.31
Nodes (8): ArchiveSegment, checkCameras(), publish(), deleteSegments(), freeGb(), runRetention(), Segment, settingNumber()

### Community 74 - "Community 74"
Cohesion: 0.16
Nodes (10): getServerSettings(), getSystemInfo(), saveServerSettings(), ServerSetting, SystemInfo, AdminSettingsPage(), fmtBytes(), fmtUptime() (+2 more)

### Community 75 - "Community 75"
Cohesion: 0.18
Nodes (10): Здоровье диска (по желанию, но полезно), Подключение диска 1 TB под видеоархив (viziai-server, Ubuntu 24.04), Сколько влезет и ретеншен, Шаг 0. Перед установкой диска, Шаг 1. Установить диск и найти его, Шаг 2. Разметить и отформатировать (СТИРАЕТ ДИСК), Шаг 3. Перенести существующий архив, Шаг 4. Монтирование навсегда (fstab по UUID) (+2 more)

### Community 76 - "Community 76"
Cohesion: 0.22
Nodes (8): OSNet ONNX для сквозной идентификации (Re-ID), Зачем, Проверка, Шаг 1. Получить ONNX-файл (на dev-ПК, нужен интернет), Шаг 2. Положить модель на сервер, Шаг 3. Включить на сервере, Шаг 4. Перенастроить пороги (ОБЯЗАТЕЛЬНО), Шаг 5. Заново отметить сотрудников

## Knowledge Gaps
- **393 isolated node(s):** `VideoCapture`, `deploymentModeEnum`, `sourceTypeEnum`, `cameraStatusEnum`, `zoneKindEnum` (+388 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Settings` connect `Zone Engine` to `Analyzer Config & Settings`, `API Events Routes & Queues`, `Video Grid (WebRTC)`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `Button` connect `Zone Editor (Canvas)` to `Web API Client & Clips`, `Community 74`, `Events Page (Web)`, `Community 55`, `WebSocket Hub`, `Web Auth Middleware`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `cn()` connect `Zone Editor (Canvas)` to `Events Page (Web)`, `Event Log & Store`, `Web Root Layout & Providers`, `Community 52`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Are the 61 inferred relationships involving `Settings` (e.g. with `CameraConfig` and `Settings`) actually correct?**
  _`Settings` has 61 INFERRED edges - model-reasoned connections that need verification._
- **Are the 38 inferred relationships involving `Event` (e.g. with `Any` and `Event`) actually correct?**
  _`Event` has 38 INFERRED edges - model-reasoned connections that need verification._
- **Are the 34 inferred relationships involving `FrameContext` (e.g. with `Any` and `Event`) actually correct?**
  _`FrameContext` has 34 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `Zone` (e.g. with `Any` and `Event`) actually correct?**
  _`Zone` has 16 INFERRED edges - model-reasoned connections that need verification._