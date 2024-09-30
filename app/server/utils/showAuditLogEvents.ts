import {AuditEventDetails, AuditEventName, SiteAuditEventName} from 'app/common/AuditEvent';

interface Options {
  /**
   * The type of audit log events to show.
   *
   * Defaults to `"installation"`.
   */
  type?: AuditEventType;
}

type AuditEventType = 'installation' | 'site';

export function showAuditLogEvents({type = 'installation'}: Options) {
  showTitle(type);
  const events = getAuditEvents(type);
  showTableOfContents(events);
  showEvents(events);
}

function showTitle(type: AuditEventType) {
  if (type === 'installation') {
    console.log('# Installation audit log events {: .tag-core .tag-ee }\n');
  } else {
    console.log('# Site audit log events\n');
  }
}

function getAuditEvents(type: AuditEventType): [string, AuditEvent<AuditEventName>][] {
  if (type === 'installation') {
    return Object.entries(AuditEvents).filter(([name]) => AuditEventName.guard(name));
  } else {
    return Object.entries(AuditEvents).filter(([name]) => SiteAuditEventName.guard(name));
  }
}

function showTableOfContents(events: [string, AuditEvent<AuditEventName>][]) {
  for (const [name] of events) {
    console.log(` - [${name}](#${name.toLowerCase()})`);
  }
  console.log('');
}

function showEvents(events: [string, AuditEvent<AuditEventName>][]) {
  for (const [name, event] of events) {
    const {description, properties} = event;
    console.log(`## ${name}\n`);
    console.log(`${description}\n`);
    if (Object.keys(properties).length === 0) { continue; }

    console.log('### Properties\n');
    console.log('| Name | Type | Description |');
    console.log('| ---- | ---- | ----------- |');
    showEventProperties(properties);
    console.log('');
  }
}

function showEventProperties(
  properties: AuditEventProperties<object>,
  prefix = ''
) {
  for (const [key, {type, description, optional, ...rest}] of Object.entries(properties)) {
    const name = prefix + key + (optional ? ' *(optional)*' : '');
    const types = (Array.isArray(type) ? type : [type]).map(t => `\`${t}\``);
    console.log(`| ${name} | ${types.join(' or ')} | ${description} |`);
    if ('properties' in rest) {
      showEventProperties(rest.properties, prefix + `${name}.`);
    }
  }
}

type AuditEvents = {
  [Name in keyof AuditEventDetails]: Name extends AuditEventName
  ? AuditEvent<Name>
  : never
}

interface AuditEvent<Name extends AuditEventName> {
  description: string;
  properties: AuditEventProperties<AuditEventDetails[Name]>;
}

type AuditEventProperties<T> = {
  [K in keyof T]: T[K] extends object
  ? AuditEventProperty & {properties: AuditEventProperties<T[K]>}
  : AuditEventProperty
}

interface AuditEventProperty {
  type: string | string[];
  description: string;
  optional?: boolean;
}

