# Installer Paths Through Grist

This document maps out every path an installer can take through a fresh
Grist installation, and what happens at each step. The goal is to get
the mental model right before writing (or rewriting) code.

## Server States

The server is in exactly one of these states:

| State | Meaning | How entered |
|---|---|---|
| **SETUP** | Gate is active. Only admin panel, boot endpoints, and static assets are accessible. | `GRIST_IN_SERVICE` resolves to false (fresh install persists `false`; or admin explicitly set `false`) |
| **IN_SERVICE** | Normal operation. Gate is open. Everything works. | `GRIST_IN_SERVICE` resolves to true (admin went live, or set env var, or upgrade with no persisted value) |
| **BROKEN** | Auth was configured but failed to initialize. Server is in service but login is busted. | Login system threw during startup; orthogonal to the gate |

### How `isInService()` should work

```
if env var GRIST_IN_SERVICE is set → use it
else if persisted value exists → use it
else → true (legacy default, safe for upgrades)

additionally: test env (GRIST_TESTING_SOCKET) → true
  unless GRIST_FORCE_SETUP_GATE is set
```

That's it. No checking whether auth is configured, no checking
login system health.

**Why auth alone isn't enough:** On the default multi-team site
configuration, anyone who can reach the server can create teams and
resources freely. An admin who sets OIDC vars has configured *who can
log in*, but hasn't necessarily thought about *what logged-in users can
do*. Going into service should be a deliberate act — the admin should
see what they're exposing before the gate opens.

