import { UserProfile } from "app/common/UserAPI";
import { expressWrap } from "app/server/lib/expressWrap";
import { GristServer, setUserInSession } from "app/server/lib/GristServer";
import { getBootKey } from "app/server/lib/gristSettings";
import log from "app/server/lib/log";

import express, { Express, Request, Response } from "express";

/**
 * Register the /auth/boot-key GET and POST routes. The custom (POC)
 * boot-key login page is rendered from these endpoints; the actual
 * BootKeyLoginMiddleware lives in Boot.ts.
 */
export function addBootKeyRoutes(app: Express, gristServer: GristServer) {
  // Serve the boot key login form as a Grist-styled client page.
  app.get("/auth/boot-key", expressWrap(async (req, res) => {
    const next = String(req.query.next || "/");
    const error = String(req.query.error || "");
    await sendBootKeyPage(gristServer, req, res, next, error);
  }));

  // Check the boot key without completing login. Returns the admin
  // email (if configured) so the client can pre-fill it.
  app.post("/auth/boot-key/check", express.json(), expressWrap(async (req, res) => {
    const bootKey = req.body?.bootKey;
    const serverBootKey = getBootKey().value;
    if (!serverBootKey || bootKey !== serverBootKey) {
      return res.status(401).json({ valid: false, error: "invalid-key" });
    }
    const adminEmail = process.env.GRIST_ADMIN_EMAIL || "";
    return res.json({ valid: true, email: adminEmail });
  }));

  // Validate the boot key and establish a session.
  app.post("/auth/boot-key", express.urlencoded({ extended: false }), expressWrap(async (req, res) => {
    const bootKey = req.body?.bootKey;
    const next = req.body?.next || "/";
    const submittedEmail: string | undefined = req.body?.email?.trim();

    // Validate the boot key.
    const serverBootKey = getBootKey().value;
    if (!serverBootKey || bootKey !== serverBootKey) {
      const url = new URL("/auth/boot-key", gristServer.getHomeUrl(req));
      url.searchParams.set("next", next);
      url.searchParams.set("error", "invalid-key");
      return res.redirect(url.href);
    }

    // Use submitted email (user confirmed or entered), fall back to env var.
    const email = submittedEmail || process.env.GRIST_ADMIN_EMAIL;
    if (!email) {
      const url = new URL("/auth/boot-key", gristServer.getHomeUrl(req));
      url.searchParams.set("next", next);
      url.searchParams.set("error", "invalid-key");
      return res.redirect(url.href);
    }

    return completeLogin(req, res, gristServer, email, next);
  }));
}

/**
 * Complete the boot-key login: persist the admin email if needed,
 * create a session, and redirect.
 */
async function completeLogin(
  req: Request,
  res: Response,
  gristServer: GristServer,
  email: string,
  next: string,
) {
  if (!process.env.GRIST_ADMIN_EMAIL || process.env.GRIST_ADMIN_EMAIL !== email) {
    // Persist the admin email so it survives restarts.
    // Always update when the submitted email differs from the current one —
    // the user may be correcting a previously-set address.
    process.env.GRIST_ADMIN_EMAIL = email;
    const activations = gristServer.getActivations();
    await activations.updateEnvVars({ GRIST_ADMIN_EMAIL: email });
    // Refresh the install admin so it recognizes the new email immediately.
    gristServer.getInstallAdmin().clearCaches();
    log.info("Admin email set to %s via boot key login", email);
  }

  const adminProfile: UserProfile = {
    email,
    name: email.split("@")[0] || "Admin",
  };
  await setUserInSession(req, gristServer, adminProfile);
  log.info("Boot key login successful for %s", adminProfile.email);
  // Only allow relative redirects to prevent open redirect attacks.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return res.redirect(safeNext);
}

async function sendBootKeyPage(
  gristServer: GristServer,
  req: Request,
  res: Response,
  next: string,
  error: string,
) {
  return gristServer.sendAppPage(req, res, {
    path: "error.html",
    status: 200,
    config: {
      errPage: "boot-key-login",
      errDetails: {
        next,
        ...(error ? { error } : {}),
      },
    },
  });
}
