#!/usr/bin/env bash
# One-time host provisioning for Ubuntu 22.04 (run as root / via sudo).
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }

if [[ $EUID -ne 0 ]]; then err "Run as root: sudo $0"; exit 1; fi

VIZIAI_USER="viziai"

# 1. base packages -----------------------------------------------------------
info "apt update + base tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git make ufw fail2ban ca-certificates gnupg lsb-release

# 2. Docker Engine + compose plugin ------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  info "Installing Docker Engine"
  curl -fsSL https://get.docker.com | sh
else
  info "Docker already present: $(docker --version)"
fi
apt-get install -y docker-compose-plugin

# 3. NVIDIA Container Toolkit (only if an NVIDIA GPU is present) --------------
if lspci 2>/dev/null | grep -qi nvidia; then
  info "NVIDIA GPU detected → installing Container Toolkit"
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update -y
  apt-get install -y nvidia-container-toolkit
  nvidia-ctk runtime configure --runtime=docker
  systemctl restart docker
else
  warn "No NVIDIA GPU detected → skipping Container Toolkit (analyzer will run on CPU)"
fi

# 4. Node.js 22 LTS ----------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | cut -d. -f1)" != "v22" ]]; then
  info "Installing Node.js 22 LTS"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# 5. Python 3.12 (deadsnakes) ------------------------------------------------
if ! command -v python3.12 >/dev/null 2>&1; then
  info "Installing Python 3.12"
  apt-get install -y software-properties-common
  add-apt-repository -y ppa:deadsnakes/ppa
  apt-get update -y
  apt-get install -y python3.12 python3.12-venv python3.12-dev
fi

# 6. firewall ----------------------------------------------------------------
info "Configuring ufw"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 51820/udp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 7. service user ------------------------------------------------------------
if ! id "$VIZIAI_USER" >/dev/null 2>&1; then
  info "Creating user $VIZIAI_USER"
  useradd -r -m -s /bin/bash "$VIZIAI_USER"
fi
usermod -aG docker "$VIZIAI_USER"

# 8. data directories --------------------------------------------------------
info "Creating /mnt/data directories"
mkdir -p /mnt/data/{archive,minio,postgres,redis,backups}
chown -R "$VIZIAI_USER:$VIZIAI_USER" /mnt/data

# 9. summary -----------------------------------------------------------------
echo
info "Install complete:"
echo "  docker : $(docker --version)"
echo "  compose: $(docker compose version | head -n1)"
echo "  node   : $(node -v)"
echo "  python : $(python3.12 --version)"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,driver_version --format=csv,noheader || true
else
  warn "nvidia-smi not available"
fi
echo
info "Next: clone repo as '$VIZIAI_USER' and run ./scripts/init.sh"
