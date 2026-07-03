# ViziAI — VMS-платформа видеоаналитики для ПВЗ и производств (РФ)

## Принцип развёртывания
Один кодовый репозиторий, два режима:
- cloud:      мультитенант, ПВЗ, наш сервер (домашний ПК → стойка ДЦ)
- on-premise: завод, изолированная сеть, все сервисы локально

Переключение: DEPLOYMENT_MODE=cloud|on-premise в .env.
Код не знает где работает — только конфиг.

## Пайплайн обработки
ingest → [Redis Stream: raw_frames] → analyzer(YOLO+ByteTrack)
→ [Redis Stream: track_events] → zone_engine → feature_plugins
→ [Redis Stream: events] → api (persist PostgreSQL)
                         → alerts (Telegram/Email/Webhook)
                         → clips (ffmpeg -c copy нарезка)

## Стек

### Analyzer (Python 3.12) — единственный Python-сервис
- Ultralytics YOLOv8 (cuda, TensorRT только после MVP)
- supervision (ByteTrack), OpenCV
- redis-py (Redis Streams consumer)
- Падение одной камеры = reconnect с exponential backoff, воркер живёт

### Backend API (Node.js 22 LTS + TypeScript strict)
- Fastify 5 + @fastify/websocket — REST + WebSocket
- Drizzle ORM — типобезопасные запросы к PostgreSQL
- Zod — валидация входящих данных (аналог pydantic)
- BullMQ (Redis) — очереди для clips и alerts
- JWT-аутентификация, мультитенантность через tenant_id в каждом запросе

### Frontend (Node.js 22 LTS + TypeScript strict)
- Next.js 15 (App Router) + shadcn/ui + TailwindCSS
- TanStack Query — кеш и инвалидация API
- Zustand — глобальный стейт (события, алерты)
- WebRTC через go2rtc — live-видео без задержки
- Canvas API — редактор зон поверх видео
- SSR только для auth страниц, остальное — Client Components

### Инфраструктура
- PostgreSQL 16 + TimescaleDB — события как гипертаблица
- Redis 7 — Streams (межсервисные сообщения), BullMQ, кеш
- MinIO — хранилище клипов и скриншотов (S3-совместимый)
- go2rtc — RTSP→WebRTC прокси, без задержки в браузере
- WireGuard — VPN-туннели от клиентских камер к нашему серверу
- Docker + docker-compose — разработка и prod

## Структура монорепо
/
├── analyzer/          Python: GPU-воркер
│   ├── ingest/        приём RTSP/SRT, VideoSource абстракция
│   ├── detect/        YOLOv8 + ByteTrack
│   ├── zones/         zone_engine, геофенсинг
│   └── plugins/       FeaturePlugin интерфейс + реализации
│
├── api/               Node.js + TypeScript: Fastify API
│   ├── routes/        REST эндпоинты
│   ├── ws/            WebSocket (события → браузер)
│   ├── workers/       BullMQ: clips, alerts, reports
│   └── db/            Drizzle схемы + миграции
│
├── web/               Next.js 15 + TypeScript: фронтенд
│   ├── app/           App Router (layouts, pages, loading)
│   ├── components/
│   │   ├── VideoGrid/
│   │   ├── ZoneEditor/
│   │   └── EventLog/
│   └── store/
│
├── shared/            JSON-схемы Redis Streams сообщений
│   └── events.schema.json
│
└── infra/
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── wireguard/
└── go2rtc/

## Модель данных

