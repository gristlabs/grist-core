/**
 * Defines the IDocWorkerMap interface we need to assign a DocWorker to a doc, and to look it up.
 * TODO This is not yet implemented, there is only a hard-coded stub.
 */

import { IChecksumStore } from 'app/server/lib/IChecksumStore';
import { IElectionStore } from 'app/server/lib/IElectionStore';
import { IPermitStores } from 'app/server/lib/Permit';
import {RedisClient} from 'redis';

export interface DocWorkerInfo {
  id: string;

  // The public base URL for the docWorker, which tells the browser how to connect to it. E.g.
  // https://docworker-17.getgrist.com/ or http://localhost:8080/v/gtag/
  publicUrl: string;

  // The internal base URL for the docWorker.
  internalUrl: string;

  // If set, worker should accept work only for this named group.
  group?: string;
}

export interface DocStatus {
  // MD5 hash of the SQLite file for this document as stored on S3. We use MD5 because it is
  // automatically computed by S3 (except for multipart uploads). Null indicates a new file.
  docMD5: string|null;

  // DocWorker most recently, or currently, responsible for the file.
  docWorker: DocWorkerInfo;

  // Whether the file is currently open on this DocWorker.
  isActive: boolean;
}

/**
 * Assignment of documents to workers, and other storage related to distributed work.
 */
export interface IDocWorkerMap extends IPermitStores, IElectionStore, IChecksumStore {
  // Looks up which DocWorker is responsible for this docId.
  getDocWorker(docId: string): Promise<DocStatus|null>;

  // Assigns a DocWorker to this docId if one is not yet assigned.
  assignDocWorker(docId: string): Promise<DocStatus>;

  // Assigns a particular DocWorker to this docId if one is not yet assigned.
  getDocWorkerOrAssign(docId: string, workerId: string): Promise<DocStatus>;

  updateDocStatus(docId: string, checksum: string): Promise<void>;

  addWorker(info: DocWorkerInfo): Promise<void>;

  removeWorker(workerId: string): Promise<void>;

  // Set whether worker is accepting new assignments.  This does not automatically
  // release existing assignments.
  setWorkerAvailability(workerId: string, available: boolean): Promise<void>;

  // Releases doc from worker, freeing it to be assigned elsewhere.
  // Assignments should only be released for workers that are now unavailable.
  releaseAssignment(workerId: string, docId: string): Promise<void>;

  // Get all assignments for a worker.  Should only be queried for a worker that
  // is currently unavailable.
  getAssignments(workerId: string): Promise<string[]>;

  getWorkerGroup(workerId: string): Promise<string|null>;

  getDocGroup(docId: string): Promise<string|null>;

  updateDocGroup(docId: string, docGroup: string): Promise<void>;

  removeDocGroup(docId: string): Promise<void>;

  getRedisClient(): RedisClient|null;
}
