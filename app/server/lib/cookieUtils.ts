import { safeJsonParse } from "app/common/gutil";
import { getCookieDomain } from "app/server/lib/gristSessions";
import * as cookie from "cookie";
import * as express from "express";

interface SignupState {
  srcDocId?: string;
  assistantState?: string;
}

const SIGNUP_STATE_COOKIE_NAME = "gr_signup_state";

export function getAndClearSignupStateCookie(
  req: express.Request,
  res: express.Response
): SignupState | undefined {
  const cookies = cookie.parse(req.headers.cookie ?? "");
  const signupState = cookies[SIGNUP_STATE_COOKIE_NAME];
  if (!signupState) {
    return undefined;
  }

  clearSignupStateCookie(req, res);

  return safeJsonParse(signupState, {});
}

export function setSignupStateCookie(
  req: express.Request,
  res: express.Response,
  state: SignupState
) {
  res.cookie(
    SIGNUP_STATE_COOKIE_NAME,
    JSON.stringify(state),
    getSignupStateCookieOptions(req)
  );
}

function clearSignupStateCookie(req: express.Request, res: express.Response) {
  res.clearCookie(SIGNUP_STATE_COOKIE_NAME, getSignupStateCookieOptions(req));
}

function getSignupStateCookieOptions(
  req: express.Request
): express.CookieOptions {
  return {
    maxAge: 1000 * 60 * 60,
    httpOnly: true,
    path: "/",
    domain: getCookieDomain(req),
    sameSite: "lax",
  };
}
