# Развёртывание: домашний ПК (GPU-сервер) + VPS (публичная точка входа)

_Домашний ПК: i5-12400F / RTX 3070 8GB / 32GB DDR4 / 512GB NVMe. VPS: любой, 1-2 vCPU / 1-2GB RAM достаточно._

## Архитектура

```
Браузер ──HTTPS──► VPS (nginx, TLS, публичный IP)
Камеры ПВЗ ─AmneziaWG─►  │ AmneziaWG-хаб 10.9.0.1
                    │        │ туннель (обфусцированный WireGuard)
                    ▼        ▼
              Домашний сервер 10.9.0.2 (Ubuntu)
              nginx:80 → web:3001 / api:3000 / go2rtc:1984
              minio:9000 (s3.<домен> через VPS)
              analyzer (CUDA) → Redis → api → PostgreSQL
```

- **VPS** — только вход: TLS, DNS, AmneziaWG-хаб, проброс WebRTC :8555. Никаких данных и GPU.
- **Домашний ПК** — весь стек в docker compose (`infra/docker-compose.prod.yml`).
- **Камеры** — AmneziaWG-клиент на роутере ПВЗ → RTSP доступен по 10.9.0.x внутри туннеля.
- Используем **AmneziaWG**, не ванильный WireGuard — у части провайдеров стоит
  DPI, детектирующая и обрывающая именно протокол WireGuard (см. §2). Протокол
  и адресация те же, отличается только пакет/бинарь (`awg` вместо `wg`) и пара
  дополнительных полей обфускации в конфиге.

Порты наружу на VPS: 80, 443 (tcp), 51820 (udp, AmneziaWG), 8555 (tcp+udp, WebRTC).
На домашнем ПК наружу — **ничего**; всё только через awg0.

## 0. Что нужно заранее

1. **Домен** (любой, можно дешёвый .ru). A-записи: `viziai.example.ru → VPS_IP`, `s3.viziai.example.ru → VPS_IP`.
   Без домена не будет TLS/wss — работать будет, но браузеры ограничивают WebRTC и микрофон/уведомления на http. Домен обязателен для продукта.
2. **VPS в РФ** (если клиенты в РФ — ниже задержка и нет проблем с блокировками): 1-2 vCPU, 1GB RAM, канал от 100 Мбит. Через VPS идёт всё видео (WebRTC), поэтому смотри на **безлимитный трафик**.
3. **Рекомендация по ОС домашнего ПК: чистый Ubuntu Server 24.04 вместо Windows+WSL2.**
   WSL2 как 24/7-сервер хрупок: Windows Update перезагружает хост, WSL-сеть за двойным NAT, systemd-автостарт костыльный, часть RAM/VRAM ест хост. CUDA в WSL2 работает, но это dev-режим, не прод. Если пока оставляешь Windows — см. раздел 7.
4. **Диск**: 512GB NVMe хватит на систему + БД, но видеоархив (recorder) съест его за дни. Либо добавь HDD/SSD 2-4TB под `/mnt/data`, либо не включай recorder (клипы тогда недоступны, только снапшоты).

## 1. VPS: база

```bash
# от root на свежей Ubuntu 24.04
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy/   # перенести ключ
# в /etc/ssh/sshd_config: PasswordAuthentication no, PermitRootLogin no
systemctl restart ssh

apt update && apt -y upgrade
apt -y install nginx certbot python3-certbot-nginx ufw
# AmneziaWG ставится отдельно в §2 (не ванильный wireguard — см. объяснение там)

ufw allow OpenSSH
ufw allow 80,443/tcp
ufw allow 51820/udp
ufw allow 8555/tcp && ufw allow 8555/udp
ufw enable
```

## 2. VPS: WireGuard-хаб (AmneziaWG)

Используем **AmneziaWG**, а не ванильный WireGuard — форк с обфускацией трафика.
Причина: у части российских провайдеров стоит DPI, которая детектирует и рвёт
именно протокол WireGuard (хендшейк стабильно отваливался каждые ~2 минуты —
ровно интервал автоматического rekey). AmneziaWG протокол-совместим (те же
ключи, тот же формат конфига + несколько доп. полей), просто маскирует трафик.

```bash
sudo add-apt-repository -y ppa:amnezia/ppa
sudo apt update
sudo apt install -y amneziawg

mkdir -p /etc/amnezia/amneziawg && cd /etc/amnezia/amneziawg
umask 077
awg genkey | tee vps.key | awg pubkey > vps.pub        # ключи VPS
awg genkey | tee home.key | awg pubkey > home.pub      # ключи домашнего сервера (передать туда)
```

