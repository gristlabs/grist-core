import {Banner, buildBannerMessage} from 'app/client/components/Banner';
import {makeT} from 'app/client/lib/localization';
import {localStorageJsonObs} from 'app/client/lib/localStorageObs';
import {getGristConfig} from 'app/common/urlUtils';
import {Disposable, dom, makeTestId, Observable} from 'grainjs';
import {AppModel} from 'app/client/models/AppModel';

const t = makeT("VersionUpdateBanner");
const testId = makeTestId('test-version-update-banner-');

interface ShowVersionUpdateBannerPrefer {
  dismissed: boolean,
  version?: string,
}

export class VersionUpdateBanner extends Disposable {
  // Session storage observable. Set to false to dismiss the banner for the session.
  private _showVersionUpdateBannerPref: Observable<ShowVersionUpdateBannerPrefer>;

  constructor(private _appModel: AppModel) {
    super();
    const userId = this._appModel.currentUser?.id ?? 0;
    const {latestVersionAvailable} = getGristConfig();

    this._showVersionUpdateBannerPref = localStorageJsonObs(
      `u=${userId}:showVersionUpdateBanner`,
      {
        dismissed: false,
        version: latestVersionAvailable?.version
      }
    );
  }

  public buildDom() {
    return dom.maybe(this._appModel.isInstallAdmin(), () => {
      return dom.domComputed(use => {
        const {latestVersionAvailable} = getGristConfig();
        if(!latestVersionAvailable?.isNewer) {
          return null;
        }

        const bannerPref = use(this._showVersionUpdateBannerPref);
        // Need to check that *this* specific version has already been
        // dismissed.
        //
        // Although we only store one version as being dismissed at a
        // time, that should be okay. Conceptually, there is only one
        // "latest" version at a time that needs to be dismissed.
        if (bannerPref.version === latestVersionAvailable.version && bannerPref.dismissed) {
          return null;
        }

        return dom.create(Banner, {
          content: buildBannerMessage(
            t(`Your Grist version is outdated. ` +
              `Consider upgrading to version ${latestVersionAvailable.version} as soon as possible.`),
            testId('text')
          ),
          style: 'warning',
          showCloseButton: true,
          onClose: () => this._showVersionUpdateBannerPref.set({
            dismissed: true,
            version: latestVersionAvailable.version,
          }),
        });
      });
    });
  }
}
