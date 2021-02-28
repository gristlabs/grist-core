import {AppModel} from 'app/client/models/AppModel';
import {getUserOrgPrefObs} from 'app/client/models/UserPrefs';
import {IExampleInfo} from 'app/client/ui/ExampleInfo';
import {prepareForTransition, TransitionWatcher} from 'app/client/ui/transitions';
import {colors, mediaXSmall, testId, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {dom, Observable, styled} from 'grainjs';

let prevCardClose: (() => void)|null = null;

// Open a popup with a card introducing this example, if the user hasn't dismissed it in the past.
export function showExampleCard(
  example: IExampleInfo, appModel: AppModel, btnElem: HTMLElement, reopen: boolean = false
) {
  const prefObs: Observable<number[]|undefined> = getUserOrgPrefObs(appModel, 'seenExamples');
  const seenExamples = prefObs.get() || [];

  // If this example was previously dismissed, don't show the card, unless the user is reopening it.
  if (!reopen && seenExamples.includes(example.id)) {
    return;
  }

  // When an example card is closed, if it's the first time it's dismissed, save this fact, to avoid
  // opening the card again in the future.
  async function markAsSeen() {
    if (!seenExamples.includes(example.id)) {
      const seen = new Set(seenExamples);
      seen.add(example.id);
      prefObs.set([...seen].sort());
    }
  }

  // Close the example card.
  function close() {
    prevCardClose = null;
    collapseAndRemoveCard(cardElem, btnElem.getBoundingClientRect());
    // If we fail to save this preference, it's probably not worth alerting the user about,
    // so just log to console.
    // tslint:disable-next-line:no-console
    markAsSeen().catch((err) => console.warn("Failed to save userPref", err));
  }

  const card = example.welcomeCard;
  if (!card) { return null; }
  const cardElem = cssCard(
    cssImage({src: example.imgUrl}),
    cssBody(
      cssTitle(card.title),
      cssInfo(card.text),
      cssButtons(
        cssLinkBtn(cssLinkIcon('Page'), card.tutorialName,
          {href: example.tutorialUrl, target: '_blank'},
        ),
        // TODO: Add a link to the overview video (as popup or to a support page that shows the
        // video). Also include a 'Video' icon.
        // cssLinkBtn(cssLinkIcon('Video'), 'Grist Video Tour'),
      )
    ),
    cssCloseButton(cssBigIcon('CrossBig'),
      dom.on('click', close),
      testId('example-card-close'),
    ),
    testId('example-card'),
  );
  document.body.appendChild(cardElem);

  // When reopening, open the card smoothly, for a nicer-looking effect.
  if (reopen) {
    expandCard(cardElem, btnElem.getBoundingClientRect());
  }

  prevCardClose?.();
  prevCardClose = () => disposeCard(cardElem);
}

function disposeCard(cardElem: HTMLElement) {
  dom.domDispose(cardElem);
  cardElem.remove();
}

// When closing the card, collapse it visually into the button that can open it again, to hint to
// the user where to find that button. Remove the card after the animation.
function collapseAndRemoveCard(card: HTMLElement, collapsedRect: DOMRect) {
  const watcher = new TransitionWatcher(card);
  watcher.onDispose(() => disposeCard(card));
  collapseCard(card, collapsedRect);
}

// Implements the collapsing animation by simply setting a scale transform with a suitable origin.
function collapseCard(card: HTMLElement, collapsedRect: DOMRect) {
  const rect = card.getBoundingClientRect();
  const originX = (collapsedRect.left + collapsedRect.width / 2) - rect.left;
  const originY = (collapsedRect.top + collapsedRect.height / 2) - rect.top;
  Object.assign(card.style, {
    transform: `scale(${collapsedRect.width / rect.width}, ${collapsedRect.height / rect.height})`,
    transformOrigin: `${originX}px ${originY}px`,
    opacity: '0',
  });
}

// To expand the card visually, we reverse the process by collapsing it first with transitions
// disabled, then resetting properties to their defaults with transitions enabled again.
function expandCard(card: HTMLElement, collapsedRect: DOMRect) {
  prepareForTransition(card, () => collapseCard(card, collapsedRect));
  Object.assign(card.style, {
    transform: '',
    opacity: '',
    visibility: 'visible',
  });
}


const cssCard = styled('div', `
  position: absolute;
  left: 24px;
  bottom: 24px;
  margin-right: 24px;
  max-width: 624px;
  padding: 32px 56px 32px 32px;
  background-color: white;
  box-shadow: 0 2px 18px 0 rgba(31,37,50,0.31), 0 0 1px 0 rgba(76,86,103,0.24);
  display: flex;
  overflow: hidden;
  transition-property: opacity, transform;
  transition-duration: 0.5s;
  transition-timing-func: ease-in;
  --title-font-size: ${vars.headerControlFontSize};

  @media ${mediaXSmall} {
    & {
      flex-direction: column;
      padding: 32px;
      --title-font-size: 18px;
    }
  }
`);

const cssImage = styled('img', `
  flex: none;
  width: 180px;
  height: 140px;
  margin: 0 16px 0 -8px;
  @media ${mediaXSmall} {
    & {
      margin: auto;
    }
  }
`);

const cssBody = styled('div', `
  min-width: 0px;
`);

const cssTitle = styled('div', `
  font-size: var(--title-font-size);
  font-weight: ${vars.headerControlTextWeight};
  margin-bottom: 16px;
`);

const cssInfo = styled('div', `
  margin: 16px 0 24px 0;
  line-height: 1.6;
`);

const cssButtons = styled('div', `
  display: flex;
`);

const cssLinkBtn = styled(cssLink, `
  &:not(:last-child) {
    margin-right: 32px;
  }
`);

const cssLinkIcon = styled(icon, `
  margin-right: 8px;
  margin-top: -2px;
`);

const cssCloseButton = styled('div', `
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  --icon-color: ${colors.slate};

  &:hover {
    background-color: ${colors.mediumGreyOpaque};
  }
`);

const cssBigIcon = styled(icon, `
  padding: 12px;
`);