```sql
-- Мультитенантность
tenant(id uuid PK, name, mode: cloud|onpremise, settings jsonb)
site(id uuid PK, tenant_id FK, name, address, timezone)

-- Камеры и зоны
camera(id uuid PK, site_id FK, name,
       source_type: rtsp_pull|srt_push|file,
       url_main, url_sub,              -- main=архив, sub=AI анализ
       status: online|offline|error,
       config jsonb)

zone(id uuid PK, camera_id FK, name,
     polygon jsonb,                    -- [[x,y],...] нормализованные 0..1
     kind: counter|desk|shelf|queue|forbidden|required_ppe,
     config jsonb,                     -- dwell_seconds, max_count и т.д.
     active bool, schedule jsonb)      -- расписание активности

-- События (гипертаблица TimescaleDB)
event(id uuid, tenant_id FK, site_id FK, camera_id FK,
      zone_id FK nullable,
      type: zone_entry|zone_exit|queue_alert|ppe_violation|
            repack_event|shelf_violation|crowd|unknown_person,
      severity: info|warn|critical,
      track_id int, ts_start timestamptz, ts_end timestamptz,
      confidence float,
      bbox jsonb,                      -- {x1,y1,x2,y2}
      meta jsonb,                      -- тип-специфичные поля
      snapshot_key text,               -- MinIO ключ скриншота
      clip_key text,                   -- MinIO ключ клипа (после нарезки)
      resolved bool default false,
      resolved_by uuid, resolved_at timestamptz)
-- Партиционирование: SELECT create_hypertable('event','ts_start');
-- Компрессия: SELECT add_compression_policy('event', INTERVAL '7 days');

-- Правила алертов
alert_rule(id uuid PK, tenant_id FK,
           event_type, conditions jsonb, channels jsonb,
           cooldown_seconds int, enabled bool, schedule jsonb)

-- Доступ
user(id uuid PK, tenant_id FK, email, password_hash,
     role: super|admin|manager|operator,
     allowed_camera_ids uuid[])
audit_log(id uuid PK, tenant_id FK, user_id FK,
          action, resource_type, resource_id, details jsonb,
          ip inet, created_at timestamptz)
-- audit_log тоже гипертаблица

-- Видеоархив (метаданные, файлы на диске)
archive_segment(id uuid PK, camera_id FK,
                started_at timestamptz, ended_at timestamptz,
                file_path text, size_bytes bigint)

-- Плагин-фичи по тенанту
tenant_feature(tenant_id FK, feature: ppe|face_id|shelf|repack|queue,
               enabled bool, config jsonb,
               PRIMARY KEY(tenant_id, feature))
```

## Ключевые интерфейсы

```python
# analyzer/plugins/base.py
class FeaturePlugin(Protocol):
    feature_id: str

    def on_track_event(
        self,
        frame: np.ndarray,
        track: Track,              # {id, bbox, class_id, confidence}
        zone_context: ZoneContext, # {zone_id, kind, dwell_sec, in_zone}
        camera_id: str,
        tenant_id: str,
    ) -> list[Event]: ...

    def is_enabled(self, tenant_features: dict) -> bool: ...
```

```typescript
// shared/events.schema.ts — единая схема Redis Streams сообщений
export const TrackEventSchema = z.object({
  stream: z.literal('track_events'),
  tenant_id: z.string().uuid(),
  camera_id: z.string().uuid(),
  track_id: z.number(),
  bbox: z.object({ x1: z.number(), y1: z.number(),
                   x2: z.number(), y2: z.number() }),
  class_id: z.number(),
  confidence: z.number(),
  zone_id: z.string().uuid().nullable(),
  dwell_sec: z.number(),
  ts: z.string().datetime(),
})

export const EventSchema = z.object({
  stream: z.literal('events'),
  tenant_id: z.string().uuid(),
  site_id: z.string().uuid(),
  camera_id: z.string().uuid(),
  type: z.enum(['zone_entry','zone_exit','queue_alert',
                'ppe_violation','repack_event','shelf_violation',
                'crowd','unknown_person']),
  severity: z.enum(['info','warn','critical']),
  // ... остальные поля из таблицы event
})
```

## Правила кода

**Общие:**
- TypeScript strict: noImplicitAny, strictNullChecks, exactOptionalPropertyTypes
- Python: mypy strict, pydantic v2 с model_config = ConfigDict(strict=True)
- Весь конфиг из env через Zod (TS) / pydantic-settings (Python)
- Без хардкода: IP, порты, токены — только env
- Комментарии и docstrings минимальные, на английском

**Изоляция ошибок:**
- Падение одной камеры: log + backoff reconnect, воркер продолжает работу
- Падение Redis: analyzer буферизует последние N событий в памяти
- Все межсервисные сообщения — Redis Streams с consumer groups
- Тенант-изоляция: каждый API-запрос фильтрует по tenant_id из JWT

**API (Node.js/Fastify):**
- Каждый route-handler типизирован через Fastify generics (Body, Params, Reply)
- Drizzle — только типобезопасные запросы, без raw SQL кроме миграций
- BullMQ workers для clips и alerts — не inline в route handlers

**Analyzer (Python):**
- Один GPU-воркер = один процесс (не поток)
- frame_skip настраивается per-camera в config jsonb
- TensorRT — TODO после MVP, сейчас device='cuda'

## Порядок разработки (MVP)

1. Инфраструктура: docker-compose (postgres + timescale + redis + minio + go2rtc)
2. Analyzer: ingest → YOLO детекция → Redis Stream (без зон, без плагинов)
3. API: приём событий из Redis → сохранение в PostgreSQL
4. Web: WebSocket live-события → список в браузере
5. Зоны: zone_engine + геофенсинг + zone_entry/exit события
6. Clips: BullMQ worker + ffmpeg -c copy нарезка по запросу
7. Alerts: Telegram-бот через BullMQ worker
8. Плагины: queue_alert → repack → shelf_violation

НЕ генерировать: README, тесты, примеры использования — пока не попрошу.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
