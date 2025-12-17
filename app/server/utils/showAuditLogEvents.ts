import { AuditEventAction, AuditEventDetails } from "app/server/lib/AuditEvent";
import groupBy from "lodash/groupBy";

interface Options {
  type: AuditEventType;
}

type AuditEventType = "installation" | "site";

export function showAuditLogEvents({ type }: Options) {
  switch (type) {
    case "installation": {
      showInstallationEvents();
      break;
    }
    case "site": {
      showSiteEvents();
      break;
    }
  }
}

function showInstallationEvents() {
  console.log("---\ntitle: Audit log events\n---\n");
  console.log(
    "# Audit log events for your self-managed instance {: .tag-ee }"
  );
  const events = Object.entries(AuditEvents).filter(([, { type }]) => {
    const types = Array.isArray(type) ? type : [type];
    return types.includes("installation");
  });
  showEvents(events);
}

function showSiteEvents() {
  console.log("---\ntitle: Audit log events\n---\n");
  console.log("# Audit log events for your team site {: .tag-business .tag-ee }");
  console.log(
    `!!! note
    The events on this page appear in the audit log of a [team site]` +
      `(../teams.md). For events that appear in a [Self-Managed Grist instance]` +
      `(../self-managed.md), see ["Audit log events for your self-managed instance"]` +
      `(../install/audit-log-events.md).\n`
  );
  const events = Object.entries(AuditEvents).filter(([, { type }]) => {
    const types = Array.isArray(type) ? type : [type];
    return types.includes("site");
  });
  showEvents(events);
}

function showEvents(events: [string, AuditEvent<AuditEventAction>][]) {
  const eventsByCategory = groupBy(
    events,
    ([name]) => name.split(".")?.[0] ?? "other"
  );
  for (const [category, categoryEvents] of Object.entries(
    eventsByCategory
  ).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`\n## ${category}`);
    for (const [action, event] of categoryEvents.sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      const { description, properties, sample } = event;
      console.log(`\n### ${action}\n`);
      console.log(`${description}\n`);
      if (Object.keys(properties).length === 0) {
        continue;
      }

      console.log("#### Details\n");
      console.log("| Property | Type | Description |");
      console.log("| -------- | ---- | ----------- |");
      showEventProperties(properties);
      console.log("\n#### Sample\n");
      console.log("```json");
      console.log(JSON.stringify(sample, null, 2));
      console.log("```");
    }
  }
}

function showEventProperties(
  properties: AuditEventProperties<object>,
  prefix = ""
) {
  for (const [key, { type, description, optional, ...rest }] of Object.entries(
    properties
  )) {
    const name = prefix + key + (optional ? " *(optional)*" : "");
    const types = (Array.isArray(type) ? type : [type]).map((t) => `\`${t}\``);
    console.log(`| ${name} | ${types.join(" or ")} | ${description} |`);
    if ("properties" in rest) {
      showEventProperties(rest.properties, `${prefix + key}.`);
    }
  }
}

type AuditEvents = {
  [Action in keyof AuditEventDetails]: Action extends AuditEventAction
    ? AuditEvent<Action>
    : never;
};

interface AuditEvent<Action extends AuditEventAction> {
  type: AuditEventType | AuditEventType[];
  description: string;
  properties: AuditEventProperties<AuditEventDetails[Action]>;
  sample: AuditEventDetails[Action];
}

type AuditEventProperties<T> = {
  [K in keyof T]: T[K] extends (object & { length?: never }) | undefined
    ? AuditEventProperty & { properties: AuditEventProperties<T[K]> }
    : AuditEventProperty & { properties?: AuditEventProperties<T[K]> };
};

interface AuditEventProperty {
  type: string | string[];
  description: string;
  optional?: boolean;
}

