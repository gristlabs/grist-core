# Setup & Admin Redesign

## Principles

1. **Admin panel is the superset.** Anything the wizard can do
   (configure sandbox, configure storage, go live) must also be
   doable from the admin panel. The wizard is a guided repackaging
   of shared capabilities, not a separate system.

2. **Wizard is a view, not a system.** The wizard file is mostly
   layout and step navigation. Actual probing, configuring, and
   state management live in shared components
   (`SandboxConfigurator`, `StorageConfigurator`, `GoLiveControl`).

3. **One set of endpoints.** No separate `/api/setup/*` routes.
   Both wizard and admin panel use `/api/admin/*` and
   `/api/install/*`. Auth is always install-admin session — boot-key
   login creates a session indistinguishable from a real-auth session.

4. **Going live is a deliberate act.** Setting auth env vars doesn't
   put the server in service. The admin must walk through setup
   (or explicitly set `GRIST_IN_SERVICE=true`) to open the gate.

5. **There must always be a discoverable emergency route to admin
   access.** `/admin` is always servable without auth. When the
   user is not authenticated, it shows a link to `/auth/boot-key`.
   The old `?boot-key=XXX` query param path also still works as a
   last resort.

6. **Nothing leaks before proof of boot key.** The boot-key login
   page shows only a key input. The admin email field appears only
   after the key is validated via a JSON check endpoint.

## Server States

| State | Meaning | How entered |
|---|---|---|
| **SETUP** | Gate active. Only admin/boot/static routes work. | `GRIST_IN_SERVICE` resolves to false (fresh install persists `false`) |
| **IN_SERVICE** | Normal operation. Gate is open. | `GRIST_IN_SERVICE` resolves to true (admin went live, or set env var, or upgrade with no persisted value) |
| **BROKEN** | Auth failed to initialize. Server is in service but login is busted. | Login system threw during startup; orthogonal to the gate |

`isInService()` logic:
```
env var GRIST_IN_SERVICE → use it
else persisted value → use it
else → true (legacy default, safe for upgrades)
test env (GRIST_TESTING_SOCKET) → true, unless GRIST_FORCE_SETUP_GATE
```

## User Paths

### Fresh install (the main flow)

```
docker run → server starts in SETUP
  → browser hits any URL → gate → boot-key login page
  → admin enters boot key from server logs (+ email if not set)
  → session created → redirect to /admin/setup
  → wizard: Sandbox → Auth → Backups → Go Live
  → Go Live sets GRIST_IN_SERVICE=true, triggers restart
  → server restarts in IN_SERVICE
```

After go-live with no real auth, boot-key login remains the only
login method. This is valid — many self-hosters run behind a reverse
proxy and don't need Grist-level auth.

### Env-var admin (auth pre-configured)

Auth env vars are set in docker-compose. Server still starts behind
the gate (no `GRIST_IN_SERVICE`). Admin enters boot key, walks
through wizard (auth step shows as "already configured"), goes live.

If they also set `GRIST_IN_SERVICE=true`, the gate never activates —
normal operation from the start. Wizard is still accessible at
`/admin/setup` but isn't forced.

### Returning admin

Visits `/admin` → normal admin panel. Can change any setting the
wizard can change, plus things the wizard doesn't cover (audit logs,
version checks, enterprise toggle).

### Broken-auth admin

Auth initialized but fails at runtime (OIDC provider down, bad
redirect URI). The admin visits `/admin`, sees the unauthenticated
view with a link to `/auth/boot-key`. Boot-key login bypasses the
broken auth system. If auth failed during startup,
`ErrorInLoginMiddleware` falls back to boot-key login automatically.

### Maintenance mode

Admin panel → Maintenance → "Take out of service" → gate activates.
All non-admin traffic is blocked. Admin can re-run wizard, change
settings, then go live again. Useful for switching auth providers
safely.

## Wizard Design

### Checkmark theory

A checkmark means **"the admin actively confirmed this step"** — not
"something was auto-detected." Even if the server already has
sandboxing configured, no checkmark until the admin clicks Configure
or Continue. Checkmarks persist in sessionStorage across reloads;
they reset on a new browser session.

### Steps

1. **Sandboxing** — probes flavors, recommends best available, admin
   confirms. Probe runs on load (step 1 is immediately visible).
2. **Authentication** — shows current auth status. Continue or Skip.
   Auth check deferred until step becomes active.
3. **Backups** — probes storage backends. Storage probe deferred
   until step becomes active.
4. **Apply & Restart** — go live. Requires explicit click.

### Sandbox flavors

| Flavor | When to use | Speed | Notes |
|---|---|---|---|
| **gVisor** | Recommended when available. Pre-installed in Grist Docker image. | Fastest sandbox | Most tested. Won't work in some environments (missing capabilities, old processors). If the probe passes, use this. |
| **Pyodide** | Fallback when gVisor isn't available. Works everywhere (WebAssembly). | Slower than gVisor | Full formula compatibility (standard library). Good isolation. Less battle-tested. |
| **macOS Sandbox** | Running Grist on a Mac. Uses Apple's built-in `sandbox-exec`. | Fast (native) | Good isolation. Less tested. Only relevant on macOS — not nudged. |
| **No Sandbox** | Trusted environments (personal use, air-gapped). | Fastest | Full system access. Legitimate when you trust every document author. |

