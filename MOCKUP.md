# Mockup Code — Remove Before Merge

This branch includes a small amount of throwaway mockup code to let
reviewers interact with the setup page's new Step 2 (Sandboxing)
without needing access to server logs or environment variables.

## What to remove

### 1. Server endpoints: `mockup-boot-key` and `mockup-set-admin-email`

**File:** `app/server/lib/FlexServer.ts`

Search for `MOCKUP ONLY` — delete both endpoint blocks:
- `this.app.post("/api/setup/mockup-set-admin-email", ...)` (sets `GRIST_ADMIN_EMAIL` in process.env)
- `this.app.get("/api/setup/mockup-boot-key", ...)` (exposes the boot key)

### 2. Client mockup controls panel

**File:** `app/client/ui/errorPages.ts`

Three pieces to delete, all clearly marked with `Mockup`/`mockup`:

- **Call site** — search for `Mockup controls (for development/demo only)`.
  Delete the 2-line `dom.create(buildMockupControls, ...)` block and its comment.

- **Function and interface** — delete the `MockupState` interface and the
  `buildMockupControls` function (search for `interface MockupState` through
  the closing `}` of `buildMockupControls`).

- **CSS** — delete every `cssMockup*` styled component at the bottom of the
  file (`cssMockupPanel`, `cssMockupTitle`, `cssMockupRow`, `cssMockupButton`,
  `cssMockupSection`, `cssMockupLabel`, `cssMockupInput`, `cssMockupInfo`,
  `cssMockupLog`).

## What is NOT mockup

Everything else in the branch is real, intended-to-ship code:

- `sandbox-availability` boot probe (`BootProbe.ts`, `BootProbes.ts`)
- `POST /api/setup/configure-sandbox` endpoint (`FlexServer.ts`)
- `bootKey` returned from `configure-auth` success response (`FlexServer.ts`)
- `GRIST_SANDBOX_FLAVOR` in `updateAppEnvFile` allowlist (`ActivationsManager.ts`)
- Interactive Step 2 UI and all `cssSandbox*` CSS (`errorPages.ts`)
- Step 2 state management (`storedBootKey`, `sandboxFlavors`, etc.)
- Boot key path storing key for Step 2 instead of navigating to `/boot/`
- Tests (`SetupConfigureSandbox.ts`)

## Test independence

No tests reference mockup code. The test file `test/nbrowser/SetupConfigureSandbox.ts`
fetches the boot key via `GET /api/install/prefs` (the real admin-authenticated endpoint),
not via the mockup endpoint. Removing all mockup code will not break any tests.
