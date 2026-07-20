{{/*
SPDX-FileCopyrightText: 2026 oaslananka
SPDX-License-Identifier: Apache-2.0
*/}}
{{- define "a2amesh.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "a2amesh.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "a2amesh.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "a2amesh.commonLabels" -}}
helm.sh/chart: {{ include "a2amesh.chart" . }}
app.kubernetes.io/name: {{ include "a2amesh.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: a2amesh
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "a2amesh.selectorLabels" -}}
app.kubernetes.io/name: {{ include "a2amesh.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "a2amesh.componentLabels" -}}
{{ include "a2amesh.commonLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "a2amesh.registryName" -}}
{{- printf "%s-registry" (include "a2amesh.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "a2amesh.registryHost" -}}
{{- printf "%s.%s.svc.cluster.local" (include "a2amesh.registryName" .) .Release.Namespace -}}
{{- end -}}

{{- define "a2amesh.registryHeadlessName" -}}
{{- printf "%s-registry-headless" (include "a2amesh.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "a2amesh.runtimeName" -}}
{{- printf "%s-runtime" (include "a2amesh.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "a2amesh.runtimeHost" -}}
{{- printf "%s.%s.svc.cluster.local" (include "a2amesh.runtimeName" .) .Release.Namespace -}}
{{- end -}}

{{- define "a2amesh.registrySecretName" -}}
{{- if .Values.registry.auth.existingSecret -}}
{{- .Values.registry.auth.existingSecret -}}
{{- else -}}
{{- printf "%s-auth" (include "a2amesh.registryName" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "a2amesh.runtimeSecretName" -}}
{{- if .Values.runtime.providerSecrets.existingSecret -}}
{{- .Values.runtime.providerSecrets.existingSecret -}}
{{- else -}}
{{- printf "%s-provider" (include "a2amesh.runtimeName" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "a2amesh.registryServiceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "a2amesh.registryName" .) .Values.serviceAccount.registryName -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.registryName -}}
{{- end -}}
{{- end -}}

{{- define "a2amesh.runtimeServiceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "a2amesh.runtimeName" .) .Values.serviceAccount.runtimeName -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.runtimeName -}}
{{- end -}}
{{- end -}}

{{- define "a2amesh.image" -}}
{{- $image := index . 0 -}}
{{- if $image.digest -}}
{{- printf "%s@%s" $image.repository $image.digest -}}
{{- else -}}
{{- printf "%s:%s" $image.repository $image.tag -}}
{{- end -}}
{{- end -}}

{{- define "a2amesh.registryUrl" -}}
{{- if .Values.runtime.registry.url -}}
{{- .Values.runtime.registry.url -}}
{{- else -}}
{{- printf "http://%s:%v" (include "a2amesh.registryHost" .) .Values.registry.service.port -}}
{{- end -}}
{{- end -}}

{{- define "a2amesh.runtimeAllowedHostnames" -}}
{{- $values := list -}}
{{- if .Values.registry.enabled -}}
{{- $values = append $values (include "a2amesh.registryHost" .) -}}
{{- end -}}
{{- range .Values.runtime.registry.allowedHostnames -}}
{{- $values = append $values . -}}
{{- end -}}
{{- join "," (uniq $values) -}}
{{- end -}}

{{- define "a2amesh.registryAllowedHostnames" -}}
{{- $values := list -}}
{{- if .Values.runtime.enabled -}}
{{- $values = append $values (include "a2amesh.runtimeHost" .) -}}
{{- end -}}
{{- range .Values.registry.outboundPolicy.allowedHostnames -}}
{{- $values = append $values . -}}
{{- end -}}
{{- join "," (uniq $values) -}}
{{- end -}}

{{- define "a2amesh.checksum" -}}
{{- toJson . | sha256sum -}}
{{- end -}}

{{- define "a2amesh.validateValues" -}}
{{- if and .Values.registry.auth.createSecret .Values.registry.auth.existingSecret -}}
{{- fail "registry.auth.createSecret and registry.auth.existingSecret are mutually exclusive" -}}
{{- end -}}
{{- if and .Values.registry.enabled .Values.registry.auth.token (not .Values.registry.auth.createSecret) -}}
{{- fail "registry.auth.token requires registry.auth.createSecret=true" -}}
{{- end -}}
{{- if and .Values.registry.enabled (not .Values.registry.auth.require) (or .Values.registry.auth.createSecret .Values.registry.auth.existingSecret .Values.registry.auth.oidc.enabled .Values.registry.auth.token) -}}
{{- fail "registry.auth.require=false cannot be combined with static or OIDC credentials" -}}
{{- end -}}
{{- if .Values.registry.auth.oidc.enabled -}}
  {{- if or .Values.registry.auth.createSecret .Values.registry.auth.existingSecret .Values.registry.auth.token -}}
  {{- fail "registry.auth.oidc.enabled cannot be combined with static registry token settings" -}}
  {{- end -}}
  {{- if and (not .Values.registry.auth.oidc.discoveryUrl) (not .Values.registry.auth.oidc.jwksUri) -}}
  {{- fail "registry.auth.oidc requires discoveryUrl or jwksUri" -}}
  {{- end -}}
{{- else if and .Values.registry.enabled .Values.registry.auth.require (not .Values.registry.auth.createSecret) (not .Values.registry.auth.existingSecret) -}}
{{- fail "registry auth is required; configure createSecret or existingSecret" -}}
{{- end -}}
{{- if and .Values.registry.persistence.enabled (ne .Values.registry.storage.backend "sqlite") -}}
{{- fail "registry.persistence.enabled requires registry.storage.backend=sqlite" -}}
{{- end -}}
{{- if and (eq .Values.registry.storage.backend "sqlite") (gt (int .Values.registry.replicaCount) 1) -}}
{{- fail "sqlite registry storage supports exactly one replica" -}}
{{- end -}}
{{- if and .Values.registry.autoscaling.enabled (not .Values.registry.autoscaling.allowEphemeralReplicas) -}}
{{- fail "registry autoscaling requires autoscaling.allowEphemeralReplicas=true because replicas do not share memory storage" -}}
{{- end -}}
{{- if and .Values.registry.autoscaling.enabled (eq .Values.registry.storage.backend "sqlite") -}}
{{- fail "registry autoscaling is incompatible with sqlite storage" -}}
{{- end -}}
{{- if .Values.runtime.enabled -}}
  {{- if and .Values.runtime.providerSecrets.createSecret .Values.runtime.providerSecrets.existingSecret -}}
  {{- fail "runtime.providerSecrets.createSecret and existingSecret are mutually exclusive" -}}
  {{- end -}}
  {{- if and (not .Values.runtime.providerSecrets.existingSecret) (not (and .Values.runtime.providerSecrets.createSecret .Values.runtime.providerSecrets.openAIKey)) -}}
  {{- fail "runtime requires an existing provider secret or createSecret with openAIKey" -}}
  {{- end -}}
  {{- if and (not .Values.registry.enabled) (not .Values.runtime.registry.url) -}}
  {{- fail "runtime.registry.url is required when the chart registry is disabled" -}}
  {{- end -}}
  {{- if and .Values.runtime.registry.useChartAuthSecret (not .Values.registry.enabled) -}}
  {{- fail "runtime.registry.useChartAuthSecret requires the chart registry" -}}
  {{- end -}}
  {{- if and .Values.runtime.registry.useChartAuthSecret .Values.registry.auth.oidc.enabled -}}
  {{- fail "runtime cannot use the chart static auth secret when registry OIDC is enabled; configure runtime.registry.existingAuthSecret" -}}
  {{- end -}}
  {{- if and .Values.registry.enabled .Values.registry.auth.require (not .Values.runtime.registry.useChartAuthSecret) (not .Values.runtime.registry.existingAuthSecret) -}}
  {{- fail "runtime requires a registry auth Secret when the chart registry requires auth" -}}
  {{- end -}}
  {{- if and (gt (int .Values.runtime.replicaCount) 1) (not .Values.runtime.autoscaling.allowEphemeralReplicas) -}}
  {{- fail "runtime replicas share no task storage; set runtime.autoscaling.allowEphemeralReplicas=true to acknowledge ephemeral state" -}}
  {{- end -}}
  {{- if and .Values.runtime.autoscaling.enabled (not .Values.runtime.autoscaling.allowEphemeralReplicas) -}}
  {{- fail "runtime autoscaling requires runtime.autoscaling.allowEphemeralReplicas=true" -}}
  {{- end -}}
{{- end -}}
{{- if .Values.ingress.registry.enabled -}}
  {{- if eq (len .Values.ingress.registry.hosts) 0 -}}
  {{- fail "registry ingress requires at least one host" -}}
  {{- end -}}
  {{- if not .Values.registry.auth.require -}}
  {{- fail "registry ingress requires registry.auth.require=true" -}}
  {{- end -}}
  {{- if and (eq (len .Values.ingress.registry.tls) 0) (not .Values.ingress.registry.allowInsecureHttp) -}}
  {{- fail "registry ingress requires TLS unless allowInsecureHttp is explicitly true" -}}
  {{- end -}}
{{- end -}}
{{- if .Values.ingress.runtime.enabled -}}
  {{- if eq (len .Values.ingress.runtime.hosts) 0 -}}
  {{- fail "runtime ingress requires at least one host" -}}
  {{- end -}}
  {{- if not .Values.runtime.enabled -}}
  {{- fail "runtime ingress requires runtime.enabled=true" -}}
  {{- end -}}
  {{- if not .Values.ingress.runtime.acknowledgeUnauthenticatedEndpoint -}}
  {{- fail "runtime ingress exposes an unauthenticated demo endpoint; set acknowledgeUnauthenticatedEndpoint=true" -}}
  {{- end -}}
  {{- if and (eq (len .Values.ingress.runtime.tls) 0) (not .Values.ingress.runtime.allowInsecureHttp) -}}
  {{- fail "runtime ingress requires TLS unless allowInsecureHttp is explicitly true" -}}
  {{- end -}}
{{- end -}}
{{- end -}}
