import {CheckerT, createCheckers} from 'ts-interface-checker';
import DocumentSettingsTI from 'app/common/DocumentSettings-ti';

export interface DocumentSettings {
  locale: string;
  currency?: string;
  engine?: EngineCode;
  // Grist attachments can be stored within the document (embedded in the SQLite file), or held
  // externally. The attachmentStoreId expresses a preference for which store should be used for
  // attachments in this doc. This store will be used for new attachments when they're added, and a
  // process can be triggered to start transferring all attachments that aren't already in this
  // store over to it. A full id is stored, rather than something more convenient like a boolean or
  // the string "external", after thinking carefully about how downloads/uploads and transferring
  // files to other installations could work.
  attachmentStoreId?: string;
}

/**
 * The back-end will for now support one engine,
 * a gvisor-backed python3.
 */
export type EngineCode = 'python3';

const checkers = createCheckers(DocumentSettingsTI);
export const DocumentSettingsChecker = checkers.DocumentSettings as CheckerT<DocumentSettings>;
