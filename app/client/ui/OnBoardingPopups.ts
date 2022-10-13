/**
 * Utility to generate a series of onboarding popups. It is used to give users a short description
 * of some elements of the UI. The first step is to create the list of messages following the
 * `IOnBoardingMsg` interface. Then you have to attach each message to its corresponding element of
 * the UI using the `attachOnBoardingMsg' dom method:
 *
 *  Usage:
 *
 *    // create the list of message
 *    const messages = [{id: 'add-new-btn', placement: 'right', buildDom: () => ... },
 *                      {id: 'share-btn', buildDom: () => ... ];
 *
 *
 *    // attach each message to the corresponding element
 *    dom('div', 'Add New', ..., dom.cls('tour-add-new-btn'));
 *
 *    // start
 *    startOnBoarding(message, onFinishCB);
 *
 * Note:
 * - this module does UI only, saving which user has already seen the popups has to be handled by
 *   the caller. Pass an `onFinishCB` to handle when a user dimiss the popups.
 */

import { Disposable, dom, DomElementArg, Holder, makeTestId, styled, svg } from "grainjs";
import { createPopper, Placement } from '@popperjs/core';
import { FocusLayer } from 'app/client/lib/FocusLayer';
import {t} from 'app/client/lib/localization';
import * as Mousetrap from 'app/client/lib/Mousetrap';
import { bigBasicButton, bigPrimaryButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import range = require("lodash/range");
import {IGristUrlState} from "app/common/gristUrls";
import {urlState} from "app/client/models/gristUrlState";
import {delay} from "app/common/delay";
import {reportError} from "app/client/models/errors";
import {cssBigIcon, cssCloseButton} from "./ExampleCard";

const translate = (x: string, args?: any): string => t(`OnBoardingPopups.${x}`, args);

const testId = makeTestId('test-onboarding-');

// Describes an onboarding popup. Each popup is uniquely identified by its id.
export interface IOnBoardingMsg {

  // A CSS selector pointing to the reference element
  selector: string,

  // Title
  title: DomElementArg,

  // Body
  body?: DomElementArg,

  // If true show the message as a modal centered on the screen.
  showHasModal?: boolean,

  // The popper placement.
  placement?: Placement,

  // Adjusts the popup offset so that it is positioned relative to the content of the reference
  // element. This is useful when the reference element has padding and no border (ie: such as
  // icons). In which case, and when set to true, it will fill the gap between popups and the UI
  // part it's pointing at. If `cropPadding` is falsy otherwise, the popup might look a bit distant.
  cropPadding?: boolean,

  // The popper offset.
  offset?: [number, number],

  // Skip the message
  skip?: boolean;

  // If present, will be passed to urlState().pushUrl() to navigate to the location defined by that state
  urlState?: IGristUrlState;
}

// There should only be one tour at a time. Use a holder to dispose the previous tour when
// starting a new one.
const tourSingleton = Holder.create<OnBoardingPopupsCtl>(null);

export function startOnBoarding(messages: IOnBoardingMsg[], onFinishCB: () => void) {
  const ctl = OnBoardingPopupsCtl.create(tourSingleton, messages, onFinishCB);
  ctl.start().catch(reportError);
}

// Returns whether some tour is currently active.
export function isTourActive(): boolean {
  return !tourSingleton.isEmpty();
}

class OnBoardingError extends Error {
  public name = 'OnBoardingError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Current index in the list of messages.
 * This allows closing the tour and reopening where you left off.
 * Since it's a single global value, mixing unrelated tours
 * (e.g. the generic welcome tour and a specific document tour)
 * in a single page load won't work well.
 */
let ctlIndex = 0;

class OnBoardingPopupsCtl extends Disposable {
  private _openPopupCtl: {close: () => void}|undefined;
  private _overlay: HTMLElement;
  private _arrowEl = buildArrow();

  constructor(private _messages: IOnBoardingMsg[], private _onFinishCB: () => void) {
    super();
    if (this._messages.length === 0) {
      throw new OnBoardingError('messages should not be an empty list');
    }

    // In case we're reopening after deleting some rows of GristDocTour,
    // ensure ctlIndex is still within bounds
    ctlIndex = Math.min(ctlIndex, this._messages.length - 1);

    this.onDispose(() => {
      this._openPopupCtl?.close();
    });
  }

  public async start() {
    this._showOverlay();
    await this._move(0);
    Mousetrap.setPaused(true);
    this.onDispose(() => {
      Mousetrap.setPaused(false);
    });
  }

  private _finish() {
    this._onFinishCB();
    this.dispose();
  }

  private async _move(movement: number, maybeClose = false) {
    const newIndex = ctlIndex + movement;
    const entry = this._messages[newIndex];
    if (!entry) {
      if (maybeClose) {
        // User finished the tour, close and restart from the beginning if they reopen
        ctlIndex = 0;
        this._finish();
      }
      return;  // gone out of bounds, probably by keyboard shortcut
    }
    ctlIndex = newIndex;
    if (entry.skip) {
      // movement = 0 when starting a tour, make sure we don't get stuck in a loop
      await this._move(movement || +1);
      return;
    }

    // close opened popup if any
    this._openPopupCtl?.close();

    if (entry.urlState) {
      await urlState().pushUrl(entry.urlState);
      await delay(100);  // make sure cursor is in correct place
    }

    if (entry.showHasModal) {
      this._showHasModal();
    } else {
      await this._showHasPopup(movement);
    }
  }

  private async _showHasPopup(movement: number) {
    const content = this._buildPopupContent();
    const entry = this._messages[ctlIndex];
    const elem = document.querySelector<HTMLElement>(entry.selector);
    const {placement} = entry;

    // The element the popup refers to is not present. To the user we show nothing and simply skip
    // it to the next.
    if (!elem) {
      console.warn(`On boarding tour: element ${entry.selector} not found!`);
      // movement = 0 when starting a tour, make sure we don't get stuck in a loop
      return this._move(movement || +1);
    }

    // Cleanup
    function close() {
      popper.destroy();
      dom.domDispose(content);
      content.remove();
    }

    this._openPopupCtl = {close};
    document.body.appendChild(content);
    this._addFocusLayer(content);

    // Create a popper for positioning the popup content relative to the reference element
    const adjacentPadding = entry.cropPadding ? this._getAdjacentPadding(elem, placement) : 0;
    const popper = createPopper(elem, content, {
      placement,
      modifiers: [{
        name: 'arrow',
        options: {
          element: this._arrowEl,
        },
      }, {
        name: 'offset',
        options: {
          offset: [0, 12 - adjacentPadding],
        }
      }],
    });
  }

  private _addFocusLayer(container: HTMLElement) {
    dom.autoDisposeElem(container, new FocusLayer({
      defaultFocusElem: container,
      allowFocus: (elem) => (elem !== document.body)
    }));
  }

  // Get the padding length for the side that will be next to the popup.
  private _getAdjacentPadding(elem: HTMLElement, placement?: Placement) {
    if (placement) {
      let padding = '';
      if (placement.includes('bottom')) {
        padding = getComputedStyle(elem).paddingBottom;
      }
      else if (placement.includes('top')) {
        padding = getComputedStyle(elem).paddingTop;
      }
      else if (placement.includes('left')) {
        padding = getComputedStyle(elem).paddingLeft;
      }
      else if (placement.includes('right')) {
        padding = getComputedStyle(elem).paddingRight;
      }
      // Note: getComputedStyle return value in pixel, hence no need to handle other unit. See here
      // for reference:
      // https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle#notes.
      if (padding && padding.endsWith('px')) {
        return Number(padding.slice(0, padding.length - 2));
      }
    }
    return 0;
  }

  private _showHasModal() {
    const content = this._buildPopupContent();
    dom.update(this._overlay, content);
    this._addFocusLayer(content);

    function close() {
      content.remove();
      dom.domDispose(content);
    }

    this._openPopupCtl = {close};
  }

  private _buildPopupContent() {
    return Container(
      {tabindex: '-1'},
      this._arrowEl,
      ContentWrapper(
        cssCloseButton(cssBigIcon('CrossBig'),
          dom.on('click', () => this._finish()),
          testId('close'),
        ),
        cssTitle(this._messages[ctlIndex].title),
        cssBody(this._messages[ctlIndex].body),
        this._buildFooter(),
        testId('popup'),
      ),
      dom.onKeyDown({
        Escape:     () => this._finish(),
        ArrowLeft:  () => this._move(-1),
        ArrowRight: () => this._move(+1),
        Enter:      () => this._move(+1, true),
      }),
    );
  }

  private _buildFooter() {
    const nSteps = this._messages.length;
    const isLastStep = ctlIndex === nSteps - 1;
    const isFirstStep = ctlIndex === 0;
    return Footer(
      ProgressBar(
        range(nSteps).map((i) => Dot(Dot.cls('-done', i > ctlIndex))),
      ),
      Buttons(
        bigBasicButton(
          'Previous', testId('previous'),
          dom.on('click', () => this._move(-1)),
          dom.prop('disabled', isFirstStep),
          {style: `margin-right: 8px; visibility: ${isFirstStep ? 'hidden' : 'visible'}`},
        ),
        bigPrimaryButton(
          isLastStep ? translate('Finish') : translate('Next'), testId('next'),
          dom.on('click', () => this._move(+1, true)),
        ),
      )
    );
  }

  private _showOverlay() {
    document.body.appendChild(this._overlay = Overlay());
    this.onDispose(() => {
      document.body.removeChild(this._overlay);
      dom.domDispose(this._overlay);
    });
  }
}

function buildArrow() {
  return ArrowContainer(
    svg('svg', { style: 'width: 13px; height: 34px;' },
        svg('path', {'d': 'M 2 19 h 13 v 18 Z'}))
  );
}

const Container = styled('div', `
  align-self: center;
  border: 2px solid ${theme.accentBorder};
  border-radius: 3px;
  z-index: 1000;
  max-width: 490px;
  position: relative;
  background-color: ${theme.popupBg};
  box-shadow: 0 2px 18px 0 ${theme.popupInnerShadow}, 0 0 1px 0 ${theme.popupOuterShadow};
  outline: unset;
`);

function sideSelectorChunk(side: 'top'|'bottom'|'left'|'right') {
  return `.${Container.className}[data-popper-placement^=${side}]`;
}

const ArrowContainer = styled('div', `
  position: absolute;

  & path {
    stroke: ${theme.accentBorder};
    stroke-width: 2px;
    fill: ${theme.popupBg};
  }

  ${sideSelectorChunk('top')} > & {
    bottom: -26px;
  }

  ${sideSelectorChunk('bottom')} > & {
    top: -23px;
  }

  ${sideSelectorChunk('right')} > & {
    left: -12px;
  }

  ${sideSelectorChunk('left')} > & {
    right: -12px;
  }

  ${sideSelectorChunk('top')} svg {
    transform: rotate(-90deg);
  }

  ${sideSelectorChunk('bottom')} svg {
    transform: rotate(90deg);
  }

  ${sideSelectorChunk('left')} svg {
    transform: scalex(-1);
  }
`);

const ContentWrapper = styled('div', `
  position: relative;
  padding: 32px;
  background-color: ${theme.popupBg};
`);

const Footer = styled('div', `
  display: flex;
  flex-direction: row;
  margin-top: 32px;
  justify-content: space-between;
`);

const ProgressBar = styled('div', `
  display: flex;
  flex-direction: row;
`);

const Buttons = styled('div', `
  display: flex;
  flex-directions: row;
`);

const Dot = styled('div', `
  width: 6px;
  height: 6px;
  border-radius: 3px;
  margin-right: 12px;
  align-self: center;
  background-color: ${theme.progressBarFg};
  &-done {
    background-color: ${theme.progressBarBg};
  }
`);

const Overlay = styled('div', `
  position: fixed;
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  z-index: 999;
  overflow-y: auto;
`);

const cssTitle = styled('div', `
  font-size: ${vars.xxxlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};
  color: ${theme.text};
  margin: 0 0 16px 0;
  line-height: 32px;
`);

const cssBody = styled('div', `
  color: ${theme.text};
`);
