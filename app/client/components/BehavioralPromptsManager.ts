import {showNewsPopup, showTipPopup} from 'app/client/components/modals';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import {AppModel} from 'app/client/models/AppModel';
import {getUserPrefObs} from 'app/client/models/UserPrefs';
import {GristBehavioralPrompts} from 'app/client/ui/GristTooltips';
import {isNarrowScreen} from 'app/client/ui2018/cssVars';
import {BehavioralPrompt, BehavioralPromptPrefs} from 'app/common/Prefs';
import {getGristConfig} from 'app/common/urlUtils';
import {Computed, Disposable, dom, Observable} from 'grainjs';
import {IPopupOptions, PopupControl} from 'popweasel';

/**
 * Options for showing a popup.
 */
export interface ShowPopupOptions {
  /** Defaults to `false`. Only applies to "tip" popups. */
  hideArrow?: boolean;
  popupOptions?: IPopupOptions;
  onDispose?(): void;
}

/**
 * Options for attaching a popup to a DOM element.
 */
export interface AttachPopupOptions extends ShowPopupOptions {
  /**
   * Optional callback that should return true if the popup should be disabled.
   *
   * If omitted, the popup is enabled.
   */
  isDisabled?(): boolean;
}

interface QueuedPopup {
  prompt: BehavioralPrompt;
  refElement: Element;
  options: ShowPopupOptions;
}

/**
 * Manages popups for product announcements and tips.
 *
 * Popups are shown in the order that they are attached, with at most one popup
 * visible at any point in time. Popups that aren't visible are queued until all
 * preceding popups have been dismissed.
 */
export class BehavioralPromptsManager extends Disposable {
  private _isDisabled: boolean = false;

  private readonly _prefs = getUserPrefObs(this._appModel.userPrefsObs, 'behavioralPrompts',
    { defaultValue: { dontShowTips: false, dismissedTips: [] } }) as Observable<BehavioralPromptPrefs>;

  private _dismissedPopups: Computed<Set<BehavioralPrompt>> = Computed.create(this, use => {
    const {dismissedTips} = use(this._prefs);
    return new Set(dismissedTips.filter(BehavioralPrompt.guard));
  });

  private _queuedPopups: QueuedPopup[] = [];

  private _activePopupCtl: PopupControl<IPopupOptions>;

  constructor(private _appModel: AppModel) {
    super();
  }

  public showPopup(refElement: Element, prompt: BehavioralPrompt, options: ShowPopupOptions = {}) {
    this._queuePopup(refElement, prompt, options);
  }

  public attachPopup(prompt: BehavioralPrompt, options: AttachPopupOptions = {}) {
    return (element: Element) => {
      if (options.isDisabled?.()) { return; }

      this._queuePopup(element, prompt, options);
    };
  }

  public hasSeenPopup(prompt: BehavioralPrompt) {
    return this._dismissedPopups.get().has(prompt);
  }

  public shouldShowPopup(prompt: BehavioralPrompt): boolean {
    if (this._isDisabled) { return false; }

    // For non-SaaS flavors of Grist, don't show popups if the Help Center is explicitly
    // disabled. A separate opt-out feature could be added down the road for more granularity,
    // but will require communication in advance to avoid disrupting users.
    const {deploymentType, features} = getGristConfig();
    if (
      !features?.includes('helpCenter') &&
      // This one is an easter egg, so we make an exception.
      prompt !== 'rickRow'
    ) {
      return false;
    }

    const {
      popupType,
      audience = 'everyone',
      deviceType = 'desktop',
      deploymentTypes,
      forceShow = false,
    } = GristBehavioralPrompts[prompt];

    if (
      (audience === 'anonymous-users' && this._appModel.currentValidUser) ||
      (audience === 'signed-in-users' && !this._appModel.currentValidUser)
    ) {
      return false;
    }

    if (
      deploymentTypes !== 'all' &&
      (!deploymentType || !deploymentTypes.includes(deploymentType))
    ) {
      return false;
    }

    const currentDeviceType = isNarrowScreen() ? 'mobile' : 'desktop';
    if (deviceType !== 'all' && deviceType !== currentDeviceType) { return false; }

    return (
      forceShow ||
      (popupType === 'news' && !this.hasSeenPopup(prompt)) ||
      (!this._prefs.get().dontShowTips && !this.hasSeenPopup(prompt))
    );
  }

