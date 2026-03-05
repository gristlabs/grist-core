# Setup Wizard Review

Review of the first-run setup experience from the perspective of new
installers at different technical levels.

---

## What works well

- **Four clear steps** with a tab bar — the structure is easy to follow.
- **Auto-advance** after step 1 (boot key accepted → jumps to step 2) reduces clicks.
- **Sandbox detection probes** run automatically and surface what's available.
- **Storage detection** highlights configured vs unconfigured backends.
- **Go Live is gated** — you can't click it until steps 2 and 3 are done.
- **Maintenance mode** lets an admin re-open the gate from the admin panel.
- **Session established on Go Live** — admin can navigate freely afterward.
- **Boot key login** provides real authentication when no OIDC/SAML is configured.

---

## Issues by severity

### Critical

1. ~~**No guidance on finding the boot key.**~~ **Addressed.**
   Server now prints a prominent `BOOT KEY` banner on startup. The setup
   wizard shows an example of what to look for and gives Docker/systemd
   commands. The BootKeyLogin page also references the banner.

2. **Sandbox flavor not validated at configure time.**
   `POST /api/setup/configure-sandbox` accepts any flavor from the allowed
   list even if the probe said it's unavailable. User can set "gvisor" on a
   system without runsc; Grist will break at next restart with no clear error
   pointing back to the wizard.

3. **Restart requirement mentioned but never verified.**
   Steps 2 and 3 both set environment variables that only take effect after
   restart. The wizard says "will take effect on next server restart" but
   proceeds happily to Go Live. A non-technical user may think everything is
   active. At minimum, a stronger warning; ideally, a check after restart.

4. ~~**Unsandboxed option only appears if a real sandbox is available.**~~
   **Not actually a problem.** `maybeAppendUnsandboxed()` is called
   unconditionally after all probes complete (line 394), so the "No
   Sandbox" fallback always appears regardless of probe results.

### High

5. **Jargon without explanation.**
   "gVisor", "Pyodide", "sandbox-exec", "MinIO", "S3-compatible" — none of
   these are explained in-wizard. A non-technical installer has no basis for
   choosing. Even a one-line "What does this mean?" expandable or a link to
   docs would help.

6. **"Backups" step is labeled Optional but you must select something.**
   The Continue button is disabled until a storage option is selected.
   Either remove "(Optional)" or allow proceeding without a selection.

7. **Boot key visible in admin panel URL.**
   After Go Live, the redirect is `/admin?boot-key=<key>`. This lands in
   browser history, server logs, and referrer headers. Consider passing
   it via a POST or session instead.

8. **"Go Live" doesn't mean what a non-technical user expects.**
   After Go Live, Grist is accessible to the installer only. Other users
   still can't log in until authentication is configured. The text says
   "Set up authentication for other users" but doesn't explain how. A
   sentence or link to next steps would reduce confusion.

9. **getgrist.com auth path is untested.**
   The test suite only exercises the boot key flow. The getgrist.com
   config key path (segmented control → register → paste key) has zero
   test coverage.

10. **Error messages lack actionable detail.**
    - "Invalid configuration key" — why? Malformed? Wrong email? Expired?
    - "Probe failed with status 500" — truncated by CSS `text-overflow`.
    - "Invalid boot key" — could mean wrong key, empty key, or boot key
      not configured on the server.

### Medium

11. **No documentation links anywhere in the wizard.**
    Every step would benefit from a "Learn more" link. For sandboxing
    especially, users need to understand the security tradeoffs.

12. ~~**Loading feedback is vague.**~~ **Addressed.**
    Probes now have a 30-second timeout via AbortController. The vague
    "Please wait…" message was removed; per-card "Checking…" badges
    already show which probes are in progress.

13. ~~**State not persisted across page refresh.**~~ **Addressed.**
    Wizard state (boot key, active step, sandbox config, storage
    selection) is now persisted to `sessionStorage` and restored on
    page reload. State is saved explicitly at key transition points
    (boot key accepted, sandbox configured, storage selected).

14. **Mockup controls and endpoints still present.**
    Comments say "will be removed before merge" but the mockup panel
    (bottom-right overlay) and endpoints (`/api/setup/mockup-boot-key`,
    `/api/setup/mockup-set-admin-email`) ship as-is. These are a security
    risk if deployed — anyone can fetch the boot key. Must be removed or
    gated behind a dev-mode flag.

