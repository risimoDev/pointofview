# Установка Ubuntu Server 24.04 LTS на домашний ПК-сервер

_Железо: i5-12400F / Gigabyte H610M / RTX 3070 / 32GB DDR4 / 512GB NVMe. Текущая ОС Windows 10 будет **полностью стёрта**._

После установки продолжай с [DEPLOY.md](DEPLOY.md) §4 (драйверы NVIDIA, Docker, WireGuard, запуск стека).

---

## 0. Перед началом — чеклист

- [ ] **Бэкап всего нужного с ПК** — диск будет отформатирован целиком. Проверь: документы, сохранения, ключи, `.env`-файлы, данные из WSL (`\\wsl$\Ubuntu\home\...`).
- [ ] Лицензия Windows цифровая и привязана к железу — если когда-нибудь вернёшь Windows на этот ПК, она активируется сама. Ничего сохранять не нужно.
- [ ] USB-флешка **от 4 ГБ** (будет стёрта).
- [ ] Монитор + клавиатура, подключённые к ПК-серверу (нужны только на время установки, потом сервер работает headless по SSH).
- [ ] **Ethernet-кабель от роутера к ПК** — сервер должен быть на проводе, не на Wi-Fi.
- [ ] Монитор подключай к **видеокарте** (RTX 3070): у i5-12400**F** нет встроенной графики, выходы на материнке не работают.

## 1. Скачать ISO (на рабочем dev-ПК)

Образ: **ubuntu-24.04.x-live-server-amd64.iso** (~2.6 ГБ):

- Официально: https://ubuntu.com/download/server
- Зеркало Яндекса (быстрее из РФ): https://mirror.yandex.ru/ubuntu-cdimage/ubuntu/releases/24.04/release/

Проверка целостности (PowerShell на dev-ПК, сверить со `SHA256SUMS` рядом с образом):

```powershell
Get-FileHash .\ubuntu-24.04.2-live-server-amd64.iso -Algorithm SHA256
```

## 2. Загрузочная флешка (Rufus)

1. Скачай Rufus: https://rufus.ie (portable-версии достаточно).
2. Вставь флешку, запусти Rufus:
   - **Устройство:** твоя флешка
   - **Метод загрузки:** выбери скачанный ISO
   - **Схема раздела:** GPT, **целевая система:** UEFI (non-CSM)
   - Остальное по умолчанию → **Старт** → в диалоге выбери «Write in ISO Image mode» (по умолчанию).
3. Дождись «Готов», извлеки флешку.

## 3. Настройки BIOS (Gigabyte H610M)

Вставь флешку в ПК-сервер, включи его и жми **Del** для входа в BIOS. Если интерфейс в Easy Mode — переключись в Advanced (F2).

Настрой и сохрани (F10):

| Параметр | Где (примерно) | Значение | Зачем |
|---|---|---|---|
| CSM Support | Boot | **Disabled** | чистый UEFI |
| Secure Boot | Boot / Security | **Disabled** | иначе драйвер NVIDIA потребует ручной MOK-подписи |
| XMP / Extreme Memory Profile | Tweaker | **Profile 1** | память на паспортной частоте, а не 2133 |
| **AC BACK (Restore on AC Power Loss)** | Settings → Platform Power | **Always On** | сервер сам включится после отключения света — критично |
| ErP | Settings → Platform Power | Disabled | чтобы AC Back работал |
| Boot Option #1 | Boot | UEFI: <флешка> | загрузка установщика |

Также быстро проверь, что видны все 32 ГБ RAM и NVMe-диск (главная страница BIOS).

## 4. Установка (по экранам)

ПК загрузится в установщик Ubuntu (текстовый интерфейс, стрелки + Enter, Tab — между полями).

1. **GRUB-меню** → `Try or Install Ubuntu Server`.
2. **Язык** → **English** (логи и сообщения об ошибках проще гуглить; локаль/часовой пояс это не ограничивает).
3. **Keyboard** → English (US). Русская раскладка на сервере не нужна.
4. **Type of install** → **Ubuntu Server** (не minimized). Ничего дополнительно не отмечай.
5. **Network** — интерфейс `enpXsY` должен получить адрес по DHCP (например `192.168.1.50`). **Запиши этот адрес.** Если адреса нет — проверь кабель. Wi-Fi не настраивай.
6. **Proxy** → пусто, **Mirror** → оставь предложенный (`ru.archive.ubuntu.com`), дождись «mirror passed tests».
7. **Storage** — самый важный экран:
   - `Use an entire disk` → выбери NVMe (512GB), галка `Set up this disk as an LVM group` — оставь.
   - **Внимание, ловушка:** установщик по умолчанию отдаёт корневому разделу только ~100 ГБ, остальное оставляет пустым в LVM. На следующем экране (Storage configuration) найди в списке `ubuntu-lv`, выбери → `Edit` → в поле **Size** впиши максимум, который показан справа как доступный (`max`) → Save.
   - Убедись: `ubuntu-lv` занимает ~470+ ГБ, mount `/`.
   - `Done` → подтверждение **Confirm destructive action** → `Continue` (тут стирается Windows — точка невозврата).
