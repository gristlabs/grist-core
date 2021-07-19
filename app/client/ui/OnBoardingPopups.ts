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

import { Disposable, dom, DomElementArg, makeTestId, styled, svg } from "grainjs";
import { createPopper, Placement } from '@popperjs/core';
import { FocusLayer } from 'app/client/lib/FocusLayer';
import * as Mousetrap from 'app/client/lib/Mousetrap';
import { bigBasicButton, bigPrimaryButton } from "app/client/ui2018/buttons";
import { colors, vars } from "app/client/ui2018/cssVars";
import range = require("lodash/range");

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
}

export function startOnBoarding(messages: IOnBoardingMsg[], onFinishCB: () => void) {
  const ctl = new OnBoardingPopupsCtl(messages, onFinishCB);
  ctl.start();
}

class OnBoardingError extends Error {
  public name = 'OnBoardingError';
  constructor(message: string) {
    super(message);
  }
}

class OnBoardingPopupsCtl extends Disposable {
  private _index = -1;
  private _openPopupCtl: {close: () => void}|undefined;
  private _overlay: HTMLElement;
  private _arrowEl = buildArrow();

  constructor(private _messages: IOnBoardingMsg[], private _onFinishCB: () => void) {
    super();
    if (this._messages.length === 0) {
      throw new OnBoardingError('messages should not be an empty list');
    }
    this.onDispose(() => {
      this._openPopupCtl?.close();
    });
  }

  public start(): void {
    this._showOverlay();
    this._next();
    Mousetrap.setPaused(true);
    this.onDispose(() => {
      Mousetrap.setPaused(false);
    });
  }

  private _finish() {
    this._onFinishCB();
    this.dispose();
  }

  private _next(): void {
    this._index = this._index + 1;
    const entry = this._messages[this._index];
    if (entry.skip) { this._next(); }

    // close opened popup if any
    this._openPopupCtl?.close();

    if (entry.showHasModal) {
      this._showHasModal();
    } else {
      this._showHasPopup();
    }
  }

  private _showHasPopup() {
    const content = this._buildPopupContent();
    const entry = this._messages[this._index];
    const elem = document.querySelector<HTMLElement>(entry.selector);
    const {placement} = entry;

    // The element the popup refers to is not present. To the user we show nothing and simply skip
    // it to the next.
    if (!elem) {
      console.warn(`On boarding tour: element ${entry.selector} not found!`);
      return this._next();
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
    const container = Container({tabindex: '-1'}, this._arrowEl, ContentWrapper(
      cssTitle(this._messages[this._index].title),
      cssBody(this._messages[this._index].body),
      this._buildFooter(),
      testId('popup'),
    ));
    return container;
  }

  private _buildFooter() {
    const nSteps = this._messages.length;
    const isLastStep = this._index === nSteps - 1;
    return Footer(
      ProgressBar(
        range(nSteps).map((i) => Dot(Dot.cls('-done', i > this._index))),
      ),
      Buttons(
        bigBasicButton(
          'Finish', testId('finish'),
          dom.on('click', () => this._finish()),
          {style: 'margin-right: 8px;'},
        ),
        bigPrimaryButton(
          'Next', testId('next'),
          dom.on('click', () => this._next()),
          dom.prop('disabled', isLastStep),
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
  border: 2px solid ${colors.lightGreen};
  border-radius: 3px;
  z-index: 1000;
  max-width: 490px;
  position: relative;
  background-color: white;
  box-shadow: 0 2px 18px 0 rgba(31,37,50,0.31), 0 0 1px 0 rgba(76,86,103,0.24);
  outline: unset;
`);

function sideSelectorChunk(side: 'top'|'bottom'|'left'|'right') {
  return `.${Container.className}[data-popper-placement^=${side}]`;
}

const ArrowContainer = styled('div', `
  position: absolute;

  & path {
    stroke: ${colors.lightGreen};
    stroke-width: 2px;
    fill: white;
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
  background-color: white;
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
  background-color: ${colors.lightGreen};
  &-done {
    background-color: ${colors.darkGrey};
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
  color: ${colors.dark};
  margin: 0 0 16px 0;
  line-height: 32px;
`);

const cssBody = styled('div', `
`);
