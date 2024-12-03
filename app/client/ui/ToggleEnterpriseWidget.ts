import {makeT} from 'app/client/lib/localization';
import {markdown} from 'app/client/lib/markdown';
import {Computed, Disposable, dom, makeTestId} from "grainjs";
import {commonUrls} from "app/common/gristUrls";
import {ToggleEnterpriseModel} from 'app/client/models/ToggleEnterpriseModel';
import {
  cssOptInButton,
  cssOptOutButton,
  cssParagraph,
  cssSection,
} from 'app/client/ui/AdminTogglesCss';


const t = makeT('ToggleEnterprsiePage');
const testId = makeTestId('test-toggle-enterprise-page-');

export class ToggleEnterpriseWidget extends Disposable {
  private readonly _model: ToggleEnterpriseModel = new ToggleEnterpriseModel();
  private readonly _isEnterprise = Computed.create(this, this._model.edition, (_use, edition) => {
    return edition === 'enterprise';
  }).onWrite(async (enabled) => {
    await this._model.updateEnterpriseToggle(enabled ? 'enterprise' : 'core');
  });

  constructor() {
    super();
    this._model.fetchEnterpriseToggle().catch(reportError);
  }

  public getEnterpriseToggleObservable() {
    return this._isEnterprise;
  }

  public buildEnterpriseSection() {
    return cssSection(
      dom.domComputed(this._isEnterprise, (enterpriseEnabled) => {
        return [
          enterpriseEnabled ?
            cssParagraph(
              markdown(t('Grist Enterprise is **enabled**.')),
              testId('enterprise-opt-out-message'),
            ) : null,
          cssParagraph(
            markdown(t(`An activation key is used to run Grist Enterprise after a trial period
of 30 days has expired. Get an activation key by [contacting us]({{contactLink}}) today. You do
not need an activation key to run Grist Core.

Learn more in our [Help Center]({{helpCenter}}).`, {
                contactLink: commonUrls.contact,
                helpCenter: commonUrls.helpEnterpriseOptIn
            }))
          ),
          this._buildEnterpriseSectionButtons(),
        ];
      }),
      testId('enterprise-opt-in-section'),
    );
  }

  public _buildEnterpriseSectionButtons() {
    return dom.domComputed(this._isEnterprise, (enterpriseEnabled) => {
      if (enterpriseEnabled) {
        return [
          cssOptOutButton(t('Disable Grist Enterprise'),
            dom.on('click', () => this._isEnterprise.set(false)),
          ),
        ];
      } else {
        return [
          cssOptInButton(t('Enable Grist Enterprise'),
            dom.on('click', () => this._isEnterprise.set(true)),
          ),
        ];
      }
    });
  }
}
