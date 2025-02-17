import {appSettings} from 'app/server/lib/AppSettings';
import {FilesystemAttachmentStore, IAttachmentStore} from 'app/server/lib/AttachmentStore';
import {create} from 'app/server/lib/create';
import log from 'app/server/lib/log';
import {ICreateAttachmentStoreOptions} from './ICreate';
import * as fse from 'fs-extra';
import path from 'path';
import * as tmp from 'tmp-promise';

export type AttachmentStoreId = string

/**
 * Creates an {@link IAttachmentStore} from a given store id, if the Grist installation is
 * configured with that store's unique id.
 *
 * Each store represents a specific location to store attachments at, for example a "/attachments"
 * bucket on MinIO, or "/srv/grist/attachments" on the filesystem.
 *
 * Attachments in Grist Documents are accompanied by the id of the store they're in, allowing Grist
 * to store/retrieve them as long as that store exists on the document's installation.
 */
export interface IAttachmentStoreProvider {
  getStoreIdFromLabel(label: string): string;

  // Returns the store associated with the given id, returning null if no store with that id exists.
  getStore(id: AttachmentStoreId): Promise<IAttachmentStore | null>;

  getAllStores(): Promise<IAttachmentStore[]>;

  storeExists(id: AttachmentStoreId): Promise<boolean>;

  listAllStoreIds(): AttachmentStoreId[];
}

// All the information needed to instantiate an instance of a particular store type
export interface IAttachmentStoreSpecification {
  name: string,
  create: (storeId: string) => Promise<IAttachmentStore>,
}

// All the information needed to create a particular store instance
export interface IAttachmentStoreConfig {
  // This is the name for the store, but it also used to construct the store ID.
  label: string;
  spec: IAttachmentStoreSpecification;
}

/**
 * Provides access to instances of attachment stores.
 *
 * Stores can be accessed using ID or Label.
 *
 * Labels are a convenient/user-friendly way to refer to stores.
 * Each label is unique within a Grist instance, but other instances may have stores that use
 * the same label.
 * E.g "my-s3" or "myFolder".
 *
 * IDs are globally unique - and are created by prepending the label with the installation UUID.
 * E.g "22ec6867-67bc-414e-a707-da9204c84cab-my-s3" or "22ec6867-67bc-414e-a707-da9204c84cab-myFolder"
 */
export class AttachmentStoreProvider implements IAttachmentStoreProvider {
  private _storeDetailsById: Map<string, IAttachmentStoreConfig> = new Map();

  constructor(
    storeConfigs: IAttachmentStoreConfig[],
    private _installationUuid: string
  ) {
    // It's convenient to have stores with a globally unique ID, so there aren't conflicts as
    // documents are moved between installations. This is achieved by prepending the store labels
    // with the installation ID. Enforcing that using AttachmentStoreProvider makes it
    // much harder to accidentally bypass this constraint, as the provider should be the only way of
    // accessing stores.
    storeConfigs.forEach((storeConfig) => {
      this._storeDetailsById.set(this.getStoreIdFromLabel(storeConfig.label), storeConfig);
    });

    const storeIds = Array.from(this._storeDetailsById.keys());
    log.info(`AttachmentStoreProvider initialised with stores: ${storeIds}`);
  }

  public getStoreIdFromLabel(label: string): string {
    return `${this._installationUuid}-${label}`;
  }

  public async getStore(id: AttachmentStoreId): Promise<IAttachmentStore | null> {
    const storeDetails = this._storeDetailsById.get(id);
    if (!storeDetails) { return null; }
    return storeDetails.spec.create(id);
  }

  public async getAllStores(): Promise<IAttachmentStore[]> {
    return await Promise.all(
      Array.from(this._storeDetailsById.entries()).map(
        ([storeId, storeConfig]) => storeConfig.spec.create(storeId)
      )
    );
  }

  public async storeExists(id: AttachmentStoreId): Promise<boolean> {
    return this._storeDetailsById.has(id);
  }

  public listAllStoreIds(): string[] {
    return Array.from(this._storeDetailsById.keys());
  }
}

async function isAttachmentStoreOptionAvailable(option: ICreateAttachmentStoreOptions) {
  try {
    return await option.isAvailable();
  } catch (error) {
    log.error(`Error checking availability of store option '${option}'`, error);
    return false;
  }
}

function storeOptionIsNotUndefined(
  option: ICreateAttachmentStoreOptions | undefined
): option is ICreateAttachmentStoreOptions {
  return option !== undefined;
}

export async function checkAvailabilityAttachmentStoreOptions(
  allOptions: (ICreateAttachmentStoreOptions | undefined)[]
) {
  const options = allOptions.filter(storeOptionIsNotUndefined);
  const availability = await Promise.all(options.map(isAttachmentStoreOptionAvailable));

  return {
    available: options.filter((option, index) => availability[index]),
    unavailable: options.filter((option, index) => !availability[index]),
  };
}

// Make a filesystem store that will be cleaned up on process exit.
// This is only used when external attachments are in 'test' mode, which is used for some unit tests.
// TODO: Remove this when setting up a filesystem store is possible using normal configuration options
export async function makeTempFilesystemStoreSpec(
  name: string = "filesystem"
) {
  const tempFolder = await tmp.dir();
  // Allow tests to override the temp directory used for attachments, otherwise Grist will
  // use different temp directory after restarting the server.
  const tempDir = process.env.GRIST_TEST_ATTACHMENTS_DIR ||
    await fse.mkdtemp(path.join(tempFolder.path, 'filesystem-store-test-'));

  return {
    rootDirectory: tempDir,
    name,
    create: async (storeId: string) => (new FilesystemAttachmentStore(storeId, tempDir))
  };
}

const settings = appSettings.section("attachmentStores");
const GRIST_EXTERNAL_ATTACHMENTS_MODE = settings.flag("mode").readString({
  envVar: "GRIST_EXTERNAL_ATTACHMENTS_MODE",
  defaultValue: "none",
});

export function getConfiguredStandardAttachmentStore(): string | undefined {
  switch (GRIST_EXTERNAL_ATTACHMENTS_MODE) {
    case 'snapshots':
      return 'snapshots';
    case 'test':
      return 'test-filesystem';
    default:
      return undefined;
  }
}

export async function getConfiguredAttachmentStoreConfigs(): Promise<IAttachmentStoreConfig[]> {
  if (GRIST_EXTERNAL_ATTACHMENTS_MODE === 'snapshots') {
    const snapshotProvider = create.getAttachmentStoreOptions().snapshots;
    // This shouldn't happen - it could only happen if a version of Grist removes the snapshot provider from ICreate.
    if (snapshotProvider === undefined) {
      throw new Error("Snapshot provider is not available on this version of Grist");
    }
    if (!(await isAttachmentStoreOptionAvailable(snapshotProvider))) {
      throw new Error("The currently configured external storage does not support attachments");
    }
    return [{
      label: 'snapshots',
      spec: snapshotProvider,
    }];
  }
  // TODO This mode should be removed once stores can be configured fully via env vars.
  if(GRIST_EXTERNAL_ATTACHMENTS_MODE === 'test') {
    return [{
      label: 'test-filesystem',
      spec: await makeTempFilesystemStoreSpec(),
    }];
  }
  return [];
}
