import { UrlTweaks } from 'app/common/gristUrls';

export interface IHooks {
  iframeAttributes?: Record<string, any>,
  fetch?: typeof fetch,
  baseURI?: string,
  urlTweaks?: UrlTweaks,

  /**
   * Modify link options (href, download, etc). Convenient
   * in grist-static to directly hook up a link with the
   * source of data.
   */
  link(options: Record<string, any>): Record<string, any>;
}

export const defaultHooks: IHooks = {
  link(options: Record<string, any>) {
    return options;
  }
};