const AuditEvents: AuditEvents = {
  "config.create": {
    type: ["installation", "site"],
    description: "A configuration item was created.",
    properties: {
      config: {
        type: "object",
        description: "The created configuration item.",
        properties: {
          id: {
            type: "number",
            description: "The configuration item ID.",
          },
          key: {
            type: "string",
            description: "The configuration item key.",
          },
          value: {
            type: "any",
            description: "The configuration item value.",
            properties: {} as any,
          },
          site: {
            type: "object",
            description: "The site this configuration item belongs to.",
            optional: true,
            properties: {
              id: {
                type: "number",
                description: "The site ID.",
              },
              name: {
                type: "string",
                description: "The site name.",
              },
              domain: {
                type: "string",
                description: "The site domain.",
              },
            },
          },
        },
      },
    },
    sample: {
      config: {
        id: 18,
        key: "audit_log_streaming_destinations",
        value: [
          {
            id: "ee6971af-80f5-4654-9bd2-5c6ab33e7ccf",
            name: "splunk",
            url: "https://hec.example.com:8088/services/collector/event",
            token: "Splunk B5A79AAD-D822-46CC-80D1-819F80D7BFB0",
          },
        ],
        site: {
          id: 42,
          name: "Grist Labs",
          domain: "gristlabs",
        },
      },
    },
  },
  "config.delete": {
    type: ["installation", "site"],
    description: "A configuration item was deleted.",
    properties: {
      config: {
        type: "object",
        description: "The deleted configuration item.",
        properties: {
          id: {
            type: "number",
            description: "The configuration item ID.",
          },
          key: {
            type: "string",
            description: "The configuration item key.",
          },
          value: {
            type: "any",
            description: "The configuration item value.",
            properties: {} as any,
          },
          site: {
            type: "object",
            description: "The site this configuration item belonged to.",
            optional: true,
            properties: {
              id: {
                type: "number",
                description: "The site ID.",
              },
              name: {
                type: "string",
                description: "The site name.",
              },
              domain: {
                type: "string",
                description: "The site domain.",
              },
            },
          },
        },
      },
    },
    sample: {
      config: {
        id: 18,
        key: "audit_log_streaming_destinations",
        value: [
          {
            id: "ee6971af-80f5-4654-9bd2-5c6ab33e7ccf",
            name: "splunk",
            url: "https://hec.example.com:8088/services/collector/event",
            token: "Splunk B5A79AAD-D822-46CC-80D1-819F80D7BFB0",
          },
        ],
        site: {
          id: 42,
          name: "Grist Labs",
          domain: "gristlabs",
        },
      },
    },
  },
  "config.update": {
    type: ["installation", "site"],
    description: "A configuration item was updated.",
    properties: {
      previous: {
        type: "object",
        description: "The previous versions of affected resources.",
        properties: {
          config: {
            type: "object",
            description: "The previous configuration item.",
            properties: {
              id: {
                type: "number",
                description: "The configuration item ID.",
              },
              key: {
                type: "string",
                description: "The configuration item key.",
              },
              value: {
                type: "any",
                description: "The configuration item value.",
                properties: {} as any,
              },
              site: {
                type: "object",
                description: "The site this configuration item belongs to.",
                optional: true,
                properties: {
                  id: {
                    type: "number",
                    description: "The site ID.",
                  },
                  name: {
                    type: "string",
                    description: "The site name.",
                  },
                  domain: {
                    type: "string",
                    description: "The site domain.",
                  },
                },
              },
            },
          },
        },
      },
      current: {
        type: "object",
        description: "The current versions of affected resources.",
        properties: {
          config: {
            type: "object",
            description: "The current configuration item.",
            properties: {
              id: {
                type: "number",
                description: "The configuration item ID.",
              },
              key: {
                type: "string",
                description: "The configuration item key.",
              },
              value: {
                type: "any",
                description: "The configuration item value.",
                properties: {} as any,
              },
              site: {
                type: "object",
                description: "The site this configuration item belongs to.",
                optional: true,
                properties: {
                  id: {
                    type: "number",
                    description: "The site ID.",
                  },
                  name: {
                    type: "string",
                    description: "The site name.",
                  },
                  domain: {
                    type: "string",
                    description: "The site domain.",
                  },
                },
              },
            },
          },
        },
      },
    },
    sample: {
      previous: {
        config: {
          id: 18,
          key: "audit_log_streaming_destinations",
          value: [
            {
              id: "ee6971af-80f5-4654-9bd2-5c6ab33e7ccf",
              name: "splunk",
              url: "https://hec.example.com:8088/services/collector/event",
              token: "Splunk B5A79AAD-D822-46CC-80D1-819F80D7BFB0",
            },
          ],
          site: {
            id: 42,
            name: "Grist Labs",
            domain: "gristlabs",
          },
        },
      },
      current: {
        config: {
          id: 18,
          key: "audit_log_streaming_destinations",
          value: [
            {
              id: "ee6971af-80f5-4654-9bd2-5c6ab33e7ccf",
              name: "splunk",
              url: "https://hec.example.com:8088/services/collector/event",
              token: "Splunk B5A79AAD-D822-46CC-80D1-819F80D7BFB0",
            },
            {
              id: "8f421760-14e9-4d11-b10a-f51d82041e0f",
              name: "other",
              url: "https://other.example.com/events",
            },
          ],
          site: {
            id: 42,
            name: "Grist Labs",
            domain: "gristlabs",
          },
        },
      },
    },
  },
  "document.change_access": {
    type: ["installation", "site"],
    description: "A document's access was changed.",
    properties: {
      document: {
        type: "object",
        description: "The document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
          name: {
            type: "string",
            description: "The document name.",
          },
        },
      },
      access_changes: {
        type: "object",
        description: "The access changes.",
        properties: {
          public_access: {
            type: ["string", "null"],
            description: "The new public access level.",
            optional: true,
          },
          max_inherited_access: {
            type: ["string", "null"],
            description:
              "The new maximum access level that can be inherited from the document's workspace or site.",
            optional: true,
          },
          users: {
            type: "Array<object>",
            description: "The new access levels of individual users.",
            optional: true,
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
        name: "Project Lollipop",
      },
      access_changes: {
        public_access: "viewers",
        max_inherited_access: null,
        users: [
          {
            id: 146,
            name: "Flapjack Toasty",
            email: "flapjack@example.com",
            access: "owners",
          },
        ],
      },
    },
  },
  "document.clear_all_webhook_queues": {
    type: ["installation", "site"],
    description: "A document's webhook queues were cleared.",
    properties: {
      document: {
        type: "object",
        description: "The created document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
      },
    },
  },
  "document.clear_webhook_queue": {
    type: ["installation", "site"],
    description: "A document's webhook queue was cleared.",
    properties: {
      document: {
        type: "object",
        description: "The document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
        },
      },
      webhook: {
        type: "object",
        description: "The webhook.",
        properties: {
          id: {
            type: "string",
            description: "The webhook ID.",
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
      },
      webhook: {
        id: "17f8328e-0523-41fe-89aa-ae180bebb26e",
      },
    },
  },
  "document.create": {
    type: ["installation", "site"],
    description: "A document was created.",
    properties: {
      document: {
        type: "object",
        description: "The created document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
          name: {
            type: "string",
            description: "The document name.",
          },
          workspace: {
            type: "object",
            description: "The document's workspace.",
            properties: {
              id: {
                type: "number",
                description: "The workspace ID.",
              },
              name: {
                type: "string",
                description: "The workspace name.",
              },
            },
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
        name: "Project Lollipop",
        workspace: {
          id: 97,
          name: "Secret Plans",
        },
      },
    },
  },
  "document.delete": {
    type: ["installation", "site"],
    description: "A document was permanently deleted.",
    properties: {
      document: {
        type: "object",
        description: "The deleted document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
          name: {
            type: "string",
            description: "The document name.",
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
        name: "Project Lollipop",
      },
    },
  },
  "document.deliver_webhook_events": {
    type: ["installation", "site"],
    description: "A document's webhook successfully delivered events.",
    properties: {
      document: {
        type: "object",
        description: "The document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
        },
      },
      webhook: {
        type: "object",
        description: "The webhook.",
        properties: {
          id: {
            type: "string",
            description: "The webhook ID.",
          },
          events: {
            type: "object",
            description: "The delivered webhook events.",
            properties: {
              delivered_to: {
                type: "string",
                description: "Where the webhook events were delivered to.",
              },
              quantity: {
                type: "number",
                description:
                  "The number of webhook events that were delivered.",
              },
            },
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
      },
      webhook: {
        id: "17f8328e-0523-41fe-89aa-ae180bebb26e",
        events: {
          delivered_to: "example.com",
          quantity: 3,
        },
      },
    },
  },
  "document.disable": {
    type: ["installation", "site"],
    description: "A document was disabled.",
    properties: {
      document: {
        type: "object",
        description: "The disabled document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
          name: {
            type: "string",
            description: "The document name.",
          },
          workspace: {
            type: "object",
            description: "The document's workspace.",
            properties: {
              id: {
                type: "number",
                description: "The workspace ID.",
              },
              name: {
                type: "string",
                description: "The workspace name.",
              },
            },
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
        name: "Project Lollipop",
        workspace: {
          id: 97,
          name: "Secret Plans",
        },
      },
    },
  },
  "document.duplicate": {
    type: ["installation", "site"],
    description: "A document was duplicated.",
    properties: {
      original: {
        type: "object",
        description: "The resources that were duplicated.",
        properties: {
          document: {
            type: "object",
            description: "The document that was duplicated.",
            properties: {
              id: {
                type: "string",
                description: "The document ID.",
              },
              name: {
                type: "string",
                description: "The document name.",
              },
            },
          },
        },
      },
      duplicate: {
        type: "object",
        description: "The newly-duplicated resources.",
        properties: {
          document: {
            type: "object",
            description: "The newly-duplicated document.",
            properties: {
              id: {
                type: "string",
                description: "The document ID.",
              },
              name: {
                type: "string",
                description: "The document name.",
              },
              workspace: {
                type: "object",
                description: "The document's workspace.",
                properties: {
                  id: {
                    type: "number",
                    description: "The workspace ID",
                  },
                },
              },
            },
          },
        },
      },
      options: {
        type: "object",
        description: "The options used to duplicate the document.",
        properties: {
          as_template: {
            type: "boolean",
            description: "Include the structure without any data.",
          },
        },
      },
    },
    sample: {
      original: {
        document: {
          id: "mRM8ydxxLkc6Ewo56jsDGx",
          name: "Project Lollipop",
        },
      },
      duplicate: {
        document: {
          id: "fFKKA6qjXJd9sNLhpw6iPn",
          name: "Project Lollipop V2",
          workspace: {
            id: 92,
          },
        },
      },
      options: {
        as_template: false,
      },
    },
  },
  "document.enable": {
    type: ["installation", "site"],
    description: "A disabled document was re-enabled.",
    properties: {
      document: {
        type: "object",
        description: "The enabled document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
          name: {
            type: "string",
            description: "The document name.",
          },
          workspace: {
            type: "object",
            description: "The document's workspace.",
            properties: {
              id: {
                type: "number",
                description: "The workspace ID.",
              },
              name: {
                type: "string",
                description: "The workspace name.",
              },
            },
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
        name: "Project Lollipop",
        workspace: {
          id: 97,
          name: "Secret Plans",
        },
      },
    },
  },
  "document.fork": {
    type: ["installation", "site"],
    description: "A document was forked.",
    properties: {
      document: {
        type: "object",
        description: "The document that was forked.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
          name: {
            type: "string",
            description: "The document name.",
          },
        },
      },
      fork: {
        type: "object",
        description: "The newly-forked document.",
        properties: {
          id: {
            type: "string",
            description: "The fork ID.",
          },
          document_id: {
            type: "string",
            description: "The document ID.",
          },
          url_id: {
            type: "string",
            description: "The URL ID.",
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
        name: "Project Lollipop",
      },
      fork: {
        id: "fGGyPYea1ueFiVW382uuAY",
        document_id: "mRM8ydxxLkc6Ewo56jsDGx~fGGyPYea1ueFiVW382uuAY~9",
        url_id: "mRM8ydxxLkc6~fGGyPYea1ueFiVW382uuAY~9",
      },
    },
  },
  "document.modify": {
    type: ["installation", "site"],
    description: "A document was modified.",
    properties: {
      action: {
        type: "object",
        description: "The action.",
        properties: {
          num: {
            type: "number",
            description: "The action number.",
          },
          hash: {
            type: ["string", "null"],
            description: "The action hash.",
          },
        },
      },
      document: {
        type: "object",
        description: "The document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
        },
      },
    },
    sample: {
      action: {
        num: 7,
        hash: "825f859cf9628d9df90c1b25e31c723bb1c05c061cab6d1d9ccfea340e68d638",
      },
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
      },
    },
  },
  "document.move": {
    type: ["installation", "site"],
    description: "A document was moved to a different workspace.",
    properties: {
      previous: {
        type: "object",
        description: "The previous versions of affected resources.",
        properties: {
          document: {
            type: "object",
            description: "The previous document.",
            properties: {
              id: {
                type: "string",
                description: "The document ID.",
              },
              name: {
                type: "string",
                description: "The document name.",
              },
              workspace: {
                type: "object",
                description: "The document's workspace.",
                properties: {
                  id: {
                    type: "number",
                    description: "The workspace ID.",
                  },
                  name: {
                    type: "string",
                    description: "The workspace name.",
                  },
                },
              },
            },
          },
        },
      },
      current: {
        type: "object",
        description: "The current versions of affected resources.",
        properties: {
          document: {
            type: "object",
            description: "The current document.",
            properties: {
              id: {
                type: "string",
                description: "The document ID.",
              },
              name: {
                type: "string",
                description: "The document name.",
              },
              workspace: {
                type: "object",
                description: "The document's workspace.",
                properties: {
                  id: {
                    type: "number",
                    description: "The workspace ID.",
                  },
                  name: {
                    type: "string",
                    description: "The workspace name.",
                  },
                },
              },
            },
          },
        },
      },
    },
    sample: {
      previous: {
        document: {
          id: "mRM8ydxxLkc6Ewo56jsDGx",
          name: "Project Lollipop",
          workspace: {
            id: 97,
            name: "Secret Plans",
          },
        },
      },
      current: {
        document: {
          id: "mRM8ydxxLkc6Ewo56jsDGx",
          name: "Project Lollipop",
          workspace: {
            id: 98,
            name: "Not So Secret Plans",
          },
        },
      },
    },
  },
  "document.move_to_trash": {
    type: ["installation", "site"],
    description: "A document was moved to the trash.",
    properties: {
      document: {
        type: "object",
        description: "The removed document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
          name: {
            type: "string",
            description: "The document name.",
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
        name: "Project Lollipop",
      },
    },
  },
  "document.open": {
    type: ["installation", "site"],
    description: "A document was opened.",
    properties: {
      document: {
        type: "object",
        description: "The opened document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
          name: {
            type: "string",
            description: "The document name.",
          },
          url_id: {
            type: "string",
            description: "The URL ID.",
          },
          fork_id: {
            type: "string",
            description: "The fork ID.",
            optional: true,
          },
          snapshot_id: {
            type: "string",
            description: "The snapshot ID.",
            optional: true,
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
        name: "Project Lollipop",
        url_id: "mRM8ydxxLkc6~fGGyPYea1ueFiVW382uuAY~9",
        fork_id: "fGGyPYea1ueFiVW382uuAY",
      },
    },
  },
  "document.pin": {
    type: ["installation", "site"],
    description: "A document was pinned.",
    properties: {
      document: {
        type: "object",
        description: "The pinned document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
          name: {
            type: "string",
            description: "The document name.",
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
        name: "Project Lollipop",
      },
    },
  },
  "document.reload": {
    type: ["installation", "site"],
    description: "A document was reloaded.",
    properties: {
      document: {
        type: "object",
        description: "The reloaded document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
      },
    },
  },
  "document.rename": {
    type: ["installation", "site"],
    description: "A document was renamed.",
    properties: {
      previous: {
        type: "object",
        description: "The previous versions of affected resources.",
        properties: {
          document: {
            type: "object",
            description: "The previous document.",
            properties: {
              id: {
                type: "number",
                description: "The document ID.",
              },
              name: {
                type: "string",
                description: "The document name.",
              },
            },
          },
        },
      },
      current: {
        type: "object",
        description: "The current versions of affected resources.",
        properties: {
          document: {
            type: "object",
            description: "The current document.",
            properties: {
              id: {
                type: "number",
                description: "The document ID.",
              },
              name: {
                type: "string",
                description: "The document name.",
              },
            },
          },
        },
      },
    },
    sample: {
      previous: {
        document: {
          id: "mRM8ydxxLkc6Ewo56jsDGx",
          name: "Project Lollipop",
        },
      },
      current: {
        document: {
          id: "mRM8ydxxLkc6Ewo56jsDGx",
          name: "Competitive Analysis",
        },
      },
    },
  },
  "document.replace": {
    type: ["installation", "site"],
    description: "A document was replaced.",
    properties: {
      document: {
        type: "object",
        description: "The document that was replaced.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
        },
      },
      fork: {
        type: "object",
        description: "The fork that the document was replaced with.",
        optional: true,
        properties: {
          document_id: {
            type: "string",
            description: "The document ID.",
          },
        },
      },
      snapshot: {
        type: "object",
        description: "The snapshot that the document was replaced with.",
        optional: true,
        properties: {
          id: {
            type: "string",
            description: "The snapshot ID.",
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
      },
      fork: {
        document_id: "mRM8ydxxLkc6Ewo56jsDGx~fGGyPYea1ueFiVW382uuAY~9",
      },
    },
  },
  "document.restore_from_trash": {
    type: ["installation", "site"],
    description: "A document was restored from the trash.",
    properties: {
      document: {
        type: "object",
        description: "The restored document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
          name: {
            type: "string",
            description: "The document name.",
          },
          workspace: {
            type: "object",
            description: "The document's workspace.",
            properties: {
              id: {
                type: "number",
                description: "The workspace ID.",
              },
              name: {
                type: "string",
                description: "The workspace name.",
              },
            },
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
        name: "Project Lollipop",
        workspace: {
          id: 97,
          name: "Secret Plans",
        },
      },
    },
  },
  "document.run_sql_query": {
    type: ["installation", "site"],
    description: "A SQL query was run against a document.",
    properties: {
      document: {
        type: "object",
        description: "The queried document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
        },
      },
      sql_query: {
        type: "object",
        description: "The SQL query.",
        properties: {
          statement: {
            type: "string",
            description: "The SQL statement.",
          },
          arguments: {
            type: "Array<string | number>",
            description:
              "The arguments passed to parameters in the SQL statement.",
            optional: true,
          },
        },
      },
      options: {
        type: "object",
        description: "The options used to query the document.",
        properties: {
          timeout_ms: {
            type: "number",
            description:
              "Timeout in milliseconds after which operations on the document will be interrupted.",
            optional: true,
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
      },
      sql_query: {
        statement: "SELECT * FROM Pets WHERE popularity >= ?",
        arguments: [50],
      },
      options: {
        timeout_ms: 500,
      },
    },
  },
  "document.send_to_google_drive": {
    type: ["installation", "site"],
    description: "A document was sent to Google Drive.",
    properties: {
      document: {
        type: "object",
        description: "The sent document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
      },
    },
  },
  "document.truncate_history": {
    type: ["installation", "site"],
    description: "A document's history was truncated.",
    properties: {
      document: {
        type: "object",
        description: "The document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
        },
      },
      options: {
        type: "object",
        description: "The options used to truncate the document's history.",
        properties: {
          keep_n_most_recent: {
            type: "number",
            description: "The number of recent history actions to keep.",
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
      },
      options: {
        keep_n_most_recent: 3,
      },
    },
  },
  "document.unpin": {
    type: ["installation", "site"],
    description: "A document was unpinned.",
    properties: {
      document: {
        type: "object",
        description: "The unpinned document.",
        properties: {
          id: {
            type: "string",
            description: "The document ID.",
          },
          name: {
            type: "string",
            description: "The document name.",
          },
        },
      },
    },
    sample: {
      document: {
        id: "mRM8ydxxLkc6Ewo56jsDGx",
        name: "Project Lollipop",
      },
    },
  },
  "site.change_access": {
    type: ["installation", "site"],
    description: "A site's access was changed.",
    properties: {
      site: {
        type: "object",
        description: "The site.",
        properties: {
          id: {
            type: "number",
            description: "The site ID.",
          },
          name: {
            type: "string",
            description: "The site name.",
          },
          domain: {
            type: "string",
            description: "The site domain.",
          },
        },
      },
      access_changes: {
        type: "object",
        description: "The access changes.",
        properties: {
          users: {
            type: "Array<object>",
            description: "The new access levels of individual users.",
          },
        },
      },
    },
    sample: {
      site: {
        id: 42,
        name: "Grist Labs",
        domain: "gristlabs",
      },
      access_changes: {
        users: [
          {
            id: 146,
            name: "Flapjack Toasty",
            email: "flapjack@example.com",
            access: "owners",
          },
        ],
      },
    },
  },
  "site.create": {
    type: ["installation"],
    description: "A site was created.",
    properties: {
      site: {
        type: "object",
        description: "The created site.",
        properties: {
          id: {
            type: "number",
            description: "The site ID.",
          },
          name: {
            type: "string",
            description: "The site name.",
          },
          domain: {
            type: "string",
            description: "The site domain.",
          },
        },
      },
    },
    sample: {
      site: {
        id: 42,
        name: "Grist Labs",
        domain: "gristlabs",
      },
    },
  },
  "site.delete": {
    type: ["installation"],
    description: "A site was permanently deleted.",
    properties: {
      site: {
        type: "object",
        description: "The deleted site.",
        properties: {
          id: {
            type: "number",
            description: "The site ID.",
          },
          name: {
            type: "string",
            description: "The site name.",
          },
          domain: {
            type: "string",
            description: "The site domain.",
          },
        },
      },
    },
    sample: {
      site: {
        id: 42,
        name: "Grist Labs",
        domain: "gristlabs",
      },
    },
  },
  "site.rename": {
    type: ["installation", "site"],
    description: "A site was renamed.",
    properties: {
      previous: {
        type: "object",
        description: "The previous versions of affected resources.",
        properties: {
          site: {
            type: "object",
            description: "The previous site.",
            properties: {
              id: {
                type: "number",
                description: "The site ID.",
              },
              name: {
                type: "string",
                description: "The site name.",
              },
              domain: {
                type: "string",
                description: "The site domain.",
              },
            },
          },
        },
      },
      current: {
        type: "object",
        description: "The current versions of affected resources.",
        properties: {
          site: {
            type: "object",
            description: "The current site.",
            properties: {
              id: {
                type: "number",
                description: "The site ID.",
              },
              name: {
                type: "string",
                description: "The site name.",
              },
              domain: {
                type: "string",
                description: "The site domain.",
              },
            },
          },
        },
      },
    },
    sample: {
      previous: {
        site: {
          id: 42,
          name: "Grist Labs",
          domain: "gristlabs",
        },
      },
      current: {
        site: {
          id: 42,
          name: "ACME Unlimited",
          domain: "acme",
        },
      },
    },
  },
  "user.change_name": {
    type: ["installation"],
    description: "A user's name was changed.",
    properties: {
      previous: {
        type: "object",
        description: "The previous versions of affected resources.",
        properties: {
          user: {
            type: "object",
            description: "The previous user.",
            properties: {
              id: {
                type: "number",
                description: "The user ID.",
              },
              name: {
                type: "string",
                description: "The user's name.",
              },
              email: {
                type: "string",
                description: "The user's email.",
                optional: true,
              },
            },
          },
        },
      },
      current: {
        type: "object",
        description: "The current versions of affected resources.",
        properties: {
          user: {
            type: "object",
            description: "The current user.",
            properties: {
              id: {
                type: "number",
                description: "The user ID.",
              },
              name: {
                type: "string",
                description: "The user's name.",
              },
              email: {
                type: "string",
                description: "The user's email.",
                optional: true,
              },
            },
          },
        },
      },
    },
    sample: {
      previous: {
        user: {
          id: 146,
          name: "Flapjack Waffleflap",
          email: "flapjack@example.com",
        },
      },
      current: {
        user: {
          id: 146,
          name: "Flapjack Toasty",
          email: "flapjack@example.com",
        },
      },
    },
  },
  "user.create_api_key": {
    type: ["installation"],
    description: "A user API key was created.",
    properties: {
      user: {
        type: "object",
        description: "The user.",
        properties: {
          id: {
            type: "number",
            description: "The user ID.",
          },
          name: {
            type: "string",
            description: "The user's name.",
          },
          email: {
            type: "string",
            description: "The user's email.",
            optional: true,
          },
        },
      },
    },
    sample: {
      user: {
        id: 146,
        name: "Flapjack Waffleflap",
        email: "flapjack@example.com",
      },
    },
  },
  "user.delete": {
    type: ["installation"],
    description: "A user was permanently deleted.",
    properties: {
      user: {
        type: "object",
        description: "The user.",
        properties: {
          id: {
            type: "number",
            description: "The user ID.",
          },
          name: {
            type: "string",
            description: "The user's name.",
          },
          email: {
            type: "string",
            description: "The user's email.",
            optional: true,
          },
        },
      },
    },
    sample: {
      user: {
        id: 146,
        name: "Flapjack Waffleflap",
        email: "flapjack@example.com",
      },
    },
  },
  "user.delete_api_key": {
    type: ["installation"],
    description: "A user API key was deleted.",
    properties: {
      user: {
        type: "object",
        description: "The user.",
        properties: {
          id: {
            type: "number",
            description: "The user ID.",
          },
          name: {
            type: "string",
            description: "The user's name.",
          },
          email: {
            type: "string",
            description: "The user's email.",
            optional: true,
          },
        },
      },
    },
    sample: {
      user: {
        id: 146,
        name: "Flapjack Waffleflap",
        email: "flapjack@example.com",
      },
    },
  },
  "workspace.change_access": {
    type: ["installation", "site"],
    description: "A workspace's access was changed.",
    properties: {
      workspace: {
        type: "object",
        description: "The workspace.",
        properties: {
          id: {
            type: "number",
            description: "The workspace ID.",
          },
          name: {
            type: "string",
            description: "The workspace name.",
          },
        },
      },
      access_changes: {
        type: "object",
        description: "The access changes.",
        properties: {
          max_inherited_access: {
            type: ["string", "null"],
            description:
              "The new maximum access level that can be inherited from the workspace's site.",
            optional: true,
          },
          users: {
            type: "Array<object>",
            description: "The new access levels of individual users.",
            optional: true,
          },
        },
      },
    },
    sample: {
      workspace: {
        id: 97,
        name: "Secret Plans",
      },
      access_changes: {
        max_inherited_access: "editors",
        users: [
          {
            id: 146,
            name: "Flapjack Toasty",
            email: "flapjack@example.com",
            access: "editors",
          },
        ],
      },
    },
  },
  "workspace.create": {
    type: ["installation", "site"],
    description: "A workspace was created.",
    properties: {
      workspace: {
        type: "object",
        description: "The created workspace.",
        properties: {
          id: {
            type: "number",
            description: "The workspace ID.",
          },
          name: {
            type: "string",
            description: "The workspace name.",
          },
        },
      },
    },
    sample: {
      workspace: {
        id: 97,
        name: "Secret Plans",
      },
    },
  },
  "workspace.delete": {
    type: ["installation", "site"],
    description: "A workspace was permanently deleted.",
    properties: {
      workspace: {
        type: "object",
        description: "The deleted workspace.",
        properties: {
          id: {
            type: "number",
            description: "The workspace ID.",
          },
          name: {
            type: "string",
            description: "The workspace name.",
          },
        },
      },
    },
    sample: {
      workspace: {
        id: 97,
        name: "Secret Plans",
      },
    },
  },
  "workspace.move_to_trash": {
    type: ["installation", "site"],
    description: "A workspace was moved to the trash.",
    properties: {
      workspace: {
        type: "object",
        description: "The removed workspace.",
        properties: {
          id: {
            type: "number",
            description: "The workspace ID.",
          },
          name: {
            type: "string",
            description: "The workspace name.",
          },
        },
      },
    },
    sample: {
      workspace: {
        id: 97,
        name: "Secret Plans",
      },
    },
  },
  "workspace.rename": {
    type: ["installation", "site"],
    description: "A workspace was renamed.",
    properties: {
      previous: {
        type: "object",
        description: "The previous versions of affected resources.",
        properties: {
          workspace: {
            type: "object",
            description: "The previous workspace.",
            properties: {
              id: {
                type: "number",
                description: "The workspace ID.",
              },
              name: {
                type: "string",
                description: "The workspace name.",
              },
            },
          },
        },
      },
      current: {
        type: "object",
        description: "The current versions of affected resources.",
        properties: {
          workspace: {
            type: "object",
            description: "The current workspace.",
            properties: {
              id: {
                type: "number",
                description: "The workspace ID.",
              },
              name: {
                type: "string",
                description: "The workspace name.",
              },
            },
          },
        },
      },
    },
    sample: {
      previous: {
        workspace: {
          id: 97,
          name: "Secret Plans",
        },
      },
      current: {
        workspace: {
          id: 97,
          name: "Retreat Docs",
        },
      },
    },
  },
  "workspace.restore_from_trash": {
    type: ["installation", "site"],
    description: "A workspace was restored from the trash.",
    properties: {
      workspace: {
        type: "object",
        description: "The restored workspace.",
        properties: {
          id: {
            type: "number",
            description: "The workspace ID.",
          },
          name: {
            type: "string",
            description: "The workspace name.",
          },
        },
      },
    },
    sample: {
      workspace: {
        id: 97,
        name: "Secret Plans",
      },
    },
  },
};