Fresh installs persist `GRIST_IN_SERVICE=false` on first boot, so they
start behind the gate. The flag gets set to `true` in two ways:
1. Through the setup wizard's "Go Live" step (persisted to DB).
2. By the admin in their env/docker-compose (for experienced admins
   who know what they're doing and want to skip the wizard).

### The BROKEN state

Currently handled by `ErrorInLoginMiddleware` which falls back to
boot-key login. This is actually the right idea — if auth is broken,
the admin still needs a way in. But it's separate from the SETUP flow
and shouldn't be conflated with it.

## Installer Personas

1. **First-timer**: Fresh `docker run`, no env vars, no config. Knows nothing.
2. **Env-var admin**: Sets `GRIST_OIDC_*` or similar in docker-compose before
   first run. Auth works on first boot.
3. **Returning admin**: Already set up, comes back to change settings.
4. **Broken-auth admin**: Had working auth, something broke, locked out.

## Path 1: First-timer (the main setup flow)

```
docker run grist → server starts in SETUP state
  ↓
Browser hits any URL → gate intercepts → boot-key login page
  ↓
Admin reads boot key from server logs, enters it
  (+ enters email if GRIST_ADMIN_EMAIL not set)
  ↓
POST /auth/boot-key → session created → redirect to /admin/setup
  ↓
Setup wizard: Step 1 (Sandbox) → Step 2 (Storage) → Step 3 (Go Live)
  ↓
Go Live: sets GRIST_IN_SERVICE=true, triggers restart
  ↓
Server restarts in IN_SERVICE state
  (boot-key login system is active since no real auth)
  (admin can use boot key to log in for normal use)
```

**After go-live with no real auth:** The server is "in service" but
the only login method is boot-key. This is a valid end state — many
self-hosters run Grist behind a reverse proxy and don't need
Grist-level auth. "In service" means: the gate is open, Grist serves
pages, anonymous access works (unless GRIST_FORCE_LOGIN is set).
The admin can still reach /admin via boot-key login.

## Path 2a: Env-var admin (auth only, no GRIST_IN_SERVICE)

```
docker run with GRIST_OIDC_* etc → auth initializes successfully
  ↓
isInService() returns false (no explicit GRIST_IN_SERVICE)
  ↓
Gate is active. Browser hits any URL → boot-key login page.
  ↓
Admin enters boot key → redirected to /admin/setup
  ↓
Setup wizard: sandbox, storage, go-live (auth step can be skipped
  or shown as "already configured")
  ↓
Go Live → GRIST_IN_SERVICE=true persisted, server restarts
  ↓
Admin logs in via OIDC. Normal Grist experience.
```

Auth is configured but the admin still walks through the wizard to
confirm sandbox/storage settings and consciously open the server.
This prevents accidentally exposing a wide-open multi-team server
just because OIDC vars were set.

## Path 2b: Experienced env-var admin (auth + GRIST_IN_SERVICE)

```
docker run with GRIST_OIDC_* + GRIST_IN_SERVICE=true
  ↓
isInService() returns true (explicit opt-in)
  ↓
Gate never activates. Normal Grist experience from the start.
  ↓
Admin logs in via OIDC → /admin panel available as usual
```

For admins who know what they're doing. The wizard is still accessible
at /admin/setup for tuning but isn't forced.

## Path 3: Returning admin

```
Admin visits /admin → normal admin panel
  ↓
Can change settings, manage boot key, etc.
```

No gate, no boot-key login required (they have a real session).

## Path 4: Broken-auth admin

```
Server starts, auth system fails to initialize
  ↓
isInService() returns true (GRIST_IN_SERVICE=true is persisted)
```

`GRIST_IN_SERVICE=true` is persisted, so
`isInService()` returns true even though auth is broken. The gate
won't activate — which is correct, because the admin explicitly chose
to go live. What they need is a way to log in despite broken auth:

- ErrorInLoginMiddleware falls back to boot-key login as the
  active login system — this is what the PR does.
- The admin can also fix the env vars and restart.

The PR handles this via `ErrorInLoginMiddleware` falling back to
boot-key routes. This is the right approach — it's orthogonal to the
setup gate. The gate is about "not yet in service"; broken auth is
about "in service but login is busted".

**But there's a gap: auth that's broken without throwing.** If the
login system initializes fine but the OIDC provider is down, has a
bad redirect URI, or is otherwise broken at runtime, there's no
`ErrorInLoginMiddleware` — the login system is "active." The admin
clicks "Sign in," gets sent to the OIDC provider, and it fails.
They can't reach `/admin`.

Prior to this PR, the emergency escape hatch was:
1. Visit `/admin` unauthenticated → see "Administrator Panel
   Unavailable" with instructions: set `GRIST_BOOT_KEY=XXX` in
   the environment, then visit `/admin?boot-key=XXX`
2. The `?boot-key=` query param is picked up by client-side code
   and sent as an `x-boot-key` header on API calls
3. Authorizer (`Authorizer.ts:231`) recognizes the header and
   authenticates as admin — no session, no login system involved

This path bypasses the login system entirely. It works regardless
of auth state because the admin panel page itself is served without
auth (via `attachEarlyEndpoints`), and the boot key header
authenticates the API calls directly in the Authorizer.

**This emergency path must survive in the new design.** The PR's
`/auth/boot-key` login page is a nicer UX for normal boot-key
login, but if auth is broken at runtime the admin may not be able
to navigate there (they'd need to know the URL). The old
`/admin?boot-key=XXX` path works because `/admin` is always
servable and the client-side code handles the rest. This should
continue to work as the true last-resort fallback.

**Principle: there must always be a discoverable emergency route
to admin access.** "Discoverable" means the admin can find it
without prior knowledge of the URL, even when the login system is
completely non-functional.

The old design achieved this because `/admin` was always servable
(no auth needed for the HTML) and showed fallback instructions
on-page. The new boot-key login page is better UX but `/auth/boot-key`
is not discoverable — you have to know the URL.

Possible approaches:
- **Keep `/admin` always servable.** When the user is not
  authenticated, show the "Panel Unavailable" message with a
  link/button to `/auth/boot-key` (instead of the old
  `?boot-key=XXX` instructions). This preserves discoverability:
  the admin visits `/admin`, sees the boot-key login link, clicks
  it, authenticates, comes back. The old `?boot-key=XXX` query
  param path can also be preserved as a secondary mechanism.
- **Make `/auth/boot-key` always reachable.** Ensure that even
  when the login system is active, navigating directly to
  `/auth/boot-key` works (it isn't intercepted by OIDC redirects).
  Then mention it in the startup log banner alongside the boot key.

The first approach is better — it doesn't require the admin to
have seen the server logs. They just go to `/admin` and the page
tells them what to do, same as before but with a nicer path.

Currently `/admin` is served by `attachEarlyEndpoints` with
minimal middleware, so it should already be reachable without auth.
The client-side `AdminPanel` code checks whether probes are
accessible (which requires admin auth) and shows `_buildMainContentForOthers()`
if not. That's the right place to add the `/auth/boot-key` link.

## Path 5: Going back to setup mode (maintenance)

```
Admin is in service, wants to lock down the server temporarily
  ↓
Admin panel → Maintenance → "Take out of service"
  ↓
POST /api/admin/maintenance {maintenance: true}
  → sets GRIST_IN_SERVICE=false in DB and process.env
  ↓
Server is now in SETUP state. Gate activates.
All non-admin traffic gets blocked.
  ↓
Admin can re-run wizard, change settings, etc.
  ↓
Go Live again when ready.
```

This is useful for making risky changes (switching auth provider,
reconfiguring storage) without exposing a half-configured server.
The admin already has a session, so the gate lets them through to
`/admin` without needing to re-enter the boot key.

## Path 6: Visitor during setup (could be admin on another device)

```
Someone hits server while in SETUP state
  ↓
Gate intercepts → sees boot-key login page
  ↓
They don't have the boot key → stuck
```

The visitor could be:
- The admin on a different device (phone, colleague's laptop)
- A colleague the admin sent the URL to
- A genuinely random person scanning ports

**Principle: nothing should be leaked before proof of boot key.**
The boot-key login page must not show the admin email, server
configuration state, auth method, or anything beyond "this is a
Grist server that requires a boot key." The admin email input
(for first-time setup when `GRIST_ADMIN_EMAIL` is not set) should
only appear after the boot key is validated, not on the initial
page. Error messages must also be generic — "invalid key," not
"the admin email is X" or "OIDC is configured but..."

**Implemented:** The boot-key login page uses a two-phase
client-side flow (no page reload between phases). The initial page
shows only the boot key field with a "Check key" button. On click,
the client calls `POST /auth/boot-key/check` (JSON endpoint) which
validates the key and returns the admin email if `GRIST_ADMIN_EMAIL`
is set. On success the boot key field is disabled (with a green
checkmark) and the admin email field is revealed — pre-filled if an
email was returned, empty otherwise — with a "Continue" button.
This prevents leaking whether an admin email is configured to
visitors who haven't proven they have the boot key, and avoids the
janky page reload of a server-side redirect flow.

## Path 7: Lost boot key recovery

```
Admin can't find boot key (logs rotated, didn't save it)
  ↓
Can't log in via boot-key login → can't reach /admin
```

Recovery options:
- **Server access**: Set `GRIST_BOOT_KEY=newvalue` in env, restart.
  The env var overrides the DB-stored key.
- **DB access**: Update `activation.prefs.bootKey` directly.
- **If in service with working auth**: Log in normally, use admin
  panel → Security Settings → Boot Key → Generate new key.

The first option is always available to anyone with server access,
which is the same person who needs the boot key. This is fine —
the boot key is a proof-of-server-access mechanism, so requiring
server access to recover it is tautologically correct.

## Path 8: Auth transition (changing auth provider)

```
Admin has working OIDC, wants to switch to SAML
  ↓
Option A: Change env vars, restart. Brief window where old
  auth is gone and new auth might not work. If it fails,
  ErrorInLoginMiddleware → boot-key login fallback.
  ↓
Option B: Go to maintenance mode first (Path 5), make changes
  safely behind the gate, test, then go live again.
```

Path 5 (maintenance mode) makes this much safer. Without it,
switching auth is a "hold your breath and restart" operation.

## What the Gate Should Do (simplified)

```
if isInService():
  pass through (normal Grist)
else:
  if path is allowed (health, status, boot, auth, static, admin API):
    pass through
  if API request:
    503 JSON
  if browser request:
    if has valid session:
      redirect to /admin/setup (or pass through if already on /admin)
    else:
      show boot-key login page
```

## Open Questions

### Upgrade path for existing installations (resolved)

On a **new** installation, if `GRIST_IN_SERVICE` is not set in the
environment, we persist `GRIST_IN_SERVICE=false` to internal state
(activation prefs) on first boot. This is what activates the gate.

The lookup order is:

```
if env var GRIST_IN_SERVICE is set → use it (env always wins)
else if persisted value exists → use it
else → assume in service (no value anywhere = legacy default)
```

**Detecting first boot:** The activations table has no row yet on a
fresh install. When ActivationsManager creates the first activation
record, it persists `GRIST_IN_SERVICE=false` at the same time (unless
the env var is already set). Existing installations already have a
row, so they're unaffected — no persisted value, falls through to
the legacy default of "in service".

The admin can always override with the env var in docker-compose,
which takes precedence over the persisted value.

### UX for env-var admin hitting the gate

An admin who sets OIDC vars on a new install but not `GRIST_IN_SERVICE`
will hit the gate and see the boot-key login page. This could be
confusing — they expected "I set OIDC, it should just work." The
boot-key login page needs to clearly explain: "You've configured
authentication but haven't gone live yet. Enter the boot key from
your server logs to complete setup." The wizard's auth step should
show their OIDC config as already done, so they can skip straight
to sandbox/storage/go-live.

### MinimalLogin and backwards compatibility

**What MinimalLogin does:** When no auth system is configured and
`GRIST_ADMIN_EMAIL` is not set, the fallback is `MinimalLogin`
(`app/server/lib/MinimalLogin.ts`). Clicking "Sign in" instantly
logs you in as `you@example.com` (or `GRIST_DEFAULT_EMAIL`) with
no password, no prompt, nothing. It reports itself as `"no-logins"`
to appSettings.

**The login fallback chain** (`getCoreLoginSystem()` in `coreLogins.ts`):

```
1. Try real auth: getgrist.com → OIDC → SAML → forward-auth
2. If GRIST_ADMIN_EMAIL is set → boot-key login
3. Otherwise → MinimalLogin (auto-login, no auth)
```

**Why it's a problem for new installs:** MinimalLogin is deeply
insecure — anyone who reaches the server is instantly an admin.
For fresh installs going through the setup wizard, it should never
be the active login system. The wizard flow sets `GRIST_ADMIN_EMAIL`
during boot-key login, so step 2 (boot-key login) becomes the
fallback instead of step 3.

**The backwards compatibility situation:** `GRIST_ADMIN_EMAIL` already
exists in released Grist (it controls who is an install admin via
`InstallAdmin`). What's new in this PR is that `GRIST_ADMIN_EMAIL`
now also selects boot-key login as the fallback instead of
MinimalLogin (the check at `coreLogins.ts:31`). So existing installs
that happen to have `GRIST_ADMIN_EMAIL` set will get boot-key login
as their fallback instead of MinimalLogin after upgrading. In practice
this is fine — those installs almost certainly have real auth
configured too, so the fallback never runs. But it's worth noting.

**Proposed resolution:** The `GRIST_IN_SERVICE` persistence model
gives us a natural split:

- **Fresh installs** persist `GRIST_IN_SERVICE=false` on first boot,
  hit the gate, go through boot-key login (which sets
  `GRIST_ADMIN_EMAIL`). After that, the fallback chain lands on
  boot-key login, not MinimalLogin. MinimalLogin is never reached
  on new installs.

- **Existing installs** have no persisted `GRIST_IN_SERVICE`. They
  get the legacy default (in service). If they don't have
  `GRIST_ADMIN_EMAIL` set, MinimalLogin remains the fallback —
  identical to current behavior. If they do have `GRIST_ADMIN_EMAIL`
  set, they'll get boot-key login as the fallback instead, but those
  installs almost certainly have real auth configured so the fallback
  never runs. No breakage either way.

So we don't need to remove MinimalLogin — we just need to ensure
the setup wizard flow always sets `GRIST_ADMIN_EMAIL`, which makes
boot-key login the fallback instead.

**When each login fallback is reached (summary):**

| Scenario | Gate | Login fallback |
|---|---|---|
| New install, no env vars | Active (wizard flow) | Boot-key (wizard sets `GRIST_ADMIN_EMAIL`) |
| `GRIST_IN_SERVICE=true`, no auth, no `GRIST_ADMIN_EMAIL` | Skipped | MinimalLogin (`you@example.com`) |
| `GRIST_IN_SERVICE=true` + `GRIST_ADMIN_EMAIL`, no auth | Skipped | Boot-key login |
| `GRIST_IN_SERVICE=true` + real auth | Skipped | Real auth (fallback never reached) |
| Existing install upgrading (no persisted value) | Skipped (legacy default) | Same as before upgrade |

MinimalLogin is reachable in exactly one scenario: explicit
`GRIST_IN_SERVICE=true` without `GRIST_ADMIN_EMAIL` and without
real auth. That's a deliberate "I know what I'm doing"
configuration — the admin chose to bypass the wizard.

**Open question:** Should we eventually deprecate MinimalLogin with
a warning? E.g., on startup, if MinimalLogin is the active login
system and the server is in service, log a prominent warning:
"No authentication configured. Anyone can sign in as admin.
Set GRIST_ADMIN_EMAIL or configure a real auth system." This would
nudge existing admins toward proper auth without breaking them.

### Relationship between Quick Setup wizard and full admin panel

The Quick Setup wizard (`/admin/setup`) and the full admin panel
(`/admin`) overlap significantly but have different UX goals and
different implementations. This needs to be thought through.

**What the wizard covers (4 steps):**
1. Sandboxing — probe available flavors, pick one, configure
2. Authentication — configure auth provider (reuses `AuthenticationSection`)
3. Storage/Backups — probe external storage, pick or skip
4. Apply & Restart — restart to apply changes, go live

**What the full admin panel covers:**
- Support Grist (telemetry, sponsorship)
- Security Settings: admin accounts, sandboxing, authentication,
  session secret, boot key
- Maintenance (take out of service)
- Audit logs
- Version & updates
- Self-checks (boot probes)

**The overlap:** Sandboxing and authentication appear in both. The
wizard mounts the same `AuthenticationSection` component used by the
admin panel (with `controls` optional — the wizard doesn't need the
"needs restart" banner since it has its own Apply & Restart step).
Storage/backups appears in the wizard but not yet in the admin panel.

**Structural issues (resolved):**
- The wizard was a 1000+ line function in `errorPages.ts` — now
  extracted to `SetupWizard.ts` (~200 lines) using shared components.
- The wizard and admin panel now share the same `/api/admin/*`
  endpoints with session auth via `requireInstallAdmin`. The old
  `/api/setup/*` endpoints with boot-key header auth are removed.
- Shared components (`SandboxConfigurator`, `StorageConfigurator`,
  `GoLiveControl`) are used by both the wizard and admin panel.

**Design principle:** The admin panel should be able to read and
modify anything the wizard can. The wizard is a visual repackaging
— a guided linear flow — of capabilities whose implementation is
shared with the full admin panel. The wizard should not have its own
parallel endpoints, state management, or configure mechanisms.

Concretely this means:
- **One set of endpoints.** No separate `/api/setup/*` routes. The
  wizard uses the same `/api/admin/*` and `/api/install/*` endpoints
  as the admin panel. Auth for these endpoints needs to work in both
  modes (boot-key session pre-go-live, install-admin session
  post-go-live — but both result in a session, so the middleware
  can be the same).
- **One set of UI building blocks.** The sandboxing probe/configure
  UI, storage config UI, etc. should be components that both the
  wizard and the admin panel can render. The wizard arranges them
  in a step flow; the admin panel shows them as expandable sections.
- **Admin panel is the superset.** Anything the wizard can do
  (configure sandbox, configure storage, go live) should also be
  doable from the admin panel. The admin panel may also have things
  the wizard doesn't (audit logs, version checks, enterprise toggle).
- **Wizard is a view, not a system.** The wizard file should be
  mostly layout and step navigation. The actual probing, configuring,
  and state management lives in shared code.

After go-live, `/admin/setup` redirects to `/admin`. The admin panel
sidebar already has a "Quick Setup" entry, so the wizard remains
accessible from there.

**Remaining open questions:**
- How should the admin panel expose storage/backup config (currently
  only in the wizard)?
- What's the right granularity for shared components — per-section
  (a sandboxing widget) or per-primitive (a probe card)?

## Wizard Checkmark Theory

A checkmark on a wizard tab means **"the admin actively confirmed this
step."** It does not mean "something is detected" or "a default was
auto-selected." The distinction:

- **No checkmark:** The step has not been addressed in this wizard
  session. Even if the server already has sandboxing configured or
  storage set up, the admin has not yet looked at it and confirmed
  they are satisfied. Auto-detected state is shown *within* the step
  panel (e.g. "currently configured: gVisor") but does not earn a
  checkmark on the tab.

- **Checkmark:** The admin took an explicit action — clicked
  "Configure," clicked "Continue," or clicked "Skip." This confirms
  they reviewed the step and made a deliberate choice (even if that
  choice was to keep the existing configuration).

Concrete rules per step:

1. **Sandboxing** — checkmark after the admin clicks "Configure" (saves
   a flavor to the server) or clicks "Continue" (accepts the
   already-configured flavor). Not on probe completion.
2. **Authentication** — checkmark after the admin clicks "Continue"
   (confirms the detected auth provider) or "Skip for now." Not on
   probe detecting an existing provider.
3. **Backups** — checkmark after the admin clicks "Continue" (confirms
   the storage choice). Not on probe auto-selecting a backend.
4. **Apply & Restart** — checkmark after go-live succeeds (already
   correct — requires explicit click).

Checkmarks persist across page reloads via sessionStorage. This is
valid because the admin *did* confirm the step in this session. On a
fresh session (new browser tab, sessionStorage cleared), all
checkmarks reset — the admin should re-review.

Implementation: each step tracks a `confirmed` observable separate
from the component's `status`/`selected` state. The `done` predicate
for the tab checks `confirmed`, not auto-detected state. The
`_saveState()`/`_restoreState()` methods persist confirmations.

## Setup Page Requirements

1. **Left panel fully collapsed on setup page.** When arriving at
   `/admin/setup`, the left panel starts fully collapsed (0px width,
   no thin strip). The opener handle in the header remains visible.
   Once the user opens the panel via the opener, subsequent closes
   collapse to the normal 48px thin strip — not back to 0px. This
   is implemented via a reactive `collapsedWidth` observable on
   `PageSidePanel` that starts at 0 and switches to 48 on first open.

2. **Quick Setup link in sidebar.** The admin panel left panel
   must have a visible "Quick Setup" entry under Settings so the
   wizard is discoverable and reachable from the admin panel.

3. **Top bar mostly empty when panel fully collapsed.** When the
   left panel is fully collapsed (0px, i.e. on initial load of the
   setup page), the top bar hides breadcrumbs and extra buttons
   (Support Grist, language menu, etc.), leaving only the panel
   opener on the far left and user account widget on the far right.
   Once the panel has been opened (collapsedWidth switches to 48px),
   the full top bar content is restored.

## Visual Design Language

The setup wizard and boot key login page establish a visual language
that should spread to the rest of the admin panel over time. The
aesthetic is **"quiet authority"** — clean, confident, warm without
being flashy. It says "you are in control" without saying "look how
clever this UI is."

### Core principles

- **Depth via shadow, not weight.** Cards float slightly above the
  page with subtle multi-layer box-shadows (`0 1px 3px` + `0 6px 20px`
  at low opacity). Borders are light (1–1.5px, `theme.pagePanelsBorder`
  or `theme.inputBorder`). Never rely on heavy borders or outlines
  for structure.

- **Generous rounding.** Cards at 8–12px border-radius, badges at
  10px (pill-shaped), buttons at 8px, inputs at 8px. Nothing is sharp-
  cornered except code blocks (6px). This softness signals approachability
  for an admin tool that might intimidate.

- **Atmosphere, not decoration.** A subtle radial glow
  (`theme.controlPrimaryBg` at ~4–7% opacity) sits behind the main
  content area, giving depth without adding visual noise. The glow is
  pointer-events: none, purely atmospheric.

- **Entrance animation.** Content fades up on load with staggered
  delays (0s, 0.08s, 0.14s, 0.2s). The keyframe is simple:
  `from { opacity: 0; translateY(16px) } to { opacity: 1; translateY(0) }`.
  Step panels animate individually when revealed. This gives a sense
  of things arriving rather than appearing.

- **Hover lift on interactive cards.** Selection cards (sandbox
  flavors, storage backends) gain a soft shadow on hover
  (`0 2px 8px rgba(0,0,0,0.06)`), reinforcing clickability without
  color change.

- **Active press scale.** Buttons shrink slightly on click
  (`transform: scale(0.98)`) for tactile feedback.

### Concrete values to reuse

| Element | border-radius | padding | font-size | font-weight |
|---|---|---|---|---|
| Page card (step panel) | 12px | 28px 32px | — | — |
| Selection card (radio) | 8px | 14px 18px | — | — |
| Badge/pill | 10px | 2px 8px | 11px | 600 |
| Primary button | 8px | 10px 28px | 14px | 600 |
| Code block | 6px | 10px 14px | 12px mono | — |
| Text input | 8px | 10px 14px | 15px | — |
| Success box | 8px | 14px 18px | 14px | — |

### Colors (always via theme tokens where possible)

- Primary actions: `theme.controlPrimaryBg` / `theme.controlPrimaryHoverBg`
- Success: `#e6f4ea` bg / `#1e7e34` text (green)
- Error: `#fce8e6` bg / `#c5221f` text (red)
- Warning: `#fef7e0` bg / `#b45309` text (amber)
- Info/recommended: `#e8f0fe` bg / `#1a73e8` text (blue)
- Neutral/checking: `#e8eaed` bg / `#5f6368` text (grey)

These are hardcoded because Grist's theme system doesn't yet have
semantic tokens for status colors. If/when it does, migrate.

### The progress rail

The wizard's progress rail (horizontal track with connected dots) is
the most distinctive element. It replaces a generic tab bar with a
spatial metaphor — you are *traveling* through setup, not switching
tabs. The fill bar animates smoothly between steps. Completed dots
become green circles with white checkmarks. The rail is specific to
the wizard and shouldn't be used elsewhere, but the underlying idea
— using spatial metaphors for multi-step flows — should inform other
admin panel patterns.

### What NOT to do

- Don't use flat 4px-radius rectangles with 1px borders for cards.
  That's the old Grist admin panel style and reads as generic.
- Don't use `theme.controlFg` for primary button backgrounds; use
  `theme.controlPrimaryBg`. The former is for text/icon accents.
- Don't omit transitions. Every interactive state change should have
  a 0.15–0.2s ease transition. Instant state changes feel broken.
- Don't mix border radiuses randomly. Pick from the table above.

## What Needs Fixing

### 1. State transitions are ad-hoc (resolved)
`_isInService()` now checks only `GRIST_IN_SERVICE` (env var or
DB-persisted) with a legacy default of `true`. The auth check has been
removed. Fresh installs persist `GRIST_IN_SERVICE=false` on first boot
via `ActivationsManager.current()`. Test env uses
`GRIST_FORCE_SETUP_GATE` to force the gate on.

### 2. Setup endpoints are scattered (resolved)
All configuration endpoints now live in `attachEarlyEndpoints.ts`
under `/api/admin/*` with session auth via `requireInstallAdmin`.
The old `/api/setup/configure-auth`, `/api/setup/configure-sandbox`,
and `/api/setup/go-live` endpoints have been removed from
`FlexServer.addSetupGate()`. Only mockup endpoints remain under
`/api/setup/` (to be removed after user testing, step #9).
`BootKeyLogin.ts` handles `/auth/boot-key` routes.

### 3. Boot-key login serves two purposes
1. Gate authentication (getting past the setup gate)
2. Fallback login system (when auth is broken or not configured)

These are the same mechanism but triggered differently. The gate shows
the boot-key login page inline; the login system redirects to /auth/boot-key.
Both POST to the same endpoint. This is actually fine — just needs to
be clearly documented.

### 4. The wizard lives inside errorPages.ts (resolved)
The wizard has been extracted to `SetupWizard.ts`. The old
`createSetupPage` function, `buildMockupControls`, and 32 unused
styled components have been removed from `errorPages.ts`
(2348 → 890 lines). Only the boot-key login page and standard
error pages remain.

### 5. Session handling in the gate is fragile
The gate manually inspects `req.session.users` to check for authentication.
This duplicates logic from the Authorizer. Should use a simpler signal
(e.g., a flag set by the boot-key login handler).

### 6. AdminLeftPanel special-cases setup page
The left panel starts collapsed with `fullCollapse: true` on setup,
then clears it when opened. This is clever but fragile — the panel
behavior depends on URL state at construction time. The wizard stays
as an admin panel sub-page (reachable via sidebar), but the
`fullCollapse` hack should be revisited.

## Plan: Reconciling Quick Setup and Admin Panel

### Design principle

The admin panel should be able to read and modify anything the wizard
can. The wizard is a visual repackaging — a guided linear flow — of
capabilities whose implementation is shared with the full admin panel.

### Endpoint consolidation (complete)

All configuration goes through `/api/admin/*` and `/api/install/*`.
The wizard-only `/api/setup/*` routes are being eliminated.

| Action | Endpoint | Auth | Status |
|---|---|---|---|
| Probe sandbox flavors | `GET /api/probes/sandbox-availability` | Install admin (session) | Exists |
| Configure sandbox | `POST /api/admin/configure-sandbox` | Install admin (session) | **New** |
| Probe external storage | `GET /api/probes/external-storage` | Install admin (session) | Exists |
| Go live | `POST /api/admin/go-live` | Install admin (session) | **New** |
| Restart | `POST /api/admin/restart` | Install admin (session) | Exists |
| Maintenance toggle | `POST /api/admin/maintenance` | Install admin (session) | Exists |
| Boot key generate/clear | `POST /api/admin/boot-key/*` | Install admin (session) | Exists |

Auth is always "install admin session" — established via boot-key
login (pre-go-live) or real auth (post-go-live). The boot-key login
creates a session where the user's email matches `GRIST_ADMIN_EMAIL`,
so `requireInstallAdmin` middleware accepts it. Verified: the
`_userIdMiddleware` is registered on `/api` before early endpoints run
(because `addEarlyApi` depends on `api-mw`), so session auth flows
through to the new `/api/admin/*` endpoints.

### Shared UI components (implemented, wired into wizard + admin panel)

Three shared components extracted from the wizard into reusable files:

#### Sandbox flavor guide

| Flavor | When to use | Speed | Notes |
|---|---|---|---|
| **gvisor** | Recommended when available. The default in the Grist Docker image (`runsc` is pre-installed). | Fastest sandbox | Most tested. Won't work in some environments (e.g. containers without required capabilities, or old processors). If the availability probe passes, use this. |
| **pyodide** | Fallback when gVisor isn't available. Works everywhere (runs Python via WebAssembly). | Slower than gVisor | Full Grist formula compatibility (standard library only). Good isolation. Less battle-tested than gVisor. |
| **macSandboxExec** | Running Grist on a Mac (local/dev use). Uses Apple's built-in `sandbox-exec`. | Fast (native Python) | Good isolation. Less tested than gVisor. Only relevant on macOS — not a choice the wizard should nudge toward. |
| **unsandboxed** | Trusted environments where the admin controls all documents (e.g. personal use, air-gapped). | Fastest (no overhead) | Formulas get full system access. Legitimate when you trust every document author. Some users specifically want this to run unrestricted Python. |

**Decision tree for the wizard:** recommend gVisor if its probe passes →
otherwise suggest pyodide (or macSandboxExec if on a Mac) → show
unsandboxed as an available-but-opt-in fallback with a clear warning.

**1. SandboxConfigurator** (`app/client/ui/SandboxConfigurator.ts`)
- Probes sandbox flavors via `InstallAPI.runCheck()` (one request per
  candidate: gvisor, pyodide, macSandboxExec)
- Renders interactive flavor cards with radio buttons, status badges
  (Available/Not available/Checking), and recommended/warning labels
- "Configure" button calls `POST /api/admin/configure-sandbox`
- "unsandboxed" option always appended as a fallback
- `buildDom({ onContinue })` for wizard, `buildStatusDisplay()` for
  compact admin panel display
- Currently used by wizard Step 1. Admin panel still uses its own
  read-only probe display (can be upgraded later).

**2. StorageConfigurator** (`app/client/ui/StorageConfigurator.ts`)
- Probes external storage via `InstallAPI.runCheck("external-storage")`
- Renders backend cards: minio (always selectable), s3, azure
  (greyed out unless configured), none
- Inline MinIO setup instructions when minio is selected but not
  configured (shows required env vars)
- Currently used by wizard Step 2. Not yet in admin panel.

**3. GoLiveControl** (`app/client/ui/GoLiveControl.ts`)
- Two modes: `restart` (just restart) and `go-live` (persist
  `GRIST_IN_SERVICE=true` then restart)
- Polls `/status?ready=1` after restart (2s initial delay, then
  1s intervals, 30 attempts)
- Status flow: idle → working → restarting → success/error
- `canProceed` option controls button enable/disable
- Currently used by wizard Step 3. Not yet wired into admin panel
  Maintenance section.

### File structure (current)

```
app/client/ui/
  SetupWizard.ts          — Step layout, tab bar, navigation.
                            Mounts shared components. ~200 lines.
  SandboxConfigurator.ts  — Probe + configure sandbox. ~400 lines.
  StorageConfigurator.ts  — Probe + display storage. ~370 lines.
  GoLiveControl.ts        — Go-live and restart logic. ~230 lines.
  AdminPanel.ts           — Imports buildSetupWizard from SetupWizard.ts.
                            Shows boot-key login link for unauthenticated
                            admins (replacing old GRIST_BOOT_KEY instructions).
  errorPages.ts           — Boot-key login page (client-side two-phase
                            flow) and standard error pages. ~890 lines
                            (was 2348).

app/server/lib/
  attachEarlyEndpoints.ts — POST /api/admin/configure-sandbox,
                            POST /api/admin/go-live. Session auth via
                            requireInstallAdmin middleware.
  BootKeyLogin.ts         — /auth/boot-key GET/POST routes plus
                            /auth/boot-key/check JSON endpoint for
                            client-side key validation without login.
  FlexServer.ts           — Setup gate middleware. Old /api/setup/*
                            endpoints removed. Mockup endpoints remain
                            (to be removed after user testing, step #9).
```

### Migration progress

| Step | Description | Status |
|---|---|---|
| 1 | Create `SandboxConfigurator.ts` | Done |
| 2 | Create `StorageConfigurator.ts` | Done |
| 3 | Create `GoLiveControl.ts` | Done |
| 4 | Create `SetupWizard.ts`, wire into AdminPanel.ts | Done |
| 5 | Add `/api/admin/configure-sandbox` and `/api/admin/go-live` endpoints | Done |
| 6 | Update tests to use new test IDs | Done |
| | **Not yet user-tested. Passes automated tests (30/30).** | |
| 7 | Wire shared components into admin panel (sandbox, storage, maintenance) | Done |
| 8 | Remove old `/api/setup/*` endpoints from FlexServer.addSetupGate() | Done |
| 9 | Remove mockup endpoints from FlexServer.addSetupGate() | Not started |
| 10 | Remove dead wizard code from errorPages.ts | Done |
| 11 | Update `isInService()` to remove auth check | Done |
| 12 | Add first-boot detection in ActivationsManager | Done |
| 13 | Ensure `/auth/boot-key` is always reachable and discoverable | Done |
| 14 | Boot-key login page: defer email field until after key validation | Done |

### Remaining work (prioritized, no user testing needed)

| Priority | Step | Description | Blocked by |
|---|---|---|---|
| — | #9 | Remove mockup endpoints from FlexServer | User testing complete |

### Known issues found during implementation

- **"unsandboxed" gating bug (fixed):** The initial `SandboxConfigurator`
  only added the "unsandboxed" option when at least one real sandbox
  was available. In environments where no sandbox is installed (no
  gVisor, no pyodide, no macOS), this meant the user had no options to
  select and the wizard was stuck. Fixed by always adding "unsandboxed"
  as a fallback, matching the original wizard behavior.

- **Test ID naming:** Shared components use generic test IDs
  (`test-sandbox-submit`, `test-storage-option-minio`, `test-go-live-submit`)
  rather than the old wizard-specific `test-setup-*` prefix. Tests
  updated accordingly. This is intentional — the same components will
  be rendered in the admin panel context where `setup-` would be misleading.

### Implementation insights

- **Unified auth via session, not headers.** The key insight that
  made endpoint consolidation work: boot-key login creates a session
  where the user's email matches `GRIST_ADMIN_EMAIL`. This means the
  same `requireInstallAdmin` middleware works for both boot-key
  sessions (pre-go-live) and real auth sessions (post-go-live). No
  need for separate auth paths or `X-Boot-Key` header plumbing on
  configure endpoints.

- **DB env var merge timing.** DB-persisted env vars are merged into
  `process.env` during `addHomeDBManager()`, before `_isInService()`
  ever runs. This means `_isInService()` doesn't need its own DB
  lookup — it just reads `process.env.GRIST_IN_SERVICE`, which
  already reflects the three-tier precedence (env > DB > default).
  This was non-obvious but made the implementation much simpler.

- **`_userIdMiddleware` ordering matters.** The `/api/admin/*`
  endpoints in `attachEarlyEndpoints` depend on session auth, which
  requires `_userIdMiddleware` to have run. This works because
  `addEarlyApi` (which calls `attachEarlyEndpoints`) depends on
  `api-mw` in the FlexServer phase ordering, and `api-mw` registers
  `_userIdMiddleware` on `/api`. If this ordering is disrupted,
  boot-key sessions will silently fail to authenticate.

- **Sessions must be initialized before the setup gate.**
  `addHosts()` and `addSessions()` are called before
  `addSetupGate()` in `MergedServer.create()`. This is critical
  because the boot-key login routes (registered by `addSetupGate`)
  need express-session middleware to create sessions via
  `setUserInSession()`. Both `addHosts` and `addSessions` only
  depend on `homedb` (already initialized at that point). If this
  ordering is reversed, boot-key login will fail with "session not
  found" because `req.session` / `req.sessionID` won't exist.

- **CSRF check requires Content-Type header on POST requests.**
  The Authorizer's CSRF protection (Authorizer.ts:269) rejects
  POST requests that lack `Content-Type: application/json` or
  `X-Requested-With: XMLHttpRequest` when `req.userId` is not yet
  populated. Any client-side `fetch()` POST to `/api/*` endpoints
  must include `headers: { "Content-Type": "application/json" }`
  or the request will be rejected with 401 before session-based
  user lookup even runs.

- **The `?boot-key=XXX` query param path still works** as a
  last-resort fallback. The Authorizer (`Authorizer.ts:231`)
  recognizes `X-Boot-Key` headers and authenticates as admin without
  a session. The client-side admin panel reads `?boot-key=` from the
  URL and sends it as a header on API calls. This bypasses the login
  system entirely and works even when auth is broken at runtime. It's
  complementary to `/auth/boot-key` (which creates a session) and
  should be preserved.

## Refactoring Status

All planned refactoring steps are complete except step #9 (remove
mockup endpoints, blocked on user testing). Summary of what was done:

1. Extracted shared components: `SandboxConfigurator`, `StorageConfigurator`, `GoLiveControl`
2. Extracted wizard to `SetupWizard.ts`, wired into `AdminPanel.ts`
3. Added `/api/admin/configure-sandbox` and `/api/admin/go-live` endpoints
4. Updated tests to use new test IDs and endpoints
5. Wired shared components into both wizard and admin panel
6. Removed old `/api/setup/*` endpoints from FlexServer
7. Removed dead wizard code from `errorPages.ts` (2348 → 890 lines)
8. Simplified `_isInService()` — removed auth check, env var always wins
9. Added first-boot detection in `ActivationsManager` (persists `GRIST_IN_SERVICE=false`)
10. Secured boot-key login: client-side two-phase flow (check key via JSON API, then reveal email field — no page reload)
11. Made `/auth/boot-key` discoverable via link on unauthenticated `/admin` page

### Remaining

- **Step #9**: Remove mockup endpoints from FlexServer — blocked on user testing
- **User-test the wizard** visually (automated tests pass, 30/30)
- **Test each installer path end-to-end** — walk through all 8 paths above

## Appendix: How DB-persisted env vars work

The activation record (single row in the `activations` table) has a
JSON `prefs` column. Within prefs, `envVars` is a string-keyed object
that stores environment variable overrides:

```
activation.prefs = {
  telemetry: { ... },
  bootKey: "abc123",
  envVars: {
    "GRIST_IN_SERVICE": "true",
    "GRIST_SANDBOX_FLAVOR": "gvisor",
    "GRIST_ADMIN_EMAIL": "admin@example.com",
    ...
  }
}
```

### Writing

`ActivationsManager.updateAppEnvFile(delta)` merges key/value pairs
into `prefs.envVars`. It only accepts a whitelist of known keys
(`GRIST_IN_SERVICE`, `GRIST_SANDBOX_FLAVOR`, `GRIST_ADMIN_EMAIL`,
`GRIST_GETGRISTCOM_SECRET`, `GRIST_LOGIN_SYSTEM_TYPE`). Setting a
key to `null` removes it.

### Reading (on startup)

During `FlexServer.addHomeDBManager()`, after the activation record
is loaded:

1. `appSettings.setEnvVars(dbEnvVars)` — makes values available via
   the appSettings API.
2. For each key in `dbEnvVars`, if `process.env[key]` is `undefined`,
   copy the DB value into `process.env`. **Real env vars (Docker,
   shell) always take precedence** — DB values only fill in gaps.

So the precedence is:

```
process.env (Docker/shell)  >  activation.prefs.envVars (DB)  >  not set
```

Because DB values are merged into `process.env` on startup (only
filling gaps), by the time `isInService()` runs, `process.env`
already reflects the merged result. So `isInService()` can simply
check `process.env.GRIST_IN_SERVICE` — the three-tier precedence
(env var > DB > default) is already resolved by the startup merge.
The only extra logic `isInService()` needs is the fallback to `true`
when the value is absent entirely (legacy/upgrade safety).

### Runtime updates

The setup wizard and admin panel can update persisted env vars via
API calls (e.g., go-live persists `GRIST_IN_SERVICE=true`). These
writes go to the DB and also update `process.env` in the running
process. A server restart picks them up fresh from the DB.

### Entities involved

- **`Activation`** entity (`app/gen-server/entity/Activation.ts`):
  TypeORM entity with `prefs: InstallPrefs | null` JSON column.
- **`ActivationsManager`** (`app/gen-server/lib/ActivationsManager.ts`):
  `current()` returns the single activation row (creates it on first
  call). `updateAppEnvFile(delta)` writes to `prefs.envVars`.
- **`InstallPrefs`** (`app/common/Install.ts`): TypeScript interface,
  includes `envVars?: Record<string, any>` plus `telemetry`,
  `bootKey`, etc.
