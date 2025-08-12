import {GristLoadConfig} from "app/common/gristUrls";

declare global {
  export interface Window {
    gristConfig: GristLoadConfig;
  }
}
