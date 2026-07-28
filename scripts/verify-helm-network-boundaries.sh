#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 oaslananka
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

KUBECTL_BIN="${KUBECTL_BIN:-kubectl}"
HELM_BIN="${HELM_BIN:-helm}"
RELEASE="${A2AMESH_RELEASE:-a2amesh}"
NAMESPACE="${A2AMESH_NAMESPACE:-a2amesh}"
UNTRUSTED_NAMESPACE="${A2AMESH_UNTRUSTED_NAMESPACE:-a2amesh-untrusted}"
EXTERNAL_NAMESPACE="${A2AMESH_EXTERNAL_NAMESPACE:-a2amesh-external}"
PROBE_IMAGE="${A2AMESH_PROBE_IMAGE:-curlimages/curl:8.14.1}"
SERVER_IMAGE="${A2AMESH_SERVER_IMAGE:-registry.k8s.io/e2e-test-images/agnhost:2.53}"
REGISTRY_URL="http://${RELEASE}-registry.${NAMESPACE}.svc.cluster.local:3099"
RUNTIME_URL="http://${RELEASE}-runtime.${NAMESPACE}.svc.cluster.local:3003"
APP_LABELS="app.kubernetes.io/name=a2amesh,app.kubernetes.io/instance=${RELEASE}"

registry_workload() {
  if "${KUBECTL_BIN}" get statefulset "${RELEASE}-registry" --namespace "${NAMESPACE}" >/dev/null 2>&1; then
    printf 'statefulset/%s-registry\n' "${RELEASE}"
  else
    printf 'deployment/%s-registry\n' "${RELEASE}"
  fi
}

run_probe() {
  local namespace="$1"
  local name="$2"
  local labels="$3"
  local command="$4"

  "${KUBECTL_BIN}" delete pod "${name}" --namespace "${namespace}" \
    --ignore-not-found --wait=true >/dev/null 2>&1 || true
  "${KUBECTL_BIN}" run "${name}" \
    --namespace "${namespace}" \
    --image "${PROBE_IMAGE}" \
    --restart Never \
    --labels "${labels}" \
    --command -- sh -ec "${command}"
  if ! "${KUBECTL_BIN}" wait \
    --namespace "${namespace}" \
    --for=jsonpath='{.status.phase}'=Succeeded \
    "pod/${name}" \
    --timeout=45s >/dev/null; then
    "${KUBECTL_BIN}" logs --namespace "${namespace}" "${name}" || true
    "${KUBECTL_BIN}" describe pod --namespace "${namespace}" "${name}" || true
    return 1
  fi
  "${KUBECTL_BIN}" logs --namespace "${namespace}" "${name}"
  "${KUBECTL_BIN}" delete pod "${name}" --namespace "${namespace}" --wait=true >/dev/null
}

expect_denied_probe() {
  local namespace="$1"
  local name="$2"
  local labels="$3"
  local url="$4"

  run_probe "${namespace}" "${name}" "${labels}" \
    "code=\$(curl --insecure --silent --show-error --output /dev/null --write-out '%{http_code}' --connect-timeout 3 --max-time 5 '${url}' || true); test \"\${code}\" = '000'"
}

prepare_namespaces() {
  "${KUBECTL_BIN}" create namespace "${UNTRUSTED_NAMESPACE}" \
    --dry-run=client --output yaml | "${KUBECTL_BIN}" apply -f - >/dev/null
  "${KUBECTL_BIN}" create namespace "${EXTERNAL_NAMESPACE}" \
    --dry-run=client --output yaml | "${KUBECTL_BIN}" apply -f - >/dev/null
  "${KUBECTL_BIN}" label namespace "${EXTERNAL_NAMESPACE}" \
    a2amesh.dev/network-access=approved --overwrite >/dev/null

  cat <<MANIFEST | "${KUBECTL_BIN}" apply -f - >/dev/null
apiVersion: apps/v1
kind: Deployment
metadata:
  name: approved-endpoint
  namespace: ${EXTERNAL_NAMESPACE}
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: approved-endpoint
  template:
    metadata:
      labels:
        app.kubernetes.io/name: approved-endpoint
    spec:
      automountServiceAccountToken: false
      containers:
        - name: server
          image: ${SERVER_IMAGE}
          args:
            - netexec
            - --http-port=8080
          ports:
            - name: http
              containerPort: 8080
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: [ALL]
          resources:
            requests:
              cpu: 5m
              memory: 16Mi
            limits:
              cpu: 100m
              memory: 64Mi
---
apiVersion: v1
kind: Service
metadata:
  name: approved-endpoint
  namespace: ${EXTERNAL_NAMESPACE}
spec:
  selector:
    app.kubernetes.io/name: approved-endpoint
  ports:
    - name: http
      port: 8080
      targetPort: http
MANIFEST
  "${KUBECTL_BIN}" rollout status deployment/approved-endpoint \
    --namespace "${EXTERNAL_NAMESPACE}" --timeout=3m >/dev/null
}

