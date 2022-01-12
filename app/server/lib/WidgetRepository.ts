import {ICustomWidget} from 'app/common/CustomWidget';
import * as log from 'app/server/lib/log';
import fetch from 'node-fetch';
import {ApiError} from 'app/common/ApiError';
import * as LRUCache from 'lru-cache';

/**
 * Widget Repository returns list of available Custom Widgets.
 */
export interface IWidgetRepository {
  getWidgets(): Promise<ICustomWidget[]>;
}

// Static url for StaticWidgetRepository
const STATIC_URL = process.env.GRIST_WIDGET_LIST_URL;

/**
 * Default repository that gets list of available widgets from a static URL.
 */
export class WidgetRepositoryImpl implements IWidgetRepository {
  constructor(protected _staticUrl = STATIC_URL) {}

  /**
   * Method exposed for testing, overrides widget url.
   */
  public testOverrideUrl(url: string) {
    this._staticUrl = url;
  }

  public async getWidgets(): Promise<ICustomWidget[]> {
    if (!this._staticUrl) {
      log.warn(
        'WidgetRepository: Widget repository is not configured.' + !STATIC_URL
          ? ' Missing GRIST_WIDGET_LIST_URL environmental variable.'
          : ''
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
 * Version of WidgetRepository that caches successful result for 2 minutes.
 */
class CachedWidgetRepository extends WidgetRepositoryImpl {
  private _cache = new LRUCache<1, ICustomWidget[]>({maxAge : 1000 * 60 /* minute */ * 2});
  public async getWidgets() {
    // Don't cache for localhost
    if (super._staticUrl && super._staticUrl.startsWith("http://localhost")) {
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

  public testOverrideUrl(url: string) {
    super.testOverrideUrl(url);
    this._cache.reset();
  }
}

/**
 * Returns widget repository implementation.
 */
export function buildWidgetRepository() {
  return new CachedWidgetRepository();
}
