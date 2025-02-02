# Grist Helm Chart

This Helm chart deploys Grist on a Kubernetes cluster.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.0+
- PV provisioner support in the underlying infrastructure (if persistence is enabled)

## Installing the Chart

To install the chart with the release name `my-grist`:

```bash
helm install my-grist .
```

## Configuration

The following table lists the configurable parameters of the Grist chart and their default values.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `1` |
| `image.repository` | Image repository | `gristlabs/grist` |
| `image.tag` | Image tag | `latest` |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `service.type` | Service type | `ClusterIP` |
| `service.port` | Service port | `8484` |
| `ingress.enabled` | Enable ingress | `false` |
| `persistence.enabled` | Enable persistence | `true` |
| `persistence.size` | PVC size | `10Gi` |
| `config.APP_TITLE` | Custom app title | `"Grist"` |
| ...

## Usage

1. Modify the values.yaml file to match your requirements
2. Install the chart
3. Access Grist through the configured ingress or service

For more information, visit the [Grist documentation](https://support.getgrist.com/self-managed/).

## Configuration

### Extra Environment Variables

The chart supports various GRIST_* environment variables for customization. Here are some examples:

#### User Management
- `GRIST_DEFAULT_EMAIL`: Default email for the first user
- `GRIST_SINGLE_ORG`: Name of the single organization to use
- `GRIST_ORG_IN_PATH`: Whether to include org in URL paths
- `GRIST_FORCE_LOGIN`: Require login for all access

#### Document Settings
- `GRIST_THROTTLE_CPU`: Throttle CPU usage

#### Email Settings
- `GRIST_SMTP_HOST`: SMTP server hostname
- `GRIST_SMTP_PORT`: SMTP server port
- `GRIST_SMTP_USER`: SMTP username
- `GRIST_SMTP_PASSWORD`: SMTP password (stored securely in a Secret)
- `GRIST_SMTP_SECURE`: Use secure SMTP
- `GRIST_SMTP_FROM`: From email address

To configure these variables, you can create a custom values.yaml:

```yaml
config:
  extraEnv:
    GRIST_DEFAULT_EMAIL: "admin@example.com"
    GRIST_SINGLE_ORG: "MyOrganization"
    GRIST_FORCE_LOGIN: "true"
```

### Session Secret

The `GRIST_SESSION_SECRET` is automatically generated if not provided. To set a specific session secret:

```yaml
config:
  sessionSecret: "your-custom-secret"
```

### Example: Using External Services

```yaml
postgresql:
  enabled: false

redis:
  enabled: false

minio:
  enabled: false

config:
  database:
    host: "external-postgresql.database.svc"
    port: 5432
    name: grist
    user: grist
    password: external-db-password

  redis:
    url: "redis://external-redis:6379"
    password: external-redis-password

  minio:
    endpoint: "external-minio.storage.svc"
    port: 9000
    bucket: grist-docs
    accessKey: external-minio-access
    secretKey: external-minio-secret
    useSSL: true
```

## Development

### Testing

To test the chart locally:

```bash
# Update dependencies
helm dependency update

# Lint the chart
helm lint

# Template the chart and validate output
helm template . | kubectl apply --dry-run=client -f -

# Install the chart in dry-run mode
helm install test . --dry-run
```

### CI/CD

This chart is automatically tested and published using GitHub Actions:

- Pull Requests: Chart is linted and tested
- Main branch: Chart is published to GitHub Pages
- Tags (grist-*): New chart versions are released

To release a new version:

1. Update the `version` in Chart.yaml
2. Create and push a tag:
   ```bash
   git tag grist-0.1.0
   git push origin grist-0.1.0
   ```
