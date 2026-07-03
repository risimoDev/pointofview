# Graph Report - .  (2026-06-16)

## Corpus Check
- Corpus is ~16,353 words - fits in a single context window. You may not need a graph.

## Summary
- 603 nodes · 987 edges · 46 communities (40 shown, 6 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 89 edges (avg confidence: 0.58)
- Token cost: 32,215 input · 0 output

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

## God Nodes (most connected - your core abstractions)
1. `Settings` - 29 edges
2. `ZoneEngine` - 22 edges
3. `compilerOptions` - 21 edges
4. `CameraConfig` - 20 edges
5. `AnalyzerWorker` - 19 edges
6. `compilerOptions` - 18 edges
7. `TrackEvent` - 16 edges
8. `RtspPullSource` - 14 edges
9. `VideoSource` - 13 edges
10. `FileSource` - 13 edges

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
  analyzer/zones/engine.py → analyzer/config.py

## Import Cycles
- 1-file cycle: `analyzer/ingest/recorder.py -> analyzer/ingest/recorder.py`

## Hyperedges (group relationships)
- **Frame processing flow via Redis Streams** — claude_ingest, claude_analyzer, claude_zone_engine, claude_feature_plugins, claude_api_service, claude_redis_streams [EXTRACTED 1.00]
- **Dev infrastructure services** — docker_compose_dev_postgres, docker_compose_dev_redis, docker_compose_dev_minio, docker_compose_dev_go2rtc, docker_compose_dev_wireguard [EXTRACTED 1.00]
- **Tenant data model hierarchy** — claude_tenant_entity, claude_site_entity, claude_camera_entity, claude_zone_entity, claude_event_entity [EXTRACTED 1.00]

## Communities (46 total, 6 thin omitted)

### Community 0 - "Analyzer Config & Settings"
Cohesion: 0.08
Nodes (37): CameraConfig, Process config from env / .env (pydantic-settings)., One camera entry from Redis key cameras:{tenant_id} (JSON array)., Sub-stream is used for AI; fall back to main., Settings, CameraConfig, Settings, CameraConfig (+29 more)

### Community 1 - "Architecture & Data Model"
Cohesion: 0.06
Nodes (43): alert_rule (data model), Alerts (Telegram/Email/Webhook), Analyzer (Python GPU worker), Backend API (Fastify/Node.js), BullMQ Queues, camera (data model), Clips (ffmpeg -c copy), Deployment Modes (cloud/on-premise) (+35 more)

### Community 2 - "JSON Schema Definitions"
Cohesion: 0.05
Nodes (43): $ref, format, type, type, type, type, properties, type (+35 more)

### Community 3 - "API Dependencies"
Cohesion: 0.06
Nodes (35): dependencies, bcryptjs, bullmq, dotenv, drizzle-orm, fastify, @fastify/jwt, fastify-plugin (+27 more)

### Community 4 - "Web Dependencies"
Cohesion: 0.06
Nodes (31): dependencies, class-variance-authority, clsx, lucide-react, next, @radix-ui/react-label, @radix-ui/react-select, @radix-ui/react-slot (+23 more)

### Community 5 - "Zone Engine"
Cohesion: 0.14
Nodes (13): Redis, Settings, Any, EntryState, Event, _iso(), _now(), _point_in_polygon() (+5 more)

### Community 6 - "Shared Events Schema"
Cohesion: 0.07
Nodes (27): additionalProperties, properties, required, type, definitions, Bbox, Event, TrackEvent (+19 more)

### Community 7 - "Drizzle DB Schema & Enums"
Cohesion: 0.08
Nodes (25): AuditLog, Bbox, cameraStatusEnum, deploymentModeEnum, eventSeverityEnum, eventTypeEnum, featureIdEnum, NewAlertRule (+17 more)

### Community 8 - "API TypeScript Config"
Cohesion: 0.08
Nodes (25): compilerOptions, allowJs, baseUrl, esModuleInterop, exactOptionalPropertyTypes, incremental, isolatedModules, jsx (+17 more)

### Community 9 - "API Events Routes & Queues"
Cohesion: 0.11
Nodes (20): eventsRoutes(), AlertJob, alertsQueue, bullConnection, ClipJob, clipsQueue, BboxSchema, CameraIdParams (+12 more)

### Community 10 - "Web API Client & Clips"
Cohesion: 0.15
Nodes (19): ClipState, ClipStatus, apiFetch(), apiJson(), ClipUrlSchema, createZone(), CreateZoneInput, EventsFilter (+11 more)

### Community 11 - "Web TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, lib, module, moduleResolution, noImplicitAny (+11 more)

### Community 12 - "Video Grid (WebRTC)"
Cohesion: 0.18
Nodes (12): CameraTile(), COLS, startWhep(), VideoGrid(), waitIceGathering(), cn(), Camera, Button (+4 more)

### Community 13 - "API Auth (JWT)"
Cohesion: 0.18
Nodes (12): ArchiveSegment, FastifyInstance, FastifyJWT, FastifyRequest, JwtPayload, internalRoutes(), Config, EnvSchema (+4 more)

### Community 14 - "Alerts Worker"
Cohesion: 0.19
Nodes (15): AlertRule, Notification, buildText(), Channel, Channels, escapeHtml(), EventCtx, log() (+7 more)

### Community 15 - "Zone Editor (Canvas)"
Cohesion: 0.21
Nodes (9): EditZone, Kind, Point, ZoneEditor(), getSnapshotObjectUrl(), ZoneKind, SelectContent, SelectItem (+1 more)

### Community 16 - "Events Page (Web)"
Cohesion: 0.24
Nodes (9): ClipCell(), severityVariant, useClipRequest(), Table, TableBody, TableCell, TableHead, TableHeader (+1 more)

### Community 17 - "Event Log & Store"
Cohesion: 0.26
Nodes (8): EventLog(), severityVariant, UiEvent, EventsState, useEventsStore, Badge(), BadgeProps, badgeVariants

### Community 18 - "Web Zod Schemas"
Cohesion: 0.17
Nodes (10): ApiEvent, ApiEventSchema, BboxSchema, CameraSchema, CameraStatus, EventsPageSchema, EventType, Severity (+2 more)

### Community 19 - "API DB Client & Analytics"
Cohesion: 0.22
Nodes (8): db, pool, AppUser, Event, analyticsRoutes(), SummaryRow, authRoutes(), SummaryQuery

### Community 20 - "Dashboard & Event Stream"
Cohesion: 0.29
Nodes (7): DashboardPage(), useEventStream(), getWsTicket(), fromStreamEvent(), StreamEventSchema, ToggleGroup, ToggleGroupItem

### Community 21 - "Clips Worker & MinIO"
Cohesion: 0.36
Nodes (8): ensureBucket(), minio, url, ffmpegEscape(), log(), main(), processClip(), runFfmpeg()

### Community 22 - "Cameras Routes & go2rtc Sync"
Cohesion: 0.22
Nodes (4): Camera, Site, Zone, camerasRoutes()

### Community 24 - "Deploy Script"
Cohesion: 0.73
Nodes (5): deploy.sh script, err(), info(), wait_healthy(), warn()

### Community 25 - "Install Script"
Cohesion: 0.53
Nodes (5): install.sh script, DEBIAN_FRONTEND, err(), info(), warn()

### Community 26 - "Update Script"
Cohesion: 0.60
Nodes (4): update.sh script, err(), info(), wait_api()

### Community 28 - "Init Script"
Cohesion: 0.70
Nodes (4): init.sh script, err(), info(), warn()

## Knowledge Gaps
- **224 isolated node(s):** `VideoCapture`, `deploymentModeEnum`, `sourceTypeEnum`, `cameraStatusEnum`, `zoneKindEnum` (+219 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Settings` connect `Analyzer Config & Settings` to `Zone Engine`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `properties` connect `JSON Schema Definitions` to `Shared Events Schema`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `Settings` (e.g. with `CameraConfig` and `Settings`) actually correct?**
  _`Settings` has 21 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `ZoneEngine` (e.g. with `CameraConfig` and `Settings`) actually correct?**
  _`ZoneEngine` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `CameraConfig` (e.g. with `CameraConfig` and `Settings`) actually correct?**
  _`CameraConfig` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `AnalyzerWorker` (e.g. with `CameraConfig` and `Settings`) actually correct?**
  _`AnalyzerWorker` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Process config from env / .env (pydantic-settings).`, `One camera entry from Redis key cameras:{tenant_id} (JSON array).`, `Sub-stream is used for AI; fall back to main.` to the rest of the system?**
  _237 weakly-connected nodes found - possible documentation gaps or missing edges._