import {colors, isNarrowScreenObs} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {Disposable, dom, DomArg, DomElementArg, makeTestId, Observable, styled} from 'grainjs';

const testId = makeTestId('test-banner-');

export interface BannerOptions {
  /**
   * Content to display in the banner.
   */
  content: DomArg;

  /**
   * The banner style.
   *
   * Warning banners have a yellow background. Error banners have a red
   * background.
   */
  style: 'warning' | 'error' | 'info';

  /**
   * Optional variant of `content` to display when screen width becomes narrow.
   */
  contentSmall?: DomArg;

  /**
   * Whether a button to close the banner should be shown.
   *
   * If true, `onClose` should also be specified; it will be called when the close
   * button is clicked.
   *
   * Defaults to false.
   */
  showCloseButton?: boolean;

  /**
   * Whether a button to collapse/expand the banner should be shown on narrow screens.
   *
   * Defaults to false.
   */
  showExpandButton?: boolean;

  /**
   * If provided, applies the css class to the banner container.
   */
  bannerCssClass?: string;

  /**
   * Function that is called when the banner close button is clicked.
   *
   * Should be used to handle disposal of the Banner.
   */
  onClose?(): void;
}

/**
 * A customizable banner for displaying at the top of a page.
 */
export class Banner extends Disposable {
  private readonly _isExpanded = Observable.create(this, true);

  constructor(private _options: BannerOptions) {
    super();
  }

  public buildDom() {
    return cssBanner({class: this._options.bannerCssClass || ''},
      cssBanner.cls(`-${this._options.style}`),
      this._buildContent(),
      this._buildButtons(),
      testId('element')
    );
  }

  private _buildContent() {
    const {content, contentSmall} = this._options;
    return dom.domComputed(use => {
      if (contentSmall === undefined) { return [content]; }

      const isExpanded = use(this._isExpanded);
      const isNarrowScreen = use(isNarrowScreenObs());
      return [isNarrowScreen && !isExpanded ? contentSmall : content];
    });
  }

  private _buildButtons() {
    return cssButtons(
      this._options.showExpandButton ? this._buildExpandButton() : null,
      this._options.showCloseButton ? this._buildCloseButton() : null,
    );
  }

  private _buildCloseButton() {
    return cssButton('CrossBig',
      dom.on('click', () => this._options.onClose?.()),
      testId('close'),
    );
  }

  private _buildExpandButton() {
    return dom.maybe(isNarrowScreenObs(), () => {
      return cssExpandButton('Dropdown',
        cssExpandButton.cls('-expanded', this._isExpanded),
        dom.on('click', () => this._isExpanded.set(!this._isExpanded.get())),
      );
    });
  }
}

export function buildBannerMessage(...domArgs: DomElementArg[]) {
  return cssBannerMessage(
    cssIcon('Idea'),
    cssLightlyBoldedText(domArgs),
  );
}

const cssBanner = styled('div', `
  display: flex;
  padding: 10px;
  gap: 16px;
  color: white;

  &-info {
    color: black;
    background: #FFFACD;
  }

  &-warning {
    background: #E6A117;
  }

  &-error {
    background: ${colors.error};
  }
`);

export const cssBannerLink = styled('span', `
  cursor: pointer;
  color: unset;
  text-decoration: underline;

  &:hover, &:focus {
    color: unset;
  }
`);

const cssButtons = styled('div', `
  display: flex;
  gap: 16px;
  flex-shrink: 0;
  margin-left: auto;
`);

const cssButton = styled(icon, `
  width: 16px;
  height: 16px;
  cursor: pointer;
  background-color: white;
`);

const cssExpandButton = styled(cssButton, `
  &-expanded {
    -webkit-mask-image: var(--icon-DropdownUp) !important;
  }
`);

const cssLightlyBoldedText = styled('div', `
  font-weight: 500;
`);

const cssIconAndText = styled('div', `
  display: flex;
  gap: 16px;
`);

const cssBannerMessage = styled(cssIconAndText, `
  flex-grow: 1;
  justify-content: center;
`);

const cssIcon = styled(icon, `
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  background-color: white;
`);
