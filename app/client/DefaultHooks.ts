import { UrlTweaks } from 'app/common/gristUrls';

export interface IHooks {
  iframeAttributes?: Record<string, any>,
  fetch?: typeof fetch,
  baseURI?: string,
  urlTweaks?: UrlTweaks,
}

export const defaultHooks: IHooks = {
};
