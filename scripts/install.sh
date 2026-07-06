#!/usr/bin/env bash
# One-time host provisioning for the home GPU server (Ubuntu 24.04, run as root).
# Covers DEPLOY.md §4.1-4.3 except the WireGuard config itself (§4.2).
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }

if [[ $EUID -ne 0 ]]; then err "Run as root: sudo $0"; exit 1; fi

# 1. base packages -----------------------------------------------------------
info "apt update + base tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git make ufw fail2ban ca-certificates gnupg lsb-release software-properties-common

# AmneziaWG (WireGuard-compatible protocol with traffic obfuscation) instead of
# vanilla WireGuard — some ISPs run DPI that specifically detects and kills
# plain WireGuard's rekey handshake every ~2 minutes. Config format and keys
# are compatible; see DEPLOY.md §2/§4.2 for the awg0.conf setup.
info "Installing AmneziaWG"
add-apt-repository -y ppa:amnezia/ppa
apt-get update -y
apt-get install -y amneziawg

# 2. Docker Engine + compose plugin ------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  info "Installing Docker Engine"
  curl -fsSL https://get.docker.com | sh
else
  info "Docker already present: $(docker --version)"
fi
apt-get install -y docker-compose-plugin
systemctl enable --now docker

# 3. docker log rotation (json logs would eat the NVMe otherwise) -------------
if [[ ! -f /etc/docker/daemon.json ]]; then
  info "Writing /etc/docker/daemon.json (log rotation)"
  cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "50m", "max-file": "3" } }
EOF
else
  warn "/etc/docker/daemon.json exists — check log rotation is configured there"
fi

# 4. NVIDIA Container Toolkit (only if an NVIDIA GPU is present) --------------
if lspci 2>/dev/null | grep -qi nvidia; then
  if ! command -v nvidia-smi >/dev/null 2>&1; then
    warn "NVIDIA GPU present but no driver — installing (reboot required after)"
    ubuntu-drivers install || warn "ubuntu-drivers failed; install driver manually"
  fi
  info "Installing NVIDIA Container Toolkit"
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update -y
  apt-get install -y nvidia-container-toolkit
  nvidia-ctk runtime configure --runtime=docker
else
  warn "No NVIDIA GPU detected → skipping Container Toolkit (analyzer will run on CPU)"
fi
systemctl restart docker

# 5. firewall -----------------------------------------------------------------
# Public: only SSH. Platform ports (nginx 80, minio 9000, webrtc 8555,
# go2rtc api 1984) are reachable ONLY from the WireGuard subnet — traffic
# arrives via the VPS. The WG tunnel itself is outbound (home is a client).
info "Configuring ufw"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow from 10.9.0.0/24 to any port 80 proto tcp
ufw allow from 10.9.0.0/24 to any port 9000 proto tcp
ufw allow from 10.9.0.0/24 to any port 8555
ufw allow from 10.9.0.0/24 to any port 1984 proto tcp
# go2rtc runs on host-network; the api/nginx containers reach it through the
# host gateway with a docker-bridge source IP (172.16/12), which the WG-only
# rule above would drop. Allow docker subnets → go2rtc api. 172.16/12 is
# private/non-routable, so this doesn't expose it to the internet.
ufw allow from 172.16.0.0/12 to any port 1984 proto tcp
ufw --force enable

# 6. docker group for the invoking user ---------------------------------------
if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
  usermod -aG docker "$SUDO_USER"
  info "User $SUDO_USER added to docker group (re-login to apply)"
fi

# 7. data directories ----------------------------------------------------------
info "Creating /mnt/data directories"
mkdir -p /mnt/data/{archive,minio,backups}
[[ -n "${SUDO_USER:-}" ]] && chown -R "$SUDO_USER:$SUDO_USER" /mnt/data

# 8. summary --------------------------------------------------------------------
echo
info "Install complete:"
echo "  docker : $(docker --version)"
echo "  compose: $(docker compose version | head -n1)"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,driver_version --format=csv,noheader || true
else
  warn "nvidia-smi not available (reboot if the driver was just installed)"
fi
echo
info "Next: WireGuard client (DEPLOY.md §4.2), then ./scripts/init.sh --seed"
