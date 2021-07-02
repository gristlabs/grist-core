/**
 * Utility to generate a series of onboarding popups. It is used to give users a short description
 * of some elements of the UI. The first step is to create the list of messages following the
 * `IOnBoardingMsg` interface. Then you have to attach each message to its corresponding element of
 * the UI using the `attachOnBoardingMsg' dom method:
 *
 *  Usage:
 *
 *    // create the list of message
 *    const messages = [{id: 'add-new-btn', buildDom: () => dom('div', 'Adds New button let's you ...')},
 *                      {id: 'share-btn', buildDom: () => ... ];
 *
 *
 *    // attach each message to the corresponding element
 *    dom('div', 'Add New', ..., attachOnBoardingMsg('add-new-btn', {placement: 'right'}));
 *
 *    // start
 *    startOnBoarding(message, onFinishCB);
 *
 * Note:
 * - this module does UI only, saving which user has already seen the popups has to be handled by
 *   the caller. Pass an `onFinishCB` to handle when a user dimiss the popups.
 */

import { Disposable, dom, DomElementMethod, makeTestId, styled, svg } from "grainjs";
import { createPopper, Placement, Options as PopperOptions } from '@popperjs/core';
import { pull, range } from "lodash";
import { bigBasicButton, bigPrimaryButton } from "../ui2018/buttons";
import { colors } from "../ui2018/cssVars";

const testId = makeTestId('test-onboarding-');

// Describes an onboarding popup. Each popup is uniquely identified by its id.
export interface IOnBoardingMsg {

  // Identifies one message
  id: string,

  // Build the popup's content
  buildDom: () => HTMLElement,
}

export function startOnBoarding(messages: IOnBoardingMsg[], onFinishCB: () => void) {
  const ctl = new OnBoardingPopupsCtl(messages, onFinishCB);
  ctl.start();
}

// Onboarding popup options.
export interface IOnBoardingPopupOptions {
  placement?: Placement;
}

function attachOnBoardingElem(elem: HTMLElement, messageId: string, opts: IOnBoardingPopupOptions) {
  const val = {elem, messageId, ...opts};
  registry.push(val);
  dom.onDisposeElem(elem, () => pull(registry, val));
}

// A dom method that let you attach an boarding message to an element. This causes the onboarding
// message to be shown in a tooltip like popup pointing at this element. More info in the module
// description.
export function attachOnBoardingMsg(messageId: string, opts: IOnBoardingPopupOptions): DomElementMethod {
  return (elem) => attachOnBoardingElem(elem, messageId, opts);
}

// Onboarding popup's options.
interface IOnboardingRegistryItem {

  // the message id
  messageId: string;

  // The popper placement, optional.
  placement?: Placement,

  // the element,
  elem: HTMLElement,
}

// List of all registered element
const registry: Array<IOnboardingRegistryItem> = [];

class OnBoardingPopupsCtl extends Disposable {
  private _index = -1;
  private _openPopupCtl: {close: () => void}|undefined;
  private _overlay: HTMLElement;
  private _arrowEl = buildArrow();

  constructor(private _messages: IOnBoardingMsg[], private _onFinishCB: () => void) {
    super();
    if (this._messages.length === 0) {
      throw new Error('messages should not be an empty list');
    }
    this.onDispose(() => {
      this._openPopupCtl?.close();
    });
  }

  public start(): void {
    this._showOverlay();
    this._next();
  }

  private _finish() {
    this._onFinishCB();
    this.dispose();
  }

  private _next(): void {
    this._index = this._index + 1;
    const {id} = this._messages[this._index];
    const entry = registry.find((opts) => opts.messageId === id);
    if (!entry) { throw new Error(`Missing on-boarding entry for message: ${id}`); }
    const {elem, placement} = entry;

    // close opened popup if any
    this._openPopupCtl?.close();

    // Cleanup
    function close() {
      popper.destroy();
      dom.domDispose(content);
      content.remove();
    }

    // Add the content element
    const content = this._buildPopupContent();
    document.body.appendChild(content);

    // Create a popper for positioning the popup content relative to the reference element
    const popperOptions: Partial<PopperOptions> = { placement };
    const popper = createPopper(elem, content, {
      ...popperOptions,
      modifiers: [{
        name: 'arrow',
        options: {
          element: this._arrowEl,
        },
      }, {
        name: 'offset',
        options: {
          offset: [-12, 12],
        }
      }],
    });
    this._openPopupCtl = {close};
  }

  private _buildPopupContent() {
    return Container(this._arrowEl, ContentWrapper(
      this._messages[this._index].buildDom(),
      this._buildFooter(),
      testId('popup'),
    ));
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
    svg('svg', { style: 'width: 14px; height: 36px;' },
        svg('path', {'d': 'M 2 16 h 12 v 16 Z'}))
  );
}

const Container = styled('div', `
  border: 2px solid ${colors.lightGreen};
  border-radius: 3px;
  z-index: 1000;
  max-width: 490px;
  position: relative;
  background-color: white;
  box-shadow: 0 2px 18px 0 rgba(31,37,50,0.31), 0 0 1px 0 rgba(76,86,103,0.24);
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
    top: -24px;
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
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  z-index: 999;
  overflow-y: auto;
`);
