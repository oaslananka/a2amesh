#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 oaslananka
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

KUBECTL_BIN="${KUBECTL_BIN:-kubectl}"
RELEASE="${A2AMESH_RELEASE:-a2amesh}"
NAMESPACE="${A2AMESH_NAMESPACE:-a2amesh}"
TOKEN="${A2AMESH_REGISTRY_TOKEN:?A2AMESH_REGISTRY_TOKEN is required}"
LOCAL_PORT="${A2AMESH_REGISTRY_PORT:-18199}"
SENTINEL_URL="${A2AMESH_REGISTRY_SENTINEL_URL:-http://${RELEASE}-runtime.${NAMESPACE}.svc.cluster.local:3003/recovery-sentinel}"
MODE="${1:-}"

response_file="$(mktemp)"
request_file="$(mktemp)"
port_forward_log="$(mktemp)"
port_forward_pid=''
cleanup() {
  if [[ -n "${port_forward_pid}" ]]; then
    kill "${port_forward_pid}" >/dev/null 2>&1 || true
  fi
  rm -f "${response_file}" "${request_file}" "${port_forward_log}"
}
trap cleanup EXIT

"${KUBECTL_BIN}" port-forward --namespace "${NAMESPACE}" \
  "service/${RELEASE}-registry" "${LOCAL_PORT}:3099" >"${port_forward_log}" 2>&1 &
port_forward_pid=$!
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null; then
    break
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    cat "${port_forward_log}" >&2
    exit 1
  fi
  sleep 2
done

case "${MODE}" in
  seed)
    /usr/bin/python3 - "${SENTINEL_URL}" "${request_file}" <<'PY'
import json, sys
sentinel_url, output_path = sys.argv[1:]
payload = {
    'agentUrl': sentinel_url,
    'agentCard': {
        'protocolVersion': '1.0',
        'name': 'Recovery Sentinel',
        'description': 'Synthetic chart persistence evidence',
        'url': sentinel_url,
        'version': '1.0.0',
        'skills': [],
    },
}
with open(output_path, 'w', encoding='utf-8') as handle:
    json.dump(payload, handle, separators=(',', ':'))
PY
    chmod 0600 "${request_file}"
    curl --fail-with-body --silent --show-error --max-time 30 \
      --request POST \
      --header "Authorization: Bearer ${TOKEN}" \
      --header 'Content-Type: application/a2a+json' \
      --data-binary "@${request_file}" \
      "http://127.0.0.1:${LOCAL_PORT}/agents/register" >"${response_file}"
    ;;
  verify)
    curl --fail-with-body --silent --show-error --max-time 30 \
      --header "Authorization: Bearer ${TOKEN}" \
      "http://127.0.0.1:${LOCAL_PORT}/agents" >"${response_file}"
    ;;
  *)
    echo "Usage: $0 {seed|verify}" >&2
    exit 64
    ;;
esac

/usr/bin/python3 - "${response_file}" "${SENTINEL_URL}" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding='utf-8'))
if isinstance(payload, dict) and payload.get('url') == sys.argv[2]:
    raise SystemExit(0)
items = payload if isinstance(payload, list) else payload.get('items', [])
if not any(isinstance(item, dict) and item.get('url') == sys.argv[2] for item in items):
    raise SystemExit('Registry persistence sentinel was not found in the API response.')
PY
printf 'Registry persistence sentinel %s passed.\n' "${MODE}"
