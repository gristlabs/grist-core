import { isAffirmative, isNumber } from 'app/common/gutil';

/**
 * A bundle of settings for the application. May contain
 * a value directly, and/or via nested settings. Also
 * may have some information about where we looked for
 * the value, for reporting as a diagnostic.
 */
export class AppSettings {
  private _value?: JSONValue;
  private _children?: {[key: string]: AppSettings};
  private _info?: AppSettingQueryResult;

  public constructor(public readonly name: string) {}

  /* access the setting - undefined if not set */
  public get(): JSONValue|undefined {
    return this._value;
  }

  /* access the setting as a boolean using isAffirmative - undefined if not set */
  public getAsBool(): boolean|undefined {
    return (this._value !== undefined) ? isAffirmative(this._value) : undefined;
  }

  /**
   * Access the setting as an integer using parseInt. Undefined if not set.
   * Throws an error if not numberlike.
   */
  public getAsInt(): number|undefined {
    if (this._value === undefined) { return undefined; }
    const datum = this._value?.valueOf();
    if (typeof datum === 'number') {
      return datum;
    }
    if (isNumber(String(datum))) {
      return parseInt(String(datum), 10);
    }
    throw new Error(`${datum} does not look like a number`);
  }

  /**
   * Try to read the setting from the environment. Even if
   * we fail, we record information about how we tried to
   * find the setting, so we can report on that.
   */
  public read(query: AppSettingQuery) {
    this._value = undefined;
    this._info = undefined;
    let value = undefined;
    let found = false;
    const envVars = getEnvVarsFromQuery(query);
    if (!envVars.length) {
      throw new Error('could not find an environment variable to read');
    }
    let envVar = envVars[0];
    for (const synonym of envVars) {
      value = process.env[synonym];
      if (value !== undefined) {
        envVar = synonym;
        found = true;
        break;
      }
    }
    this._info = {
      envVar: found ? envVar : undefined,
      found,
      query,
    };
    if (value !== undefined) {
      this._value = value;
    } else if (query.defaultValue !== undefined) {
      this._value = query.defaultValue;
    }
    return this;
  }

  /**
   * As for read() but type the result as a string.
   */
  public readString(query: AppSettingQuery): string|undefined {
    this.read(query);
    if (this._value === undefined) { return undefined; }
    this._value = String(this._value);
    return this._value;
  }

  /**
   * As for readString() but fail if nothing was found.
   */
  public requireString(query: AppSettingQuery): string {
    const result = this.readString(query);
    if (result === undefined) {
      throw new Error(`missing environment variable: ${query.envVar}`);
    }
    return result;
  }

  /**
   * As for readInt() but fail if nothing was found.
   */
  public requireInt(query: AppSettingQuery): number {
    const result = this.readInt(query);
    if (result === undefined) {
      throw new Error(`missing environment variable: ${query.envVar}`);
    }
    return result;
  }

  /**
   * As for read() but type (and store, and report) the result as
   * a boolean.
   */
  public readBool(query: AppSettingQuery): boolean|undefined {
    this.readString(query);
    const result = this.getAsBool();
    this._value = result;
    return result;
  }

  /**
   * As for read() but type (and store, and report) the result as
   * an integer (well, a number).
   */
  public readInt(query: AppSettingQuery): number|undefined {
    this.readString(query);
    const result = this.getAsInt();
    this._value = result;
    return result;
  }

  /* set this setting 'manually' */
  public set(value: JSONValue): void {
    this._value = value;
    this._info = undefined;
  }

  /* access any nested settings */
  public get nested(): {[key: string]: AppSettings} {
    return this._children || {};
  }

  /**
   * Add a named nested setting, returning an AppSettings
   * object that can be used to access it. This method is
   * named "section" to suggest that the nested setting
   * will itself contain multiple settings, but doesn't
   * require that.
   */
  public section(fname: string): AppSettings {
    if (!this._children) { this._children = {}; }
    let child = this._children[fname];
    if (!child) {
      this._children[fname] = child = new AppSettings(fname);
    }
    return child;
  }

  /**
   * Add a named nested setting, returning an AppSettings
   * object that can be used to access it. This method is
   * named "flag" to suggest that tthe nested setting will
   * not iself be nested, but doesn't require that - it is
   * currently just an alias for the section() method.
   */
  public flag(fname: string): AppSettings {
    return this.section(fname);
  }

  /**
   * Produce a summary description of the setting and how it was
   * derived.
   */
  public describe(): AppSettingDescription {
    return {
      name: this.name,
      value: (this._info?.query.censor && this._value !== undefined) ? '*****' : this._value,
      foundInEnvVar: this._info?.envVar,
      wouldFindInEnvVar: this._info?.query.preferredEnvVar || getEnvVarsFromQuery(this._info?.query)[0],
      usedDefault: this._value !== undefined && this._info !== undefined && !this._info?.found,
    };
  }

  /**
   * As for describe(), but include all nested settings also.
   * Used dotted notation for setting names. Omit settings that
   * are undefined and without useful information about how they
   * might be defined.
   */
  public describeAll(): AppSettingDescription[] {
    const inv: AppSettingDescription[] = [];
    inv.push(this.describe());
    if (this._children) {
      for (const child of Object.values(this._children)) {
        for (const item of child.describeAll()) {
          inv.push({...item, name: this.name + '.' + item.name});
        }
      }
    }
    return inv.filter(item => item.value !== undefined ||
      item.wouldFindInEnvVar !== undefined ||
      item.usedDefault);
  }
}

/**
 * A global object for Grist application settings.
 */
export const appSettings = new AppSettings('grist');

/**
 * Hints for how to define a setting, including possible
 * environment variables and default values.
 */
export interface AppSettingQuery {
  envVar: string|string[];  // environment variable(s) to check.
  preferredEnvVar?: string; // "Canonical" environment variable to suggest.
                            // Should be in envVar (though this is not checked).
  defaultValue?: JSONValue; // value to use if variable(s) unavailable.
  censor?: boolean;   // should the value of the setting be obscured when printed.
}

/**
 * Result of a query specifying whether the setting
 * was found, and if so in what environment variable, and using
 * what query.
 */
export interface AppSettingQueryResult {
  envVar?: string;
  found: boolean;
  query: AppSettingQuery;
}

/**
 * Output of AppSettings.describe().
 */
interface AppSettingDescription {
  name: string;            // name of the setting.
  value?: JSONValue;       // value of the setting, if available.
  foundInEnvVar?: string;  // environment variable the setting was read from, if available.
  wouldFindInEnvVar?: string;  // environment variable that would be checked for the setting.
  usedDefault: boolean;    // whether a default value was used for the setting.
}

// Helper function to normalize the AppSettingQuery.envVar list.
function getEnvVarsFromQuery(q?: AppSettingQuery): string[] {
  if (!q) { return []; }
  return Array.isArray(q.envVar) ? q.envVar : [q.envVar];
}

// Keep app settings JSON-like, in case later we decide to load them from
// a JSON source.
type JSONValue = string | number | boolean | null | { [member: string]: JSONValue } | JSONValue[];