const AuditEvents: AuditEvents = {
  createDocument: {
    description: 'A new document was created.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the document.',
      },
      name: {
        type: 'string',
        description: 'The name of the document.',
        optional: true,
      },
    },
  },
  sendToGoogleDrive: {
    description: 'A document was sent to Google Drive.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the document.',
      },
    },
  },
  renameDocument: {
    description: 'A document was renamed.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the document.',
      },
      previousName: {
        type: 'string',
        description: 'The previous name of the document.',
      },
      currentName: {
        type: 'string',
        description: 'The current name of the document.',
      },
    },
  },
  pinDocument: {
    description: 'A document was pinned.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the document.',
      },
      name: {
        type: 'string',
        description: 'The name of the document.',
      },
    },
  },
  unpinDocument: {
    description: 'A document was unpinned.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the document.',
      },
      name: {
        type: 'string',
        description: 'The name of the document.',
      },
    },
  },
  moveDocument: {
    description: 'A document was moved to a new workspace.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the document.',
      },
      previousWorkspace: {
        type: 'object',
        description: 'The workspace the document was moved from.',
        properties: {
          id: {
            type: 'number',
            description: 'The ID of the workspace.',
          },
          name: {
            type: 'string',
            description: 'The name of the workspace.',
          },
        },
      },
      newWorkspace: {
        type: 'object',
        description: 'The workspace the document was moved to.',
        properties: {
          id: {
            type: 'number',
            description: 'The ID of the workspace.',
          },
          name: {
            type: 'string',
            description: 'The name of the workspace.',
          },
        },
      },
    },
  },
  removeDocument: {
    description: 'A document was moved to the trash.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the document.',
      },
      name: {
        type: 'string',
        description: 'The name of the document.',
      },
    },
  },
  deleteDocument: {
    description: 'A document was permanently deleted.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the document.',
      },
      name: {
        type: 'string',
        description: 'The name of the document.',
      },
    },
  },
  restoreDocumentFromTrash: {
    description: 'A document was restored from the trash.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the document.',
      },
      name: {
        type: 'string',
        description: 'The name of the document.',
      },
      workspace: {
        type: 'object',
        description: 'The workspace of the document.',
        properties: {
          id: {
            type: 'number',
            description: 'The ID of the workspace.',
          },
          name: {
            type: 'string',
            description: 'The name of the workspace.',
          },
        },
      },
    },
  },
  changeDocumentAccess: {
    description: 'Access to a document was changed.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the document.',
      },
      access: {
        type: 'object',
        description: 'The access level of the document.',
        properties: {
          maxInheritedRole: {
            type: ['"owners"', '"editors"', '"viewers"', 'null'],
            description: 'The max inherited role.',
            optional: true,
          },
          users: {
            type: 'object',
            description: 'The access level by user ID.',
            optional: true,
          },
        },
      },
    },
  },
  openDocument: {
    description: 'A document was opened.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the document.',
      },
      name: {
        type: 'string',
        description: 'The name of the document.',
      },
      urlId: {
        type: 'string',
        description: 'The URL ID of the document.',
      },
      forkId: {
        type: 'string',
        description: 'The fork ID of the document, if the document is a fork.',
      },
      snapshotId: {
        type: 'string',
        description: 'The snapshot ID of the document, if the document is a snapshot.',
      },
    },
  },
  duplicateDocument: {
    description: 'A document was duplicated.',
    properties: {
      original: {
        type: 'object',
        description: 'The document that was duplicated.',
        properties: {
          id: {
            type: 'string',
            description: 'The ID of the document.',
          },
          name: {
            type: 'string',
            description: 'The name of the document.',
          },
          workspace: {
            type: 'object',
            description: 'The workspace of the document.',
            properties: {
              id: {
                type: 'number',
                description: 'The ID of the workspace',
              },
              name: {
                type: 'string',
                description: 'The name of the workspace.',
              },
            },
          },
        },
      },
      duplicate: {
        description: 'The newly-duplicated document.',
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The ID of the document.',
          },
          name: {
            type: 'string',
            description: 'The name of the document.',
          },
        },
      },
      asTemplate: {
        type: 'boolean',
        description: 'If the document was duplicated without any data.',
      },
    },
  },
  forkDocument: {
    description: 'A document was forked.',
    properties: {
      original: {
        type: 'object',
        description: 'The document that was forked.',
        properties: {
          id: {
            type: 'string',
            description: 'The ID of the document.',
          },
          name: {
            type: 'string',
            description: 'The name of the document.',
          },
        },
      },
      fork: {
        type: 'object',
        description: 'The newly-forked document.',
        properties: {
          id: {
            type: 'string',
            description: 'The ID of the fork.',
          },
          documentId: {
            type: 'string',
            description: 'The ID of the fork with the trunk ID.',
          },
          urlId: {
            type: 'string',
            description: 'The ID of the fork with the trunk URL ID.',
          },
        },
      },
    },
  },
  replaceDocument: {
    description: 'A document was replaced.',
    properties: {
      previous: {
        type: 'object',
        description: 'The document that was replaced.',
        properties: {
          id: {
            type: 'string',
            description: 'The ID of the document.',
          },
        },
      },
      current: {
        type: 'object',
        description: 'The newly-replaced document.',
        properties: {
          id: {
            type: 'string',
            description: 'The ID of the document.',
          },
          snapshotId: {
            type: 'string',
            description: 'The ID of the snapshot, if the document was replaced with one.',
          },
        },
      },
    },
  },
  reloadDocument: {
    description: 'A document was reloaded.',
    properties: {},
  },
  truncateDocumentHistory: {
    description: "A document's history was truncated.",
    properties: {
      keep: {
        type: 'number',
        description: 'The number of history items kept.',
      },
    },
  },
  deliverWebhookEvents: {
    description: 'A batch of webhook events was delivered.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the webhook.',
      },
      host: {
        type: 'string',
        description: 'The host the webhook events were delivered to.',
      },
      quantity: {
        type: 'number',
        description: 'The number of webhook events delivered.',
      },
    },
  },
  clearWebhookQueue: {
    description: 'A webhook queue was cleared.',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the webhook.',
      },
    },
  },
  clearAllWebhookQueues: {
    description: 'All webhook queues were cleared.',
    properties: {},
  },
  runSQLQuery: {
    description: 'A SQL query was run on a document.',
    properties: {
      query: {
        type: 'string',
        description: 'The SQL query.'
      },
      arguments: {
        type: 'Array<string | number>',
        description: 'The arguments used for query parameters, if any.',
        optional: true,
      },
      timeoutMs: {
        type: 'number',
        description: 'The query execution timeout duration in milliseconds.',
        optional: true,
      },
    },
  },
  createWorkspace: {
    description: 'A new workspace was created.',
    properties: {
      id: {
        type: 'number',
        description: 'The ID of the workspace.',
      },
      name: {
        type: 'string',
        description: 'The name of the workspace.',
      },
    },
  },
  renameWorkspace: {
    description: 'A workspace was renamed.',
    properties: {
      id: {
        type: 'number',
        description: 'The ID of the workspace.',
      },
      previousName: {
        type: 'string',
        description: 'The previous name of the workspace.',
      },
      currentName: {
        type: 'string',
        description: 'The current name of the workspace.',
      },
    },
  },
  removeWorkspace: {
    description: 'A workspace was moved to the trash.',
    properties: {
      id: {
        type: 'number',
        description: 'The ID of the workspace.',
      },
      name: {
        type: 'string',
        description: 'The name of the workspace.',
      },
    },
  },
  deleteWorkspace: {
    description: 'A workspace was permanently deleted.',
    properties: {
      id: {
        type: 'number',
        description: 'The ID of the workspace.',
      },
      name: {
        type: 'string',
        description: 'The name of the workspace.',
      },
    },
  },
  restoreWorkspaceFromTrash: {
    description: 'A workspace was restored from the trash.',
    properties: {
      id: {
        type: 'number',
        description: 'The ID of the workspace.',
      },
      name: {
        type: 'string',
        description: 'The name of the workspace.',
      },
    },
  },
  changeWorkspaceAccess: {
    description: 'Access to a workspace was changed.',
    properties: {
      id: {
        type: 'number',
        description: 'The ID of the workspace.',
      },
      access: {
        type: 'object',
        description: 'The access level of the workspace.',
        properties: {
          maxInheritedRole: {
            type: ['"owners"', '"editors"', '"viewers"', 'null'],
            description: 'The max inherited role.',
            optional: true,
          },
          users: {
            type: 'object',
            description: 'The access level by user ID.',
            optional: true,
          },
        },
      },
    },
  },
  createSite: {
    description: 'A new site was created.',
    properties: {
      id: {
        type: 'number',
        description: 'The ID of the site.',
      },
      name: {
        type: 'string',
        description: 'The name of the site.',
      },
      domain: {
        type: 'string',
        description: 'The domain of the site.',
      },
    },
  },
  renameSite: {
    description: 'A site was renamed.',
    properties: {
      id: {
        type: 'number',
        description: 'The ID of the site.',
      },
      previous: {
        type: 'object',
        description: 'The previous name and domain of the site.',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the site.',
          },
          domain: {
            type: 'string',
            description: 'The domain of the site.',
          },
        },
      },
      current: {
        type: 'object',
        description: 'The current name and domain of the site.',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the site.',
          },
          domain: {
            type: 'string',
            description: 'The domain of the site.',
          },
        },
      },
    },
  },
  changeSiteAccess: {
    description: 'Access to a site was changed.',
    properties: {
      id: {
        type: 'number',
        description: 'The ID of the site.',
      },
      access: {
        type: 'object',
        description: 'The access level of the site.',
        properties: {
          users: {
            type: 'object',
            description: 'The access level by user ID.',
            optional: true,
          },
        },
      },
    },
  },
  deleteSite: {
    description: 'A site was deleted.',
    properties: {
      id: {
        type: 'number',
        description: 'The ID of the site.',
      },
      name: {
        type: 'string',
        description: 'The name of the site.',
      },
    },
  },
  changeUserName: {
    description: 'The name of a user was changed.',
    properties: {
      previousName: {
        type: 'string',
        description: 'The previous name of the user.',
      },
      currentName: {
        type: 'string',
        description: 'The current name of the user.',
      },
    },
  },
  createUserAPIKey: {
    description: 'A user API key was created.',
    properties: {},
  },
  deleteUserAPIKey: {
    description: 'A user API key was deleted.',
    properties: {},
  },
  deleteUser: {
    description: 'A user was deleted.',
    properties: {},
  },
};
