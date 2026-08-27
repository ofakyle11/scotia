#!/usr/bin/env bash
# Chambers health check — standalone, zero dependencies beyond coreutils.
# Used three ways:
#   1. systemd readiness gate:  ExecStartPost= in chambers.service
#   2. operator, by hand:       sudo bash /opt/chambers/app/deploy/healthcheck.sh
#   3. cron watchdog:           */5 * * * * root /opt/chambers/app/deploy/healthcheck.sh --quiet || systemctl restart chambers
#
# Probes the app's own GET /healthz (server.js: `send(res, 200, 'ok')`, one of
# the five routes in PUBLIC, so it needs no session and leaks nothing).
# Exit 0 = healthy. Exit 1 = unhealthy, with an explicit reason.
#
# Prints no secret, ever: it never dumps the journal (a fresh journal carries
# the one-time enrolment links) and never echoes the environment — it prints
# the commands the operator should run instead.
set -uo pipefail

URL=${HEALTH_URL:-}
PORT=${PORT:-8028}
WAIT=0
QUIET=0
UNIT=${CHAMBERS_UNIT:-chambers}

usage() {
  cat <<'USAGE'
usage: healthcheck.sh [--url URL] [--wait SECONDS] [--quiet]
  --url URL        what to probe            (default http://127.0.0.1:8028/healthz,
                                            or $PORT if that is set in the environment)
  --wait SECONDS   retry until healthy      (default 0 = probe once)
  --quiet          print only on failure
Exit 0 healthy, 1 unhealthy, 2 bad usage.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url)   URL=${2:-}; shift 2 || true ;;
    --wait)  WAIT=${2:-0}; shift 2 || true ;;
    --quiet) QUIET=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf '!! unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done
case "$WAIT" in (*[!0-9]*|'') printf '!! --wait needs whole seconds\n' >&2; exit 2 ;; esac
: "${URL:=http://127.0.0.1:${PORT}/healthz}"
# the port actually being probed, for the failure hints (may differ from $PORT)
PROBED_PORT=${URL##*:}; PROBED_PORT=${PROBED_PORT%%/*}
case "$PROBED_PORT" in (*[!0-9]*|'') PROBED_PORT=$PORT ;; esac

# Probe once. Echoes "<http-status> <first 24 bytes of body>" or "ERR <reason>".
# curl when present; otherwise node, which is guaranteed on a Chambers box.
probe() {
  local tmp code
  if command -v curl >/dev/null 2>&1; then
    tmp=$(mktemp) || { printf 'ERR mktemp failed (read-only /tmp?)'; return 1; }
    code=$(curl -sS -m 5 -o "$tmp" -w '%{http_code}' "$URL" 2>/dev/null)
    if [ -z "$code" ] || [ "$code" = "000" ]; then
      rm -f "$tmp"; printf 'ERR no answer — connection refused or timed out'; return 1
    fi
    printf '%s %s' "$code" "$(tr -d '\r\n' < "$tmp" | cut -c1-24)"
    rm -f "$tmp"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    node -e '
      const http = require("http"), u = new URL(process.argv[1]);
      const req = http.get({ hostname: u.hostname, port: u.port, path: u.pathname, timeout: 5000 }, (r) => {
        let b = ""; r.setEncoding("utf8");
        r.on("data", (c) => { b += c; });
        r.on("end", () => { process.stdout.write(r.statusCode + " " + b.trim().slice(0, 24)); });
      });
      req.on("timeout", () => { req.destroy(); process.stdout.write("ERR timeout after 5s"); });
      req.on("error", (e) => { process.stdout.write("ERR " + (e.code || e.message)); });
    ' "$URL"
    return 0
  fi
  printf 'ERR no curl and no node on PATH'
  return 1
}

deadline=$(( $(date +%s) + WAIT ))
attempts=0
while :; do
  attempts=$((attempts + 1))
  result=$(probe 2>/dev/null)
  case "$result" in
    "200 ok"*)
      [ "$QUIET" = 1 ] || printf 'ok   Chambers healthy — %s returned 200 ok (attempt %d)\n' "$URL" "$attempts"
      exit 0 ;;
  esac
  [ "$(date +%s)" -lt "$deadline" ] || break
  sleep 1
done

# ---- unhealthy: say exactly what was tried, what came back, and what to run
{
  printf '!! Chambers health check FAILED\n'
  printf '   probed : %s\n' "$URL"
  printf '   result : %s\n' "${result:-no response}"
  printf '   tries  : %d over %ss\n' "$attempts" "$WAIT"
  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    printf '   unit   : %s is %s (%s)\n' "$UNIT" \
      "$(systemctl is-active "$UNIT" 2>/dev/null || echo unknown)" \
      "$(systemctl is-enabled "$UNIT" 2>/dev/null || echo not-enabled)"
  else
    printf '   unit   : no running systemd here — checking the URL only\n'
  fi
  printf '   next   : sudo systemctl status %s --no-pager\n' "$UNIT"
  printf '            sudo journalctl -u %s -n 50 --no-pager\n' "$UNIT"
  printf '            sudo ss -ltnp | grep %s        # is anything listening?\n' "$PROBED_PORT"
  printf '            df -h /var/lib/chambers        # a full disk stops every write\n'
  printf '   note   : the journal can contain a one-time enrolment link. Treat it\n'
  printf '            as a credential — do not paste it into a ticket or chat.\n'
} >&2
exit 1
