import * as fse from "fs-extra";

// Export dependencies for stubbing in tests.
export const Deps = {
  readFile: fse.readFileSync,
  writeFile: fse.writeFile,
  pathExists: fse.pathExistsSync,
};

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

export interface ConfigAccessors<ValueType> {
  get: () => ValueType,
  set?: (value: ValueType) => Promise<void>
}

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
  public static create<CreateConfigFileContents>(
    configPath: string,
    validator: FileContentsValidator<CreateConfigFileContents>
  ): FileConfig<CreateConfigFileContents> {
    // Start with empty object, as it can be upgraded to a full config.
    let rawFileContents: any = {};

    if (Deps.pathExists(configPath)) {
      rawFileContents = JSON.parse(Deps.readFile(configPath, 'utf8'));
    }

    let fileContents = null;

    try {
      fileContents = validator(rawFileContents);
    } catch (error) {
      const configError =
        new ConfigValidationError(`Config at ${configPath} failed validation: ${error.message}`);
      configError.cause = error;
      throw configError;
    }

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

  public async persistToDisk() {
    await Deps.writeFile(this._filePath, JSON.stringify(this._rawConfig, null, 2) + "\n");
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
  persistence?: ConfigAccessors<ValueType> | ConfigAccessors<ValueType | undefined>,
): IWritableConfigValue<ValueType> {
  let inMemoryValue = (persistence && persistence.get());
  return {
    get(): ValueType {
      return inMemoryValue ?? defaultValue;
    },
    async set(value: ValueType) {
      if (persistence && persistence.set) {
        await persistence.set(value);
      }
      inMemoryValue = value;
    }
  };
}