Создай `/etc/amnezia/amneziawg/awg0.conf` по шаблону `infra/vps/wg0-vps.conf.example`
(подставь `vps.key` в PrivateKey, `home.pub` в PublicKey пира). Параметры
`Jc/Jmin/Jmax/S1-S4/H1-H4` в шаблоне уже сгенерированы — **используй именно их**,
одинаковые на всех пирах (VPS + домашний сервер + все точки ПВЗ).

```bash
systemctl enable --now awg-quick@awg0
awg show   # после подключения дома появится handshake
```

Проброс `:8555 → 10.9.0.2` уже в PostUp конфига (нужен для WebRTC-видео).

## 3. VPS: nginx + TLS

Файл `nginx-viziai.conf.example` уже содержит пути к сертификату (`ssl_certificate .../fullchain.pem`), которого на этом шаге ещё не существует. Если включить файл как есть, `nginx -t` упадёт раньше, чем certbot успеет получить сертификат («курица и яйцо»). Поэтому сертификат получаем **до** включения HTTPS-блоков:

```bash
# сначала DNS-записи должны указывать на VPS
cp nginx-viziai.conf.example /etc/nginx/sites-available/viziai.conf   # из infra/vps/
# замени viziai.example.ru на свой домен (sed -i 's/viziai.example.ru/домен/g' ...)
cp /etc/nginx/sites-available/viziai.conf /etc/nginx/sites-available/viziai.conf.full
ln -s /etc/nginx/sites-available/viziai.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# временный HTTP-only конфиг (только acme-challenge + редирект, без ssl_certificate) —
# вырезаем оба блока "listen 443 ssl http2 { ... }" из полного файла
awk '/listen 443 ssl/{skip=1} skip&&/^}/{skip=0;next} !skip' \
  /etc/nginx/sites-available/viziai.conf.full > /etc/nginx/sites-available/viziai.conf
mkdir -p /var/www/html
nginx -t && systemctl reload nginx

# получаем сертификат без участия nginx-плагина (только кладёт файлы, конфиг не трогает)
certbot certonly --webroot -w /var/www/html -d xn----7sbbhzo1afsm0d.xn--p1ai -d s3.xn----7sbbhzo1afsm0d.xn--p1ai

# теперь возвращаем полный конфиг — пути к сертификату уже существуют
cp /etc/nginx/sites-available/viziai.conf.full /etc/nginx/sites-available/viziai.conf
nginx -t && systemctl reload nginx
```

Certbot сам настроит автопродление (`systemctl list-timers | grep certbot`).

## 4. Домашний сервер: Ubuntu 24.04

Установка самой ОС (флешка, BIOS, разметка диска, SSH) — отдельная инструкция: [INSTALL_UBUNTU_SERVER.md](INSTALL_UBUNTU_SERVER.md).

### 4.1 Система и драйверы — `scripts/install.sh`

Всё провижининг-железо (Docker + compose, NVIDIA Container Toolkit, драйвер NVIDIA
если его нет, ротация docker-логов, ufw-правила из §4.3, AmneziaWG,
`/mnt/data/{archive,minio,backups}`) ставится одним скриптом:

```bash
sudo apt update && sudo apt -y upgrade
git clone <repo> viziai && cd viziai
sudo ./scripts/install.sh
# если скрипт ставил драйвер NVIDIA — перезагрузись и проверь:
nvidia-smi                                                                  # RTX 3070 видна
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi   # GPU виден из контейнера
```

После скрипта перелогинься (или `newgrp docker`), чтобы заработала группа docker.

В BIOS: **Restore AC Power Loss = Power On** (сервер сам поднимется после отключения света), отключить sleep.

### 4.2 WireGuard-клиент (AmneziaWG)

`install.sh` уже добавил PPA и поставил пакет `amneziawg` (см. §2 про причину
выбора AmneziaWG вместо ванильного WireGuard). Создай
`/etc/amnezia/amneziawg/awg0.conf` по шаблону `infra/vps/wg0-home.conf.example`
(PrivateKey = `home.key` со 2-го шага, PublicKey = `vps.pub`, Endpoint = IP VPS,
параметры `Jc/Jmin/.../H4` — те же самые, что в конфиге VPS, не генерировать заново).

```bash
sudo systemctl enable --now awg-quick@awg0
ping 10.9.0.1        # VPS отвечает — туннель работает
```

### 4.3 Файрвол

Уже настроен скриптом `install.sh` (§4.1): наружу открыт только SSH, а порты
платформы (80, 9000, 8555, 1984) доступны только из WG-подсети `10.9.0.0/24` —
трафик приходит через VPS. Проверка: `sudo ufw status verbose`.

Если правишь вручную — правила лежат в `scripts/install.sh` (секция firewall).

### 4.4 Запуск стека — `scripts/init.sh` + `scripts/deploy.sh`

Скрипты сами определяют режим: если существует `infra/.env.prod` — работают
с `docker-compose.prod.yml`, иначе с dev-файлом (флаги `--prod`/`--dev` форсируют).