8. **Profile**:
   - Your name: `deploy`
   - Server name: `viziai-server`
   - Username: `deploy`
   - Password: длинный, сохрани в менеджер паролей.
9. **Upgrade to Ubuntu Pro** → `Skip for now`.
10. **SSH Setup** → **отметь `Install OpenSSH server`** (пробел). «Import SSH identity» → No (ключ зальём вручную).
11. **Featured Server Snaps** → **ничего не отмечай** (docker поставим нормальным способом по DEPLOY.md, snap-версия docker ломает GPU-настройку). `Done`.
12. Пойдёт установка + скачивание обновлений (5-15 мин) → **Reboot Now**, вытащи флешку когда попросит.

## 5. Первый вход и базовая настройка

Логинься прямо на сервере (deploy / твой пароль) или сразу по SSH с dev-ПК:

```powershell
# на dev-ПК (PowerShell)
ssh deploy@192.168.1.50    # адрес из шага 4.5
```

### 5.1 Обновление и часовой пояс

```bash
sudo apt update && sudo apt -y upgrade
sudo timedatectl set-timezone Europe/Moscow
timedatectl    # проверка: NTP active: yes
```

### 5.2 Постоянный IP-адрес

Сервер должен иметь фиксированный адрес в домашней сети (на него ссылаются port-forward'ы и твой SSH).

**Способ А (рекомендую): резервация на роутере.** В админке роутера найди DHCP → Static lease / Резервация адресов → привяжи MAC сервера к адресу (например `192.168.1.50`). Ничего на сервере менять не надо.

**Способ Б: статика через netplan** (если роутер не умеет):

```bash
sudo nano /etc/netplan/50-cloud-init.yaml
```

```yaml
network:
  version: 2
  ethernets:
    enp3s0:                     # имя своего интерфейса: ip -br a
      dhcp4: false
      addresses: [192.168.1.50/24]
      routes: [{ to: default, via: 192.168.1.1 }]
      nameservers: { addresses: [192.168.1.1, 1.1.1.1] }
```

```bash
sudo netplan apply
```

### 5.3 SSH по ключу (с dev-ПК)

```powershell
# на dev-ПК, если ключа ещё нет:
ssh-keygen -t ed25519
# залить ключ на сервер:
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh deploy@192.168.1.50 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
ssh deploy@192.168.1.50        # должен пустить без пароля
```

Когда вход по ключу проверен — отключи парольный вход:

```bash
sudo nano /etc/ssh/sshd_config.d/hardening.conf
```
```
PasswordAuthentication no
PermitRootLogin no
```
```bash
sudo systemctl restart ssh
```

### 5.4 Отключить сон и «спящие» ловушки

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

### 5.5 Автообновления безопасности — без внезапных перезагрузок

`unattended-upgrades` уже включён по умолчанию, но убедимся, что он не перезагружает сервер сам:

```bash
sudo nano /etc/apt/apt.conf.d/50unattended-upgrades
# найди и проверь (по умолчанию так и есть):
#   Unattended-Upgrade::Automatic-Reboot "false";
```

Ядро будет обновляться, но перезагрузку делаешь ты — в удобное время (`sudo reboot`).

### 5.6 Быстрая проверка железа

```bash
free -h            # ~31Gi RAM
df -h /            # ~460G+ на / (если меньше 200G — не расширил LVM, см. ниже)
lspci | grep -i nvidia    # RTX 3070 видна (драйвер поставим в DEPLOY.md §4.1)
ip -br a           # адрес интерфейса
```

Если корень оказался ~100 ГБ (пропустил шаг 4.7), расширь без переустановки:

```bash
sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv
sudo resize2fs /dev/ubuntu-vg/ubuntu-lv
df -h /
```

## 6. Готово — дальше DEPLOY.md

Сервер готов к развёртыванию. Продолжай по [DEPLOY.md](DEPLOY.md):

- **§4.1** — драйвер NVIDIA, Docker, NVIDIA Container Toolkit, ротация логов, `/mnt/data`
- **§4.2** — WireGuard-клиент к VPS
- **§4.3** — файрвол (ufw)
- **§4.4** — запуск стека

Монитор и клавиатуру после этого можно отключить — вся работа по SSH, а из интернета сервер доступен только через WireGuard-туннель с VPS.

## Приложение: типовые проблемы

| Симптом | Причина / решение |
|---|---|
| Флешка не видна в Boot-меню | В Rufus выбрана MBR вместо GPT, либо включён CSM — проверь §2 и §3 |
| Чёрный экран после GRUB | Монитор в материнку, а не в видеокарту (у 12400F нет iGPU) |
| Установщик не видит сеть | Кабель/порт роутера; Wi-Fi в установщике не трогаем |
| После установки `df -h /` показывает ~98G | LVM не расширен — команды в §5.6 |
| `ssh: connection refused` | Не отметил OpenSSH server при установке: `sudo apt install openssh-server` |
| Сервер не включился после отключения света | AC BACK в BIOS не выставлен в Always On (§3) |
