/**
 * Endpoints for "setup requests": any signed-in user may record a request and see censored
 * per-step counts; install admins read the full detail and can clear a step.
 *
 * Attached early, after the install-admin gate on /api/admin is registered — it's that gate
 * that protects the admin endpoints here.
 */
import { ApiError } from "app/common/ApiError";
import { ConfigValue, SetupFeatureId, SetupRequests, SetupStepId } from "app/common/Config";
import {
  addSetupRequest,
  clearSetupRequestsStep,
  MAX_SETUP_REASON_LENGTH,
  SETUP_FEATURE_IDS,
  SETUP_STEP_IDS,
  SetupRequestSpec,
  summarizeSetupRequests,
} from "app/common/SetupRequests";
import { getAuthorizedUserId, RequestWithLogin } from "app/server/lib/Authorizer";
import { expressWrap } from "app/server/lib/expressWrap";
import { GristServer } from "app/server/lib/GristServer";
import { sendOkReply, stringParam } from "app/server/lib/requestUtils";

import { Application, json } from "express";

const CONFIG_KEY = "setup_requests";

/**
 * Validate an incoming request body into a SetupRequestSpec, throwing a 400 ApiError if
 * it is not acceptable. Features are deduplicated and an over-long reason is truncated.
 */
export function parseSetupRequestSpec(body: unknown): SetupRequestSpec {
  const { step, features, reason } = (body || {}) as {
    step?: unknown;
    features?: unknown;
    reason?: unknown;
  };
  if (!SETUP_STEP_IDS.includes(step as SetupStepId)) {
    throw new ApiError(`Invalid setup step: ${String(step)}`, 400);
  }
  if (!Array.isArray(features) ||
    !features.every(f => SETUP_FEATURE_IDS.includes(f as SetupFeatureId))) {
    throw new ApiError("Invalid setup features", 400);
  }
  if (reason !== undefined && typeof reason !== "string") {
    throw new ApiError("Invalid setup reason", 400);
  }
  const trimmedReason = reason?.trim().slice(0, MAX_SETUP_REASON_LENGTH);
  return {
    step: step as SetupStepId,
    features: [...new Set(features as SetupFeatureId[])],
    ...(trimmedReason ? { reason: trimmedReason } : {}),
  };
}

export function attachSetupRequestsEndpoints(
  app: Application,
  gristServer: GristServer,
) {
  const getStoredRequests = async (): Promise<SetupRequests | null> => {
    const result = await gristServer.getHomeDBManager().getInstallConfig(CONFIG_KEY);
    return result.status === 200 ? (result.data!.value as SetupRequests) : null;
  };

  // Record (or refresh) a request from the signed-in user, returning the updated
  // summary. The read-modify-write is concurrency-safe; see transformInstallConfig.
  app.post(
    "/api/setup-requests",
    json({ limit: "10kb" }),
    expressWrap(async (req, res) => {
      const mreq = req as RequestWithLogin;
      const userId = getAuthorizedUserId(req);
      const spec = parseSetupRequestSpec(req.body);
      // Requester identity from the resolved FullUser, so admins always have a name/email to
      // act on.
      const fullUser = mreq.fullUser;
      const requester = {
        email: fullUser?.email || fullUser?.loginEmail || "",
        ...(fullUser?.name ? { name: fullUser.name } : {}),
        at: new Date().toISOString(),
      };
      const result = await gristServer.getHomeDBManager().transformInstallConfig(
        CONFIG_KEY,
        { steps: {} },
        (value: ConfigValue) =>
          addSetupRequest(value as SetupRequests, userId, spec, requester),
      );
      const requests = result.current.value as SetupRequests;
      return sendOkReply(req, res, summarizeSetupRequests(requests, userId));
    }),
  );

  // What the signed-in user may see: per-step counts and their own participation.
  app.get(
    "/api/setup-requests",
    expressWrap(async (req, res) => {
      const userId = getAuthorizedUserId(req);
      return sendOkReply(req, res, summarizeSetupRequests(await getStoredRequests(), userId));
    }),
  );

  // Full detail, install admins only.
  app.get(
    "/api/admin/setup-requests",
    expressWrap(async (req, res) => {
      return sendOkReply(req, res, (await getStoredRequests()) ?? { steps: {} });
    }),
  );

  // Clear all requests for one step, install admins only. Returns the updated value so
  // the admin panel can refresh from the response rather than refetching.
  app.delete(
    "/api/admin/setup-requests/:step",
    expressWrap(async (req, res) => {
      const step = stringParam(req.params.step, "step", {
        allowed: SETUP_STEP_IDS,
      }) as SetupStepId;
      const result = await gristServer.getHomeDBManager().transformInstallConfig(
        CONFIG_KEY,
        { steps: {} },
        (value: ConfigValue) =>
          clearSetupRequestsStep(value as SetupRequests, step),
      );
      return sendOkReply(req, res, result.current.value as SetupRequests);
    }),
  );
}
