import {ICustomWidget} from 'app/common/CustomWidget';
import log from 'app/server/lib/log';
import * as fse from 'fs-extra';
import fetch from 'node-fetch';
import * as path from 'path';
import {ApiError} from 'app/common/ApiError';
import LRUCache from 'lru-cache';
import * as url from 'url';
import { removeTrailingSlash } from 'app/common/gutil';
import { GristServer } from './GristServer';
// import { LocalPlugin } from 'app/common/plugin';

/**
 * Widget Repository returns list of available Custom Widgets.
 */
export interface IWidgetRepository {
  getWidgets(): Promise<ICustomWidget[]>;
}

// Static url for StaticWidgetRepository
const STATIC_URL = process.env.GRIST_WIDGET_LIST_URL;

export class FileWidgetRepository implements IWidgetRepository {
  constructor(private _widgetFileName: string,
              private _widgetBaseUrl: string,
              private _pluginId?: string) {}

  public async getWidgets(): Promise<ICustomWidget[]> {
    const txt = await fse.readFile(this._widgetFileName, {
      encoding: 'utf8',
    });
    const widgets: ICustomWidget[] = JSON.parse(txt);
    fixUrls(widgets, this._widgetBaseUrl);
    if (this._pluginId) {
      for (const widget of widgets) {
        widget.fromPlugin = this._pluginId;
      }
    }
    console.log("FileWidget", {widgets});
    return widgets;
  }
}

/*
export class NestedWidgetRepository implements IWidgetRepository {
  constructor(private _widgetDir: string,
              private _widgetBaseUrl: string) {}

  public async getWidgets(): Promise<ICustomWidget[]> {
    const listDir = await fse.readdir(this._widgetDir,
                                      { withFileTypes: true });
    const fileName = 'manifest.json';
    const allWidgets: ICustomWidget[] = [];
    for (const dir of listDir) {
      if (!dir.isDirectory()) { continue; }
      const fullPath = path.join(this._widgetDir, dir.name, fileName);
      if (!await fse.pathExists(fullPath)) { continue; }
      const txt = await fse.readFile(fullPath, 'utf8');
      const widgets = JSON.parse(txt);
      fixUrls(
        widgets,
        removeTrailingSlash(this._widgetBaseUrl) + '/' + dir.name + '/'
      );
      allWidgets.push(...widgets);
    }
    return allWidgets;
  }
}
*/

export class DelayedWidgetRepository implements IWidgetRepository {
  constructor(private _makeRepo: () => Promise<IWidgetRepository|undefined>) {}

  public async getWidgets(): Promise<ICustomWidget[]> {
    const repo = await this._makeRepo();
    if (!repo) { return []; }
    return repo.getWidgets();
  }
}

export class CombinedWidgetRepository implements IWidgetRepository {
  constructor(private _repos: IWidgetRepository[]) {}

  public async getWidgets(): Promise<ICustomWidget[]> {
    const allWidgets: ICustomWidget[] = [];
    for (const repo of this._repos) {
      allWidgets.push(...await repo.getWidgets());
    }
    console.log("COMBINED", {allWidgets});
    return allWidgets;
  }
}

/**
 * Repository that gets list of available widgets from a static URL.
 */
export class UrlWidgetRepository implements IWidgetRepository {
  constructor(private _staticUrl = STATIC_URL) {}

  public async getWidgets(): Promise<ICustomWidget[]> {
    if (!this._staticUrl) {
      log.warn(
        'WidgetRepository: Widget repository is not configured.' + (!STATIC_URL
          ? ' Missing GRIST_WIDGET_LIST_URL environmental variable.'
          : '')
      );
      return [];
    }
    try {
      const response = await fetch(this._staticUrl);
      if (!response.ok) {
        if (response.status === 404) {
          throw new ApiError('WidgetRepository: Remote widget list not found', 404);
        } else {
          const body = await response.text().catch(() => '');
          throw new ApiError(
            `WidgetRepository: Remote server returned an error: ${body || response.statusText}`, response.status
          );
        }
      }
      const widgets = await response.json().catch(() => null);
      if (!widgets || !Array.isArray(widgets)) {
        throw new ApiError('WidgetRepository: Error reading widget list', 500);
      }
      fixUrls(widgets, this._staticUrl);
      return widgets;
    } catch (err) {
      if (!(err instanceof ApiError)) {
        throw new ApiError(String(err), 500);
      }
      throw err;
    }
  }
}

