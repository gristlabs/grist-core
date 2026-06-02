import { ExternalAttachmentBanner } from "app/client/components/ExternalAttachmentBanner";
import { VersionUpdateBanner } from "app/client/components/VersionUpdateBanner";
import { AppModel } from "app/client/models/AppModel";
import { DocPageModel } from "app/client/models/DocPageModel";

import { dom } from "grainjs";

export function buildHomeBanners(app: AppModel) {
  return dom.create(VersionUpdateBanner, app);
}

export function buildDocumentBanners(docPageModel: DocPageModel) {
  return [
    dom.create(VersionUpdateBanner, docPageModel.appModel),
    dom.create(ExternalAttachmentBanner, docPageModel),
  ];
}
