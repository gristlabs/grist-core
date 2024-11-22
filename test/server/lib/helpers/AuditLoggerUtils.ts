import { AuditEvent } from "app/server/lib/AuditEvent";
import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import nock from "nock";
import { validate } from "uuid";

export function isCreateSiteEvent(event: AuditEvent) {
  return (
    validate(event.id) &&
    isNowish(event.timestamp) &&
    isEqual(omit(event, "id", "timestamp"), {
      action: "site.create",
      actor: { type: "unknown" },
      context: {},
      details: {
        site: {
          id: 42,
          name: "Grist Labs",
          domain: "gristlabs",
        },
      },
    })
  );
}

export function isCreateDocumentEvent(event: AuditEvent, orgId: number) {
  return (
    validate(event.id) &&
    isNowish(event.timestamp) &&
    isEqual(omit(event, "id", "timestamp"), {
      action: "document.create",
      actor: { type: "unknown" },
      context: {
        site: {
          id: orgId,
        },
      },
      details: {
        document: {
          id: "mRM8ydxxLkc6Ewo56jsDGx",
          name: "Project Lollipop",
        },
      },
    })
  );
}

export function isNowish(value: number | string | Date) {
  const nowMs = new Date().getTime();
  const differenceMs = nowMs - new Date(value).getTime();
  const deltaMs = 2 * 1_000;
  return differenceMs > 0 && differenceMs <= deltaMs;
}

export function ignoreConfigEvents() {
  // Ignore "config.*" audit events; some tests call the `/configs`
  // endpoint as part of setup, which triggers them.
  nock("https://audit.example.com")
    .persist()
    .post(
      /\/events\/.*/,
      (body) =>
        body.event?.action?.startsWith("config.") ||
        body.action?.startsWith("config.")
    )
    .reply(200);
}
