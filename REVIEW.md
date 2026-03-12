# PR Review: Setup & Admin Redesign

## Summary

This PR adds a guided first-run setup wizard and redesigns the admin
panel for self-hosted Grist. ~8,200 lines added/changed across 43
files, 44 commits.

### What it does

1. **Setup gate.** Fresh installs start behind a gate — no traffic
   until the admin walks through setup or sets `GRIST_IN_SERVICE=true`.

2. **Boot-key login.** A boot key printed to the console on first run
   lets the admin authenticate without any auth provider configured.
   This creates a real session, so the same admin middleware works for
   boot-key and real-auth admins.

3. **Setup wizard** (`/admin/setup`). Five steps: Server (base URL +
   edition), Sandboxing (probes flavors, recommends best), Auth
   (shows current status), Backups (probes S3/Azure), Apply & Restart
   (permission defaults + go live). State persists in sessionStorage.

4. **Shared configurator components.** SandboxConfigurator,
   ServerConfigurator, StorageConfigurator, PermissionsConfigurator,
   GoLiveControl — used by both wizard and admin panel.

5. **Built-in supervisor.** `stubs/app/server/server.ts` wraps the
   Grist process so `/api/admin/restart` works universally (not just
   under external supervisors).

6. **New admin endpoints.** `/api/admin/go-live`,
   `/api/admin/configure-sandbox`, `/api/admin/maintenance`,
   `/api/admin/boot-key/{generate,clear}`,
   `/api/admin/server-config`, `/api/admin/save-server-config`,
   `/api/admin/save-permissions`.

7. **Boot-key login page redesign.** Grist-themed page with tabbed
   guidance (Docker, systemd, source), auto-generated example keys
   with copy button.

8. **Admin panel additions.** Server section (base URL), boot key
   management, permissions configurator in Security section.

9. **Tests.** `SetupPage.ts` (gate, boot-key login, auth fallback)
   and `SetupConfigureSandbox.ts` (wizard UI, probe APIs, go-live,
   maintenance mode).

### New files

| File | Purpose |
|---|---|
| `app/client/ui/ServerConfigurator.ts` | Base URL + edition config |
| `app/client/ui/SandboxConfigurator.ts` | Sandbox flavor probe + selection |
| `app/client/ui/StorageConfigurator.ts` | External storage probe + selection |
| `app/client/ui/GoLiveControl.ts` | Go-live / restart with polling |
| `app/client/ui/PermissionsConfigurator.ts` | Permission defaults toggle grid |
| `app/client/ui/SetupWizard.ts` | Wizard layout + step navigation |
| `app/client/ui/MockupPanel.ts` | Dev-only state override panel |
| `app/server/lib/BootKeyLogin.ts` | Boot-key auth routes + middleware |
| `test/nbrowser/SetupPage.ts` | Gate + boot-key login tests |
| `test/nbrowser/SetupConfigureSandbox.ts` | Wizard + endpoint tests |

---

## Code Problems (ranked)

### Must fix before merge

**1. Mockup endpoints are unauthenticated and must be removed.**
`FlexServer.ts:735-780` registers four `/api/setup/mockup-*`
endpoints with no auth. `mockup-boot-key-login` leaks the boot key
unconditionally. Comments say "will be removed before merge" — do it.

**2. Open redirect in boot-key login** *(fixed in this review)*
`BootKeyLogin.ts:158` used `res.redirect(next)` where `next` came
from user input. Now validates that `next` is a relative path.

### Should fix before merge

**3. `(gristServer as any)._bootKey` — type-unsafe private field mutation.**
`attachEarlyEndpoints.ts:308,325` casts through `any` to mutate
`FlexServer._bootKey`. Add a `setBootKey(key)` method to the
`GristServer` interface or `FlexServer` class instead.

**4. Boot key logged to structured logging.**
`FlexServer.ts:~697` calls `log.rawInfo("Boot key...", { bootKey })`
which may forward the key to external log aggregation (CloudWatch,
Datadog). The console banner is intentional; the structured log call
should omit the key value or use a separate console-only path.

