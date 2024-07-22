import {FocusLayer} from 'app/client/lib/FocusLayer';
import {makeT} from 'app/client/lib/localization';
import {AppModel} from 'app/client/models/AppModel';
import {logError} from 'app/client/models/errors';
import {getMainOrgUrl, urlState} from 'app/client/models/gristUrlState';
import {getUserPrefObs} from 'app/client/models/UserPrefs';
import {textInput} from 'app/client/ui/inputs';
import {PlayerState, YouTubePlayer} from 'app/client/ui/YouTubePlayer';
import {bigBasicButton, bigPrimaryButton, bigPrimaryButtonLink} from 'app/client/ui2018/buttons';
import {colors, mediaMedium, mediaXSmall, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {IconName} from 'app/client/ui2018/IconList';
import {modal} from 'app/client/ui2018/modals';
import {BaseAPI} from 'app/common/BaseAPI';
import {getPageTitleSuffix, ONBOARDING_VIDEO_YOUTUBE_EMBED_ID} from 'app/common/gristUrls';
import {UserPrefs} from 'app/common/Prefs';
import {getGristConfig} from 'app/common/urlUtils';
import {
  Computed,
  Disposable,
  dom,
  DomContents,
  IDisposableOwner,
  input,
  makeTestId,
  Observable,
  styled,
  subscribeElem,
} from 'grainjs';

const t = makeT('OnboardingPage');

const testId = makeTestId('test-onboarding-');

const choices: Array<{icon: IconName, color: string, textKey: string}> = [
  {icon: 'UseProduct', color: `${colors.lightGreen}`, textKey: 'Product Development' },
  {icon: 'UseFinance', color: '#0075A2',              textKey: 'Finance & Accounting'},
  {icon: 'UseMedia',   color: '#F7B32B',              textKey: 'Media Production'    },
  {icon: 'UseMonitor', color: '#F2545B',              textKey: 'IT & Technology'     },
  {icon: 'UseChart',   color: '#7141F9',              textKey: 'Marketing'           },
  {icon: 'UseScience', color: '#231942',              textKey: 'Research'            },
  {icon: 'UseSales',   color: '#885A5A',              textKey: 'Sales'               },
  {icon: 'UseEducate', color: '#4A5899',              textKey: 'Education'           },
  {icon: 'UseHr',      color: '#688047',              textKey: 'HR & Management'     },
  {icon: 'UseOther',   color: '#929299',              textKey: 'Other'               },
];

export function shouldShowOnboardingPage(userPrefsObs: Observable<UserPrefs>): boolean {
  return Boolean(getGristConfig().survey && userPrefsObs.get()?.showNewUserQuestions);
}

type IncrementStep = (delta?: 1 | -1) => void;

interface Step {
  state?: QuestionsState | VideoState;
  buildDom(): DomContents;
  onNavigateAway?(): void;
}

interface QuestionsState {
  organization: Observable<string>;
  role: Observable<string>;
  useCases: Array<Observable<boolean>>;
  useOther: Observable<string>;
}

interface VideoState {
  watched: Observable<boolean>;
}

export class OnboardingPage extends Disposable {
  private _steps: Array<Step>;
  private _stepIndex: Observable<number> = Observable.create(this, 0);

  constructor(private _appModel: AppModel) {
    super();

    this.autoDispose(this._stepIndex.addListener((_, prevIndex) => {
      this._steps[prevIndex].onNavigateAway?.();
    }));

    const incrementStep: IncrementStep = (delta: -1 | 1 = 1) => {
      this._stepIndex.set(this._stepIndex.get() + delta);
    };

    this._steps = [
      {
        state: {
          organization: Observable.create(this, ''),
          role: Observable.create(this, ''),
          useCases: choices.map(() => Observable.create(this, false)),
          useOther: Observable.create(this, ''),
        },
        buildDom() { return dom.create(buildQuestions, incrementStep, this.state as QuestionsState); },
        onNavigateAway() { saveQuestions(this.state as QuestionsState); },
      },
      {
        state: {
          watched: Observable.create(this, false),
        },
        buildDom() { return dom.create(buildVideo, incrementStep, this.state as VideoState); },
      },
      {
        buildDom() { return dom.create(buildTutorial, incrementStep); },
      },
    ];

    document.title = `Welcome${getPageTitleSuffix(getGristConfig())}`;

    getUserPrefObs(this._appModel.userPrefsObs, 'showNewUserQuestions').set(undefined);
  }

  public buildDom() {
    return cssPageContainer(
      cssOnboardingPage(
        cssSidebar(
          cssSidebarContent(
            cssSidebarHeading1(t('Welcome')),
            cssSidebarHeading2(this._appModel.currentUser!.name + '!'),
            testId('sidebar'),
          ),
          cssGetStarted(
            cssGetStartedImg({src: 'img/get-started.png'}),
          ),
        ),
        cssMainPanel(
          buildStepper(this._steps, this._stepIndex),
          dom.domComputed(this._stepIndex, index => {
            return this._steps[index].buildDom();
          }),
        ),
        testId('page'),
      ),
    );
  }
}

function buildStepper(steps: Step[], stepIndex: Observable<number>) {
  return cssStepper(
    steps.map((_, i) =>
      cssStep(
        cssStepCircle(
          cssStepCircle.cls('-done', use => (i < use(stepIndex))),
          dom.domComputed(use => i < use(stepIndex), (done) => done ? icon('Tick') : String(i + 1)),
          cssStepCircle.cls('-current', use => (i === use(stepIndex))),
          dom.on('click', () => { stepIndex.set(i); }),
          testId(`step-${i + 1}`)
        )
      )
    )
  );
}

function saveQuestions(state: QuestionsState) {
  const {organization, role, useCases, useOther} = state;
  if (!organization.get() && !role.get() && !useCases.map(useCase => useCase.get()).includes(true)) {
    return;
  }

  const org_name = organization.get();
  const org_role = role.get();
  const use_cases = choices.filter((c, i) => useCases[i].get()).map(c => c.textKey);
  const use_other = use_cases.includes('Other') ? useOther.get() : '';
  const submitUrl = new URL(window.location.href);
  submitUrl.pathname = '/welcome/info';
  BaseAPI.request(submitUrl.href, {
    method: 'POST',
    body: JSON.stringify({org_name, org_role, use_cases, use_other})
  }).catch((e) => logError(e));
}

function buildQuestions(owner: IDisposableOwner, incrementStep: IncrementStep, state: QuestionsState) {
  const {organization, role, useCases, useOther} = state;
  const isFilled = Computed.create(owner, (use) => {
    return Boolean(use(organization) || use(role) || useCases.map(useCase => use(useCase)).includes(true));
  });

  return cssQuestions(
    cssHeading(t("Tell us who you are")),
    cssQuestion(
      cssFieldHeading(t('What organization are you with?')),
      cssInput(
        organization,
        {type: 'text', placeholder: t('Your organization')},
        testId('questions-organization'),
      ),
    ),
    cssQuestion(
      cssFieldHeading(t('What is your role?')),
      cssInput(
        role,
        {type: 'text', placeholder: t('Your role')},
        testId('questions-role'),
      ),
    ),
    cssQuestion(
      cssFieldHeading(t("What brings you to Grist (you can select multiple)?")),
      cssUseCases(
        choices.map((item, i) => cssUseCase(
          cssUseCaseIcon(icon(item.icon)),
          cssUseCase.cls('-selected', useCases[i]),
          dom.on('click', () => useCases[i].set(!useCases[i].get())),
          (item.icon !== 'UseOther' ?
            t(item.textKey) :
            [
              cssOtherLabel(t(item.textKey)),
              cssOtherInput(useOther, {}, {type: 'text', placeholder: t("Type here")},
                // The following subscribes to changes to selection observable, and focuses the input when
                // this item is selected.
                (elem) => subscribeElem(elem, useCases[i], val => val && setTimeout(() => elem.focus(), 0)),
                // It's annoying if clicking into the input toggles selection; better to turn that
                // off (user can click icon to deselect).
                dom.on('click', ev => ev.stopPropagation()),
                // Similarly, ignore Enter/Escape in "Other" textbox, so that they don't submit/close the form.
                dom.onKeyDown({
                  Enter: (ev, elem) => elem.blur(),
                  Escape: (ev, elem) => elem.blur(),
                }),
              )
            ]
          ),
          testId('questions-use-case'),
        )),
      ),
    ),
    cssContinue(
      bigPrimaryButton(
        t('Next step'),
        dom.show(isFilled),
        dom.on('click', () => incrementStep()),
        testId('next-step'),
      ),
      bigBasicButton(
        t('Skip step'),
        dom.hide(isFilled),
        dom.on('click', () => incrementStep()),
        testId('skip-step'),
      ),
    ),
    testId('questions'),
  );
}

function buildVideo(_owner: IDisposableOwner, incrementStep: IncrementStep, state: VideoState) {
  const {watched} = state;

  function onPlay() {
    watched.set(true);

    return modal((ctl, modalOwner) => {
      const youtubePlayer = YouTubePlayer.create(modalOwner,
        ONBOARDING_VIDEO_YOUTUBE_EMBED_ID,
        {
          onPlayerReady: (player) => player.playVideo(),
          onPlayerStateChange(_player, {data}) {
            if (data !== PlayerState.Ended) { return; }

            ctl.close();
          },
          height: '100%',
          width: '100%',
          origin: getMainOrgUrl(),
        },
        cssYouTubePlayer.cls(''),
      );

      return [
        dom.on('click', () => ctl.close()),
        elem => { FocusLayer.create(modalOwner, {defaultFocusElem: elem, pauseMousetrap: true}); },
        dom.onKeyDown({
          Escape: () => ctl.close(),
          ' ': () => youtubePlayer.playPause(),
        }),
        cssModalHeader(
          cssModalCloseButton(
            cssCloseIcon('CrossBig'),
          ),
        ),
        cssModalBody(
          cssVideoPlayer(
            dom.on('click', (ev) => ev.stopPropagation()),
            youtubePlayer.buildDom(),
            testId('video-player'),
          ),
          cssModalButtons(
            bigPrimaryButton(
              t('Next step'),
              dom.on('click', (ev) => {
                ev.stopPropagation();
                ctl.close();
                incrementStep();
              }),
            ),
          ),
        ),
        cssVideoPlayerModal.cls(''),
      ];
    });
  }

  return dom('div',
    cssHeading(t('Discover Grist in 3 minutes')),
    cssScreenshot(
      dom.on('click', onPlay),
      dom('div',
        cssScreenshotImg({src: 'img/youtube-screenshot.png'}),
        cssActionOverlay(
          cssAction(
            cssRoundButton(cssVideoPlayIcon('VideoPlay')),
          ),
        ),
      ),
      testId('video-thumbnail'),
    ),
    cssContinue(
      cssBackButton(
        t('Back'),
        dom.on('click', () => incrementStep(-1)),
        testId('back'),
      ),
      bigPrimaryButton(
        t('Next step'),
        dom.show(watched),
        dom.on('click', () => incrementStep()),
        testId('next-step'),
      ),
      bigBasicButton(
        t('Skip step'),
        dom.hide(watched),
        dom.on('click', () => incrementStep()),
        testId('skip-step'),
      ),
    ),
    testId('video'),
  );
}

function buildTutorial(_owner: IDisposableOwner, incrementStep: IncrementStep) {
  const {templateOrg, onboardingTutorialDocId} = getGristConfig();
  return dom('div',
    cssHeading(
      t('Go hands-on with the Grist Basics tutorial'),
      cssSubHeading(
        t("Grist may look like a spreadsheet, but it doesn't always "
          + "act like one. Discover what makes Grist different."
        ),
      ),
    ),
    cssTutorial(
      cssScreenshot(
        dom.on('click', () => urlState().pushUrl({org: templateOrg!, doc: onboardingTutorialDocId})),
        cssTutorialScreenshotImg({src: 'img/tutorial-screenshot.png'}),
        cssTutorialOverlay(
          cssAction(
            cssTutorialButton(t('Go to the tutorial!')),
          ),
        ),
        testId('tutorial-thumbnail'),
      ),
    ),
    cssContinue(
      cssBackButton(
        t('Back'),
        dom.on('click', () => incrementStep(-1)),
        testId('back'),
      ),
      bigBasicButton(
        t('Skip tutorial'),
        dom.on('click', () => window.location.href = urlState().makeUrl(urlState().state.get())),
        testId('skip-tutorial'),
      ),
    ),
    testId('tutorial'),
  );
}

const cssPageContainer = styled('div', `
  overflow: auto;
  height: 100%;
  background-color: ${theme.mainPanelBg};
`);

const cssOnboardingPage = styled('div', `
  display: flex;
  min-height: 100%;
`);

const cssSidebar = styled('div', `
  width: 460px;
  background-color: ${colors.lightGreen};
  color: ${colors.light};
  background-image:
    linear-gradient(to bottom, rgb(41, 185, 131) 32px, transparent 32px),
    linear-gradient(to right, rgb(41, 185, 131) 32px, transparent 32px);
  background-size: 240px 120px;
  background-position: 0 0, 40%;
  display: flex;
  flex-direction: column;

  @media ${mediaMedium} {
    & {
      display: none;
    }
  }
`);

const cssGetStarted = styled('div', `
  width: 500px;
  height: 350px;
  margin: auto -77px 0 37px;
  overflow: hidden;
`);

const cssGetStartedImg = styled('img', `
  display: block;
  width: 500px;
  height: auto;
`);

const cssSidebarContent = styled('div', `
  line-height: 32px;
  margin: 112px 16px 64px 16px;
  font-size: 24px;
  line-height: 48px;
  font-weight: 500;
`);

const cssSidebarHeading1 = styled('div', `
  font-size: 32px;
  text-align: center;
`);

const cssSidebarHeading2 = styled('div', `
  font-size: 28px;
  text-align: center;
`);

const cssMainPanel = styled('div', `
  margin: 56px auto;
  padding: 0px 96px;
  text-align: center;

  @media ${mediaMedium} {
    & {
      padding: 0px 32px;
    }
  }
`);

const cssHeading = styled('div', `
  color: ${theme.text};
  font-size: 24px;
  font-weight: 500;
  margin: 32px 0px;
`);

const cssSubHeading = styled(cssHeading, `
  font-size: 15px;
  font-weight: 400;
  margin-top: 16px;
`);

const cssStep = styled('div', `
  display: flex;
  align-items: center;
  cursor: default;

  &:not(:last-child)::after {
    content: "";
    width: 50px;
    height: 2px;
    background-color: var(--grist-color-light-green);
  }
`);

const cssStepCircle = styled('div', `
  --icon-color: ${theme.controlPrimaryFg};
  --step-color: ${theme.controlPrimaryBg};
  display: inline-block;
  width: 24px;
  height: 24px;
  border-radius: 30px;
  border: 1px solid var(--step-color);
  color: var(--step-color);
  margin: 4px;
  position: relative;
  cursor: pointer;

  &:hover {
    --step-color: ${theme.controlPrimaryHoverBg};
  }
  &-current {
    background-color: var(--step-color);
    color: ${theme.controlPrimaryFg};
    outline: 3px solid ${theme.cursorInactive};
  }
  &-done {
    background-color: var(--step-color);
  }
`);

const cssQuestions = styled('div', `
  max-width: 500px;
`);

const cssQuestion = styled('div', `
  margin: 16px 0 8px 0;
  text-align: left;
`);

const cssFieldHeading = styled('div', `
  color: ${theme.text};
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 12px;
`);

const cssContinue = styled('div', `
  display: flex;
  justify-content: center;
  margin-top: 40px;
  gap: 16px;
`);

const cssUseCases = styled('div', `
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: -8px -4px;
`);

const cssUseCase = styled('div', `
  flex: 1 0 40%;
  min-width: 200px;
  margin: 8px 4px 0 4px;
  height: 40px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 3px;
  display: flex;
  align-items: center;
  text-align: left;
  cursor: pointer;
  color: ${theme.text};
  --icon-color: ${theme.accentIcon};

  &:hover {
    background-color: ${theme.hover};
  }
  &-selected {
    border: 2px solid ${theme.controlFg};
  }
  &-selected:hover {
    border: 2px solid ${theme.controlHoverFg};
  }
  &-selected:focus-within {
    box-shadow: 0 0 2px 0px ${theme.controlFg};
  }
`);

const cssUseCaseIcon = styled('div', `
  margin: 0 16px;
  --icon-color: ${theme.accentIcon};
`);

const cssOtherLabel = styled('div', `
  display: block;

  .${cssUseCase.className}-selected & {
    display: none;
  }
`);

const cssInput = styled(textInput, `
  height: 40px;
`);

const cssOtherInput = styled(input, `
  color: ${theme.inputFg};
  display: none;
  border: none;
  background: none;
  outline: none;
  padding: 0px;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
  .${cssUseCase.className}-selected & {
    display: block;
  }
`);

const cssTutorial = styled('div', `
  display: flex;
  justify-content: center;
`);

const cssScreenshot = styled('div', `
  max-width: 720px;
  display: flex;
  position: relative;
  border-radius: 3px;
  border: 3px solid ${colors.lightGreen};
  overflow: hidden;
  cursor: pointer;
`);

const cssActionOverlay = styled('div', `
  position: absolute;
  z-index: 1;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.20);
`);

const cssTutorialOverlay = styled(cssActionOverlay, `
  background-color: transparent;
`);

const cssAction = styled('div', `
  display: flex;
  flex-direction: column;
  margin: auto;
  align-items: center;
  justify-content: center;
  height: 100%;
`);

const cssVideoPlayIcon = styled(icon, `
  --icon-color: ${colors.light};
  width: 38px;
  height: 33.25px;
`);

const cssCloseIcon = styled(icon, `
  --icon-color: ${colors.light};
  width: 22px;
  height: 22px;
`);

const cssYouTubePlayer = styled('iframe', `
  border-radius: 4px;
`);

const cssModalHeader = styled('div', `
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
`);

const cssModalBody = styled('div', `
  display: flex;
  flex-grow: 1;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`);

const cssBackButton = styled(bigBasicButton, `
  border: none;
`);

const cssModalButtons = styled('div', `
  display: flex;
  justify-content: center;
  margin-top: 24px;
`);

const cssVideoPlayer = styled('div', `
  width: 100%;
  max-width: 1280px;
  height: 100%;
  max-height: 720px;

  @media ${mediaXSmall} {
    & {
      max-height: 240px;
    }
  }
`);

const cssVideoPlayerModal = styled('div', `
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  padding: 8px;
  background-color: transparent;
  box-shadow: none;
`);

const cssModalCloseButton = styled('div', `
  margin-bottom: 8px;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background-color: ${theme.hover};
  }
`);

const cssScreenshotImg = styled('img', `
  transform: scale(1.2);
  width: 100%;
`);

const cssTutorialScreenshotImg = styled('img', `
  width: 100%;
  opacity: 0.4;
`);

const cssRoundButton = styled('div', `
  width: 75px;
  height: 75px;
  flex-shrink: 0;
  border-radius: 100px;
  background: ${colors.lightGreen};
  display: flex;
  align-items: center;
  justify-content: center;
  --icon-color: var(--light, #FFF);

  .${cssScreenshot.className}:hover & {
    background: ${colors.darkGreen};
  }
`);

const cssStepper = styled('div', `
  display: flex;
  justify-content: center;
  text-align: center;
  font-size: 14px;
  font-style: normal;
  font-weight: 700;
  line-height: 20px;
  text-transform: uppercase;
`);

const cssTutorialButton = styled(bigPrimaryButtonLink, `
  .${cssScreenshot.className}:hover & {
    background-color: ${theme.controlPrimaryHoverBg};
    border-color: ${theme.controlPrimaryHoverBg};
  }
`);
