import {ForkResult} from 'app/common/ActiveDocAPI';
import {buildUrlId, parseUrlId} from 'app/common/gristUrls';
import {padStart} from 'app/common/gutil';
import {IDocWorkerMap} from 'app/server/lib/DocWorkerMap';
import * as shortUUID from 'short-uuid';

// make an id that is a standard UUID compressed into fewer characters.
export function makeId(): string {
  // Generate a flickr-style id, by converting a regular uuid interpreted
  // as a hex number (without dashes) into a number expressed in a bigger
  // base. That number is encoded as characters chosen for url safety and
  // lack of confusability. The character encoding zero is '1'.  We pad the
  // result so that the length of the id remains consistent, since there is
  // routing that depends on the id length exceeding a minimum threshold.
  return padStart(shortUUID.generate(), 22, '1');
}

/**
 * Construct an id for a fork, given the userId, whether the user is the anonymous user,
 * and the id of a reference document (the trunk).
 * If the userId is null, the user will be treated as the anonymous user.
 */
export function makeForkIds(options: { userId: number|null, isAnonymous: boolean,
                                       trunkDocId: string, trunkUrlId: string }): ForkResult {
  const forkId = makeId();
  const forkUserId = options.isAnonymous ? undefined :
    (options.userId !== null ? options.userId : undefined);
  // TODO: we will want to support forks of forks, but for now we do not -
  // forks are always forks of the trunk.
  const docId = parseUrlId(options.trunkDocId).trunkId;
  const urlId = parseUrlId(options.trunkUrlId).trunkId;
  return {
    docId: buildUrlId({trunkId: docId, forkId, forkUserId}),
    urlId: buildUrlId({trunkId: urlId, forkId, forkUserId}),
  };
}

// For importing, we can assign any worker to the job.  As a hack, we reuse the document
// assignment mechanism.  To spread the work around a bit if we have several doc workers,
// we use a fake document id between import0 and import9.
// This method takes a DocWorkerMap to allow for something smarter in future.
export function getAssignmentId(docWorkerMap: IDocWorkerMap, docId: string): string {
  let assignmentId = docId;
  if (assignmentId === 'import') {
    assignmentId = `import${Math.round(Math.random() * 10)}`;
  }
  return assignmentId;
}