**Decision tree:** gVisor if probe passes → else Pyodide → macOS
Sandbox if on a Mac → No Sandbox as opt-in fallback with warning.

**UI pattern:** Hero card for the recommended option (pre-selected,
prominent, blue left accent). Alternatives collapsed behind "Other
options..." toggle. When only No Sandbox is available, it becomes the
hero with an amber warning accent.

### Login fallback chain

```
1. Real auth: getgrist.com → OIDC → SAML → forward-auth
2. GRIST_ADMIN_EMAIL is set → boot-key login
3. Otherwise → MinimalLogin (auto-login as you@example.com, no auth)
```

MinimalLogin is only reachable with explicit `GRIST_IN_SERVICE=true`,
no `GRIST_ADMIN_EMAIL`, and no real auth. The wizard always sets
`GRIST_ADMIN_EMAIL`, so MinimalLogin is never reached on new installs.

## Visual Design

The aesthetic is **"quiet authority"** — clean, confident, warm
without being flashy.

### Core patterns

- **Depth via shadow, not weight.** Subtle multi-layer box-shadows.
  Borders are light (1–1.5px). Never heavy borders for structure.
- **Generous rounding.** Cards 8–12px, badges 10px (pill), buttons
  8px, inputs 8px. Nothing sharp-cornered except code blocks (6px).
- **Entrance animation.** Content fades up with staggered delays
  (0s → 0.08s → 0.14s → 0.2s). Step panels animate when revealed.
- **Hover lift on cards.** Soft shadow on hover reinforces
  clickability without color change.
- **Active press scale.** Buttons `scale(0.98)` on click.
- **Atmosphere.** Subtle radial glow behind content area
  (`controlPrimaryBg` at ~4–7% opacity).

### Concrete values

| Element | border-radius | padding | font-size | font-weight |
|---|---|---|---|---|
| Page card | 12px | 28px 32px | — | — |
| Selection card | 8px | 14px 18px | — | — |
| Badge/pill | 10px | 2px 8px | 11px | 600 |
| Primary button | 8px | 10px 28px | 14px | 600 |
| Code block | 6px | 10px 14px | 12px mono | — |
| Text input | 8px | 10px 14px | 15px | — |

### Status colors

| Meaning | Background | Text |
|---|---|---|
| Success/available | `#e6f4ea` | `#1e7e34` |
| Error/fail | `#fce8e6` | `#c5221f` |
| Warning | `#fef7e0` | `#b45309` |
| Info/recommended | `#e8f0fe` | `#1a73e8` |
| Neutral/checking | `#e8eaed` | `#5f6368` |

Hardcoded — Grist's theme system doesn't have semantic status tokens
yet. Use `theme.*` tokens for everything else.

## Key Insights

- **Unified auth via session.** Boot-key login creates a session
  where the user's email matches `GRIST_ADMIN_EMAIL`. Same
  `requireInstallAdmin` middleware works for boot-key and real-auth
  sessions. No separate auth paths needed.

- **DB env vars merge on startup.** DB-persisted env vars merge into
  `process.env` during `addHomeDBManager()`, before `isInService()`
  runs. Precedence: real env var > DB > not set. So `isInService()`
  just reads `process.env` — the merge is already done.

- **Middleware ordering is critical.** `addSessions()` before
  `addSetupGate()` (boot-key login needs `req.session`).
  `_userIdMiddleware` on `/api` before early endpoints (session auth
  needs user lookup). If either ordering is disrupted, boot-key
  sessions silently fail.

- **CSRF requires Content-Type.** Any client-side `fetch()` POST to
  `/api/*` must include `Content-Type: application/json` or it gets
  rejected before session auth runs.

- **Boot-key email mismatch bug.** When `GRIST_ADMIN_EMAIL` is
  already set (from a previous run) and the user enters a different
  email during boot-key login, `completeLogin()` must update it.
  Otherwise the session email doesn't match the admin check → 403
  on all admin API calls.

## Shared Components

| Component | File | Used by |
|---|---|---|
| `SandboxConfigurator` | `app/client/ui/SandboxConfigurator.ts` | Wizard step 1, admin panel Security |
| `StorageConfigurator` | `app/client/ui/StorageConfigurator.ts` | Wizard step 3 (admin panel: not yet) |
| `GoLiveControl` | `app/client/ui/GoLiveControl.ts` | Wizard step 4 (admin panel Maintenance: not yet) |
| `AuthenticationSection` | `app/client/ui/AuthenticationSection.ts` | Wizard step 2, admin panel Security |
| `MockupPanel` | `app/client/ui/MockupPanel.ts` | Wizard (dev/testing only, remove before merge) |

## Working Notes

- **Check the full PR scope before assuming a failure is
  pre-existing.** This PR has many commits touching many files.
  When a test fails, check `git log origin/main..HEAD -- <file>`
  to see if the PR touched the relevant code. "Pre-existing" is
  usually wrong — it's more often a side effect of an earlier
  commit in the branch.

## What's Left

- Wire `StorageConfigurator` into admin panel
- Wire `GoLiveControl` into admin panel Maintenance section
- Remove mockup endpoints from FlexServer (after user testing)
- Remove `MockupPanel` (after user testing)
- End-to-end test each user path above
