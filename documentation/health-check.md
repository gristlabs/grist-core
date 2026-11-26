# Health check endpoint

Grist exposes a lightweight health-check endpoint at `GET /status`. It
returns `200` with a short text body when the server is healthy, or
`500` when one of the requested checks fails. This makes it suitable
for use as a liveness/readiness probe in containers or orchestrators.

## Basic usage

```
GET /status
```

Response:

```
Grist <name> is alive.
```

## Query options

Each option adds an extra check to the response. Multiple options can be
combined in a single request.

| Query parameter | What it checks |
|---|---|
| `db=1` | Home database connectivity (runs `SELECT 1`). |
| `redis=1` | Redis connection. |
| `docWorkerRegistered=1` | Doc worker registration in Redis. |
| `ready=1` | That the server finished starting up. |

When any extra check is requested, the response includes the per-check
result:

```
Grist <name> is alive (db ok, redis ok).
```

On failure:

```
Grist <name> is unhealthy (db not ok).
```

## Timeout

`timeout=<ms>` sets the per-check timeout (default `10000`). For
example:

```
GET /status?db=1&timeout=5000
```

## Status codes

- `200` — all requested checks passed.
- `500` — at least one requested check failed.
- `503` — service unavailable during startup (when `ready=1` is used
  before startup completed).
