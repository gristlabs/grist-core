import {StringUnion} from 'app/common/StringUnion';
import pickBy = require('lodash/pickBy');

/**
 * Telemetry levels, in increasing order of data collected.
 */
export enum Level {
  off = 0,
  limited = 1,
  full = 2,
}

/**
 * A set of contracts that all telemetry events must follow prior to being
 * logged.
 *
 * Currently, this includes meeting minimum telemetry levels for events
 * and their metadata, and passing in the correct data type for the value of
 * each metadata property.
 *
 * The `minimumTelemetryLevel` defined at the event level will also be applied
 * to all metadata properties of an event, and can be overridden at the metadata
 * level.
 */
export const TelemetryContracts: TelemetryContracts = {
  /**
   * Triggered when an HTTP request with an API key is made.
   */
  apiUsage: {
    minimumTelemetryLevel: Level.full,
    metadataContracts: {
      /**
       * The HTTP request method (e.g. GET, POST, PUT).
       */
      method: {
        dataType: 'string',
      },
      /**
       * The id of the user that triggered this event.
       */
      userId: {
        dataType: 'number',
      },
      /**
       * The User-Agent HTTP request header.
       */
      userAgent: {
        dataType: 'string',
      },
    },
  },
  /**
   * Triggered when HelpScout Beacon is opened.
   */
  beaconOpen: {
    minimumTelemetryLevel: Level.full,
    metadataContracts: {
      /**
       * The id of the user that triggered this event.
       */
      userId: {
        dataType: 'number',
      },
      /**
       * A random, session-based identifier for the user that triggered this event.
       */
      altSessionId: {
        dataType: 'string',
      },
    },
  },
  /**
   * Triggered when an article is opened in HelpScout Beacon.
   */
  beaconArticleViewed: {
    minimumTelemetryLevel: Level.full,
    metadataContracts: {
      /**
       * The id of the article.
       */
      articleId: {
        dataType: 'string',
      },
      /**
       * The id of the user that triggered this event.
       */
      userId: {
        dataType: 'number',
      },
      /**
       * A random, session-based identifier for the user that triggered this event.
       */
      altSessionId: {
        dataType: 'string',
      },
    },
  },
  /**
   * Triggered when an email is sent in HelpScout Beacon.
   */
  beaconEmailSent: {
    minimumTelemetryLevel: Level.full,
    metadataContracts: {
      /**
       * The id of the user that triggered this event.
       */
      userId: {
        dataType: 'number',
      },
      /**
       * A random, session-based identifier for the user that triggered this event.
       */
      altSessionId: {
        dataType: 'string',
      },
    },
  },
  /**
   * Triggered when a search is made in HelpScout Beacon.
   */
  beaconSearch: {
    minimumTelemetryLevel: Level.full,
    metadataContracts: {
      /**
       * The search query.
       */
      searchQuery: {
        dataType: 'string',
      },
      /**
       * The id of the user that triggered this event.
       */
      userId: {
        dataType: 'number',
      },
      /**
       * A random, session-based identifier for the user that triggered this event.
       */
      altSessionId: {
        dataType: 'string',
      },
    },
  },
  /**
   * Triggered when a document is forked.
   */
  documentForked: {
    minimumTelemetryLevel: Level.limited,
    metadataContracts: {
      /**
       * A hash of the doc id.
       */
      docIdDigest: {
        dataType: 'string',
      },
      /**
       * The id of the site containing the forked document.
       */
      siteId: {
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * The type of the site.
       */
      siteType: {
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * A random, session-based identifier for the user that triggered this event.
       */
      altSessionId: {
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * The id of the user that triggered this event.
       */
      userId: {
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * A hash of the fork id.
       */
      forkIdDigest: {
        dataType: 'string',
      },
      /**
       * A hash of the full id of the fork, including the trunk id and fork id.
       */
      forkDocIdDigest: {
        dataType: 'string',
      },
      /**
       * A hash of the trunk id.
       */
      trunkIdDigest: {
        dataType: 'string',
      },
      /**
       * Whether the trunk is a template.
       */
      isTemplate: {
        dataType: 'boolean',
      },
      /**
       * Timestamp of the last update to the trunk document.
       */
      lastActivity: {
        dataType: 'date',
      },
    },
  },
  /**
   * Triggered when a public document or template is opened.
   */
  documentOpened: {
    minimumTelemetryLevel: Level.limited,
    metadataContracts: {
      /**
       * A hash of the doc id.
       */
      docIdDigest: {
        dataType: 'string',
      },
      /**
       * The site id.
       */
      siteId: {
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * The site type.
       */
      siteType: {
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * The id of the user that triggered this event.
       */
      userId: {
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * A random, session-based identifier for the user that triggered this event.
       */
      altSessionId: {
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * The document access level of the user that triggered this event.
       */
      access: {
        dataType: 'boolean',
      },
      /**
       * Whether the document is public.
       */
      isPublic: {
        dataType: 'boolean',
      },
      /**
       * Whether a snapshot was opened.
       */
      isSnapshot: {
        dataType: 'boolean',
      },
      /**
       * Whether the document is a template.
       */
      isTemplate: {
        dataType: 'boolean',
      },
      /**
       * Timestamp of when the document was last updated.
       */
      lastUpdated: {
        dataType: 'date',
      },
    },
  },
  /**
   * Triggered on doc open and close, as well as hourly while a document is open.
   */
  documentUsage: {
    minimumTelemetryLevel: Level.limited,
    metadataContracts: {
      /**
       * A hash of the doc id.
       */
      docIdDigest: {
        dataType: 'string',
      },
      /**
       * The site id.
       */
      siteId: {
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * The site type.
       */
      siteType: {
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * A random, session-based identifier for the user that triggered this event.
       */
      altSessionId: {
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * The id of the user that triggered this event.
       */
      userId: {
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * What caused this event to trigger.
       *
       * May be either "docOpen", "interval", or "docClose".
       */
      triggeredBy: {
        dataType: 'string',
      },
      /**
       * Whether the document is public.
       */
      isPublic: {
        dataType: 'boolean',
      },
      /**
       * The number of rows in the document.
       */
      rowCount: {
        dataType: 'number',
      },
      /**
       * The total size of all data in the document, excluding attachments.
       */
      dataSizeBytes: {
        dataType: 'number',
      },
      /**
       * The total size of all attachments in the document.
       */
      attachmentsSize: {
        dataType: 'number',
      },
      /**
       * The number of access rules in the document.
       */
      numAccessRules: {
        dataType: 'number',
      },
      /**
       * The number of user attributes in the document.
       */
      numUserAttributes: {
        dataType: 'number',
      },
      /**
       * The number of attachments in the document.
       */
      numAttachments: {
        dataType: 'number',
      },
      /**
       * A list of unique file extensions compiled from all of the document's attachments.
       */
      attachmentTypes: {
        dataType: 'string[]',
      },
      /**
       * The number of charts in the document.
       */
      numCharts: {
        dataType: 'number',
      },
      /**
       * A list of chart types of every chart in the document.
       */
      chartTypes: {
        dataType: 'string[]',
      },
      /**
       * The number of linked charts in the document.
       */
      numLinkedCharts: {
        dataType: 'number',
      },
      /**
       * The number of linked widgets in the document.
       */
      numLinkedWidgets: {
        dataType: 'number',
      },
      /**
       * The number of columns in the document.
       */
      numColumns: {
        dataType: 'number',
      },
      /**
       * The number of columns with conditional formatting in the document.
       */
      numColumnsWithConditionalFormatting: {
        dataType: 'number',
      },
      /**
       * The number of formula columns in the document.
       */
      numFormulaColumns: {
        dataType: 'number',
      },
      /**
       * The number of trigger formula columns in the document.
       */
      numTriggerFormulaColumns: {
        dataType: 'number',
      },
      /**
       * The number of summary formula columns in the document.
       */
      numSummaryFormulaColumns: {
        dataType: 'number',
      },
      /**
       * The number of fields with conditional formatting in the document.
       */
      numFieldsWithConditionalFormatting: {
        dataType: 'number',
      },
      /**
       * The number of tables in the document.
       */
      numTables: {
        dataType: 'number',
      },
      /**
       * The number of on-demand tables in the document.
       */
      numOnDemandTables: {
        dataType: 'number',
      },
      /**
       * The number of tables with conditional formatting in the document.
       */
      numTablesWithConditionalFormatting: {
        dataType: 'number',
      },
      /**
       * The number of summary tables in the document.
       */
      numSummaryTables: {
        dataType: 'number',
      },
      /**
       * The number of custom widgets in the document.
       */
      numCustomWidgets: {
        dataType: 'number',
      },
      /**
       * A list of plugin ids for every custom widget in the document.
       *
       * The ids of widgets not created by Grist Labs are replaced with "externalId".
       */
      customWidgetIds: {
        dataType: 'string[]',
      },
    },
  },
  /**
   * Triggered every 5 seconds.
   */
  processMonitor: {
    minimumTelemetryLevel: Level.full,
    metadataContracts: {
      /** Size of JS heap in use, in MiB. */
      heapUsedMB: {
        dataType: 'number',
      },
      /** Total heap size, in MiB, allocated for JS by V8. */
      heapTotalMB: {
        dataType: 'number',
      },
      /** Fraction (typically between 0 and 1) of CPU usage. Includes all threads, so may exceed 1. */
      cpuAverage: {
        dataType: 'number',
      },
      /** Interval (in milliseconds) over which `cpuAverage` is reported. */
      intervalMs: {
        dataType: 'number',
      },
    },
  },
  /**
   * Triggered when sending webhooks.
   */
  sendingWebhooks: {
    minimumTelemetryLevel: Level.limited,
    metadataContracts: {
      /**
       * The number of events in the batch of webhooks being sent.
       */
      numEvents: {
        dataType: 'number',
      },
      /**
       * A hash of the doc id.
       */
      docIdDigest: {
        dataType: 'string',
      },
      /**
       * The site id.
       */
      siteId: {
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * The site type.
       */
      siteType: {
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * A random, session-based identifier for the user that triggered this event.
       */
      altSessionId: {
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * The id of the user that triggered this event.
       */
      userId: {
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
    },
  },
  /**
   * Triggered after a user successfully verifies their account during sign-up.
   *
   * Not triggered in grist-core.
   */
  signupVerified: {
    minimumTelemetryLevel: Level.full,
    metadataContracts: {
      /**
       * Whether the user viewed any templates before signing up.
       */
      isAnonymousTemplateSignup: {
        dataType: 'boolean',
      },
      /**
       * The doc id of the template the user last viewed before signing up, if any.
       */
      templateId: {
        dataType: 'string',
      },
    },
  },
  /**
   * Triggered daily.
   */
  siteMembership: {
    minimumTelemetryLevel: Level.limited,
    metadataContracts: {
      /**
       * The site id.
       */
      siteId: {
        dataType: 'number',
      },
      /**
       * The site type.
       */
      siteType: {
        dataType: 'string',
      },
      /**
       * The number of users with an owner role in this site.
       */
      numOwners: {
        dataType: 'number',
      },
      /**
       * The number of users with an editor role in this site.
       */
      numEditors: {
        dataType: 'number',
      },
      /**
       * The number of users with a viewer role in this site.
       */
      numViewers: {
        dataType: 'number',
      },
    },
  },
  /**
   * Triggered daily.
   */
  siteUsage: {
    minimumTelemetryLevel: Level.limited,
    metadataContracts: {
      /**
       * The site id.
       */
      siteId: {
        dataType: 'number',
      },
      /**
       * The site type.
       */
      siteType: {
        dataType: 'string',
      },
      /**
       * Whether the site's subscription is in good standing.
       */
      inGoodStanding: {
        dataType: 'boolean',
      },
      /**
       * The Stripe Plan id associated with this site.
       */
      stripePlanId: {
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * The number of docs in this site.
       */
      numDocs: {
        dataType: 'number',
      },
      /**
       * The number of workspaces in this site.
       */
      numWorkspaces: {
        dataType: 'number',
      },
      /**
       * The number of site members.
       */
      numMembers: {
        dataType: 'number',
      },
      /**
       * A timestamp of the most recent update made to a site document.
       */
      lastActivity: {
        dataType: 'date',
      },
    },
  },
  /**
   * Triggered on changes to tutorial progress.
   */
  tutorialProgressChanged: {
    minimumTelemetryLevel: Level.full,
    metadataContracts: {
      /**
       * A hash of the tutorial fork id.
       */
      tutorialForkIdDigest: {
        dataType: 'string',
      },
      /**
       * A hash of the tutorial trunk id.
       */
      tutorialTrunkIdDigest: {
        dataType: 'string',
      },
      /**
       * The 0-based index of the last tutorial slide the user had open.
       */
      lastSlideIndex: {
        dataType: 'number',
      },
      /**
       * The total number of slides in the tutorial.
       */
      numSlides: {
        dataType: 'number',
      },
      /**
       * Percentage of tutorial completion.
       */
      percentComplete: {
        dataType: 'number',
      },
    },
  },
  /**
   * Triggered when a tutorial is restarted.
   */
  tutorialRestarted: {
    minimumTelemetryLevel: Level.full,
    metadataContracts: {
      /**
       * A hash of the tutorial fork id.
       */
      tutorialForkIdDigest: {
        dataType: 'string',
      },
      /**
       * A hash of the tutorial trunk id.
       */
      tutorialTrunkIdDigest: {
        dataType: 'string',
      },
      /**
       * A hash of the doc id.
       */
      docIdDigest: {
        dataType: 'string',
      },
      /**
       * The site id.
       */
      siteId: {
        dataType: 'number',
      },
      /**
       * The site type.
       */
      siteType: {
        dataType: 'string',
      },
      /**
       * A random, session-based identifier for the user that triggered this event.
       */
      altSessionId: {
        dataType: 'string',
      },
      /**
       * The id of the user that triggered this event.
       */
      userId: {
        dataType: 'number',
      },
    },
  },
  /**
   * Triggered when the video tour is closed.
   */
  watchedVideoTour: {
    minimumTelemetryLevel: Level.limited,
    metadataContracts: {
      /**
       * The number of seconds elapsed in the video player.
       */
      watchTimeSeconds: {
        dataType: 'number',
      },
      /**
       * The id of the user that triggered this event.
       */
      userId: {
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      /**
       * A random, session-based identifier for the user that triggered this event.
       */
      altSessionId: {
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
    },
  },
};

type TelemetryContracts = Record<TelemetryEvent, TelemetryEventContract>;

export const TelemetryEvents = StringUnion(
  'apiUsage',
  'beaconOpen',
  'beaconArticleViewed',
  'beaconEmailSent',
  'beaconSearch',
  'documentForked',
  'documentOpened',
  'documentUsage',
  'processMonitor',
  'sendingWebhooks',
  'signupVerified',
  'siteMembership',
  'siteUsage',
  'tutorialProgressChanged',
  'tutorialRestarted',
  'watchedVideoTour',
);
export type TelemetryEvent = typeof TelemetryEvents.type;

interface TelemetryEventContract {
  minimumTelemetryLevel: Level;
  metadataContracts?: Record<string, MetadataContract>;
}

interface MetadataContract {
  dataType: 'boolean' | 'number' | 'string' | 'string[]' | 'date';
  minimumTelemetryLevel?: Level;
}

export type TelemetryMetadataByLevel = Partial<Record<EnabledTelemetryLevel, TelemetryMetadata>>;

export type EnabledTelemetryLevel = Exclude<TelemetryLevel, 'off'>;

export const TelemetryLevels = StringUnion('off', 'limited', 'full');
export type TelemetryLevel = typeof TelemetryLevels.type;

export type TelemetryMetadata = Record<string, any>;

/**
 * The name of a cookie that's set whenever a template is opened.
 *
 * The cookie remembers the last template that was opened, which is then read during
 * sign-up to track which templates were viewed before sign-up.
 */
export const TELEMETRY_TEMPLATE_SIGNUP_COOKIE_NAME = 'gr_template_signup_trk';

// A set of metadata keys that are always allowed when logging.
const ALLOWED_METADATA_KEYS = new Set(['eventSource', 'installationId']);

/**
 * Returns a function that accepts a telemetry event and metadata, and performs various
 * checks on it based on a set of contracts and the `telemetryLevel`.
 *
 * The function throws if any checks fail.
 */
export function buildTelemetryEventChecker(telemetryLevel: TelemetryLevel) {
  const currentTelemetryLevel = Level[telemetryLevel];

  return (event: TelemetryEvent, metadata?: TelemetryMetadata) => {
    const eventContract = TelemetryContracts[event];
    if (!eventContract) {
      throw new Error(`Unknown telemetry event: ${event}`);
    }

    const eventMinimumTelemetryLevel = eventContract.minimumTelemetryLevel;
    if (currentTelemetryLevel < eventMinimumTelemetryLevel) {
      throw new Error(
        `Telemetry event ${event} requires a minimum telemetry level of ${eventMinimumTelemetryLevel} ` +
        `but the current level is ${currentTelemetryLevel}`
      );
    }

    for (const [key, value] of Object.entries(metadata ?? {})) {
      if (ALLOWED_METADATA_KEYS.has(key))  { continue; }

      const metadataContract = eventContract.metadataContracts?.[key];
      if (!metadataContract) {
        throw new Error(`Unknown metadata for telemetry event ${event}: ${key}`);
      }

      const metadataMinimumTelemetryLevel = metadataContract.minimumTelemetryLevel;
      if (metadataMinimumTelemetryLevel && currentTelemetryLevel < metadataMinimumTelemetryLevel) {
        throw new Error(
          `Telemetry metadata ${key} of event ${event} requires a minimum telemetry level of ` +
          `${metadataMinimumTelemetryLevel} but the current level is ${currentTelemetryLevel}`
        );
      }

      const {dataType} = metadataContract;
      if (dataType.endsWith('[]')) {
        if (!Array.isArray(value)) {
          throw new Error(
            `Telemetry metadata ${key} of event ${event} expected a value of type array ` +
            `but received a value of type ${typeof value}`
          );
        }

        const elementDataType = dataType.slice(0, -2);
        if (value.some(element => typeof element !== elementDataType)) {
          throw new Error(
            `Telemetry metadata ${key} of event ${event} expected a value of type ${elementDataType}[] ` +
            `but received a value of type ${typeof value}[]`
          );
        }
      } else if (dataType === 'date') {
        if (!(value instanceof Date) && typeof value !== 'string') {
          throw new Error(
            `Telemetry metadata ${key} of event ${event} expected a value of type Date or string ` +
            `but received a value of type ${typeof value}`
          );
        }
      } else if (dataType !== typeof value) {
        throw new Error(
          `Telemetry metadata ${key} of event ${event} expected a value of type ${dataType} ` +
          `but received a value of type ${typeof value}`
        );
      }
    }
  };
}

export type TelemetryEventChecker = (event: TelemetryEvent, metadata?: TelemetryMetadata) => void;

/**
 * Returns a new, filtered metadata object.
 *
 * Metadata in groups that don't meet `telemetryLevel` are removed from the
 * returned object, and the returned object is flattened.
 *
 * Returns undefined if `metadata` is undefined.
 */
export function filterMetadata(
  metadata: TelemetryMetadataByLevel | undefined,
  telemetryLevel: TelemetryLevel
): TelemetryMetadata | undefined {
  if (!metadata) { return; }

  let filteredMetadata = {};
  for (const level of ['limited', 'full'] as const) {
    if (Level[telemetryLevel] < Level[level]) { break; }

    filteredMetadata = {...filteredMetadata, ...metadata[level]};
  }

  filteredMetadata = removeNullishKeys(filteredMetadata);

  return removeNullishKeys(filteredMetadata);
}

/**
 * Returns a copy of `object` with all null and undefined keys removed.
 */
export function removeNullishKeys(object: Record<string, any>) {
  return pickBy(object, value => value !== null && value !== undefined);
}
