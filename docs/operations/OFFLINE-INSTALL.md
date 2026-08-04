# Офлайн-установка (изолированная сеть завода)

Поставка собирается на машине с интернетом, устанавливается на сервере без него.

## Сборка поставки (у нас)

```bash
./scripts/offline-bundle.sh            # → dist-offline/viziai-offline-YYYYMMDD.tar.gz
```

Внутри: все docker-образы (analyzer уже содержит модели: YOLOv8 n/s, поза,
лица; модель СИЗ — отдельный файл, см. ниже), конфиги, миграции, скрипты,
`install-offline.sh`.

## Установка (на объекте)

Требования к серверу: Ubuntu 22.04+, docker + docker compose v2, NVIDIA-драйвер
и nvidia-container-toolkit (для GPU), диск под архив.

```bash
tar xzf viziai-offline-YYYYMMDD.tar.gz && cd viziai-offline-YYYYMMDD
./install-offline.sh          # первый запуск создаст repo/infra/.env.prod
nano repo/infra/.env.prod     # пароли, DATA_ROOT, DEPLOYMENT_MODE=on-premise,
                              # YOLO_MODEL=/opt/models/yolov8s.pt  (ВАЖНО: путь,
                              # не имя — иначе анализатор полезет в интернет)
./install-offline.sh
sudo ./repo/scripts/install-backup-cron.sh
```

## Модель СИЗ и другие внешние веса

Веса, не входящие в образ (ppe.pt, OSNet для re-id), кладутся в
`${DATA_ROOT}/models/` на целевом сервере — каталог смонтирован в analyzer как
`/models`. Перенести файлом вместе с поставкой.

## Обновление офлайн-объекта

Новая поставка тем же скриптом → перенести → на объекте:
`docker load` новых образов (`install-offline.sh` можно запускать повторно —
миграции идемпотентны), затем `docker compose up -d`.

## Ограничения офлайна

- Telegram-алерты и заявки с лендинга не работают (нет интернета) — каналы
  алертов: webhook в локальные системы; email появится отдельным каналом.
- Обновления времени (NTP) и TLS-сертификаты — на стороне ИТ объекта.
