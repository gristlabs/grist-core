import {StringUnion} from 'app/common/StringUnion';

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
  apiUsage: {
    description: 'Triggered when an HTTP request with an API key is made.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      method: {
        description: 'The HTTP request method (e.g. GET, POST, PUT).',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      userAgent: {
        description: 'The User-Agent HTTP request header.',
        dataType: 'string',
      },
    },
  },
  assistantOpen: {
    description: 'Triggered when the AI Assistant is first opened.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'short',
    metadataContracts: {
      docIdDigest: {
        description: 'A hash of the doc id.',
        dataType: 'string',
      },
      conversationId: {
        description: 'A random identifier for the current conversation with the assistant.',
        dataType: 'string',
      },
      context: {
        description: 'The type of assistant (e.g. "formula"), table id, and column id.',
        dataType: 'object',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
    },
  },
  assistantSend: {
    description: 'Triggered when a message is sent to the AI Assistant.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'short',
    metadataContracts: {
      docIdDigest: {
        description: 'A hash of the doc id.',
        dataType: 'string',
      },
      siteId: {
        description: 'The id of the site.',
        dataType: 'number',
      },
      siteType: {
        description: 'The type of the site.',
        dataType: 'string',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
      access: {
        description: 'The document access level of the user that triggered this event.',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      conversationId: {
        description: 'A random identifier for the current conversation with the assistant.',
        dataType: 'string',
      },
      context: {
        description: 'The type of assistant (e.g. "formula"), table id, and column id.',
        dataType: 'object',
      },
      prompt: {
        description: 'The role ("user" or "system"), content, and index of the message sent to the AI Assistant.',
        dataType: 'object',
      },
    },
  },
  assistantReceive: {
    description: 'Triggered when a message is received from the AI Assistant is received.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'short',
    metadataContracts: {
      docIdDigest: {
        description: 'A hash of the doc id.',
        dataType: 'string',
      },
      siteId: {
        description: 'The id of the site.',
        dataType: 'number',
      },
      siteType: {
        description: 'The type of the site.',
        dataType: 'string',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
      access: {
        description: 'The document access level of the user that triggered this event.',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      conversationId: {
        description: 'A random identifier for the current conversation with the assistant.',
        dataType: 'string',
      },
      context: {
        description: 'The type of assistant (e.g. "formula"), table id, and column id.',
        dataType: 'object',
      },
      message: {
        description: 'The content and index of the message received from the AI Assistant.',
        dataType: 'object',
      },
      suggestedFormula: {
        description: 'The formula suggested by the AI Assistant, if present.',
        dataType: 'string',
      },
    },
  },
  assistantSave: {
    description: 'Triggered when changes in the expanded formula editor are saved after the AI Assistant ' +
      'was opened.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'short',
    metadataContracts: {
      docIdDigest: {
        description: 'A hash of the doc id.',
        dataType: 'string',
      },
      conversationId: {
        description: 'A random identifier for the current conversation with the assistant.',
        dataType: 'string',
      },
      context: {
        description: 'The type of assistant (e.g. "formula"), table id, and column id.',
        dataType: 'object',
      },
      newFormula: {
        description: 'The formula that was saved.',
        dataType: 'string',
      },
      oldFormula: {
        description: 'The formula that was overwritten.',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
    },
  },
  assistantCancel: {
    description: 'Triggered when changes in the expanded formula editor are discarded after the AI Assistant ' +
      'was opened.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'short',
    metadataContracts: {
      docIdDigest: {
        description: 'A hash of the doc id.',
        dataType: 'string',
      },
      conversationId: {
        description: 'A random identifier for the current conversation with the assistant.',
        dataType: 'string',
      },
      context: {
        description: 'The type of assistant (e.g. "formula"), table id, and column id.',
        dataType: 'object',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
    },
  },
  assistantClearConversation: {
    description: 'Triggered when a conversation in the AI Assistant is cleared.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'short',
    metadataContracts: {
      docIdDigest: {
        description: 'A hash of the doc id.',
        dataType: 'string',
      },
      conversationId: {
        description: 'A random identifier for the current conversation with the assistant.',
        dataType: 'string',
      },
      context: {
        description: 'The type of assistant (e.g. "formula"), table id, and column id.',
        dataType: 'object',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
    },
  },
  assistantClose: {
    description: 'Triggered when a formula is saved or discarded after the AI Assistant was opened.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      docIdDigest: {
        description: 'A hash of the doc id.',
        dataType: 'string',
      },
      conversationId: {
        description: 'A random identifier for the current conversation with the assistant.',
        dataType: 'string',
      },
      suggestionApplied: {
        description: 'True if a suggested formula from one of the received messages was applied.',
        dataType: 'boolean',
      },
      conversationLength: {
        description: 'The number of messages sent and received since opening the AI Assistant.',
        dataType: 'number',
      },
      conversationHistoryLength: {
        description: "The number of messages in the conversation's history. May be less than conversationLength "
          + "if the conversation history was cleared in the same session.",
        dataType: 'number',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
    },
  },
  beaconOpen: {
    description: 'Triggered when HelpScout Beacon is opened.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
    },
  },
  beaconArticleViewed: {
    description: 'Triggered when an article is opened in HelpScout Beacon.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      articleId: {
        description: 'The id of the article.',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
    },
  },
  beaconEmailSent: {
    description: 'Triggered when an email is sent in HelpScout Beacon.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
    },
  },
  beaconSearch: {
    description: 'Triggered when a search is made in HelpScout Beacon.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      searchQuery: {
        description: 'The search query.',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
    },
  },
  documentCreated: {
    description: 'Triggered when a document is created.',
    minimumTelemetryLevel: Level.limited,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      docIdDigest: {
        description: 'A hash of the id of the created document.',
        dataType: 'string',
      },
      sourceDocIdDigest: {
        description: 'A hash of the id of the source document, if the document was '
          + 'duplicated from an existing document.',
        dataType: 'string',
      },
      isImport: {
        description: 'Whether the document was created by import.',
        dataType: 'boolean',
      },
      isSaved: {
        description: 'Whether the document was saved to a workspace.',
        dataType: 'boolean',
      },
      fileType: {
        description: 'If the document was created by import, the file extension '
          + 'of the file that was imported.',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
    },
  },
  documentForked: {
    description: 'Triggered when a document is forked.',
    minimumTelemetryLevel: Level.limited,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      docIdDigest: {
        description: 'A hash of the doc id.',
        dataType: 'string',
      },
      siteId: {
        description: 'The id of the site containing the forked document.',
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      siteType: {
        description: 'The type of the site.',
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      access: {
        description: 'The document access level of the user that triggered this event.',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      forkIdDigest: {
        description: 'A hash of the fork id.',
        dataType: 'string',
      },
      forkDocIdDigest: {
        description: 'A hash of the full id of the fork, including the trunk id and fork id.',
        dataType: 'string',
      },
      trunkIdDigest: {
        description: 'A hash of the trunk id.',
        dataType: 'string',
      },
      isTemplate: {
        description: 'Whether the trunk is a template.',
        dataType: 'boolean',
      },
      lastActivity: {
        description: 'Timestamp of the last update to the trunk document.',
        dataType: 'date',
      },
    },
  },
  documentOpened: {
    description: 'Triggered when a public document or template is opened.',
    minimumTelemetryLevel: Level.limited,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      docIdDigest: {
        description: 'A hash of the doc id.',
        dataType: 'string',
      },
      siteId: {
        description: 'The site id.',
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      siteType: {
        description: 'The site type.',
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      access: {
        description: 'The document access level of the user that triggered this event.',
        dataType: 'string',
      },
      isPublic: {
        description: 'Whether the document is public.',
        dataType: 'boolean',
      },
      isSnapshot: {
        description: 'Whether a snapshot was opened.',
        dataType: 'boolean',
      },
      isTemplate: {
        description: 'Whether the document is a template.',
        dataType: 'boolean',
      },
      lastUpdated: {
        description: 'Timestamp of when the document was last updated.',
        dataType: 'date',
      },
    },
  },
  documentUsage: {
    description: 'Triggered on doc open and close, as well as hourly while a document is open.',
    minimumTelemetryLevel: Level.limited,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      docIdDigest: {
        description: 'A hash of the doc id.',
        dataType: 'string',
      },
      siteId: {
        description: 'The site id.',
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      siteType: {
        description: 'The site type.',
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      access: {
        description: 'The document access level of the user that triggered this event.',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      triggeredBy: {
        description: 'What caused this event to trigger. May be either "docOpen", "interval", or "docClose".',
        dataType: 'string',
      },
      isPublic: {
        description: 'Whether the document is public.',
        dataType: 'boolean',
      },
      rowCount: {
        description: 'The number of rows in the document.',
        dataType: 'number',
      },
      dataSizeBytes: {
        description: 'The total size of all data in the document, excluding attachments.',
        dataType: 'number',
      },
      attachmentsSize: {
        description: 'The total size of all attachments in the document.',
        dataType: 'number',
      },
      numAccessRules: {
        description: 'The number of access rules in the document.',
        dataType: 'number',
      },
      numUserAttributes: {
        description: 'The number of user attributes in the document.',
        dataType: 'number',
      },
      numAttachments: {
        description: 'The number of attachments in the document.',
        dataType: 'number',
      },
      attachmentTypes: {
        description: "A list of unique file extensions compiled from all of the document's attachments.",
        dataType: 'string[]',
      },
      numCharts: {
        description: 'The number of charts in the document.',
        dataType: 'number',
      },
      chartTypes: {
        description: 'A list of chart types of every chart in the document.',
        dataType: 'string[]',
      },
      numLinkedCharts: {
        description: 'The number of linked charts in the document.',
        dataType: 'number',
      },
      numLinkedWidgets: {
        description: 'The number of linked widgets in the document.',
        dataType: 'number',
      },
      numColumns: {
        description: 'The number of columns in the document.',
        dataType: 'number',
      },
      numColumnsWithConditionalFormatting: {
        description: 'The number of columns with conditional formatting in the document.',
        dataType: 'number',
      },
      numFormulaColumns: {
        description: 'The number of formula columns in the document.',
        dataType: 'number',
      },
      numTriggerFormulaColumns: {
        description: 'The number of trigger formula columns in the document.',
        dataType: 'number',
      },
      numSummaryFormulaColumns: {
        description: 'The number of summary formula columns in the document.',
        dataType: 'number',
      },
      numFieldsWithConditionalFormatting: {
        description: 'The number of fields with conditional formatting in the document.',
        dataType: 'number',
      },
      numTables: {
        description: 'The number of tables in the document.',
        dataType: 'number',
      },
      numOnDemandTables: {
        description: 'The number of on-demand tables in the document.',
        dataType: 'number',
      },
      numTablesWithConditionalFormatting: {
        description: 'The number of tables with conditional formatting in the document.',
        dataType: 'number',
      },
      numSummaryTables: {
        description: 'The number of summary tables in the document.',
        dataType: 'number',
      },
      numCustomWidgets: {
        description: 'The number of custom widgets in the document.',
        dataType: 'number',
      },
      customWidgetIds: {
        description: 'A list of plugin ids for every custom widget in the document. '
          + 'The ids of widgets not created by Grist Labs are replaced with "externalId".',
        dataType: 'string[]',
      },
    },
  },
  processMonitor: {
    description: 'Triggered every 5 seconds.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      heapUsedMB: {
        description: 'Size of JS heap in use, in MiB.',
        dataType: 'number',
      },
      heapTotalMB: {
        description: 'Total heap size, in MiB, allocated for JS by V8. ',
        dataType: 'number',
      },
      cpuAverage: {
        description: 'Fraction (typically between 0 and 1) of CPU usage. Includes all threads, so may exceed 1.',
        dataType: 'number',
      },
      intervalMs: {
        description: 'Interval (in milliseconds) over which `cpuAverage` is reported.',
        dataType: 'number',
      },
    },
  },
  sendingWebhooks: {
    description: 'Triggered when sending webhooks.',
    minimumTelemetryLevel: Level.limited,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      numEvents: {
        description: 'The number of events in the batch of webhooks being sent.',
        dataType: 'number',
      },
      docIdDigest: {
        description: 'A hash of the doc id.',
        dataType: 'string',
      },
      siteId: {
        description: 'The site id.',
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      siteType: {
        description: 'The site type.',
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      access: {
        description: 'The document access level of the user that triggered this event.',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
    },
  },
  signupFirstVisit: {
    description: 'Triggered when a new user first opens the Grist app',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      siteId: {
        description: 'The site id of first visit after signup.',
        dataType: 'number',
      },
      siteType: {
        description: 'The site type of first visit after signup.',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that signed up.',
        dataType: 'number',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
    },
  },
  signupVerified: {
    description: 'Triggered after a user successfully verifies their account during sign-up. '
      + 'Not triggered in grist-core.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      isAnonymousTemplateSignup: {
        description: 'Whether the user viewed any templates before signing up.',
        dataType: 'boolean',
      },
      templateId: {
        description: 'The doc id of the template the user last viewed before signing up, if any.',
        dataType: 'string',
      },
    },
  },
  siteMembership: {
    description: 'Triggered daily.',
    minimumTelemetryLevel: Level.limited,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      siteId: {
        description: 'The site id.',
        dataType: 'number',
      },
      siteType: {
        description: 'The site type.',
        dataType: 'string',
      },
      numOwners: {
        description: 'The number of users with an owner role in this site.',
        dataType: 'number',
      },
      numEditors: {
        description: 'The number of users with an editor role in this site.',
        dataType: 'number',
      },
      numViewers: {
        description: 'The number of users with a viewer role in this site.',
        dataType: 'number',
      },
    },
  },
  siteUsage: {
    description: 'Triggered daily.',
    minimumTelemetryLevel: Level.limited,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      siteId: {
        description: 'The site id.',
        dataType: 'number',
      },
      siteType: {
        description: 'The site type.',
        dataType: 'string',
      },
      inGoodStanding: {
        description: "Whether the site's subscription is in good standing.",
        dataType: 'boolean',
      },
      stripePlanId: {
        description: 'The Stripe Plan id associated with this site.',
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
      numDocs: {
        description: 'The number of docs in this site.',
        dataType: 'number',
      },
      numWorkspaces: {
        description: 'The number of workspaces in this site.',
        dataType: 'number',
      },
      numMembers: {
        description: 'The number of site members.',
        dataType: 'number',
      },
      lastActivity: {
        description: 'A timestamp of the most recent update made to a site document.',
        dataType: 'date',
      },
      earliestDocCreatedAt: {
        description: 'A timestamp of the earliest non-deleted document creation time.',
        dataType: 'date',
      },
    },
  },
  tutorialProgressChanged: {
    description: 'Triggered on changes to tutorial progress.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      tutorialForkIdDigest: {
        description: 'A hash of the tutorial fork id.',
        dataType: 'string',
      },
      tutorialTrunkIdDigest: {
        description: 'A hash of the tutorial trunk id.',
        dataType: 'string',
      },
      lastSlideIndex: {
        description: 'The 0-based index of the last tutorial slide the user had open.',
        dataType: 'number',
      },
      numSlides: {
        description: 'The total number of slides in the tutorial.',
        dataType: 'number',
      },
      percentComplete: {
        description: 'Percentage of tutorial completion.',
        dataType: 'number',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
    },
  },
  tutorialRestarted: {
    description: 'Triggered when a tutorial is restarted.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      tutorialForkIdDigest: {
        description: 'A hash of the tutorial fork id.',
        dataType: 'string',
      },
      tutorialTrunkIdDigest: {
        description: 'A hash of the tutorial trunk id.',
        dataType: 'string',
      },
      docIdDigest: {
        description: 'A hash of the doc id.',
        dataType: 'string',
      },
      siteId: {
        description: 'The site id.',
        dataType: 'number',
      },
      siteType: {
        description: 'The site type.',
        dataType: 'string',
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
      },
      access: {
        description: 'The document access level of the user that triggered this event.',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
    },
  },
  watchedVideoTour: {
    description: 'Triggered when the video tour is closed.',
    minimumTelemetryLevel: Level.limited,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      watchTimeSeconds: {
        description: 'The number of seconds elapsed in the video player.',
        dataType: 'number',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
        minimumTelemetryLevel: Level.full,
      },
      altSessionId: {
        description: 'A random, session-based identifier for the user that triggered this event.',
        dataType: 'string',
        minimumTelemetryLevel: Level.full,
      },
    },
  },
  welcomeQuestionsSubmitted: {
    description: 'Triggered when the welcome questionnaire is submitted.',
    minimumTelemetryLevel: Level.full,
    retentionPeriod: 'indefinitely',
    metadataContracts: {
      useCases: {
        description: 'The selected use cases.',
        dataType: 'string[]',
      },
      useOther: {
        description: 'The value of the Other use case.',
        dataType: 'string',
      },
      userId: {
        description: 'The id of the user that triggered this event.',
        dataType: 'number',
      },
    },
  },
};

type TelemetryContracts = Record<TelemetryEvent, TelemetryEventContract>;

export const TelemetryEvents = StringUnion(
  'apiUsage',
  'assistantOpen',
  'assistantSend',
  'assistantReceive',
  'assistantSave',
  'assistantCancel',
  'assistantClearConversation',
  'assistantClose',
  'beaconOpen',
  'beaconArticleViewed',
  'beaconEmailSent',
  'beaconSearch',
  'documentCreated',
  'documentForked',
  'documentOpened',
  'documentUsage',
  'processMonitor',
  'sendingWebhooks',
  'signupFirstVisit',
  'signupVerified',
  'siteMembership',
  'siteUsage',
  'tutorialProgressChanged',
  'tutorialRestarted',
  'watchedVideoTour',
  'welcomeQuestionsSubmitted',
);
export type TelemetryEvent = typeof TelemetryEvents.type;

interface TelemetryEventContract {
  description: string;
  minimumTelemetryLevel: Level;
  retentionPeriod: TelemetryRetentionPeriod;
  metadataContracts?: Record<string, MetadataContract>;
}

export type TelemetryRetentionPeriod = 'short' | 'indefinitely';

interface MetadataContract {
  description: string;
  dataType: 'boolean' | 'number' | 'string' | 'string[]' | 'date' | 'object';
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
