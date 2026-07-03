# Развёртывание: домашний ПК (GPU-сервер) + VPS (публичная точка входа)

_Домашний ПК: i5-12400F / RTX 3070 8GB / 32GB DDR4 / 512GB NVMe. VPS: любой, 1-2 vCPU / 1-2GB RAM достаточно._

## Архитектура

```
Браузер ──HTTPS──► VPS (nginx, TLS, публичный IP)
Камеры ПВЗ ──WG──►  │ WireGuard-хаб 10.9.0.1
                    │        │ туннель
                    ▼        ▼
              Домашний сервер 10.9.0.2 (Ubuntu)
              nginx:80 → web:3001 / api:3000 / go2rtc:1984
              minio:9000 (s3.<домен> через VPS)
              analyzer (CUDA) → Redis → api → PostgreSQL
```

- **VPS** — только вход: TLS, DNS, WireGuard-хаб, проброс WebRTC :8555. Никаких данных и GPU.
- **Домашний ПК** — весь стек в docker compose (`infra/docker-compose.prod.yml`).
- **Камеры** — WG-клиент на роутере ПВЗ → RTSP доступен по 10.9.0.x внутри туннеля.

Порты наружу на VPS: 80, 443 (tcp), 51820 (udp, WG), 8555 (tcp+udp, WebRTC).
На домашнем ПК наружу — **ничего**; всё только через wg0.

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
apt -y install wireguard nginx certbot python3-certbot-nginx ufw

ufw allow OpenSSH
ufw allow 80,443/tcp
ufw allow 51820/udp
ufw allow 8555/tcp && ufw allow 8555/udp
ufw enable
```

## 2. VPS: WireGuard-хаб

```bash
cd /etc/wireguard
umask 077
wg genkey | tee vps.key | wg pubkey > vps.pub        # ключи VPS
wg genkey | tee home.key | wg pubkey > home.pub      # ключи домашнего сервера (передать туда)
```

Создай `/etc/wireguard/wg0.conf` по шаблону `infra/vps/wg0-vps.conf.example`
(подставь `vps.key` в PrivateKey, `home.pub` в PublicKey пира).

```bash
systemctl enable --now wg-quick@wg0
wg show   # после подключения дома появится handshake
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

### 4.1 Система и драйверы

```bash
sudo apt update && sudo apt -y upgrade
sudo ubuntu-drivers install                # nvidia-driver-5xx
sudo reboot
nvidia-smi                                 # должна показать RTX 3070

# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# NVIDIA Container Toolkit (GPU в контейнерах)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -sL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update && sudo apt -y install nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi   # проверка

# ротация docker-логов (иначе json-логи забьют NVMe)
sudo tee /etc/docker/daemon.json > /dev/null <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "50m", "max-file": "3" } }
EOF
sudo systemctl restart docker

# данные
sudo mkdir -p /mnt/data/{minio,archive}
```

В BIOS: **Restore AC Power Loss = Power On** (сервер сам поднимется после отключения света), отключить sleep.

### 4.2 WireGuard-клиент

`/etc/wireguard/wg0.conf` по шаблону `infra/vps/wg0-home.conf.example`
(PrivateKey = `home.key` со 2-го шага, PublicKey = `vps.pub`, Endpoint = IP VPS).

```bash
sudo apt -y install wireguard
sudo systemctl enable --now wg-quick@wg0
ping 10.9.0.1        # VPS отвечает — туннель работает
```

### 4.3 Файрвол

```bash
sudo ufw allow OpenSSH
# сервисы платформы доступны только из WG-подсети (VPS-прокси и камеры)
sudo ufw allow from 10.9.0.0/24 to any port 80 proto tcp
sudo ufw allow from 10.9.0.0/24 to any port 9000 proto tcp
sudo ufw allow from 10.9.0.0/24 to any port 8555
sudo ufw allow from 10.9.0.0/24 to any port 1984 proto tcp
sudo ufw enable
```

(WebRTC :8555 приходит с VPS уже как форвард через wg0, публично ПК не торчит.)

### 4.4 Запуск стека

```bash
git clone <repo> viziai && cd viziai/infra
cp .env.prod.example .env.prod
nano .env.prod    # домен, VPS_PUBLIC_IP, пароли (openssl rand -hex 32), TELEGRAM_BOT_TOKEN

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod ps    # все healthy

# первый раз: сид (супер-пользователь и т.д.) — потом сменить пароли!
docker exec -i viziai-postgres-1 psql -U viziai -d viziai < postgres/seed.dev.sql
```

Архивный рекордер (когда есть большой диск): добавь `--profile recorder` к команде up.

## 5. Подключение камеры ПВЗ

1. Сгенерируй пару ключей для точки, добавь `[Peer]` в wg0.conf VPS (`AllowedIPs = 10.9.0.11/32`), `wg syncconf wg0 <(wg-quick strip wg0)`.
2. На роутере ПВЗ (Keenetic/MikroTik/OpenWrt) настрой WG-клиент по `infra/vps/wg0-site.conf.example` + dst-nat 554 → камера.
3. В админке добавь камеру: `rtsp://user:pass@10.9.0.11:554/...` (sub-поток для AI, main для архива).

## 6. Проверки и эксплуатация

```bash
curl https://viziai.example.ru/api/v1/health          # {"status":"ok"}
# логин в браузере, дашборд, live-видео (WebRTC через VPS:8555)
docker compose -f docker-compose.prod.yml logs -f analyzer   # детекции идут
```

**Обновление:** `git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`

**Бэкапы (cron на домашнем сервере, копировать на VPS или в облако):**
```bash
docker exec viziai-postgres-1 pg_dump -U viziai viziai | gzip > /mnt/data/backup/db-$(date +%F).sql.gz
```

**Мониторинг:** на VPS поставь Uptime Kuma (docker) и мониторь `https://<домен>/api/v1/health` + пинг 10.9.0.2 — алерт в Telegram, если дом ушёл в оффлайн.

## 7. Если пока остаёшься на Windows + WSL2 (не рекомендуется для прода)

Работает, но прими меры:
1. WireGuard ставь **в Windows** (официальный клиент), не в WSL: туннель переживает перезапуск WSL. В `.wslconfig` включи `networkingMode=mirrored` (Windows 11) — WSL видит wg0-адреса; на Windows 10 mirrored нет, придётся пробрасывать порты `netsh interface portproxy` (80, 9000, 8555, 1984 → WSL-IP, который меняется при перезагрузке — скрипт в автозагрузку).
2. Электропитание: «Никогда не спать», отключить гибернацию (`powercfg /h off`).
3. Windows Update: активные часы + групповая политика «уведомлять, не перезагружать».
4. Автостарт: Task Scheduler → при старте `wsl -d Ubuntu -u <user> -- docker compose -f ~/viziai/infra/docker-compose.prod.yml --env-file ~/viziai/infra/.env.prod up -d`.
5. Docker — ставь **внутри WSL** (systemd в Ubuntu 24.04 включён), не Docker Desktop: меньше слоёв, GPU через nvidia-container-toolkit работает так же (нужен только Windows-драйвер NVIDIA).

Итог: на Windows 10 (как сейчас) двойной NAT + portproxy делают схему заметно хрупче. Чистый Ubuntu Server снимает все четыре пункта.
