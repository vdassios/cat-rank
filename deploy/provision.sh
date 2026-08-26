#!/usr/bin/env bash
# Idempotent host provisioning for Cat Ranking (Ubuntu 24.04 LTS, Hetzner CX22).
# Safe to re-run: every step checks before it changes, and partial installs are
# converged (not just skipped). Runs as root.
#
#   ./deploy/provision.sh <deploy_public_key> <repo_url>
#
# The deploy login key and repo URL may also be supplied via DEPLOY_PUBKEY and
# REPO_URL. A private repo additionally needs a read-only deploy key, passed via
# DEPLOY_REPO_KEY (contents of the private key) — this is separate from the
# login key, which only authorizes inbound SSH.

set -euo pipefail

DEPLOY_KEY="${1:-${DEPLOY_PUBKEY:-}}"
REPO_URL="${2:-${REPO_URL:-}}"

DONE=()
SKIPPED=()

note() { DONE+=("$1"); }
skip() { SKIPPED+=("$1"); }

export DEBIAN_FRONTEND=noninteractive

# ─────────────────────────────────────────────────────────────────────────────
# 1. Docker Engine + compose plugin (official apt repo), converged
# ─────────────────────────────────────────────────────────────────────────────
ensure_docker_apt_repo() {
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  if [ ! -f /etc/apt/sources.list.d/docker.list ]; then
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      >/etc/apt/sources.list.d/docker.list
    apt-get update -y
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  ensure_docker_apt_repo
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  note "installed Docker Engine + compose plugin"
else
  skip "Docker Engine already installed"
fi

# Compose plugin must be present independently of the docker binary — a host
# with docker but no compose plugin is not fully provisioned.
if ! docker compose version >/dev/null 2>&1; then
  ensure_docker_apt_repo
  apt-get install -y docker-compose-plugin
  note "installed Docker Compose plugin"
else
  skip "Docker Compose plugin already installed"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Base host packages (git, curl, sqlite3, fail2ban, unattended-upgrades, ufw)
# ─────────────────────────────────────────────────────────────────────────────
apt-get install -y git curl sqlite3 fail2ban unattended-upgrades ufw ca-certificates >/dev/null
note "ensured host packages (git, curl, sqlite3, fail2ban, unattended-upgrades, ufw)"

# ─────────────────────────────────────────────────────────────────────────────
# 3. Firewall (UFW): default deny incoming; allow 22/80/443; enable
# ─────────────────────────────────────────────────────────────────────────────
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
if ufw status | grep -q "Status: active"; then
  skip "UFW already active"
else
  ufw --force enable >/dev/null
  note "enabled UFW (22/80/443 only)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. Deploy user + docker group (converged: group is ensured even if user exists)
# ─────────────────────────────────────────────────────────────────────────────
if id deploy >/dev/null 2>&1; then
  skip "deploy user exists"
else
  useradd --create-home --shell /bin/bash deploy
  note "created deploy user"
fi

if id -nG deploy | grep -qw docker; then
  skip "deploy user already in docker group"
else
  usermod -aG docker deploy
  note "added deploy user to docker group"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. Authorized key (inbound SSH login)
# ─────────────────────────────────────────────────────────────────────────────
if [ -n "$DEPLOY_KEY" ]; then
  AUTH_KEYS="/home/deploy/.ssh/authorized_keys"
  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  if [ -f "$AUTH_KEYS" ] && grep -qF "$DEPLOY_KEY" "$AUTH_KEYS"; then
    skip "deploy public key already installed"
  else
    echo "$DEPLOY_KEY" >>"$AUTH_KEYS"
    chown deploy:deploy "$AUTH_KEYS"
    chmod 600 "$AUTH_KEYS"
    note "installed deploy public key (inbound login)"
  fi
else
  skip "no deploy public key provided (pass as \$1 or DEPLOY_PUBKEY)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 6. Optional read-only deploy key (outbound git access for a PRIVATE repo).
#    Distinct from the login key above, which only authorizes inbound SSH.
# ─────────────────────────────────────────────────────────────────────────────
if [ -n "${DEPLOY_REPO_KEY:-}" ]; then
  SSH_DIR="/home/deploy/.ssh"
  install -d -m 700 -o deploy -g deploy "$SSH_DIR"
  if [ -f "$SSH_DIR/id_ed25519" ]; then
    skip "repo deploy key already present"
  else
    printf '%s\n' "$DEPLOY_REPO_KEY" >"$SSH_DIR/id_ed25519"
    chown deploy:deploy "$SSH_DIR/id_ed25519"
    chmod 600 "$SSH_DIR/id_ed25519"
    ssh-keyscan -t ed25519 github.com >>"$SSH_DIR/known_hosts" 2>/dev/null || true
    chown deploy:deploy "$SSH_DIR/known_hosts"
    note "installed read-only deploy key (outbound git)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 7. SSH hardening (key-only) — only once a login key is known to be present, so
#    a misconfigured run can't lock out the current session.
# ─────────────────────────────────────────────────────────────────────────────
SSHD_DROPIN="/etc/ssh/sshd_config.d/99-cat-ranking.conf"
if [ -f /home/deploy/.ssh/authorized_keys ] && [ -s /home/deploy/.ssh/authorized_keys ]; then
  if [ -f "$SSHD_DROPIN" ]; then
    skip "sshd drop-in present"
  else
    printf 'PasswordAuthentication no\nPermitRootLogin prohibit-password\n' >"$SSHD_DROPIN"
    systemctl reload ssh
    note "hardened sshd (key-only, no root password) + reloaded"
  fi
else
  skip "sshd hardening deferred (no authorized key for deploy user yet)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 8. fail2ban — enable the sshd jail
# ─────────────────────────────────────────────────────────────────────────────
if [ -f /etc/fail2ban/jail.local ] && grep -q '\[sshd\]' /etc/fail2ban/jail.local; then
  skip "fail2ban sshd jail configured"
else
  printf '[sshd]\nenabled = true\n' >/etc/fail2ban/jail.local
  systemctl enable fail2ban >/dev/null 2>&1 || true
  systemctl restart fail2ban >/dev/null 2>&1 || true
  note "enabled fail2ban sshd jail"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 9. unattended-upgrades — enable security updates
# ─────────────────────────────────────────────────────────────────────────────
if [ -f /etc/apt/apt.conf.d/20auto-upgrades ] && grep -q '1' /etc/apt/apt.conf.d/20auto-upgrades; then
  skip "unattended-upgrades enabled"
else
  printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' \
    >/etc/apt/apt.conf.d/20auto-upgrades
  note "enabled unattended-upgrades (security)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 10. Repository — clone/pull as the deploy user (so it is pullable by CI, which
#     connects as deploy), to /opt/cat-ranking
# ─────────────────────────────────────────────────────────────────────────────
REPO_DIR="/opt/cat-ranking"
if [ -d "$REPO_DIR/.git" ]; then
  if [ -n "$REPO_URL" ]; then
    runuser -u deploy -- git -C "$REPO_DIR" remote set-url origin "$REPO_URL"
  fi
  runuser -u deploy -- git -C "$REPO_DIR" pull --ff-only
  note "updated repo at $REPO_DIR (git pull --ff-only)"
elif [ -n "$REPO_URL" ]; then
  install -d -o deploy -g deploy "$REPO_DIR"
  runuser -u deploy -- git clone "$REPO_URL" "$REPO_DIR"
  note "cloned repo to $REPO_DIR"
else
  skip "no repo URL provided (pass as \$2 or REPO_URL); clone skipped"
fi

# Ensure deploy owns the repo so CI (deploy user) can pull and edit .env.
if [ "$(stat -c %U "$REPO_DIR" 2>/dev/null)" != "deploy" ]; then
  chown -R deploy:deploy "$REPO_DIR"
  note "ensured deploy owns $REPO_DIR"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 11. Cron — nightly restore-verify job for the deploy user. Source .env so
#     HEALTHCHECK_RESTORE_URL reaches verify-backup.sh.
# ─────────────────────────────────────────────────────────────────────────────
CRON_LINE='30 4 * * * cd /opt/cat-ranking && set -a && . ./.env && set +a && ./deploy/verify-backup.sh'
if crontab -u deploy -l 2>/dev/null | grep -qF "verify-backup.sh"; then
  skip "verify-backup cron present"
else
  (crontab -u deploy -l 2>/dev/null || true; echo "$CRON_LINE") | crontab -u deploy -
  note "installed nightly verify-backup cron (sources .env)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 12. Summary
# ─────────────────────────────────────────────────────────────────────────────
echo
echo "provision complete"
echo "  done:"
for item in "${DONE[@]}"; do printf '    - %s\n' "$item"; done
echo "  already in place / skipped:"
for item in "${SKIPPED[@]}"; do printf '    - %s\n' "$item"; done
