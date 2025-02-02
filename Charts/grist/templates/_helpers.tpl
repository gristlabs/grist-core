{{/*
Expand the name of the chart.
*/}}
{{- define "grist.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "grist.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "grist.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "grist.labels" -}}
helm.sh/chart: {{ include "grist.chart" . }}
{{ include "grist.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "grist.selectorLabels" -}}
app.kubernetes.io/name: {{ include "grist.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "grist.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "grist.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Get the PostgreSQL hostname
*/}}
{{- define "grist.postgresql.host" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "%s-postgresql" .Release.Name -}}
{{- else -}}
{{- if not .Values.config.database.host }}
{{- fail "External database host must be provided when postgresql.enabled is false" }}
{{- end -}}
{{- .Values.config.database.host -}}
{{- end -}}
{{- end -}}

{{/*
Get Database Password
*/}}
{{- define "grist.database.password" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.auth.password -}}
{{- else -}}
{{- .Values.config.database.password -}}
{{- end -}}
{{- end -}}

{{/*
Get the Redis URL
*/}}
{{- define "grist.redis.url" -}}
{{- if .Values.redis.enabled }}
{{- printf "redis://%s-redis-master:6379" .Release.Name -}}
{{- else -}}
{{- if not (regexMatch "^redis://.+" .Values.config.redis.url) }}
{{- fail "Invalid Redis URL format. Must start with redis://" }}
{{- end -}}
{{- .Values.config.redis.url -}}
{{- end -}}
{{- end -}}

{{/*
Get the MinIO hostname
*/}}
{{- define "grist.minio.host" -}}
{{- if .Values.minio.enabled }}
{{- printf "%s-minio" .Release.Name -}}
{{- else -}}
{{- if not .Values.config.minio.endpoint }}
{{- fail "External MinIO endpoint must be provided when minio.enabled is false" }}
{{- end -}}
{{- .Values.config.minio.endpoint -}}
{{- end -}}
{{- end -}}

{{/*
Get MinIO Access Key
*/}}
{{- define "grist.minio.accessKey" -}}
{{- if .Values.minio.enabled }}
{{- .Values.minio.auth.rootUser -}}
{{- else -}}
{{- .Values.config.minio.accessKey -}}
{{- end -}}
{{- end -}}

{{/*
Get MinIO Secret Key
*/}}
{{- define "grist.minio.secretKey" -}}
{{- if .Values.minio.enabled }}
{{- .Values.minio.auth.rootPassword -}}
{{- else -}}
{{- .Values.config.minio.secretKey -}}
{{- end -}}
{{- end -}}

{{/*
Get allowed hosts from ingress configuration
*/}}
{{- define "grist.allowedHosts" -}}
{{- if .Values.ingress.enabled -}}
    {{- $hosts := list -}}
    {{- range .Values.ingress.hosts -}}
        {{- $hosts = append $hosts .host -}}
    {{- end -}}
    {{- join "," $hosts -}}
{{- else -}}
    {{- .Values.config.ALLOWED_HOSTS | default "*" -}}
{{- end -}}
{{- end -}}
