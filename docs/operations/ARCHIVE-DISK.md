# Подключение диска 1 TB под видеоархив (viziai-server, Ubuntu 24.04)

Архив пишется рекордером в каталог `${DATA_ROOT}/archive` на хосте
(`DATA_ROOT` задан в `infra/.env.prod`, далее в примерах — `/opt/viziai/data`).
План: смонтировать новый диск **прямо в этот каталог** — тогда ни compose, ни
код менять не нужно, все сервисы продолжают видеть тот же путь.

Все команды выполняются на сервере по SSH, от root (`sudo -i`).

---

## Шаг 0. Перед установкой диска

```bash
lsblk -o NAME,SIZE,MODEL,SERIAL
```

Сохрани вывод (пришли мне) — так мы точно узнаем, какое имя получит новый диск.

## Шаг 1. Установить диск и найти его

Выключить сервер (`sudo poweroff`), подключить диск SATA-кабелем + питание,
включить. Затем:

```bash
lsblk -o NAME,SIZE,MODEL,SERIAL
```

Новый диск — тот, которого не было в выводе Шага 0, размером ~931.5G.
Обычно это `/dev/sda` или `/dev/sdb`. **Дальше везде вместо `/dev/sdX`
подставляй реальное имя.** Ошибка здесь = потеря данных на другом диске,
поэтому проверь трижды: на новом диске `MOUNTPOINTS` пуст и нет разделов.

## Шаг 2. Разметить и отформатировать (СТИРАЕТ ДИСК)

```bash
# GPT-разметка, один раздел на весь диск
parted -s /dev/sdX mklabel gpt
parted -s /dev/sdX mkpart archive ext4 1MiB 100%

# ext4 без резервирования 5% под root (высвобождает ~46 ГБ) и с меткой
mkfs.ext4 -m 0 -L viziai-archive /dev/sdX1
```

## Шаг 3. Перенести существующий архив

```bash
# 1) остановить запись, чтобы файлы не менялись во время переноса
cd /opt/viziai/app   # каталог с репозиторием (git pull делается тут)
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod stop recorder

# 2) временно смонтировать новый диск и скопировать текущий архив
mkdir -p /mnt/newdisk
mount /dev/sdX1 /mnt/newdisk
rsync -a --info=progress2 /opt/viziai/data/archive/ /mnt/newdisk/
umount /mnt/newdisk

# 3) убрать старый каталог с системного диска (копия уже на новом)
mv /opt/viziai/data/archive /opt/viziai/data/archive.old
mkdir -p /opt/viziai/data/archive
```

## Шаг 4. Монтирование навсегда (fstab по UUID)

```bash
blkid /dev/sdX1   # скопируй UUID из вывода
```

Добавить строку в `/etc/fstab` (одной командой, подставив свой UUID):

```bash
echo 'UUID=xxxx-xxxx-xxxx /opt/viziai/data/archive ext4 defaults,noatime,nofail 0 2' >> /etc/fstab
```

- `noatime` — не писать время доступа (меньше износ, быстрее).
- `nofail` — если диск умрёт, сервер всё равно загрузится (архив отвалится,
  но платформа и live-видео продолжат работать).

Применить и проверить:

```bash
systemctl daemon-reload
mount -a
df -h /opt/viziai/data/archive   # должен показать ~916G на /dev/sdX1
ls /opt/viziai/data/archive      # должны быть каталоги tenant_id/camera_id
```

## Шаг 5. Запустить запись обратно

```bash
cd /opt/viziai/app
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d recorder
docker compose -f infra/docker-compose.prod.yml logs -f --tail 50 recorder
# в логах: "recorder <camera>: starting ffmpeg" без ошибок
```

Через 5–10 минут проверить, что новые сегменты пишутся уже на новый диск:

```bash
find /opt/viziai/data/archive -name '*.mp4' -mmin -10 | head
df -h /opt/viziai/data/archive   # занятое место должно расти
```

## Шаг 6. Убрать старую копию (через день-два, когда всё стабильно)

```bash
rm -rf /opt/viziai/data/archive.old
```

---

## Сколько влезет и ретеншен

4 камеры × ~2 Мбит/с (main-поток) ≈ 3.6 ГБ/час ≈ **86 ГБ/сутки**.
1 TB хватит примерно на **10–11 суток** записи всех камер.

Чтобы диск не переполнился, в админке появилась страница **«Настройки»**
(`/admin/settings`): там задаются «Хранить архив, дней» и «Мин. свободно, ГБ» —
API сам удаляет самые старые сегменты по расписанию. После подключения диска
поставь: хранить 7 дней, минимум свободно 50 ГБ.

## Здоровье диска (по желанию, но полезно)

```bash
apt install -y smartmontools
smartctl -H /dev/sdX          # SMART overall-health: PASSED
```