verify_baseline() {
  prepare_namespaces

  run_probe "${NAMESPACE}" registry-path "${APP_LABELS},app.kubernetes.io/component=runtime" "curl --fail --silent --show-error --connect-timeout 3 --max-time 10 '${REGISTRY_URL}/health' >/dev/null" # NOSONAR -- disposable cluster-local probe; transport security is outside this NetworkPolicy test.
  run_probe "${NAMESPACE}" runtime-path "${APP_LABELS},app.kubernetes.io/component=registry" "curl --fail --silent --show-error --connect-timeout 3 --max-time 10 '${RUNTIME_URL}/health' >/dev/null" # NOSONAR -- disposable cluster-local probe; transport security is outside this NetworkPolicy test.

  expect_denied_probe "${UNTRUSTED_NAMESPACE}" untrusted-registry 'app.kubernetes.io/name=untrusted' "${REGISTRY_URL}/health" # NOSONAR -- must attempt the chart's cluster-local HTTP endpoint to prove denial.
  expect_denied_probe "${UNTRUSTED_NAMESPACE}" untrusted-runtime 'app.kubernetes.io/name=untrusted' "${RUNTIME_URL}/health" # NOSONAR -- must attempt the chart's cluster-local HTTP endpoint to prove denial.

  expect_denied_probe "${NAMESPACE}" private-service-denied "${APP_LABELS},app.kubernetes.io/component=runtime" "http://approved-endpoint.${EXTERNAL_NAMESPACE}.svc.cluster.local:8080/hostname" # NOSONAR -- disposable private endpoint intentionally tests egress denial.
  expect_denied_probe "${NAMESPACE}" metadata-denied "${APP_LABELS},app.kubernetes.io/component=runtime" 'http://169.254.169.254/latest/meta-data/' # NOSONAR -- non-sensitive request intentionally proves metadata egress denial.

  run_probe "${NAMESPACE}" public-egress \
    "${APP_LABELS},app.kubernetes.io/component=runtime" \
    "curl --fail --silent --show-error --connect-timeout 5 --max-time 15 https://example.com/ >/dev/null"
}

verify_override() {
  run_probe "${NAMESPACE}" approved-private-egress "${APP_LABELS},app.kubernetes.io/component=runtime" "curl --fail --silent --show-error --connect-timeout 3 --max-time 10 'http://approved-endpoint.${EXTERNAL_NAMESPACE}.svc.cluster.local:8080/hostname' >/dev/null" # NOSONAR -- disposable private endpoint intentionally validates the explicit override.
}

verify_pdb_blocks_drain() {
  local node output status
  node="$("${KUBECTL_BIN}" get nodes --output jsonpath='{.items[0].metadata.name}')"
  "${KUBECTL_BIN}" delete pod "${RELEASE}-smoke" --namespace "${NAMESPACE}" \
    --ignore-not-found --wait=true >/dev/null 2>&1 || true

  set +e
  output="$("${KUBECTL_BIN}" drain "${node}" \
    --ignore-daemonsets \
    --delete-emptydir-data \
    --pod-selector="app.kubernetes.io/instance=${RELEASE}" \
    --timeout=30s 2>&1)"
  status=$?
  set -e
  "${KUBECTL_BIN}" uncordon "${node}" >/dev/null 2>&1 || true

  if [[ ${status} -eq 0 ]]; then
    printf '%s\n' "${output}" >&2
    echo 'Expected the single-replica PDBs to block voluntary drain.' >&2
    exit 1
  fi
  if ! grep -Eqi 'disruption budget|cannot evict pod' <<<"${output}"; then
    printf '%s\n' "${output}" >&2
    echo 'Drain failed for a reason other than the documented PDB boundary.' >&2
    exit 1
  fi

  "${KUBECTL_BIN}" wait --namespace "${NAMESPACE}" \
    --for=condition=Ready pod \
    --selector="app.kubernetes.io/instance=${RELEASE}" \
    --timeout=2m >/dev/null
}

verify_maintenance_drain() {
  local node
  node="$("${KUBECTL_BIN}" get nodes --output jsonpath='{.items[0].metadata.name}')"
  if [[ "$("${KUBECTL_BIN}" get pdb --namespace "${NAMESPACE}" --no-headers 2>/dev/null | wc -l)" -ne 0 ]]; then
    echo 'Maintenance drain requires both chart PDBs to be disabled explicitly.' >&2
    exit 1
  fi

  "${KUBECTL_BIN}" delete pod "${RELEASE}-smoke" --namespace "${NAMESPACE}" \
    --ignore-not-found --wait=true >/dev/null 2>&1 || true
  "${KUBECTL_BIN}" drain "${node}" \
    --ignore-daemonsets \
    --delete-emptydir-data \
    --pod-selector="app.kubernetes.io/instance=${RELEASE}" \
    --timeout=2m
  "${KUBECTL_BIN}" uncordon "${node}"
  "${KUBECTL_BIN}" rollout status "$(registry_workload)" \
    --namespace "${NAMESPACE}" --timeout=5m
  "${KUBECTL_BIN}" rollout status "deployment/${RELEASE}-runtime" \
    --namespace "${NAMESPACE}" --timeout=5m
}

collect_diagnostics() {
  "${KUBECTL_BIN}" get nodes,pods,services,endpoints,networkpolicies,poddisruptionbudgets \
    --all-namespaces --output wide || true
  "${KUBECTL_BIN}" get events --all-namespaces --sort-by=.lastTimestamp || true
  "${KUBECTL_BIN}" describe networkpolicy --all-namespaces || true
  "${KUBECTL_BIN}" describe poddisruptionbudget --all-namespaces || true
  "${KUBECTL_BIN}" describe pods --namespace "${NAMESPACE}" || true
  "${KUBECTL_BIN}" logs --namespace "${NAMESPACE}" "$(registry_workload)" \
    --all-containers --tail=200 || true
  "${KUBECTL_BIN}" logs --namespace "${NAMESPACE}" "deployment/${RELEASE}-runtime" \
    --all-containers --tail=200 || true
  "${HELM_BIN}" status "${RELEASE}" --namespace "${NAMESPACE}" || true
}

case "${1:-}" in
  baseline) verify_baseline ;;
  override) verify_override ;;
  pdb-blocked) verify_pdb_blocks_drain ;;
  maintenance-drain) verify_maintenance_drain ;;
  diagnostics) collect_diagnostics ;;
  *)
    echo "Usage: $0 {baseline|override|pdb-blocked|maintenance-drain|diagnostics}" >&2
    exit 64
    ;;
esac