/**
 * Default repository that gets list of available widgets from a static URL.
 */
export class WidgetRepositoryImpl implements IWidgetRepository {
  protected _staticUrl: string|undefined;
  private _urlWidgets: UrlWidgetRepository;
  private _combinedWidgets: CombinedWidgetRepository;
  private _dirWidgets?: IWidgetRepository;

  constructor(_options: {
    staticUrl?: string,
    gristServer?: GristServer,
  }) {
    const {staticUrl, gristServer} = _options;
    if (gristServer) {
      this._dirWidgets = new DelayedWidgetRepository(async () => {
        const places = getWidgetPlaces(gristServer);
        console.log("PLACES!", places);
        const files = places.map(place => new FileWidgetRepository(place.fileBase,
                                                                   place.urlBase,
                                                                   place.pluginId));
        return new CombinedWidgetRepository(files);
      });
    }
    this.testSetUrl(staticUrl);
  }

  /**
   * Method exposed for testing, overrides widget url.
   */
  public testOverrideUrl(url: string|undefined) {
    this.testSetUrl(url);
  }

  public testSetUrl(url: string|undefined) {
    const repos: IWidgetRepository[] = [];
    this._staticUrl = url ?? STATIC_URL;
    if (this._staticUrl) {
      this._urlWidgets = new UrlWidgetRepository(this._staticUrl);
      repos.push(this._urlWidgets);
    }
    if (this._dirWidgets) { repos.push(this._dirWidgets); }
    this._combinedWidgets = new CombinedWidgetRepository(repos);
  }

  public async getWidgets(): Promise<ICustomWidget[]> {
    return this._combinedWidgets.getWidgets();
  }
}

/**
 * Version of WidgetRepository that caches successful result for 2 minutes.
 */
class CachedWidgetRepository extends WidgetRepositoryImpl {
  private _cache = new LRUCache<1, ICustomWidget[]>({maxAge : 1000 * 60 /* minute */ * 2});
  public async getWidgets() {
    // Don't cache for localhost
    if (this._staticUrl && this._staticUrl.startsWith("http://localhost")) {
      this._cache.reset();
    }
    if (this._cache.has(1)) {
      log.debug("WidgetRepository: Widget list taken from the cache.");
      return this._cache.get(1)!;
    }
    const list = await super.getWidgets();
    // Cache only if there are some widgets.
    if (list.length) { this._cache.set(1, list); }
    console.log("CACHABLE RESULT", {list});
    return list;
  }

  public testOverrideUrl(url: string) {
    super.testOverrideUrl(url);
    this._cache.reset();
  }
}

/**
 * Returns widget repository implementation.
 */
export function buildWidgetRepository(gristServer: GristServer,
                                      options?: {
                                        localOnly: boolean
                                      }) {
  if (options?.localOnly) {
    return new WidgetRepositoryImpl({
      gristServer,
      staticUrl: ''
    });
  }
  return new CachedWidgetRepository({
    gristServer,
  });
}

function fixUrls(widgets: ICustomWidget[], baseUrl: string) {
  // If URLs are relative, make them absolute, interpreting them
  // relative to the manifest file.
  for (const widget of widgets) {
    if (!(url.parse(widget.url).protocol)) {
      widget.url = new URL(widget.url, baseUrl).href;
    }
  }
}

export interface CustomWidgetPlace {
  urlBase: string,
  fileBase: string,
  fileDir: string,
  name: string,
  pluginId: string,
}

export function getWidgetPlaces(gristServer: GristServer,
                                pluginUrl?: string) {
  const places: CustomWidgetPlace[] = [];
  const plugins = gristServer.getPlugins();
  console.log("PLUGINS", plugins);
  pluginUrl = pluginUrl || gristServer.getPluginUrl();
  if (!pluginUrl) { return []; }
  for (const plugin of plugins) {
    console.log("PLUGIN", plugin);
    const components = plugin.manifest.components;
    if (!components.widgets) { continue; }
    console.log("GOT SOMETHING", {
      name: plugin.id,
      path: plugin.path,
      widgets: components.widgets
    });
    const urlBase =
        removeTrailingSlash(pluginUrl) + '/v/' +
        gristServer.getTag() + '/widgets/' + plugin.id + '/';
    places.push({
      urlBase,
      fileBase: path.join(plugin.path, components.widgets),
      fileDir: plugin.path,
      name: plugin.id,
      pluginId: plugin.id,
    });
  }
  console.log("PLACES", places);
  return places;
}
