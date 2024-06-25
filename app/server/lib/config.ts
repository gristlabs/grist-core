import * as fse from "fs-extra";

/**
 * Readonly config value - no write access.
 */
export interface IReadableConfigValue<T> {
  get(): T;
}

/**
 * Writeable config value. Write behaviour is asynchronous and defined by the implementation.
 */
export interface IWritableConfigValue<T> extends IReadableConfigValue<T> {
  set(value: T): Promise<void>;
}

type FileContentsValidator<T> = (value: any) => T | null;

export class MissingConfigFileError extends Error {
  public name: string = "MissingConfigFileError";

  constructor(message: string) {
    super(message);
  }
}

export class ConfigValidationError extends Error {
  public name: string = "ConfigValidationError";

  constructor(message: string) {
    super(message);
  }
}

type ConfigAccessors<ValueType> = { get: () => ValueType, set?: (value: ValueType) => Promise<void> };

/**
 * Provides type safe access to an underlying JSON file.
 *
 * Multiple FileConfigs for the same file shouldn't be used, as they risk going out of sync.
 */
export class FileConfig<FileContents> {
  /**
   * Creates a new type-safe FileConfig, by loading and checking the contents of the file with `validator`.
   * @param configPath - Path to load.
   * @param validator - Validates the contents are in the correct format, and converts to the correct type.
   *  Should throw an error or return null if not valid.
   */
  public static async create<CreateConfigFileContents>(
    configPath: string,
    validator: FileContentsValidator<CreateConfigFileContents>
  ): Promise<FileConfig<CreateConfigFileContents>> {
    // Start with empty object, as it can be upgraded to a full config.
    let rawFileContents: any = {};

    if (await fse.pathExists(configPath)) {
      rawFileContents = JSON.parse(await fse.readFile(configPath, 'utf8'));
    }

    const fileContents = validator(rawFileContents);

    if (!fileContents) {
      throw new ConfigValidationError(`Config at ${configPath} failed validation - check the format?`);
    }

    return new FileConfig<CreateConfigFileContents>(configPath, fileContents);
  }

  constructor(private _filePath: string, private _rawConfig: FileContents) {
  }

  public get<Key extends keyof FileContents>(key: Key): FileContents[Key] {
    return this._rawConfig[key];
  }

  public async set<Key extends keyof FileContents>(key: Key, value: FileContents[Key]) {
    this._rawConfig[key] = value;
    await this.persistToDisk();
  }

  public async persistToDisk(): Promise<void> {
    await fse.writeFile(this._filePath, JSON.stringify(this._rawConfig, null, 2));
  }
}

/**
 * Creates a function for creating accessors for a given key.
 * Propagates undefined values, so if no file config is available, accessors are undefined.
 * @param fileConfig - Config to load/save values to.
 */
export function fileConfigAccessorFactory<FileContents>(
  fileConfig?: FileConfig<FileContents>
): <Key extends keyof FileContents>(key: Key) => ConfigAccessors<FileContents[Key]> | undefined
{
  if (!fileConfig) { return (key) => undefined; }
  return (key) => ({
    get: () => fileConfig.get(key),
    set: (value) => fileConfig.set(key, value)
  });
}

/**
 * Creates a config value optionally backed by persistent storage.
 * Can be used as an in-memory value without persistent storage.
 * @param defaultValue - Value to use if no persistent value is available.
 * @param persistence - Accessors for saving/loading persistent value.
 */
export function createConfigValue<ValueType>(
  defaultValue: ValueType,
  persistence?: ConfigAccessors<ValueType>,
): IWritableConfigValue<ValueType> {
  let inMemoryValue = (persistence && persistence.get()) ?? defaultValue;
  return {
    get() {
      return inMemoryValue;
    },
    async set(value: ValueType) {
      if (persistence && persistence.set) {
        await persistence.set(value);
      }
      inMemoryValue = value;
    }
  };
}
