#!/usr/bin/env bash
set -euo pipefail

LAN_IP=""
PORT="8443"
HOST="0.0.0.0"
CERT_FILE="certs/scenewords-ip.pem"
KEY_FILE="certs/scenewords-ip-key.pem"
GRACEFUL_SHUTDOWN_SEC="5"
RELOAD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lan-ip)
      LAN_IP="${2:?missing value for --lan-ip}"
      shift 2
      ;;
    --port)
      PORT="${2:?missing value for --port}"
      shift 2
      ;;
    --host)
      HOST="${2:?missing value for --host}"
      shift 2
      ;;
    --cert-file)
      CERT_FILE="${2:?missing value for --cert-file}"
      shift 2
      ;;
    --key-file)
      KEY_FILE="${2:?missing value for --key-file}"
      shift 2
      ;;
    --graceful-shutdown-sec)
      GRACEFUL_SHUTDOWN_SEC="${2:?missing value for --graceful-shutdown-sec}"
      shift 2
      ;;
    --reload)
      RELOAD="true"
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage:
  ./scripts/run-https.sh [options]

Options:
  --lan-ip <ip>          Print the iPad-facing HTTPS URL.
  --port <port>          HTTPS port. Default: 8443
  --host <host>          Bind host. Default: 0.0.0.0
  --cert-file <path>     Server certificate path. Default: certs/scenewords-ip.pem
  --key-file <path>      Server private key path. Default: certs/scenewords-ip-key.pem
  --graceful-shutdown-sec <sec>
                         Max seconds to wait for graceful shutdown. Default: 5
  --reload               Enable uvicorn reload mode.
  -h, --help             Show this help.
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOLVED_CERT_FILE="$REPO_ROOT/$CERT_FILE"
RESOLVED_KEY_FILE="$REPO_ROOT/$KEY_FILE"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed or not on PATH." >&2
  exit 1
fi

if [[ ! -f "$RESOLVED_CERT_FILE" ]]; then
  echo "Certificate file not found: $RESOLVED_CERT_FILE" >&2
  exit 1
fi

if [[ ! -f "$RESOLVED_KEY_FILE" ]]; then
  echo "Private key file not found: $RESOLVED_KEY_FILE" >&2
  exit 1
fi

if command -v cygpath >/dev/null 2>&1; then
  UV_CERT_FILE="$(cygpath -w "$RESOLVED_CERT_FILE")"
  UV_KEY_FILE="$(cygpath -w "$RESOLVED_KEY_FILE")"
else
  UV_CERT_FILE="$RESOLVED_CERT_FILE"
  UV_KEY_FILE="$RESOLVED_KEY_FILE"
fi

if [[ -n "$LAN_IP" ]]; then
  echo "SceneWords HTTPS URL: https://$LAN_IP:$PORT"
else
  echo "SceneWords HTTPS listening on $HOST:$PORT"
  echo "If you want a copyable iPad URL, pass --lan-ip <your-lan-ip>."
fi

echo "Using certificate: $RESOLVED_CERT_FILE"
echo "Using private key: $RESOLVED_KEY_FILE"
echo "Graceful shutdown timeout: $GRACEFUL_SHUTDOWN_SEC s"

UVICORN_ARGS=(
  run
  uvicorn
  app.main:create_app
  --factory
  --host "$HOST"
  --port "$PORT"
  --timeout-graceful-shutdown "$GRACEFUL_SHUTDOWN_SEC"
  --ssl-certfile "$UV_CERT_FILE"
  --ssl-keyfile "$UV_KEY_FILE"
)

if [[ "$RELOAD" == "true" ]]; then
  UVICORN_ARGS+=(--reload)
fi

cd "$REPO_ROOT"
export VIDEO_GATEWAY_SHUTDOWN_DIAGNOSTICS="true"
export VIDEO_GATEWAY_WORKER_SHUTDOWN_TIMEOUT_SEC="$GRACEFUL_SHUTDOWN_SEC"
exec uv "${UVICORN_ARGS[@]}"
