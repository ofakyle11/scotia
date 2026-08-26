#!/usr/bin/env bash
# ============================================================================
# OPTIONAL — Chambers runs completely without this. Nothing in install.sh,
# update.sh, backup.sh or restore.sh calls it, and the platform's 36 rooms all
# work with the model gateway switched off.
# ============================================================================
# Installs Ollama on THIS box, bound to loopback, so the AI gateway
# (kernel/ai.js, configured at /admin) has an OpenAI-compatible endpoint that
# never leaves the machine. No prompt, no document, no client name is sent to
# any third party: the model runs in a process on this box, on privileged
# material that must not cross a border or a vendor's logging pipeline.
#
#   sudo bash deploy/optional-ollama.sh                 # default model
#   sudo OLLAMA_MODEL=qwen2.5:7b bash deploy/optional-ollama.sh
#
# HARDWARE — read before running. An 8B model needs ~8 GB of free RAM and
# ~6 GB of disk, and answers in tens of seconds on CPU. The 1 vCPU / 1 GB
# droplet in RUNBOOK.md cannot run it. Either size the box up (8-16 GB) or put
# Ollama on a second machine on the same private network and point the gateway
# at http://<private-ip>:11434/v1 — in which case allow that port only from the
# Chambers box, never from the internet.
set -euo pipefail

MODEL=${OLLAMA_MODEL:-llama3.1:8b}
BIND=${OLLAMA_BIND:-127.0.0.1:11434}

log()  { printf '== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }
die()  { printf '!! %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"

ram_gb=$(awk '/MemTotal/{printf "%d", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 0)
[ "$ram_gb" -ge 8 ] || warn "this box has ${ram_gb} GB RAM — an 8B model will swap or be OOM-killed. Continuing anyway."

if ! command -v ollama >/dev/null 2>&1; then
  log "installing Ollama (vendor script — read it first if you like: curl -fsSL https://ollama.com/install.sh | less)"
  curl -fsSL https://ollama.com/install.sh | sh
else
  info "ollama already installed: $(ollama --version 2>/dev/null | head -1)"
fi

# Loopback only. The vendor default is already 127.0.0.1, but pin it so an
# upgrade or a stray OLLAMA_HOST in the environment cannot publish the model
# server to the network.
log "pinning Ollama to $BIND"
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf <<EOF
[Service]
Environment=OLLAMA_HOST=$BIND
EOF
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  systemctl daemon-reload
  systemctl enable --now ollama
  systemctl restart ollama
  sleep 2
else
  warn "no running systemd — start ollama yourself with OLLAMA_HOST=$BIND"
fi

log "pulling $MODEL (several GB — this takes a while)"
ollama pull "$MODEL"

log "checking the endpoint"
if curl -fsS -m 10 "http://${BIND}/v1/models" >/dev/null; then
  info "http://${BIND}/v1 answers"
else
  die "http://${BIND}/v1/models did not answer — check: systemctl status ollama"
fi

if command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | grep -q '0\.0\.0\.0:11434\|\[::\]:11434'; then
    warn "ollama is listening on ALL interfaces — fix OLLAMA_HOST before going further"
  else
    info "listening on loopback only (confirmed with ss)"
  fi
fi

cat <<DONE

Ollama is up. Now wire it into Chambers, in the browser, as an admin:

  /admin -> Model gateway
    OpenAI-compatible endpoint : http://${BIND}/v1
    Model                      : ${MODEL}
    API key                    : leave blank — a local Ollama needs none

Everything after that is unchanged: every call is policy-checked per matter and
audited (kernel/api.js), matters can forbid model use entirely in the Moot
Room, and client content never trains anything — this gateway only infers.

To turn it off again:
  systemctl disable --now ollama        # gateway falls back to "off" cleanly
  (and clear the endpoint field at /admin — a blank endpoint disables it)
DONE
