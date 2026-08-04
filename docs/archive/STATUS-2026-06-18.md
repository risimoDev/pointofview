# BZK-VIZIAI — статус проекта

_Обновлено: 2026-06-18. Вертикаль: ПВЗ (cloud). Сервер: RTX 3070 (8 ГБ VRAM) + 32 ГБ ОЗУ — собирается. Dev-ПК: GTX 1050Ti / i5-10400f / 16 ГБ._

Легенда: **[Готово]** · **[Частично]** · **[Не начато]** · **[Сервер/GPU]** (нельзя проверить локально)

---

## 1. Сводка

Проект доведён от never-compiled скаффолда до **работающего локально стека**: Docker (Postgres+TimescaleDB, Redis, MinIO) + API (:3000) + web (:3001). Вход, мультитенантность, события через Redis-конвейер, дашборд, **супер-админ панель из 7 разделов** — всё проверено живыми запросами. API typecheck и web build зелёные; плагины analyzer mypy-strict + юнит-тесты.

**Главное, чего нет:** реальный analyzer (torch/GPU), live-видео (go2rtc/WireGuard на Linux), доставка алертов/клипов (нужны воркеры + токены), продакшен на сервере.

**Локальный вход:** http://localhost:3001/login · `super@viziai.local / super12345` (или `admin@viziai.local / admin12345`).

---

## 2. По компонентам

### Analyzer (Python)
- **[Готово]** ingest (rtsp/srt/file, reconnect), detect/worker (YOLOv8+ByteTrack), zone_engine (геофенсинг, dwell, zone_entry/exit/violation, queue_alert).
- **[Готово]** слой плагинов (base/registry, hot-reload из Redis `features:{tenant}`): **crowd, counter, repack, shelf** — юнит-тесты, mypy-strict.
- **[Не начато]** `unknown_person` (Face/Re-ID, InsightFace), `ppe` (СИЗ).
- **[Сервер/GPU]** реальный прогон (нужен torch ~2-3 ГБ + CUDA); TensorRT-оптимизация.

### API (Node/Fastify) — **[Готово]**, typecheck чистый, запущен
- **[Готово]** auth (JWT, requireRole), cameras (CRUD + Redis-sync + go2rtc), events (+клипы), analytics, features (+config), occupancy, internal.
- **[Готово]** admin/* (super): health, dead-letter+replay, sites, users, alert-rules, simulate/event, resync, timescale, audit.
- **[Готово]** аудит-лог пишется на ключевые мутации (camera/site/user/alert_rule/feature).
- **[Частично]** BullMQ-воркеры clips/alerts реализованы, но **не запущены/не проверены** (нужны go2rtc/ffmpeg/Telegram).
- **[Не начато]** эндпоинты тенантов (кросс-тенант), email/webhook каналы алертов (только telegram).

### Web (Next.js) — **[Готово]**, build зелёный, запущен
- **[Готово]** login, dashboard (видеосетка WebRTC + лента + occupancy), events, zone-editor, /settings/cameras, /settings/features, переключатель темы, бренд **BZK-VIZIAI**, тёмная тема + Tabler-иконки.
- **[Готово]** **/admin** (7 разделов): Диагностика, Организация, Камеры, Функции, Алерты, Видео-тесты (фаза 1), Обслуживание.
- **[Частично]** Видео-тесты — только симуляция (плеер + инжектор событий); фаза 2 (MinIO upload + analyzer) не сделана.
- **[Не начато]** графики аналитики, формы для нескольких каналов алертов, light-тема не вылизана.

### Инфраструктура / БД
- **[Готово]** docker-compose dev (postgres/redis/minio подняты), init.sql (схема + hypertable + enums), миграции 0001 (crowd/counter), 0002 (notifications), сид (`seed.dev.sql`), env-файлы.
- **[Сервер/GPU]** go2rtc + WireGuard — host-network/NET_ADMIN, на Windows не поднять; нужен Linux-сервер. analyzer-образ.
- **[Не начато]** прод-развёртывание (docker-compose.prod, TLS, на сервере с RTX 3070).

---

## 3. Что осталось доделать (по всему проекту)

### A. Требует сервера / GPU (нельзя локально)
1. **Реальный analyzer** — поднять torch+CUDA на RTX 3070, прогнать YOLO по камерам/файлам, убедиться что события идут в конвейер.
2. **Live-видео** — go2rtc + (опц.) WireGuard на Linux-сервере; проверить WebRTC в дашборде и snapshot.
3. **Видео-тесты фаза 2** — загрузка видео в MinIO (`@fastify/multipart`) + прогон analyzer по file-источнику + наложение зон на плеер.
4. **Плагины `unknown_person` (Face/Re-ID) и `ppe`** — на сервере; для face — хранение эмбеддингов + 152-ФЗ.
5. **Прод-развёртывание** — docker-compose.prod, TLS (nginx), запуск на сервере.

### B. Доделать локально (можно сейчас)
6. **Доставка алертов** — запустить `npm run worker:alerts`, задать `TELEGRAM_BOT_TOKEN`, проверить отправку; добавить каналы email/webhook (сейчас только telegram).
7. **Клипы** — запустить `npm run worker:clips`, проверить ffmpeg-нарезку (нужен видеоархив/go2rtc).
8. **Аналитические дашборды** — графики из `/analytics/summary`, история occupancy.
9. **Кросс-тенантная Организация** — CRUD тенантов + переключение тенанта супером (сейчас всё в рамках своего тенанта).
10. **Расширить аудит** — login, изменения зон, фич-апдейты; фильтры на странице аудита.

### C. Качество и безопасность
11. **Security-проход** — `npm audit` (есть уязвимости: api 4 mod/1 high/2 crit, web 2 mod); rate-limit на /login; флаги cookie/JWT; ужесточить роли на остальных мутациях; 152-ФЗ для лиц.
12. **Наблюдаемость** — метрики (Prometheus/Grafana), healthchecks, структурные логи.
13. **Тесты/CI** — сейчас только юнит-тесты плагинов; добавить интеграционные + CI (по готовности).
14. **Надёжность analyzer** — буферизация событий при падении Redis (заявлено в CLAUDE.md — проверить).

---

## 4. Как запустить локально
```bash
# инфра
cd infra && docker compose -f docker-compose.dev.yml --env-file .env up -d postgres redis minio
docker exec -i viziai-dev-postgres-1 psql -U viziai -d viziai < postgres/seed.dev.sql   # один раз
# API (:3000) и web (:3001)
cd ../api && npm install && npm run start
cd ../web && npm install && npx next dev -p 3001
# проверки
cd ../api && npm run typecheck
cd ../web && npm run build
```