```bash
cd ~/viziai
cp infra/.env.prod.example infra/.env.prod
nano infra/.env.prod   # домен, VPS_PUBLIC_IP, пароли (openssl rand -hex 32), TELEGRAM_BOT_TOKEN

# первичная инициализация: build, миграции, сид, MinIO-бакеты, проверка CUDA
./scripts/init.sh --seed     # --seed один раз: супер-пользователь и демо-тенант; смени пароли после входа!

# запуск всего стека + ожидание healthcheck'ов
./scripts/deploy.sh
```

`deploy.sh` можно запускать повторно сколько угодно — он пересобирает изменившиеся
образы и поднимает то, что не запущено (`--build` для пересборки с нуля,
`--pull` чтобы сначала сделать `git pull`).

Архивный рекордер (когда есть большой диск) запускается отдельно:
```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod --profile recorder up -d recorder
```

## 5. Подключение камеры ПВЗ

1. Сгенерируй пару ключей для точки (`awg genkey | tee site.key | awg pubkey`), добавь `[Peer]` в `awg0.conf` VPS (`AllowedIPs = 10.9.0.11/32`), `awg syncconf awg0 <(awg-quick strip awg0)`.
2. На роутере ПВЗ настрой AmneziaWG-клиент по `infra/vps/wg0-site.conf.example` (те же `Jc/.../H4`, что у VPS) + dst-nat 554 → камера. MikroTik со встроенным WireGuard не подойдёт для точек за DPI-провайдером — см. примечание в файле.
3. В админке добавь камеру: `rtsp://user:pass@10.9.0.11:554/...` (sub-поток для AI, main для архива).

## 6. Проверки и эксплуатация

```bash
curl https://xn----7sbbhzo1afsm0d.xn--p1ai/api/v1/health          # {"status":"ok"}
# логин в браузере, дашборд, live-видео (WebRTC через VPS:8555)
docker compose -f docker-compose.prod.yml logs -f analyzer   # детекции идут
```

**Обновление:** `./scripts/update.sh` — сам делает `git pull`, пересобирает только приложения (api/web/analyzer/воркеры), прогоняет миграции и перезапускает их по одному, не трогая postgres/redis/minio. Полный перезапуск с нуля: `./scripts/deploy.sh --pull --build`.

**Бэкапы (cron на домашнем сервере, копировать на VPS или в облако):**
```bash
docker exec viziai-postgres-1 pg_dump -U viziai viziai | gzip > /mnt/data/backup/db-$(date +%F).sql.gz
```

**Мониторинг:** на VPS поставь Uptime Kuma (docker) и мониторь `https://<домен>/api/v1/health` + пинг 10.9.0.2 — алерт в Telegram, если дом ушёл в оффлайн.

**WireGuard-сторож (домашний сервер).** Даже с AmneziaWG оставь как страховку —
если по любой причине (перезагрузка роутера, смена IP) туннель отвалится,
`scripts/wg-watchdog.sh` пингует VPS и сам перезапускает `awg-quick@awg0`:
```bash
sudo cp scripts/wg-watchdog.sh /usr/local/bin/wg-watchdog.sh
sudo chmod +x /usr/local/bin/wg-watchdog.sh
(crontab -l 2>/dev/null; echo "*/2 * * * * /usr/local/bin/wg-watchdog.sh") | sudo crontab -
# проверка, что сработало (после его первого запуска):
journalctl -t wg-watchdog --no-pager -n 20
```

## 7. Если пока остаёшься на Windows + WSL2 (не рекомендуется для прода)

Работает, но прими меры:
1. WireGuard ставь **в Windows** (официальный клиент), не в WSL: туннель переживает перезапуск WSL. В `.wslconfig` включи `networkingMode=mirrored` (Windows 11) — WSL видит wg0-адреса; на Windows 10 mirrored нет, придётся пробрасывать порты `netsh interface portproxy` (80, 9000, 8555, 1984 → WSL-IP, который меняется при перезагрузке — скрипт в автозагрузку).
2. Электропитание: «Никогда не спать», отключить гибернацию (`powercfg /h off`).
3. Windows Update: активные часы + групповая политика «уведомлять, не перезагружать».
4. Автостарт: Task Scheduler → при старте `wsl -d Ubuntu -u <user> -- docker compose -f ~/viziai/infra/docker-compose.prod.yml --env-file ~/viziai/infra/.env.prod up -d`.
5. Docker — ставь **внутри WSL** (systemd в Ubuntu 24.04 включён), не Docker Desktop: меньше слоёв, GPU через nvidia-container-toolkit работает так же (нужен только Windows-драйвер NVIDIA).

Итог: на Windows 10 (как сейчас) двойной NAT + portproxy делают схему заметно хрупче. Чистый Ubuntu Server снимает все четыре пункта.