**5. `AdminPanel._buildBootKeyDetail` — observables with null owner.**
`AdminPanel.ts:604-606` creates three Observables with `null` owner
inside a `dom.domComputed`. These leak when the domComputed
re-evaluates. Use `dom.autoDispose()`.

**6. Hardcoded status colors won't work in dark mode.**
`#1e7e34`, `#b45309`, `#c5221f`, `#fef7e0`, etc. are used in
SandboxConfigurator, ServerConfigurator, PermissionsConfigurator,
StorageConfigurator, SetupWizard. Grist's theme system doesn't have
semantic status tokens yet, so this is a known debt — but should be
tracked and addressed before dark mode works with the wizard.
(Documented in REDESIGN.md.)

**7. Maintenance mode tests have inter-test order dependency.**
`SetupConfigureSandbox.ts:539-562` — "enables maintenance mode" must
run before "disables maintenance mode". If the first fails, the
second operates on wrong state. Consider combining into one test or
adding independent setup/teardown.

### Worth fixing

**8. `SandboxConfigurator._buildAlternativeCard` — `isBusy` is not reactive.**
`SandboxConfigurator.ts:484` captures `status.get()` once at card
build time. If status changes to "saving" later, the card won't
disable. Use `dom.prop("disabled", use => ...)` instead.

**9. Duplicated styled components across configurators.**
`cssBadge` is identical in SandboxConfigurator and
StorageConfigurator. `cssError` is defined in four files with
slightly different border-radius values. Extract to a shared module.

**10. `t()` called at module level for FLAVOR_META / STORAGE_META / PERM_ITEMS.**
Translations are locked to the locale active at module load time.
Changing language without a full reload won't update these strings.
This matches existing Grist patterns (many files do this) but is
worth noting.

**11. `PermissionsConfigurator` constructor pattern is inconsistent.**
Uses `new PermissionsConfigurator(parent, api)` with manual
`parent.autoDispose(this)` instead of the standard
`PermissionsConfigurator.create(parent, api)` pattern used by all
other configurators.

**12. Wizard builds all step DOMs eagerly.**
`SetupWizard.ts:265-276` calls `buildContent()` for every step and
uses `dom.show()` for visibility. `dom.maybe()` would defer
construction and reduce initial memory/side-effects.

**13. `GRIST_RUNNING_UNDER_SUPERVISOR` env var is partially obsolete.**
`attachEarlyEndpoints.ts` now checks `process.send` directly instead
of the env var. But `stubs/app/server/server.ts:274` still sets it,
and `server.ts:303` still reads it for the "skip supervisor" check.
Clean up to use one mechanism.

### Informational

**14. No test for go-live's effect on the gate.**
After calling `/api/admin/go-live`, no test verifies that the gate
actually opens (e.g., that `GET /` no longer redirects to boot-key).
The test only checks the go-live response status.

**15. `ConfigAPI.setMaintenanceMode` discards the response.**
Returns `Promise<void>` but the server responds with
`{ msg, maintenance }`. Callers can't confirm resulting state without
a separate GET.

**16. `bootKey` in `InstallPrefs` is readable via GET `/api/install/prefs`.**
The endpoint is behind admin middleware, so this is low-risk, but
the boot key is transmitted over the wire and cached client-side.

**17. Admin card replaces video tour on home page for admins.**
`HomeIntroCards.ts` — when `isInstallAdmin()` is true, the video
tour card is entirely replaced by the admin card. Admins never see
the tour. May be intentional.

### Fixed in this review

- Removed dead `isDirty`/`updateDirty` code and unused `urlDirty`
  getter from `ServerConfigurator.ts`
- Removed unused `Notifier` import and constructor parameter from
  `ServerConfigurator.ts`
- Fixed `body` variable shadowing in `GoLiveControl.goLive()`
- Fixed stale `ErrorInLoginMiddleware` comment in `BootKeyLogin.ts`
- Removed unused `&-setup` CSS variant from `errorPages.ts`
- Fixed open redirect in `BootKeyLogin.ts` (`next` parameter)
