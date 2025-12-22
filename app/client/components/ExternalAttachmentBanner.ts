import { Banner, buildBannerMessage, cssBannerLink } from "app/client/components/Banner";
import { makeT } from "app/client/lib/localization";
import { localStorageJsonObs } from "app/client/lib/localStorageObs";
import { DocPageModel } from "app/client/models/DocPageModel";
import { urlState } from "app/client/models/gristUrlState";
import { PREFERRED_STORAGE_ANCHOR } from "app/common/gristUrls";

import { Disposable, dom, makeTestId, Observable } from "grainjs";

const t = makeT("ExternalAttachmentBanner");

const testId = makeTestId("test-external-attachment-banner-");

interface ShowExternalAttachmentBannerPrefer {
  dismissed: boolean,
}

// Modeled after VersionUpdateBanner.
export class ExternalAttachmentBanner extends Disposable {
  // Session storage observable. Set to false to dismiss the banner for the session.
  private _showBannerPref: Observable<ShowExternalAttachmentBannerPrefer>;

  constructor(private _docPageModel: DocPageModel) {
    super();
    this.autoDispose(this._docPageModel.currentDocId.addListener((docId) => {
      if (this._showBannerPref?.isDisposed() === false) {
        this._showBannerPref.dispose();
      }
      const userId = this._docPageModel.appModel.currentUser?.id ?? 0;
      this._showBannerPref = localStorageJsonObs(
        `u=${userId}:doc=${docId}:showExternalAttachmentBanner`,
        {
          dismissed: false,
        },
      );
    }));
  }

  public buildDom() {
    return dom.maybe(this._docPageModel.appModel.isOwner(), () => {
      return dom.domComputed((use) => {
        const usage = use(this._docPageModel.currentDocUsage);
        if (!usage?.usageRecommendations?.recommendExternal) {
          return;
        }

        const bannerPref = use(this._showBannerPref);
        if (bannerPref.dismissed) {
          return null;
        }

        return dom.create(Banner, {
          content: buildBannerMessage(
            getExternalStorageRecommendation(),
            testId("text"),
          ),
          style: "warning",
          showCloseButton: true,
          onClose: () => this._showBannerPref.set({
            dismissed: true,
          }),
        });
      });
    });
  }
}

/**
 * Get the text for the banner. This text is also shown
 * on the raw data page. It contains a link to a part of
 * the document settings page where external storage is
 * configured. The phrasing of the text is a little awkward
 * to make it more practical to translate, given that the
 * link text is separate from the main body of the text and
 * a translator may not see them together.
 */
export function getExternalStorageRecommendation() {
  return t(`Recommendation: {{storageRecommendation}}
When storing large attachments, or many of them, we recommend
keeping them in external storage. This document is currently
using internal storage for attachments, which keeps it
self-contained but may limit performance.`, {
    storageRecommendation: cssBannerLink(
      t("Set the document to use external storage."),
      urlState().setLinkUrl({
        docPage: "settings",
        hash: {
          anchor: PREFERRED_STORAGE_ANCHOR,
        },
      }),
    ),
  });
}
