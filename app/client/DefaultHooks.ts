import { UrlTweaks } from 'app/common/gristUrls';
import { IAttrObj } from 'grainjs';

export interface IHooks {
  iframeAttributes?: Record<string, any>,
  fetch?: typeof fetch,
  baseURI?: string,
  urlTweaks?: UrlTweaks,

  /**
   * Modify the attributes of an <a> dom element.
   * Convenient in grist-static to directly hook up a
   * download link with the function that provides the data.
   */
  maybeModifyLinkAttrs(attrs: IAttrObj): IAttrObj;
}

export const defaultHooks: IHooks = {
  maybeModifyLinkAttrs(attrs: IAttrObj) {
    return attrs;
  }
};
