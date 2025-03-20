import { Disposable, dom, Observable, styled } from 'grainjs';
import { get as getBrowserGlobals } from 'app/client/lib/browserGlobals';
import { testId } from 'app/client/lib/dom';
import { getStorage } from 'app/client/lib/storage';
import { confirmModal, cssModalBody, cssModalButtons, cssModalTitle, modal } from 'app/client/ui2018/modals';
import { bigPrimaryButton } from 'app/client/ui2018/buttons';
import { cssLink } from 'app/client/ui2018/links';
import { makeT } from 'app/client/lib/localization';
import { App } from 'app/client/ui/App';

const t = makeT('Experiments');

const G = getBrowserGlobals('document', 'window');

const EXPERIMENTS = {
  newRecordButton: () => t('New record button'),
};

type Experiment = keyof typeof EXPERIMENTS;

const EXPERIMENT_URL_PARAM = 'experiment';

export class Experiments extends Disposable {
  private _app: App;

  constructor(app: App) {
    super();
    this._app = app;
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

    // if the app is not initialized, wait and retry, we need the current user info
    const appObs = this._app.topAppModel.appObs;
    if (appObs.get() === null) {
      appObs.addListener((app, prevApp) => {
        if (app && prevApp === null) {
          this.showModal(experiment);
        }
      });
      return;
    }

    const experimentState = this._getExperimentState(experiment);

    const alreadyEnabled = experimentState.enabled;

    const experimentLabel = EXPERIMENTS[experiment as keyof typeof EXPERIMENTS]();
    const hasConfirmedModal = Observable.create(this, false);
    const urlBlock = `
      <a class="${cssLink.className}" href="${window.location.href}">
        ${window.location.href}
      </a>
    `;

    if (!hasConfirmedModal.get()) {
      confirmModal(
        t('Experimental feature'),
        alreadyEnabled ? t('Disable feature') : t('Enable feature'),
        () => {
          this._setExperimentState(experiment, !alreadyEnabled);
          hasConfirmedModal.set(true);
        },
        {
          explanation: cssWrapper(
            cssWrapper((el) => {
              el.innerHTML = t(
                alreadyEnabled
                  ? 'You are about to disable this experimental feature: {{- experiment}}'
                  : 'You are about to enable this experimental feature: {{- experiment}}',
                {experiment: `
                  <strong>
                    ${experimentLabel}
                  </strong>`}
              );
            }),
            !alreadyEnabled ? dom('p', t('This feature is experimental and may not work as expected.')) : null,
            cssWrapper((el) => {
              el.innerHTML = t(alreadyEnabled
                ? 'To start using it again, you can visit this URL at any time: {{- url}}'
                : 'Visit this URL at any time to stop using this feature: {{- url}}',
                { url: urlBlock }
              );
            }),
          )
        }
      );
    }

    // If the user just confirmed the feature toggle, feedback the change and force a page reload
    hasConfirmedModal.addListener((val) => {
      if (!val) {
        return;
      }
      modal(
        (ctl, owner) => {
          return [
            cssModalTitle(t('Experimental feature'), testId('modal-title')),
            cssModalBody(dom('div',
              dom('p', (el) => {
                el.innerHTML = t(
                  alreadyEnabled ? '{{- experiment}} disabled.' : '{{- experiment}} enabled.',
                  {experiment: `<strong>${experimentLabel}</strong>`}
                );
              })
            )),
            cssModalButtons(
              bigPrimaryButton(t('Reload the page'), dom.on('click', () => {
                const url = new URL(window.location.href);
                url.searchParams.delete(EXPERIMENT_URL_PARAM);
                window.location.href = url.toString();
              })),
            ),
          ];
        },
        {
          noEscapeKey: true,
          noClickAway: true,
        }
      );
    });
  }

  private _isSupported(experiment: string) {
    return !!(EXPERIMENTS[experiment as keyof typeof EXPERIMENTS]);
  }

  private _getExperimentState(experiment: string) {
    const localStorage = getStorage();
    const storageKey = this._getStorageKey(experiment);

    const experimentState = localStorage.getItem(storageKey)
      ? JSON.parse(localStorage.getItem(storageKey)!)
      : {enabled: false, timestamp: null};

    return experimentState;
  }

  private _setExperimentState(experiment: string, enabled: boolean) {
    const localStorage = getStorage();
    const storageKey = this._getStorageKey(experiment);
    localStorage.setItem(storageKey, JSON.stringify({enabled, timestamp: Date.now()}));
  }

  private _getStorageKey(experiment: string) {
    const userId = this._app.topAppModel.appObs.get()?.currentUser?.id || 0;
    return `u=${userId}:experiment=${experiment}`;
  }
}

const cssWrapper = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 1rem;
  & > p {
    margin-bottom: 0;
  }
`);
