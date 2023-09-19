import {showBehavioralPrompt} from 'app/client/components/modals';
import {AppModel} from 'app/client/models/AppModel';
import {getUserPrefObs} from 'app/client/models/UserPrefs';
import {GristBehavioralPrompts} from 'app/client/ui/GristTooltips';
import {isNarrowScreen} from 'app/client/ui2018/cssVars';
import {BehavioralPrompt, BehavioralPromptPrefs} from 'app/common/Prefs';
import {getGristConfig} from 'app/common/urlUtils';
import {Computed, Disposable, dom, Observable} from 'grainjs';
import {IPopupOptions} from 'popweasel';

export interface AttachOptions {
  /** Defaults to false. */
  forceShow?: boolean;
  /** Defaults to false. */
  hideArrow?: boolean;
  /** Defaults to false. */
  hideDontShowTips?: boolean;
  /** Defaults to true. */
  markAsSeen?: boolean;
  /** Defaults to false. */
  showOnMobile?: boolean;
  popupOptions?: IPopupOptions;
  onDispose?(): void;
  shouldShow?(): boolean;
}

interface QueuedTip {
  prompt: BehavioralPrompt;
  refElement: Element;
  options: AttachOptions;
}

/**
 * Manages tips that are shown the first time a user performs some action.
 *
 * Tips are shown in the order that they are attached.
 */
export class BehavioralPromptsManager extends Disposable {
  private _isDisabled: boolean = false;

  private readonly _prefs = getUserPrefObs(this._appModel.userPrefsObs, 'behavioralPrompts',
    { defaultValue: { dontShowTips: false, dismissedTips: [] } }) as Observable<BehavioralPromptPrefs>;

  private _dismissedTips: Computed<Set<BehavioralPrompt>> = Computed.create(this, use => {
    const {dismissedTips} = use(this._prefs);
    return new Set(dismissedTips.filter(BehavioralPrompt.guard));
  });

  private _queuedTips: QueuedTip[] = [];

  constructor(private _appModel: AppModel) {
    super();
  }

  public showTip(refElement: Element, prompt: BehavioralPrompt, options: AttachOptions = {}) {
    this._queueTip(refElement, prompt, options);
  }

  public attachTip(prompt: BehavioralPrompt, options: AttachOptions = {}) {
    return (element: Element) => {
      this._queueTip(element, prompt, options);
    };
  }

  public hasSeenTip(prompt: BehavioralPrompt) {
    return this._dismissedTips.get().has(prompt);
  }

  public shouldShowTips() {
    return !this._prefs.get().dontShowTips;
  }

  public enable() {
    this._isDisabled = false;
  }

  public disable() {
    this._isDisabled = true;
  }

  public reset() {
    this._prefs.set({...this._prefs.get(), dismissedTips: [], dontShowTips: false});
    this.enable();
  }

  private _queueTip(refElement: Element, prompt: BehavioralPrompt, options: AttachOptions) {
    if (!this._shouldQueueTip(prompt, options)) { return; }

    this._queuedTips.push({prompt, refElement, options});
    if (this._queuedTips.length > 1) {
      // If we're already showing a tip, wait for that one to be dismissed, which will
      // cause the next one in the queue to be shown.
      return;
    }

    this._showTip(refElement, prompt, options);
  }

  private _showTip(refElement: Element, prompt: BehavioralPrompt, options: AttachOptions) {
    const close = () => {
      if (!ctl.isDisposed()) {
        ctl.close();
      }
    };

    const {hideArrow, hideDontShowTips, markAsSeen = true, onDispose, popupOptions} = options;
    const {title, content} = GristBehavioralPrompts[prompt];
    const ctl = showBehavioralPrompt(refElement, title(), content(), {
      onClose: (dontShowTips) => {
        if (dontShowTips) { this._dontShowTips(); }
        if (markAsSeen) { this._markAsSeen(prompt); }
      },
      hideArrow,
      popupOptions,
      hideDontShowTips,
    });

    ctl.onDispose(() => {
      onDispose?.();
      this._showNextQueuedTip();
    });
    dom.onElem(refElement, 'click', () => close());
    dom.onDisposeElem(refElement, () => close());
  }

  private _showNextQueuedTip() {
    this._queuedTips.shift();
    if (this._queuedTips.length !== 0) {
      const [nextTip] = this._queuedTips;
      const {refElement, prompt, options} = nextTip;
      this._showTip(refElement, prompt, options);
    }
  }

  private _markAsSeen(prompt: BehavioralPrompt) {
    const {dismissedTips} = this._prefs.get();
    const newDismissedTips = new Set(dismissedTips);
    newDismissedTips.add(prompt);
    this._prefs.set({...this._prefs.get(), dismissedTips: [...newDismissedTips]});
  }

  private _dontShowTips() {
    this._prefs.set({...this._prefs.get(), dontShowTips: true});
    this._queuedTips = [];
  }

  private _shouldQueueTip(prompt: BehavioralPrompt, options: AttachOptions) {
    if (
      this._isDisabled ||
      options.shouldShow?.() === false ||
      (isNarrowScreen() && !options.showOnMobile) ||
      (this._prefs.get().dontShowTips && !options.forceShow) ||
      this.hasSeenTip(prompt)
    ) {
      return false;
    }

    const {deploymentType} = getGristConfig();
    const {deploymentTypes} = GristBehavioralPrompts[prompt];
    if (
      deploymentTypes !== '*' &&
      (!deploymentType || !deploymentTypes.includes(deploymentType))
    ) {
      return false;
    }

    return true;
  }
}