15. **Tab 4 uses a rocket emoji instead of "4".**
    Cute, but breaks visual consistency with tabs 1/2/3 and may not render
    on all devices or terminal-based browsers.

16. **Step 3 minio instructions are a wall of env vars with no context.**
    Shows `GRIST_DOCS_MINIO_ENDPOINT=s3.amazonaws.com` as an example but
    doesn't explain: what endpoint for a self-hosted MinIO? What for
    DigitalOcean Spaces? What for Backblaze B2?

17. **No keyboard/accessibility audit.**
    No ARIA labels on the tab bar, segmented control uses divs not radios,
    sandbox cards don't announce selection state to screen readers.

### Low

18. **Segmented control in step 1 isn't a real radio group.**
    Looks like a toggle but is built from styled divs. Fine visually but
    doesn't participate in form semantics or keyboard navigation.

19. **Step 4 "skip" text is confusing.**
    "Or skip this wizard entirely by setting `GRIST_IN_SERVICE=true` and
    restarting" appears below the Go Live button. Sounds like an
    alternative but is really an escape hatch for broken wizards. Could
    be reworded: "If something isn't working, you can bypass the wizard
    by setting …"

20. **`cssAdminPanelLink` is now used for the loading hint text.**
    The styled component name no longer matches its content. Minor code
    smell.

21. **No test for the Continue button on the backups step.**
    The new Continue button (storage → Go Live tab) isn't covered by any
    existing test.

---

## Persona walkthroughs

### Alice — non-technical small business owner, Docker install

Follows a blog tutorial, runs `docker run gristlabs/grist`. Sees the
setup page. The boot key path now explains what a boot key is, shows
an example of what to look for, and gives the `docker logs` command.
The server also prints a prominent BOOT KEY banner that's hard to miss.
**Much better than before**, but Alice still needs to know how to find
her container name (`docker ps`). The getgrist.com path still assumes
she can set environment variables and restart — could use a note that
this requires editing her Docker run command or compose file.

### Bob — sysadmin, familiar with Docker and env vars

Sets `GRIST_ADMIN_EMAIL`, restarts, sees the setup page. Finds the boot
key in the banner from `docker logs`. Enters it — step 1 done,
auto-advance to step 2. Sees gvisor is available, clicks Configure.
Success message says "will take effect when you go live" — clear,
no confusion about restart timing. Picks minio for storage, sees env
var instructions, sets them. **Still unclear: does he need to restart
to pick up the new MinIO env vars, or will they take effect on Go
Live?** (They won't — MinIO credentials must be in the environment
before the server starts.) Clicks Go Live, navigates to admin panel.
Needs: step 3 should clarify that newly added env vars require a
restart after Go Live.

### Carol — developer, self-hosting on a Mac

Step 2: gvisor unavailable (Linux only), pyodide available,
macSandboxExec available. Picks macSandboxExec. Step 3: no S3
configured, picks "No External Storage". Clicks Continue → Go Live →
success. Navigates to docs, creates a spreadsheet. **Works well.**
Only friction: didn't know what Pyodide vs sandbox-exec meant and
guessed based on the name.

### Dave — enterprise IT, wants SAML behind a reverse proxy

Goes through the wizard, picks boot key. Finishes Go Live. Now in the
admin panel. **Doesn't see how to configure SAML from the admin panel.**
The admin panel has auth toggles but the wizard didn't connect the dots.
Needs: a "Configure authentication" link/section in the admin panel
that's prominent after first Go Live.

---

## Summary of recommended next steps

1. Add help text about where to find the boot key (deployment-specific tips).
2. Validate sandbox flavor against probe results before accepting.
3. Make "unsandboxed" always available as a last resort.
4. Clarify restart timing (before Go Live? after? both?).
5. Remove or gate mockup controls and endpoints.
6. Fix "(Optional)" label on backups — either make it truly optional or
   remove the label.
7. Add "Learn more" links for sandboxing and storage options.
8. Add test coverage for the getgrist.com config key path.
9. Persist wizard state so a page refresh doesn't lose progress.
10. Improve error messages with specific causes and suggested fixes.
