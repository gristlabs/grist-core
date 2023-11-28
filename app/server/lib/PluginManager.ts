import {DirectoryScanEntry, LocalPlugin} from 'app/common/plugin';
import log from 'app/server/lib/log';
import {readManifest} from 'app/server/lib/manifest';
import {getAppPathTo} from 'app/server/lib/places';
import * as fse from 'fs-extra';
import * as path from 'path';

/**
 * Various plugins' related directories.
 */
export interface PluginDirectories {
  /**
   * Directory where built in plugins are located.
   */
  readonly builtIn?: string;
  /**
   * Directory where user installed plugins are located.
   */
  readonly installed?: string;
  /**
   * Yet another option, for plugins that are included
   * during a build but not part of the codebase itself.
   */
  readonly bundled?: string;
}

/**
 *
 * The plugin manager class is responsible for providing both built in and installed plugins and
 * spawning server side plugins's.
 *
 * Usage:
 *
 *  const pluginManager = new PluginManager(appRoot, userRoot);
 *  await pluginManager.initialize();
 *
 */
export class PluginManager {

  public pluginsLoaded: Promise<void>;

  // ========== Instance members and methods ==========
  private _dirs: PluginDirectories;
  private _validPlugins: LocalPlugin[] = [];
  private _entries: DirectoryScanEntry[] = [];


  /**
   * @param {string} userRoot: path to user's grist directory; `null` is allowed, to only uses built in plugins.
   *
   */
  public constructor(public appRoot?: string, userRoot?: string,
                     public bundledRoot?: string) {
    this._dirs = {
      installed: userRoot ? path.join(userRoot, 'plugins') : undefined,
      builtIn: appRoot ? getAppPathTo(appRoot, 'plugins') : undefined,
      bundled: bundledRoot ? getAppPathTo(bundledRoot, 'plugins') : undefined,
    };
  }

  public dirs(): PluginDirectories { return this._dirs; }

  /**
   * Create tmp dir and load plugins.
   */
  public async initialize(): Promise<void> {
    try {
      await (this.pluginsLoaded = this.loadPlugins());
    } catch (err) {
      log.error("PluginManager's initialization failed: ", err);
      throw err;
    }
  }

  /**
   * Re-load plugins (literally re-run `loadPlugins`).
   */
  // TODO: it's not clear right now what we do on reload. Do we deactivate plugins that were removed
  // from the fs? Do we update plugins that have changed on the fs ?
  public async reloadPlugins(): Promise<void> {
    return await this.loadPlugins();
  }

  /**
   * Discover both builtIn and user installed plugins. Logs any failures that happens when scanning
   * a directory (ie: manifest missing or manifest validation errors etc...)
   */
  public async loadPlugins(): Promise<void> {
    this._entries = [];

    // Load user installed plugins
    if (this._dirs.installed) {
      this._entries.push(...await scanDirectory(this._dirs.installed, "installed"));
    }

    // Load builtIn plugins
    if (this._dirs.builtIn) {
      this._entries.push(...await scanDirectory(this._dirs.builtIn, "builtIn"));
    }

    // Load bundled plugins
    if (this._dirs.bundled) {
      this._entries.push(...await scanDirectory(this._dirs.bundled, "bundled"));
    }

    if (!process.env.GRIST_EXPERIMENTAL_PLUGINS ||
       process.env.GRIST_EXPERIMENTAL_PLUGINS === '0') {
      // Remove experimental plugins
      this._entries = this._entries.filter(entry => {
        if (entry.manifest && entry.manifest.experimental) {
          log.warn("Ignoring experimental plugin %s", entry.id);
          return false;
        }
        return true;
      });
    }

    this._validPlugins = this._entries.filter(entry => !entry.errors).map(entry => entry as LocalPlugin);

    this._logScanningReport();
  }

  public getPlugins(): LocalPlugin[] {
    return this._validPlugins;
  }


  private _logScanningReport() {
    const invalidPlugins = this._entries.filter( entry => entry.errors);
    if (invalidPlugins.length) {
      for (const plugin of invalidPlugins) {
        log.warn(`Error loading plugins: Failed to load extension from ${plugin.path}\n` +
          (plugin.errors!).map(m => "  - " + m).join("\n  ")
          );
      }
    }
    log.info(`Found ${this._validPlugins.length} valid plugins on the system`);
    for (const p of this._validPlugins) {
      log.debug("PLUGIN %s -- %s", p.id, p.path);
    }
  }
}


async function scanDirectory(dir: string, kind: "installed"|"builtIn"|"bundled"): Promise<DirectoryScanEntry[]> {
  const plugins: DirectoryScanEntry[] = [];
  let listDir;

  try {
    listDir = await fse.readdir(dir);
  } catch (e) {
    // Non existing dir is treated as an empty dir.
    // It is hard for user to avoid Grist checking a dir,
    // so phrase the message as information rather than error.
    log.info(`No plugins found in directory: ${dir}`);
    return [];
  }

  for (const id of listDir) {
    const folderPath = path.join(dir, id),
      plugin: DirectoryScanEntry = {
        path: folderPath,
        id: `${kind}/${id}`
      };
    try {
      plugin.manifest = await readManifest(folderPath);
    } catch (e) {
      plugin.errors = [];
      if (e.message) {
        plugin.errors.push(e.message);
      }
      if (e.notices) {
        plugin.errors.push(...e.notices);
      }
    }
    plugins.push(plugin);
  }
  return plugins;
}
