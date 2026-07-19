#!/usr/bin/env bash
# Ставит ежедневный бэкап (03:30) через /etc/cron.d. Запускать с sudo:
#   sudo ./scripts/install-backup-cron.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_AS="${SUDO_USER:-root}"

cat > /etc/cron.d/viziai-backup <<EOF
# ViziAI: ночной бэкап PostgreSQL + Redis (scripts/backup.sh)
30 3 * * * $RUN_AS cd $ROOT && ./scripts/backup.sh >> /var/log/viziai-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/viziai-backup
touch /var/log/viziai-backup.log
chown "$RUN_AS" /var/log/viziai-backup.log || true

echo "Готово: /etc/cron.d/viziai-backup (ежедневно в 03:30 от $RUN_AS)."
echo "Первый прогон вручную: ./scripts/backup.sh"