  public enable() {
    this._isDisabled = false;
  }

  public disable() {
    this._isDisabled = true;
    this._removeQueuedPopups();
    this._removeActivePopup();
  }

  public isDisabled() {
    return this._isDisabled;
  }

  public reset() {
    this._prefs.set({...this._prefs.get(), dismissedTips: [], dontShowTips: false});
    this.enable();
  }

  private _queuePopup(refElement: Element, prompt: BehavioralPrompt, options: ShowPopupOptions) {
    if (!this.shouldShowPopup(prompt)) { return; }

    this._queuedPopups.push({prompt, refElement, options});
    if (this._queuedPopups.length > 1) {
      // If we're already showing a popup, wait for that one to be dismissed, which will
      // cause the next one in the queue to be shown.
      return;
    }

    this._showPopup(refElement, prompt, options);
  }

  private _showPopup(refElement: Element, prompt: BehavioralPrompt, options: ShowPopupOptions) {
    const {hideArrow, onDispose, popupOptions} = options;
    const {popupType, title, content, hideDontShowTips = false, markAsSeen = true} = GristBehavioralPrompts[prompt];
    let ctl: PopupControl<IPopupOptions>;
    if (popupType === 'news') {
      ctl = showNewsPopup(refElement, title(), content(), {
        popupOptions,
      });
      ctl.onDispose(() => { if (markAsSeen) { this._markAsSeen(prompt); } });
    } else if (popupType === 'tip') {
      ctl = showTipPopup(refElement, title(), content(), {
        onClose: (dontShowTips) => {
          if (dontShowTips) { this._dontShowTips(); }
          if (markAsSeen) { this._markAsSeen(prompt); }
        },
        hideArrow,
        popupOptions,
        hideDontShowTips,
      });
    } else {
      throw new Error(`BehavioralPromptsManager received unknown popup type: ${popupType}`);
    }

    this._activePopupCtl = ctl;
    ctl.onDispose(() => {
      onDispose?.();
      this._showNextQueuedPopup();
    });
    const close = () => {
      if (!ctl.isDisposed()) {
        ctl.close();
      }
    };
    dom.onElem(refElement, 'click', () => close());
    dom.onDisposeElem(refElement, () => close());

    logTelemetryEvent('viewedTip', {full: {tipName: prompt}});
  }

  private _showNextQueuedPopup() {
    this._queuedPopups.shift();
    if (this._queuedPopups.length !== 0) {
      const [nextPopup] = this._queuedPopups;
      const {refElement, prompt, options} = nextPopup;
      this._showPopup(refElement, prompt, options);
    }
  }

  private _markAsSeen(prompt: BehavioralPrompt) {
    if (this._isDisabled) { return; }

    const {dismissedTips} = this._prefs.get();
    const newDismissedTips = new Set(dismissedTips);
    newDismissedTips.add(prompt);
    this._prefs.set({...this._prefs.get(), dismissedTips: [...newDismissedTips]});
  }

  private _dontShowTips() {
    if (this._isDisabled) { return; }

    this._prefs.set({...this._prefs.get(), dontShowTips: true});
    this._queuedPopups = this._queuedPopups.filter(({prompt}) => {
      return GristBehavioralPrompts[prompt].popupType !== 'tip';
    });
  }

  private _removeActivePopup() {
    if (this._activePopupCtl && !this._activePopupCtl.isDisposed()) {
      this._activePopupCtl.close();
    }
  }

  private _removeQueuedPopups() {
    this._queuedPopups = [];
  }
}
