import { Disposable, dom, styled } from 'grainjs';
import { getGristConfig } from 'app/common/urlUtils';
import { safeJsonParse } from 'app/common/gutil';
import { get as getBrowserGlobals } from 'app/client/lib/browserGlobals';
import { getStorage } from 'app/client/lib/storage';
import { confirmModal } from 'app/client/ui2018/modals';
import { cssLink } from 'app/client/ui2018/links';
import { makeT } from 'app/client/lib/localization';

const t = makeT('Experiments');

const G = getBrowserGlobals('document', 'window');

const EXPERIMENTS = {
  newRecordButton: () => t('New record button'),
};

type Experiment = keyof typeof EXPERIMENTS;

const EXPERIMENT_URL_PARAM = 'experiment';

export class Experiments extends Disposable {
  constructor(private _userId: number) {
    super();
  }

  public isEnabled(experiment: Experiment) {
    const experimentState = this._getExperimentState(experiment);
    return experimentState.enabled;
  }

  /**
   * Returns whether or not the user wants to show the experiments modal.
   */
  public isRequested() {
    const urlExperiment = this.getCurrentRequest();
    return urlExperiment && this._isSupported(urlExperiment);
  }

  /**
   * Returns the experiment that the user wants to show the modal for.
   */
  public getCurrentRequest() {
    const searchParams = new URLSearchParams(G.window.location.search);
    return searchParams.get(EXPERIMENT_URL_PARAM);
  }

  /**
   * Shows the modal for the given experiment, allowing the user to enable or disable it.
   */
  public showModal(experiment: string) {
    if (!this._isSupported(experiment)) {
      return;
    }

    const experimentState = this._getExperimentState(experiment);
    const alreadyEnabled = experimentState.enabled;
    const experimentLabel = dom('strong', EXPERIMENTS[experiment as keyof typeof EXPERIMENTS]());

    confirmModal(
      t('Experimental feature'),
      alreadyEnabled ? t('Disable feature') : t('Enable feature'),
      () => {
        this._setExperimentState(experiment, !alreadyEnabled);
        this._showFeedbackModal(experiment, !alreadyEnabled);
      },
      {
        explanation: cssWrapper(
          dom('p', dom.cls(cssWrapper.className), alreadyEnabled
            ? t('You are about to disable this experimental feature: {{experiment}}', {
              experiment: experimentLabel,
            })
            : t('You are about to enable this experimental feature: {{experiment}}', {
              experiment: experimentLabel,
            }),
          ),
          !alreadyEnabled ? dom('p', t("Don't worry, you can disable it later if needed.")) : null,
        ),
        modalOptions: {
          noEscapeKey: true,
          noClickAway: true,
          onCancel: this._cleanAndReloadUrl,
        },
      },
    );
  }

  /**
   * Show a modal for user feedback after toggling an experiment
   */
  private _showFeedbackModal(experiment: string, nowEnabled: boolean) {
    const experimentUrl = new URL(getGristConfig().homeUrl || window.location.href);
    experimentUrl.searchParams.set(EXPERIMENT_URL_PARAM, experiment);
    const urlBlock = cssLink(
      {href: experimentUrl.toString()},
      experimentUrl.toString(),
    );
    const experimentLabel = dom('strong', EXPERIMENTS[experiment as keyof typeof EXPERIMENTS]());
    confirmModal(
      t('Experimental feature'),
      t('Reload the page'),
      this._cleanAndReloadUrl,
      {
        explanation: cssWrapper(
          dom('p', nowEnabled
            ? t('{{experiment}} enabled.', {experiment: experimentLabel})
            : t('{{experiment}} disabled.', {experiment: experimentLabel}),
          ),
          nowEnabled
            ? dom(
              'p',
              dom.cls(cssWrapper.className),
              t('Visit this URL at any time to stop using this feature: {{url}}', {url: urlBlock}),
            )
            : null,
        ),
        hideCancel: true,
        modalOptions: {
          onCancel: this._cleanAndReloadUrl,
        },
      },
    );
  }

  private _isSupported(experiment: string) {
    return EXPERIMENTS.hasOwnProperty(experiment);
  }

  private _getExperimentState(experiment: string): {enabled: boolean, timestamp: number|null} {
    return safeJsonParse(
      getStorage().getItem(this._getStorageKey(experiment)) || '',
      {enabled: false, timestamp: null},
    );
  }

  private _setExperimentState(experiment: string, enabled: boolean) {
    getStorage().setItem(
      this._getStorageKey(experiment),
      JSON.stringify({enabled, timestamp: Date.now()}),
    );
  }

  private _getStorageKey(experiment: string) {
    return `u=${this._userId}:experiment=${experiment}`;
  }

  /**
   * Removes the current experiment URL param and reloads the page.
   */
  private _cleanAndReloadUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete(EXPERIMENT_URL_PARAM);
    window.location.href = url.toString();
  }
}

const cssWrapper = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 0;
  & > p {
    margin-bottom: 0;
  }
`);
