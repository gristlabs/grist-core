import {ICustomWidget} from 'app/common/CustomWidget';
import log from 'app/server/lib/log';
import * as fse from 'fs-extra';
import fetch from 'node-fetch';
import * as path from 'path';
import {ApiError} from 'app/common/ApiError';
import {isAffirmative, removeTrailingSlash} from 'app/common/gutil';
import {GristServer} from 'app/server/lib/GristServer';
import LRUCache from 'lru-cache';
import * as url from 'url';
import { AsyncCreate } from 'app/common/AsyncCreate';

// Static url for UrlWidgetRepository
const STATIC_URL = process.env.GRIST_WIDGET_LIST_URL;

/**
 * Widget Repository returns list of available Custom Widgets.
 */
export interface IWidgetRepository {
  getWidgets(): Promise<ICustomWidget[]>;
}

/**
 *
 * A widget repository that lives on disk.
 *
 * The _widgetFile should point to a json file containing a
 * list of custom widgets, in the format used by the grist-widget
 * repo:
 *   https://github.com/gristlabs/grist-widget
 *
 * The file can use relative URLs. The URLs will be interpreted
 * as relative to the _widgetBaseUrl.
 *
 * If a _source is provided, it will be passed along in the
 * widget listings.
 *
 */
export class DiskWidgetRepository implements IWidgetRepository {
  constructor(private _widgetFile: string,
              private _widgetBaseUrl: string,
              private _source?: any) {}

  public async getWidgets(): Promise<ICustomWidget[]> {
    const txt = await fse.readFile(this._widgetFile, { encoding: 'utf8' });
    const widgets: ICustomWidget[] = JSON.parse(txt);
    fixUrls(widgets, this._widgetBaseUrl);
    if (this._source) {
      for (const widget of widgets) {
        widget.source = this._source;
      }
    }
    return widgets;
  }
}

/**
 *
 * A wrapper around a widget repository that delays creating it
 * until the first call to getWidgets().
 *
 */
export class DelayedWidgetRepository implements IWidgetRepository {
  private _repo: AsyncCreate<IWidgetRepository|undefined>;

  constructor(_makeRepo: () => Promise<IWidgetRepository|undefined>) {
    this._repo = new AsyncCreate(_makeRepo);
  }

  public async getWidgets(): Promise<ICustomWidget[]> {
    const repo = await this._repo.get();
    if (!repo) { return []; }
    return repo.getWidgets();
  }
}

/**
 *
 * A wrapper around a list of widget repositories that concatenates
 * their results.
 *
 */
export class CombinedWidgetRepository implements IWidgetRepository {
  constructor(private _repos: IWidgetRepository[]) {}

  public async getWidgets(): Promise<ICustomWidget[]> {
    const allWidgets: ICustomWidget[] = [];
    for (const repo of this._repos) {
      allWidgets.push(...await repo.getWidgets());
    }
    return allWidgets;
  }
}

/**
 * Repository that gets a list of widgets from a URL.
 */
export class UrlWidgetRepository implements IWidgetRepository {
  constructor(private _staticUrl = STATIC_URL,
              private _required: boolean = true) {}

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
      if (this._required) {
        if (!(err instanceof ApiError)) {
          throw new ApiError(String(err), 500);
        }
        throw err;
      } else {
        log.error("WidgetRepository: Error fetching widget list - " +
            String(err));
        return [];
      }
    }
  }
}

/**
 * Default repository that gets list of available widgets from multiple
 * sources.
 */
export class WidgetRepositoryImpl implements IWidgetRepository {
  protected _staticUrl: string|undefined;
  private _diskWidgets?: IWidgetRepository;
  private _urlWidgets: UrlWidgetRepository;
  private _combinedWidgets: CombinedWidgetRepository;

  constructor(_options: {
    staticUrl?: string,
    gristServer?: GristServer,
  }) {
    const {staticUrl, gristServer} = _options;
    if (gristServer) {
      this._diskWidgets = new DelayedWidgetRepository(async () => {
        const places = getWidgetsInPlugins(gristServer);
        const files = places.map(
          place => new DiskWidgetRepository(
            place.file,
            place.urlBase,
            {
              pluginId: place.pluginId,
              name: place.name
            }));
        return new CombinedWidgetRepository(files);
      });
    }
    this.testSetUrl(staticUrl);
  }

  /**
   * Method exposed for testing, overrides widget url.
   */
  public testOverrideUrl(overrideUrl: string|undefined) {
    this.testSetUrl(overrideUrl);
  }

  public testSetUrl(overrideUrl: string|undefined) {
    const repos: IWidgetRepository[] = [];
    this._staticUrl = overrideUrl ?? STATIC_URL;
    if (this._staticUrl) {
      const optional = isAffirmative(process.env.GRIST_WIDGET_LIST_URL_OPTIONAL);
      this._urlWidgets = new UrlWidgetRepository(this._staticUrl,
                                                 !optional);
      repos.push(this._urlWidgets);
    }
    if (this._diskWidgets) { repos.push(this._diskWidgets); }
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
    return list;
  }

  public testOverrideUrl(overrideUrl: string) {
    super.testOverrideUrl(overrideUrl);
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
  return new CachedWidgetRepository({
    gristServer,
    ...(options?.localOnly ? { staticUrl: '' } : undefined)
  });
}

function fixUrls(widgets: ICustomWidget[], baseUrl: string) {
  // If URLs are relative, make them absolute, interpreting them
  // relative to the supplied base.
  for (const widget of widgets) {
    if (!(url.parse(widget.url).protocol)) {
      widget.url = new URL(widget.url, baseUrl).href;
    }
  }
}

/**
 * Information about widgets in a plugin. We need to coordinate
 * URLs with location on disk.
 */
export interface CustomWidgetsInPlugin {
  pluginId: string,
  urlBase: string,
  dir: string,
  file: string,
  name: string,
}

/**
 * Get a list of widgets available locally via plugins.
 */
export function getWidgetsInPlugins(gristServer: GristServer,
                                    pluginUrl?: string) {
  const places: CustomWidgetsInPlugin[] = [];
  const plugins = gristServer.getPlugins();
  pluginUrl = pluginUrl ?? gristServer.getPluginUrl();
  if (pluginUrl === undefined) { return []; }
  for (const plugin of plugins) {
    const components = plugin.manifest.components;
    if (!components.widgets) { continue; }
    const urlBase =
        removeTrailingSlash(pluginUrl) + '/v/' +
        gristServer.getTag() + '/widgets/' + plugin.id + '/';
    places.push({
      urlBase,
      dir: path.resolve(plugin.path, path.dirname(components.widgets)),
      file: path.join(plugin.path, components.widgets),
      name: plugin.manifest.name || plugin.id,
      pluginId: plugin.id,
    });
  }
  return places;
}
