/**
 * CSS Variables. To use in your web application, add `cssRootVars` to the class list for your app's
 * root node, typically `<body>`.
 *
 * The fonts used attempt to default to system fonts as described here:
 *  https://css-tricks.com/snippets/css/system-font-stack/
 *
 */
import {createPausableObs, PausableObservable} from 'app/client/lib/pausableObs';
import {getStorage} from 'app/client/lib/storage';
import {urlState} from 'app/client/models/gristUrlState';
import {getTheme, ProductFlavor} from 'app/client/ui/CustomThemes';
import {Theme, ThemeAppearance} from 'app/common/ThemePrefs';
import {getThemeColors} from 'app/common/Themes';
import {getGristConfig} from 'app/common/urlUtils';
import {Computed, dom, DomElementMethod, makeTestId, Observable, styled, TestId} from 'grainjs';
import debounce = require('lodash/debounce');
import isEqual = require('lodash/isEqual');
import values = require('lodash/values');

const VAR_PREFIX = 'grist';

class CustomProp {
  constructor(public name: string, public value?: string, public fallback?: string | CustomProp) {

  }

  public decl(): string | undefined {
    if (this.value === undefined) { return undefined; }

    return `--${VAR_PREFIX}-${this.name}: ${this.value};`;
  }

  public toString(): string {
    let value = `--${VAR_PREFIX}-${this.name}`;
    if (this.fallback) {
      value += `, ${this.fallback}`;
    }
    return `var(${value})`;
  }
}

/**
 * Theme-agnostic color properties.
 *
 * These are appropriate for UI elements whose color should not change based on the active
 * theme. Generally, you should instead use the properties defined in `theme`, which will change
 * based on the active theme.
 */
export const colors = {
  lightGrey: new CustomProp('color-light-grey', '#F7F7F7'),
  mediumGrey: new CustomProp('color-medium-grey', 'rgba(217,217,217,0.6)'),
  mediumGreyOpaque: new CustomProp('color-medium-grey-opaque', '#E8E8E8'),
  darkGrey: new CustomProp('color-dark-grey', '#D9D9D9'),

  light: new CustomProp('color-light', '#FFFFFF'),
  dark: new CustomProp('color-dark', '#262633'),
  darkText: new CustomProp('color-dark-text', '#494949'),
  darkBg: new CustomProp('color-dark-bg', '#262633'),
  slate: new CustomProp('color-slate', '#929299'),

  lighterGreen: new CustomProp('color-lighter-green', '#b1ffe2'),
  lightGreen: new CustomProp('color-light-green', '#16B378'),
  darkGreen: new CustomProp('color-dark-green', '#009058'),
  darkerGreen: new CustomProp('color-darker-green', '#007548'),

  lighterBlue: new CustomProp('color-lighter-blue', '#87b2f9'),
  lightBlue: new CustomProp('color-light-blue', '#3B82F6'),
  orange: new CustomProp('color-orange', '#F9AE41'),

  cursor: new CustomProp('color-cursor', '#16B378'),
  selection: new CustomProp('color-selection', 'rgba(22,179,120,0.15)'),
  selectionOpaque: new CustomProp('color-selection-opaque', '#DCF4EB'),
  selectionDarkerOpaque: new CustomProp('color-selection-darker-opaque', '#d6eee5'),

  inactiveCursor: new CustomProp('color-inactive-cursor', '#A2E1C9'),

  hover: new CustomProp('color-hover', '#bfbfbf'),
  error: new CustomProp('color-error', '#D0021B'),
  warning: new CustomProp('color-warning', '#F9AE41'),
  warningBg: new CustomProp('color-warning-bg', '#dd962c'),
  backdrop: new CustomProp('color-backdrop', 'rgba(38,38,51,0.9)')

};

export const vars = {
  /* Fonts */
  fontFamily: new CustomProp('font-family', `-apple-system,BlinkMacSystemFont,Segoe UI,Liberation Sans,
    Helvetica,Arial,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol`),

  // This is more monospace and looks better for data that should often align (e.g. to have 00000
  // take similar space to 11111). This is the main font for user data.
  fontFamilyData: new CustomProp('font-family-data',
    `Liberation Sans,Helvetica,Arial,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol`),

  /* Font sizes */
  xxsmallFontSize:  new CustomProp('xx-font-size',        '8px'),
  xsmallFontSize:   new CustomProp('x-small-font-size',   '10px'),
  smallFontSize:    new CustomProp('small-font-size',     '11px'),
  mediumFontSize:   new CustomProp('medium-font-size',    '13px'),
  introFontSize:    new CustomProp('intro-font-size',     '14px'),    // feels friendlier
  largeFontSize:    new CustomProp('large-font-size',     '16px'),
  xlargeFontSize:   new CustomProp('x-large-font-size',   '18px'),
  xxlargeFontSize:  new CustomProp('xx-large-font-size',  '20px'),
  xxxlargeFontSize: new CustomProp('xxx-large-font-size', '22px'),

  /* Controls size and space */
  controlFontSize: new CustomProp('control-font-size', '12px'),
  smallControlFontSize: new CustomProp('small-control-font-size', '10px'),
  bigControlFontSize: new CustomProp('big-control-font-size', '13px'),
  headerControlFontSize: new CustomProp('header-control-font-size', '22px'),
  bigControlTextWeight: new CustomProp('big-text-weight', '500'),
  headerControlTextWeight: new CustomProp('header-text-weight', '600'),

  /* Labels */
  labelTextSize:  new CustomProp('label-text-size', 'medium'),
  labelTextBg:    new CustomProp('label-text-bg', '#FFFFFF'),
  labelActiveBg:  new CustomProp('label-active-bg', '#F0F0F0'),

  controlMargin:  new CustomProp('normal-margin', '2px'),
  controlPadding: new CustomProp('normal-padding', '3px 5px'),
  tightPadding:   new CustomProp('tight-padding',  '1px 2px'),
  loosePadding:   new CustomProp('loose-padding',  '5px 15px'),

  /* Control colors and borders */
  primaryBg:        new CustomProp('primary-fg', '#16B378'),
  primaryBgHover:   new CustomProp('primary-fg-hover', '#009058'),
  primaryFg:        new CustomProp('primary-bg', '#ffffff'),

  controlBg:      new CustomProp('control-bg', '#ffffff'),
  controlFg:      new CustomProp('control-fg', '#16B378'),
  controlFgHover: new CustomProp('primary-fg-hover', '#009058'),

  controlBorder:        new CustomProp('control-border', '1px solid #11B683'),
  controlBorderRadius:  new CustomProp('border-radius', '4px'),

  logoBg: new CustomProp('logo-bg', '#040404'),
  logoSize: new CustomProp('logo-size', '22px 22px'),
  toastBg: new CustomProp('toast-bg', '#040404'),

  /* Z indexes */
  insertColumnLineZIndex: new CustomProp('insert-column-line-z-index', '20'),
  popupSectionBackdropZIndex: new CustomProp('popup-section-backdrop-z-index', '100'),
  menuZIndex: new CustomProp('menu-z-index', '999'),
  modalZIndex: new CustomProp('modal-z-index', '999'),
  onboardingBackdropZIndex: new CustomProp('onboarding-backdrop-z-index', '999'),
  onboardingPopupZIndex: new CustomProp('onboarding-popup-z-index', '1000'),
  floatingPopupZIndex: new CustomProp('floating-popup-z-index', '1002'),
  tutorialModalZIndex: new CustomProp('tutorial-modal-z-index', '1003'),
  pricingModalZIndex: new CustomProp('pricing-modal-z-index', '1004'),
  floatingPopupMenuZIndex: new CustomProp('floating-popup-menu-z-index', '1004'),
  notificationZIndex: new CustomProp('notification-z-index', '1100'),
  browserCheckZIndex: new CustomProp('browser-check-z-index', '5000'),
  tooltipZIndex: new CustomProp('tooltip-z-index', '5000'),
  // TODO: Add properties for remaining hard-coded z-indexes.
};

/**
 * Theme-related color properties.
 *
 * Unlike `colors`, these properties don't define any values as they aren't known ahead of time.
 * Instead, when the application loads, CSS variables mapped to these properties are attached to
 * the document based on the user's theme preferences.
 *
 * In the case that CSS variables aren't attached to the document, their fallback values will be
 * used. This ensures that styles are still applied even when there's trouble fetching preferences,
 * and also serves as a method of maintaining backwards compatibility with custom CSS rules that
 * use legacy variable names (prefixed with `grist-color-`).
 */
export const theme = {
  /* Text */
  text: new CustomProp('theme-text', undefined, colors.dark),
  lightText: new CustomProp('theme-text-light', undefined, colors.slate),
  mediumText: new CustomProp('theme-text-medium', undefined, colors.darkText),
  darkText: new CustomProp('theme-text-dark', undefined, 'black'),
  errorText: new CustomProp('theme-text-error', undefined, colors.error),
  errorTextHover: new CustomProp('theme-text-error-hover', undefined, '#BF0A31'),
  dangerText: new CustomProp('theme-text-danger', undefined, '#FFA500'),
  disabledText: new CustomProp('theme-text-disabled', undefined, colors.slate),

  /* Page */
  pageBg: new CustomProp('theme-page-bg', undefined, colors.lightGrey),
  pageBackdrop: new CustomProp('theme-page-backdrop', undefined, 'grey'),

  /* Page Panels */
  mainPanelBg: new CustomProp('theme-page-panels-main-panel-bg', undefined, 'white'),
  leftPanelBg: new CustomProp('theme-page-panels-left-panel-bg', undefined, colors.lightGrey),
  rightPanelBg: new CustomProp('theme-page-panels-right-panel-bg', undefined, colors.lightGrey),
  topHeaderBg: new CustomProp('theme-page-panels-top-header-bg', undefined, 'white'),
  bottomFooterBg: new CustomProp('theme-page-panels-bottom-footer-bg', undefined, 'white'),
  pagePanelsBorder: new CustomProp('theme-page-panels-border', undefined, colors.mediumGrey),
  pagePanelsBorderResizing: new CustomProp('theme-page-panels-border-resizing', undefined,
    colors.lightGreen),
  sidePanelOpenerFg: new CustomProp('theme-page-panels-side-panel-opener-fg', undefined,
    colors.slate),
  sidePanelOpenerActiveFg: new CustomProp('theme-page-panels-side-panel-opener-active-fg',
    undefined, 'white'),
  sidePanelOpenerActiveBg: new CustomProp('theme-page-panels-side-panel-opener-active-bg',
    undefined, colors.lightGreen),

  /* Add New */
  addNewCircleFg: new CustomProp('theme-add-new-circle-fg', undefined, colors.light),
  addNewCircleBg: new CustomProp('theme-add-new-circle-bg', undefined, colors.darkGreen),
  addNewCircleHoverBg: new CustomProp('theme-add-new-circle-hover-bg', undefined,
    colors.darkerGreen),
  addNewCircleSmallFg: new CustomProp('theme-add-new-circle-small-fg', undefined, colors.light),
  addNewCircleSmallBg: new CustomProp('theme-add-new-circle-small-bg', undefined,
    colors.lightGreen),
  addNewCircleSmallHoverBg: new CustomProp('theme-add-new-circle-small-hover-bg', undefined,
    colors.darkGreen),

  /* Top Bar */
  topBarButtonPrimaryFg: new CustomProp('theme-top-bar-button-primary-fg', undefined,
    colors.lightGreen),
  topBarButtonSecondaryFg: new CustomProp('theme-top-bar-button-secondary-fg', undefined,
    colors.slate),
  topBarButtonDisabledFg: new CustomProp('theme-top-bar-button-disabled-fg', undefined,
    colors.darkGrey),
  topBarButtonErrorFg: new CustomProp('theme-top-bar-button-error-fg', undefined, colors.error),

  /* Notifications */
  notificationsPanelHeaderBg: new CustomProp('theme-notifications-panel-header-bg', undefined,
    colors.lightGrey),
  notificationsPanelBodyBg: new CustomProp('theme-notifications-panel-body-bg', undefined,
    'white'),
  notificationsPanelBorder: new CustomProp('theme-notifications-panel-border', undefined,
    colors.darkGrey),

  /* Toasts */
  toastText: new CustomProp('theme-toast-text', undefined, colors.light),
  toastLightText: new CustomProp('theme-toast-text-light', undefined, colors.slate),
  toastBg: new CustomProp('theme-toast-bg', undefined, vars.toastBg),
  toastMemoText: new CustomProp('theme-toast-memo-text', undefined, colors.light),
  toastMemoBg: new CustomProp('theme-toast-memo-bg', undefined, colors.dark),
  toastErrorIcon: new CustomProp('theme-toast-error-icon', undefined, colors.error),
  toastErrorBg: new CustomProp('theme-toast-error-bg', undefined, colors.error),
  toastSuccessIcon: new CustomProp('theme-toast-success-icon', undefined, colors.darkGreen),
  toastSuccessBg: new CustomProp('theme-toast-success-bg', undefined, colors.darkGreen),
  toastWarningIcon: new CustomProp('theme-toast-warning-icon', undefined, colors.warning),
  toastWarningBg: new CustomProp('theme-toast-warning-bg', undefined, colors.warningBg),
  toastInfoIcon: new CustomProp('theme-toast-info-icon', undefined, colors.lightBlue),
  toastInfoBg: new CustomProp('theme-toast-info-bg', undefined, colors.lightBlue),
  toastControlFg: new CustomProp('theme-toast-control-fg', undefined, colors.lightGreen),
  toastInfoControlFg: new CustomProp('theme-toast-control-info-fg', undefined, colors.lighterBlue),

  /* Tooltips */
  tooltipFg: new CustomProp('theme-tooltip-fg', undefined, 'white'),
  tooltipBg: new CustomProp('theme-tooltip-bg', undefined, 'rgba(0, 0, 0, 0.75)'),
  tooltipIcon: new CustomProp('theme-tooltip-icon', undefined, colors.slate),
  tooltipCloseButtonFg: new CustomProp('theme-tooltip-close-button-fg', undefined, 'white'),
  tooltipCloseButtonHoverFg: new CustomProp('theme-tooltip-close-button-hover-fg', undefined,
    'black'),
  tooltipCloseButtonHoverBg: new CustomProp('theme-tooltip-close-button-hover-bg', undefined,
    'white'),

  /* Modals */
  modalBg: new CustomProp('theme-modal-bg', undefined, 'white'),
  modalBackdrop: new CustomProp('theme-modal-backdrop', undefined, colors.backdrop),
  modalBorder: new CustomProp('theme-modal-border', undefined, colors.mediumGreyOpaque),
  modalBorderDark: new CustomProp('theme-modal-border-dark', undefined, colors.darkGrey),
  modalBorderHover: new CustomProp('theme-modal-border-hover', undefined, colors.slate),
  modalInnerShadow: new CustomProp('theme-modal-shadow-inner', undefined,
    'rgba(31, 37, 50, 0.31)'),
  modalOuterShadow: new CustomProp('theme-modal-shadow-outer', undefined,
    'rgba(76, 86, 103, 0.24)'),
  modalCloseButtonFg: new CustomProp('theme-modal-close-button-fg', undefined, colors.slate),
  modalBackdropCloseButtonFg: new CustomProp('theme-modal-backdrop-close-button-fg', undefined,
    vars.primaryBg),
  modalBackdropCloseButtonHoverFg: new CustomProp('theme-modal-backdrop-close-button-hover-fg',
    undefined, colors.lighterGreen),

  /* Popups */
  popupBg: new CustomProp('theme-popup-bg', undefined, 'white'),
  popupInnerShadow: new CustomProp('theme-popup-shadow-inner', undefined,
    'rgba(31, 37, 50, 0.31)'),
  popupOuterShadow: new CustomProp('theme-popup-shadow-outer', undefined,
    'rgba(76, 86, 103, 0.24)'),
  popupCloseButtonFg: new CustomProp('theme-popup-close-button-fg', undefined, colors.slate),

  /* Prompts */
  promptFg: new CustomProp('theme-prompt-fg', undefined, '#606060'),

  /* Progress Bars */
  progressBarFg: new CustomProp('theme-progress-bar-fg', undefined, colors.lightGreen),
  progressBarErrorFg: new CustomProp('theme-progress-bar-error-fg', undefined, colors.error),
  progressBarBg: new CustomProp('theme-progress-bar-bg', undefined, colors.darkGrey),

  /* Links */
  link: new CustomProp('theme-link', undefined, colors.lightGreen),
  linkHover: new CustomProp('theme-link-hover', undefined, colors.lightGreen),

  /* Hover */
  hover: new CustomProp('theme-hover', undefined, colors.mediumGrey),
  lightHover: new CustomProp('theme-hover-light', undefined, colors.lightGrey),

  /* Cell Editor */
  cellEditorFg: new CustomProp('theme-cell-editor-fg', undefined, colors.dark),
  cellEditorPlaceholderFg: new CustomProp('theme-cell-editor-placeholder-fg', undefined, colors.slate),
  cellEditorBg: new CustomProp('theme-cell-editor-bg', undefined, colors.light),

  /* Cursor */
  cursor: new CustomProp('theme-cursor', undefined, colors.cursor),
  cursorInactive: new CustomProp('theme-cursor-inactive', undefined, colors.inactiveCursor),
  cursorReadonly: new CustomProp('theme-cursor-readonly', undefined, colors.slate),

  /* Tables */
  tableHeaderFg: new CustomProp('theme-table-header-fg', undefined, '#000'),
  tableHeaderSelectedFg: new CustomProp('theme-table-header-selected-fg', undefined, '#000'),
  tableHeaderBg: new CustomProp('theme-table-header-bg', undefined, colors.lightGrey),
  tableHeaderSelectedBg: new CustomProp('theme-table-header-selected-bg', undefined,
    colors.mediumGreyOpaque),
  tableHeaderBorder: new CustomProp('theme-table-header-border', undefined, 'lightgray'),
  tableBodyBg: new CustomProp('theme-table-body-bg', undefined, 'white'),
  tableBodyBorder: new CustomProp('theme-table-body-border', undefined, colors.darkGrey),
  tableAddNewBg: new CustomProp('theme-table-add-new-bg', undefined, 'inherit'),
  tableScrollShadow: new CustomProp('theme-table-scroll-shadow', undefined, '#444444'),
  tableFrozenColumnsBorder: new CustomProp('theme-table-frozen-columns-border', undefined,
    '#999999'),
  tableDragDropIndicator: new CustomProp('theme-table-drag-drop-indicator', undefined, 'gray'),
  tableDragDropShadow: new CustomProp('theme-table-drag-drop-shadow', undefined, '#F0F0F0'),
  tableCellSummaryBg: new CustomProp('theme-table-cell-summary-bg', undefined, colors.mediumGrey),

  /* Cards */
  cardCompactWidgetBg: new CustomProp('theme-card-compact-widget-bg', undefined,
    colors.mediumGrey),
  cardCompactRecordBg: new CustomProp('theme-card-compact-record-bg', undefined, 'white'),
  cardBlocksBg: new CustomProp('theme-card-blocks-bg', undefined, colors.mediumGrey),
  cardFormLabel: new CustomProp('theme-card-form-label', undefined, colors.slate),
  cardCompactLabel: new CustomProp('theme-card-compact-label', undefined, colors.slate),
  cardBlocksLabel: new CustomProp('theme-card-blocks-label', undefined, colors.slate),
  cardFormBorder: new CustomProp('theme-card-form-border', undefined, 'lightgrey'),
  cardCompactBorder: new CustomProp('theme-card-compact-border', undefined, colors.darkGrey),
  cardEditingLayoutBg: new CustomProp('theme-card-editing-layout-bg', undefined,
    'rgba(192, 192, 192, 0.2)'),
  cardEditingLayoutBorder: new CustomProp('theme-card-editing-layout-border', undefined,
    colors.darkGrey),

  /* Card Lists */
  cardListFormBorder: new CustomProp('theme-card-list-form-border', undefined, colors.darkGrey),
  cardListBlocksBorder: new CustomProp('theme-card-list-blocks-border', undefined,
    colors.darkGrey),

  /* Selection */
  selection: new CustomProp('theme-selection', undefined, colors.selection),
  selectionDarker: new CustomProp('theme-selection-darker', undefined, 'rgba(22,179,120,0.25)'),
  selectionDarkest: new CustomProp('theme-selection-darkest', undefined, 'rgba(22,179,120,0.35)'),
  selectionOpaqueFg: new CustomProp('theme-selection-opaque-fg', undefined, 'black'),
  selectionOpaqueBg: new CustomProp('theme-selection-opaque-bg', undefined,
    colors.selectionOpaque),
  selectionOpaqueDarkBg: new CustomProp('theme-selection-opaque-dark-bg', undefined,
    colors.selectionDarkerOpaque),
  selectionHeader: new CustomProp('theme-selection-header', undefined, colors.mediumGrey),

  /* Widgets */
  widgetBg: new CustomProp('theme-widget-bg', undefined, 'white'),
  widgetBorder: new CustomProp('theme-widget-border', undefined, colors.darkGrey),
  widgetActiveBorder: new CustomProp('theme-widget-active-border', undefined, colors.lightGreen),
  widgetInactiveStripesLight: new CustomProp('theme-widget-inactive-stripes-light', undefined,
    colors.lightGrey),
  widgetInactiveStripesDark: new CustomProp('theme-widget-inactive-stripes-dark', undefined,
    colors.mediumGreyOpaque),

  /* Pinned Docs */
  pinnedDocFooterBg: new CustomProp('theme-pinned-doc-footer-bg', undefined, colors.light),
  pinnedDocBorder: new CustomProp('theme-pinned-doc-border', undefined, colors.mediumGrey),
  pinnedDocBorderHover: new CustomProp('theme-pinned-doc-border-hover', undefined, colors.slate),
  pinnedDocEditorBg: new CustomProp('theme-pinned-doc-editor-bg', undefined, colors.mediumGrey),

  /* Raw Data */
  rawDataTableBorder: new CustomProp('theme-raw-data-table-border', undefined, colors.mediumGrey),
  rawDataTableBorderHover: new CustomProp('theme-raw-data-table-border-hover',
    undefined, colors.slate),

  /* Controls */
  controlFg: new CustomProp('theme-control-fg', undefined, vars.controlFg),
  controlPrimaryFg: new CustomProp('theme-control-primary-fg', undefined, vars.primaryFg),
  controlPrimaryBg: new CustomProp('theme-control-primary-bg', undefined, vars.primaryBg),
  controlSecondaryFg: new CustomProp('theme-control-secondary-fg', undefined, colors.slate),
  controlSecondaryDisabledFg: new CustomProp('theme-control-secondary-disabled-fg',
    undefined, colors.darkGrey),
  controlHoverFg: new CustomProp('theme-control-hover-fg', undefined, vars.controlFgHover),
  controlPrimaryHoverBg: new CustomProp('theme-control-primary-hover-bg', undefined,
    vars.primaryBgHover),
  controlSecondaryHoverFg: new CustomProp('theme-control-secondary-hover-fg', undefined,
    colors.dark),
  controlSecondaryHoverBg: new CustomProp('theme-control-secondary-hover-bg', undefined,
    colors.darkGrey),
  controlDisabledFg: new CustomProp('theme-control-disabled-fg', undefined, colors.light),
  controlDisabledBg: new CustomProp('theme-control-disabled-bg', undefined, colors.slate),
  controlBorder: new CustomProp('theme-control-border', undefined, vars.controlBorder),

  /* Checkboxes */
  checkboxBg: new CustomProp('theme-checkbox-bg', undefined, colors.light),
  checkboxDisabledBg: new CustomProp('theme-checkbox-disabled-bg', undefined, colors.darkGrey),
  checkboxBorder: new CustomProp('theme-checkbox-border', undefined, colors.darkGrey),
  checkboxBorderHover: new CustomProp('theme-checkbox-border-hover', undefined, colors.hover),

  /* Move Docs */
  moveDocsSelectedFg: new CustomProp('theme-move-docs-selected-fg', undefined, 'white'),
  moveDocsSelectedBg: new CustomProp('theme-move-docs-selected-bg', undefined, colors.lightGreen),
  moveDocsDisabledFg: new CustomProp('theme-move-docs-disabled-bg', undefined, colors.darkGrey),

  /* Filter Bar */
  filterBarButtonSavedFg: new CustomProp('theme-filter-bar-button-saved-fg', undefined,
    colors.light),
  filterBarButtonSavedBg: new CustomProp('theme-filter-bar-button-saved-bg', undefined,
    colors.slate),
  filterBarButtonSavedHoverBg: new CustomProp('theme-filter-bar-button-saved-hover-bg', undefined,
    colors.darkGrey),

  /* Icons */
  iconDisabled: new CustomProp('theme-icon-disabled', undefined, colors.slate),
  iconError: new CustomProp('theme-icon-error', undefined, colors.error),

  /* Icon Buttons */
  iconButtonFg: new CustomProp('theme-icon-button-fg', undefined, colors.light),
  iconButtonPrimaryBg: new CustomProp('theme-icon-button-primary-bg', undefined,
    colors.lightGreen),
  iconButtonPrimaryHoverBg: new CustomProp('theme-icon-button-primary-hover-bg',
    undefined, colors.darkGreen),
  iconButtonSecondaryBg: new CustomProp('theme-icon-button-secondary-bg', undefined,
    colors.darkGrey),
  iconButtonSecondaryHoverBg: new CustomProp('theme-icon-button-secondary-hover-bg',
    undefined, colors.slate),

  /* Left Panel */
  pageHoverBg: new CustomProp('theme-left-panel-page-hover-bg', undefined, colors.mediumGrey),
  activePageFg: new CustomProp('theme-left-panel-active-page-fg', undefined, 'white'),
  activePageBg: new CustomProp('theme-left-panel-active-page-bg', undefined, colors.darkBg),
  disabledPageFg: new CustomProp('theme-left-panel-disabled-page-fg', undefined, colors.darkGrey),
  pageOptionsFg: new CustomProp('theme-left-panel-page-options-bg', undefined, colors.slate),
  pageOptionsHoverFg: new CustomProp('theme-left-panel-page-options-hover-fg', undefined, 'white'),
  pageOptionsHoverBg: new CustomProp('theme-left-panel-page-options-hover-bg', undefined,
    colors.darkGrey),
  pageOptionsSelectedHoverBg: new CustomProp('theme-left-panel-page-options-selected-hover-bg',
    undefined, colors.slate),
  pageInitialsFg: new CustomProp('theme-left-panel-page-initials-fg', undefined, 'white'),
  pageInitialsBg: new CustomProp('theme-left-panel-page-initials-bg', undefined, colors.slate),
  pageInitialsEmojiBg: new CustomProp('theme-left-panel-page-emoji-fg', undefined, 'white'),
  pageInitialsEmojiOutline: new CustomProp('theme-left-panel-page-emoji-outline', undefined,
    colors.darkGrey),

  /* Right Panel */
  rightPanelTabFg: new CustomProp('theme-right-panel-tab-fg', undefined, colors.dark),
  rightPanelTabBg: new CustomProp('theme-right-panel-tab-bg', undefined, colors.lightGrey),
  rightPanelTabIcon: new CustomProp('theme-right-panel-tab-icon', undefined, colors.slate),
  rightPanelTabIconHover: new CustomProp('theme-right-panel-tab-icon-hover', undefined,
    colors.lightGreen),
  rightPanelTabHoverBg: new CustomProp('theme-right-panel-tab-hover-bg', undefined,
    colors.mediumGrey),
  rightPanelTabSelectedFg: new CustomProp('theme-right-panel-tab-selected-fg', undefined,
    colors.light),
  rightPanelTabSelectedBg: new CustomProp('theme-right-panel-tab-selected-bg', undefined,
    colors.lightGreen),
  rightPanelTabButtonHoverBg: new CustomProp('theme-right-panel-tab-button-hover-bg',
    undefined, colors.darkGreen),
  rightPanelSubtabFg: new CustomProp('theme-right-panel-subtab-fg', undefined, colors.lightGreen),
  rightPanelSubtabSelectedFg: new CustomProp('theme-right-panel-subtab-selected-fg', undefined,
    colors.dark),
  rightPanelSubtabSelectedUnderline: new CustomProp('theme-right-panel-subtab-selected-underline',
    undefined, colors.lightGreen),
  rightPanelSubtabHoverFg: new CustomProp('theme-right-panel-subtab-hover-fg', undefined,
    colors.darkGreen),
  rightPanelSubtabHoverUnderline: new CustomProp('theme-right-panel-subtab-hover-underline',
    undefined, colors.lightGreen),
  rightPanelDisabledOverlay: new CustomProp('theme-right-panel-disabled-overlay', undefined,
    'white'),
  rightPanelToggleButtonEnabledFg: new CustomProp('theme-right-panel-toggle-button-enabled-fg',
    undefined, colors.light),
  rightPanelToggleButtonEnabledBg: new CustomProp('theme-right-panel-toggle-button-enabled-bg',
    undefined, colors.dark),
  rightPanelToggleButtonDisabledFg: new CustomProp('theme-right-panel-toggle-button-disabled-fg',
    undefined, colors.light),
  rightPanelToggleButtonDisabledBg: new CustomProp('theme-right-panel-toggle-button-disabled-bg',
    undefined, colors.mediumGreyOpaque),
  rightPanelFieldSettingsBg: new CustomProp('theme-right-panel-field-settings-bg',
    undefined, colors.mediumGreyOpaque),
  rightPanelFieldSettingsButtonBg: new CustomProp('theme-right-panel-field-settings-button-bg',
    undefined, 'lightgrey'),

  /* Document History */
  documentHistorySnapshotFg: new CustomProp('theme-document-history-snapshot-fg', undefined,
    colors.dark),
  documentHistorySnapshotSelectedFg: new CustomProp('theme-document-history-snapshot-selected-fg',
    undefined, colors.light),
  documentHistorySnapshotBg: new CustomProp('theme-document-history-snapshot-bg', undefined,
    'white'),
  documentHistorySnapshotSelectedBg: new CustomProp('theme-document-history-snapshot-selected-bg',
    undefined, colors.dark),
  documentHistorySnapshotBorder: new CustomProp('theme-document-history-snapshot-border',
    undefined, colors.mediumGrey),
  documentHistoryActivityText: new CustomProp('theme-document-history-activity-text', undefined,
    colors.dark),
  documentHistoryActivityLightText: new CustomProp('theme-document-history-activity-text-light',
    undefined, '#333333'),
  documentHistoryTableHeaderFg: new CustomProp('theme-document-history-table-header-fg',
    undefined, '#000'),
  documentHistoryTableBorder: new CustomProp('theme-document-history-table-border',
    undefined, 'lightgray'),
  documentHistoryTableBorderLight: new CustomProp('theme-document-history-table-border-light',
    undefined, '#D9D9D9'),

  /* Accents */
  accentIcon: new CustomProp('theme-accent-icon', undefined, colors.lightGreen),
  accentBorder: new CustomProp('theme-accent-border', undefined, colors.lightGreen),
  accentText: new CustomProp('theme-accent-text', undefined, colors.lightGreen),

  /* Inputs */
  inputFg: new CustomProp('theme-input-fg', undefined, 'black'),
  inputBg: new CustomProp('theme-input-bg', undefined, 'white'),
  inputDisabledFg: new CustomProp('theme-input-disabled-fg', undefined, colors.slate),
  inputDisabledBg: new CustomProp('theme-input-disabled-bg', undefined, colors.lightGrey),
  inputPlaceholderFg: new CustomProp('theme-input-placeholder-fg', undefined, '#757575'),
  inputBorder: new CustomProp('theme-input-border', undefined, colors.darkGrey),
  inputValid: new CustomProp('theme-input-valid', undefined, colors.lightGreen),
  inputInvalid: new CustomProp('theme-input-invalid', undefined, colors.error),
  inputFocus: new CustomProp('theme-input-focus', undefined, '#5E9ED6'),
  inputReadonlyBg: new CustomProp('theme-input-readonly-bg', undefined, colors.lightGrey),
  inputReadonlyBorder: new CustomProp('theme-input-readonly-border', undefined, colors.mediumGreyOpaque),

  /* Choice Tokens */
  choiceTokenFg: new CustomProp('theme-choice-token-fg', undefined, '#000000'),
  choiceTokenBlankFg: new CustomProp('theme-choice-token-blank-fg', undefined, colors.slate),
  choiceTokenBg: new CustomProp('theme-choice-token-bg', undefined, colors.mediumGreyOpaque),
  choiceTokenSelectedBg: new CustomProp('theme-choice-token-selected-bg', undefined, colors.darkGrey),
  choiceTokenSelectedBorder: new CustomProp('theme-choice-token-selected-border', undefined, colors.lightGreen),
  choiceTokenInvalidFg: new CustomProp('theme-choice-token-invalid-fg', undefined, '#000000'),
  choiceTokenInvalidBg: new CustomProp('theme-choice-token-invalid-bg', undefined, 'white'),
  choiceTokenInvalidBorder: new CustomProp('theme-choice-token-invalid-border', undefined, colors.error),

  /* Choice Entry */
  choiceEntryBg: new CustomProp('theme-choice-entry-bg', undefined, 'white'),
  choiceEntryBorder: new CustomProp('theme-choice-entry-border', undefined, colors.darkGrey),
  choiceEntryBorderHover: new CustomProp('theme-choice-entry-border-hover', undefined,
    colors.hover),

  /* Select Buttons */
  selectButtonFg: new CustomProp('theme-select-button-fg', undefined, colors.dark),
  selectButtonPlaceholderFg: new CustomProp('theme-select-button-placeholder-fg', undefined,
    colors.slate),
  selectButtonBg: new CustomProp('theme-select-button-bg', undefined, 'white'),
  selectButtonBorder: new CustomProp('theme-select-button-border', undefined, colors.darkGrey),
  selectButtonBorderInvalid: new CustomProp('theme-select-button-border-invalid', undefined,
    colors.error),

  /* Menus */
  menuText: new CustomProp('theme-menu-text', undefined, colors.slate),
  menuLightText: new CustomProp('theme-menu-light-text', undefined, colors.slate),
  menuBg: new CustomProp('theme-menu-bg', undefined, 'white'),
  menuSubheaderFg: new CustomProp('theme-menu-subheader-fg', undefined, colors.dark),
  menuBorder: new CustomProp('theme-menu-border', undefined, colors.mediumGreyOpaque),
  menuShadow: new CustomProp('theme-menu-shadow', undefined, 'rgba(38, 38, 51, 0.6)'),

  /* Menu Items */
  menuItemFg: new CustomProp('theme-menu-item-fg', undefined, 'black'),
  menuItemSelectedFg: new CustomProp('theme-menu-item-selected-fg', undefined, colors.light),
  menuItemSelectedBg: new CustomProp('theme-menu-item-selected-bg', undefined, vars.primaryBg),
  menuItemDisabledFg: new CustomProp('theme-menu-item-disabled-fg', undefined, '#D9D9D9'),
  menuItemIconFg: new CustomProp('theme-menu-item-icon-fg', undefined, colors.slate),
  menuItemIconSelectedFg: new CustomProp('theme-menu-item-icon-selected-fg', undefined, 'white'),

  /* Autocomplete */
  autocompleteMatchText: new CustomProp('theme-autocomplete-match-text', undefined,
    colors.lightGreen),
  autocompleteSelectedMatchText: new CustomProp('theme-autocomplete-selected-match-text',
    undefined, colors.lighterGreen),
  autocompleteItemSelectedBg: new CustomProp('theme-autocomplete-item-selected-bg', undefined,
    colors.mediumGreyOpaque),
  autocompleteAddNewCircleFg: new CustomProp('theme-autocomplete-add-new-circle-fg', undefined,
    colors.light),
  autocompleteAddNewCircleBg: new CustomProp('theme-autocomplete-add-new-circle-bg', undefined,
    colors.lightGreen),
  autocompleteAddNewCircleSelectedBg: new CustomProp(
    'theme-autocomplete-add-new-circle-selected-bg', undefined, colors.darkGreen),

  /* Search */
  searchBorder: new CustomProp('theme-search-border', undefined, 'grey'),
  searchPrevNextButtonFg: new CustomProp('theme-search-prev-next-button-fg', undefined,
    colors.slate),
  searchPrevNextButtonBg: new CustomProp('theme-search-prev-next-button-bg', undefined,
    colors.mediumGrey),

  /* Loaders */
  loaderFg: new CustomProp('theme-loader-fg', undefined, colors.lightGreen),
  loaderBg: new CustomProp('theme-loader-bg', undefined, colors.darkGrey),

  /* Site Switcher */
  siteSwitcherActiveFg: new CustomProp('theme-site-switcher-active-fg', undefined, colors.light),
  siteSwitcherActiveBg: new CustomProp('theme-site-switcher-active-bg', undefined, colors.dark),

  /* Doc Menu */
  docMenuDocOptionsFg: new CustomProp('theme-doc-menu-doc-options-fg', undefined, colors.darkGrey),
  docMenuDocOptionsHoverFg: new CustomProp('theme-doc-menu-doc-options-hover-fg', undefined,
    colors.slate),
  docMenuDocOptionsHoverBg: new CustomProp('theme-doc-menu-doc-options-hover-bg', undefined,
    colors.darkGrey),

  /* Shortcut Keys */
  shortcutKeyFg: new CustomProp('theme-shortcut-key-fg', undefined, 'black'),
  shortcutKeyPrimaryFg: new CustomProp('theme-shortcut-key-primary-fg', undefined,
    colors.darkGreen),
  shortcutKeySecondaryFg: new CustomProp('theme-shortcut-key-secondary-fg', undefined,
    colors.slate),
  shortcutKeyBg: new CustomProp('theme-shortcut-key-bg', undefined, 'white'),
  shortcutKeyBorder: new CustomProp('theme-shortcut-key-border', undefined, colors.slate),

  /* Breadcrumbs */
  breadcrumbsTagFg: new CustomProp('theme-breadcrumbs-tag-fg', undefined, 'white'),
  breadcrumbsTagBg: new CustomProp('theme-breadcrumbs-tag-bg', undefined, colors.slate),
  breadcrumbsTagAlertBg: new CustomProp('theme-breadcrumbs-tag-alert-fg', undefined, colors.error),

  /* Page Widget Picker */
  widgetPickerPrimaryBg: new CustomProp('theme-widget-picker-primary-bg', undefined, 'white'),
  widgetPickerSecondaryBg: new CustomProp('theme-widget-picker-secondary-bg', undefined,
    colors.lightGrey),
  widgetPickerItemFg: new CustomProp('theme-widget-picker-item-fg', undefined, colors.dark),
  widgetPickerItemSelectedBg: new CustomProp('theme-widget-picker-item-selected-bg', undefined,
    colors.mediumGrey),
  widgetPickerItemDisabledBg: new CustomProp('theme-widget-picker-item-disabled-bg', undefined,
    colors.mediumGrey),
  widgetPickerIcon: new CustomProp('theme-widget-picker-icon', undefined, colors.slate),
  widgetPickerPrimaryIcon: new CustomProp('theme-widget-picker-primary-icon', undefined,
    colors.lightGreen),
  widgetPickerSummaryIcon: new CustomProp('theme-widget-picker-summary-icon', undefined,
    colors.darkGreen),
  widgetPickerBorder: new CustomProp('theme-widget-picker-border', undefined, colors.mediumGrey),
  widgetPickerShadow: new CustomProp('theme-widget-picker-shadow', undefined,
    'rgba(38,38,51,0.20)'),

  /* Code View */
  codeViewText: new CustomProp('theme-code-view-text', undefined, '#444'),
  codeViewKeyword: new CustomProp('theme-code-view-keyword', undefined, '#444'),
  codeViewComment: new CustomProp('theme-code-view-comment', undefined, '#888888'),
  codeViewMeta: new CustomProp('theme-code-view-meta', undefined, '#1F7199'),
  codeViewTitle: new CustomProp('theme-code-view-title', undefined, '#880000'),
  codeViewParams: new CustomProp('theme-code-view-params', undefined, '#444'),
  codeViewString: new CustomProp('theme-code-view-string', undefined, '#880000'),
  codeViewNumber: new CustomProp('theme-code-view-number', undefined, '#880000'),
  codeViewBuiltin: new CustomProp('theme-code-view-builtin', undefined, '#397300'),
  codeViewLiteral: new CustomProp('theme-code-view-literal', undefined, '#78A960'),

  /* Importer */
  importerTableInfoBorder: new CustomProp('theme-importer-table-info-border', undefined, colors.darkGrey),
  importerPreviewBorder: new CustomProp('theme-importer-preview-border', undefined,
    colors.darkGrey),
  importerSkippedTableOverlay: new CustomProp('theme-importer-skipped-table-overlay', undefined,
    colors.mediumGrey),
  importerMatchIcon: new CustomProp('theme-importer-match-icon', undefined, colors.darkGrey),
  importerOutsideBg: new CustomProp('theme-importer-outside-bg', undefined, colors.lightGrey),
  importerMainContentBg: new CustomProp('theme-importer-main-content-bg', undefined, '#FFFFFF'),

  // tabs
  importerActiveFileBg: new CustomProp('theme-importer-active-file-bg', undefined, colors.lightGreen),
  importerActiveFileFg: new CustomProp('theme-importer-active-file-fg', undefined, colors.light),
  importerInactiveFileBg: new CustomProp('theme-importer-inactive-file-bg', undefined, colors.mediumGrey),
  importerInactiveFileFg: new CustomProp('theme-importer-inactive-file-fg', undefined, colors.light),

  /* Menu Toggles */
  menuToggleFg: new CustomProp('theme-menu-toggle-fg', undefined, colors.slate),
  menuToggleHoverFg: new CustomProp('theme-menu-toggle-hover-fg', undefined, colors.darkGreen),
  menuToggleActiveFg: new CustomProp('theme-menu-toggle-active-fg', undefined, colors.darkerGreen),
  menuToggleBg: new CustomProp('theme-menu-toggle-bg', undefined, 'white'),
  menuToggleBorder: new CustomProp('theme-menu-toggle-border', undefined, colors.slate),

  /* Info Button */
  infoButtonFg: new CustomProp('theme-info-button-fg', undefined, "#8F8F8F"),
  infoButtonHoverFg: new CustomProp('theme-info-button-hover-fg', undefined, "#707070"),
  infoButtonActiveFg: new CustomProp('theme-info-button-active-fg', undefined, "#5C5C5C"),

  /* Button Groups */
  buttonGroupFg: new CustomProp('theme-button-group-fg', undefined, colors.dark),
  buttonGroupLightFg: new CustomProp('theme-button-group-light-fg', undefined, colors.slate),
  buttonGroupBg: new CustomProp('theme-button-group-bg', undefined, 'transparent'),
  buttonGroupBgHover: new CustomProp('theme-button-group-bg-hover', undefined,
  colors.hover),
  buttonGroupIcon: new CustomProp('theme-button-group-icon', undefined, colors.slate),
  buttonGroupBorder: new CustomProp('theme-button-group-border', undefined, colors.darkGrey),
  buttonGroupBorderHover: new CustomProp('theme-button-group-border-hover', undefined,
    colors.hover),
  buttonGroupSelectedFg: new CustomProp('theme-button-group-selected-fg', undefined, colors.light),
  buttonGroupLightSelectedFg: new CustomProp('theme-button-group-light-selected-fg', undefined,
    colors.lightGreen),
  buttonGroupSelectedBg: new CustomProp('theme-button-group-selected-bg', undefined, colors.dark),
  buttonGroupSelectedBorder: new CustomProp('theme-button-group-selected-border', undefined,
    colors.dark),

  /* Access Rules */
  accessRulesTableHeaderFg: new CustomProp('theme-access-rules-table-header-fg', undefined,
    colors.dark),
  accessRulesTableHeaderBg: new CustomProp('theme-access-rules-table-header-bg', undefined,
    colors.mediumGrey),
  accessRulesTableBodyFg: new CustomProp('theme-access-rules-table-body-fg', undefined,
    colors.dark),
  accessRulesTableBodyLightFg: new CustomProp('theme-access-rules-table-body-light-fg', undefined,
    colors.darkGrey),
  accessRulesTableBorder: new CustomProp('theme-access-rules-table-border', undefined,
    colors.slate),
  accessRulesColumnListBorder: new CustomProp('theme-access-rules-column-list-border', undefined,
    colors.darkGrey),
  accessRulesColumnItemFg: new CustomProp('theme-access-rules-column-item-fg', undefined,
    colors.dark),
  accessRulesColumnItemBg: new CustomProp('theme-access-rules-column-item-bg', undefined,
    colors.mediumGreyOpaque),
  accessRulesColumnItemIconFg: new CustomProp('theme-access-rules-column-item-icon-fg', undefined,
    colors.slate),
  accessRulesColumnItemIconHoverFg: new CustomProp('theme-access-rules-column-item-icon-hover-fg',
    undefined, colors.light),
  accessRulesColumnItemIconHoverBg: new CustomProp('theme-access-rules-column-item-icon-hover-bg',
    undefined, colors.slate),
  accessRulesFormulaEditorBg: new CustomProp('theme-access-rules-formula-editor-bg', undefined,
    'white'),
  accessRulesFormulaEditorBorderHover: new CustomProp(
    'theme-access-rules-formula-editor-border-hover', undefined, colors.darkGrey),
  accessRulesFormulaEditorBgDisabled: new CustomProp(
    'theme-access-rules-formula-editor-bg-disabled', undefined, colors.mediumGreyOpaque),
  accessRulesFormulaEditorFocus: new CustomProp('theme-access-rules-formula-editor-focus',
    undefined, colors.cursor),

  /* Cells */
  cellFg: new CustomProp('theme-cell-fg', undefined, 'black'),
  cellBg: new CustomProp('theme-cell-bg', undefined, '#FFFFFF00'),
  cellZebraBg: new CustomProp('theme-cell-zebra-bg', undefined, '#F8F8F8'),

  /* Charts */
  chartFg: new CustomProp('theme-chart-fg', undefined, '#444'),
  chartBg: new CustomProp('theme-chart-bg', undefined, '#fff'),
  chartLegendBg: new CustomProp('theme-chart-legend-bg', undefined, '#FFFFFF80'),
  chartXAxis: new CustomProp('theme-chart-x-axis', undefined, '#444'),
  chartYAxis: new CustomProp('theme-chart-y-axis', undefined, '#444'),

  /* Comments */
  commentsPopupHeaderBg: new CustomProp('theme-comments-popup-header-bg', undefined,
    colors.lightGrey),
  commentsPopupBodyBg: new CustomProp('theme-comments-popup-body-bg', undefined, 'white'),
  commentsPopupBorder: new CustomProp('theme-comments-popup-border', undefined, colors.darkGrey),
  commentsUserNameFg: new CustomProp('theme-comments-user-name-fg', undefined, colors.darkText),
  commentsPanelTopicBg: new CustomProp('theme-comments-panel-topic-bg', undefined, 'white'),
  commentsPanelTopicBorder: new CustomProp('theme-comments-panel-topic-border', undefined, '#ccc'),
  commentsPanelResolvedTopicBg: new CustomProp('theme-comments-panel-resolved-topic-bg', undefined,
    vars.labelActiveBg),

  /* Date Picker */
  datePickerSelectedFg: new CustomProp('theme-date-picker-selected-fg', undefined,
    colors.light),
  datePickerSelectedBg: new CustomProp('theme-date-picker-selected-bg', undefined,
    '#286090'),
  datePickerSelectedBgHover: new CustomProp('theme-date-picker-selected-bg-hover',
    undefined, '#204d74'),
  datePickerTodayFg: new CustomProp('theme-date-picker-today-fg', undefined,
    colors.light),
  datePickerTodayBg: new CustomProp('theme-date-picker-today-bg', undefined,
    colors.lightGreen),
  datePickerTodayBgHover: new CustomProp('theme-date-picker-today-bg-hover', undefined,
    colors.darkGreen),
  datePickerRangeStartEndBg: new CustomProp('theme-date-picker-range-start-end-bg', undefined,
    '#777'),
  datePickerRangeStartEndBgHover: new CustomProp('theme-date-picker-range-start-end-bg-hover',
    undefined, '#5E5E5E'),
  datePickerRangeBg: new CustomProp('theme-date-picker-range-bg', undefined,
    colors.mediumGreyOpaque),
  datePickerRangeBgHover: new CustomProp('theme-date-picker-range-bg-hover', undefined,
    colors.darkGrey),

  /* Tutorials */
  tutorialsPopupBorder: new CustomProp('theme-tutorials-popup-border', undefined,
    colors.darkGrey),
  tutorialsPopupHeaderFg: new CustomProp('theme-tutorials-popup-header-fg', undefined,
    colors.lightGreen),
  tutorialsPopupBoxBg: new CustomProp('theme-tutorials-popup-box-bg', undefined, '#F5F5F5'),
  tutorialsPopupCodeFg: new CustomProp('theme-tutorials-popup-code-fg', undefined, '#333333'),
  tutorialsPopupCodeBg: new CustomProp('theme-tutorials-popup-code-bg', undefined, '#FFFFFF'),
  tutorialsPopupCodeBorder: new CustomProp('theme-tutorials-popup-code-border', undefined, '#E1E4E5'),

  /* Ace */
  aceEditorBg: new CustomProp('theme-ace-editor-bg', undefined, 'white'),
  aceAutocompletePrimaryFg: new CustomProp('theme-ace-autocomplete-primary-fg', undefined, '#444'),
  aceAutocompleteSecondaryFg: new CustomProp('theme-ace-autocomplete-secondary-fg', undefined,
    '#8f8f8f'),
  aceAutocompleteHighlightedFg: new CustomProp('theme-ace-autocomplete-highlighted-fg', undefined, '#000'),
  aceAutocompleteBg: new CustomProp('theme-ace-autocomplete-bg', undefined, '#FBFBFB'),
  aceAutocompleteBorder: new CustomProp('theme-ace-autocomplete-border', undefined, 'lightgray'),
  aceAutocompleteLink: new CustomProp('theme-ace-autocomplete-link', undefined, colors.lightGreen),
  aceAutocompleteLinkHighlighted: new CustomProp('theme-ace-autocomplete-link-highlighted',
    undefined, colors.darkGreen),
  aceAutocompleteActiveLineBg: new CustomProp('theme-ace-autocomplete-active-line-bg',
    undefined, '#CAD6FA'),
  aceAutocompleteLineBorderHover: new CustomProp('theme-ace-autocomplete-line-border-hover',
    undefined, '#abbffe'),
  aceAutocompleteLineBgHover: new CustomProp('theme-ace-autocomplete-line-bg-hover',
    undefined, 'rgba(233,233,253,0.4)'),

  /* Color Select */
  colorSelectFg: new CustomProp('theme-color-select-fg', undefined, colors.dark),
  colorSelectBg: new CustomProp('theme-color-select-bg', undefined, 'white'),
  colorSelectShadow: new CustomProp('theme-color-select-shadow', undefined,
    'rgba(38,38,51,0.6)'),
  colorSelectFontOptionsBorder: new CustomProp('theme-color-select-font-options-border',
    undefined, colors.darkGrey),
  colorSelectFontOptionFg: new CustomProp('theme-color-select-font-option-fg',
    undefined, colors.dark),
  colorSelectFontOptionBgHover: new CustomProp('theme-color-select-font-option-bg-hover',
    undefined, colors.lightGrey),
  colorSelectFontOptionFgSelected: new CustomProp('theme-color-select-font-option-fg-selected',
    undefined, colors.light),
  colorSelectFontOptionBgSelected: new CustomProp('theme-color-select-font-option-bg-selected',
    undefined, colors.dark),
  colorSelectColorSquareBorder: new CustomProp('theme-color-select-color-square-border',
    undefined, '#D9D9D9'),
  colorSelectColorSquareBorderEmpty: new CustomProp('theme-color-select-color-square-border-empty',
    undefined, colors.dark),
  colorSelectInputFg: new CustomProp('theme-color-select-input-fg',
    undefined, colors.slate),
  colorSelectInputBg: new CustomProp('theme-color-select-input-bg',
    undefined, 'white'),
  colorSelectInputBorder: new CustomProp('theme-color-select-input-border',
    undefined, colors.darkGrey),

  /* Highlighted Code */
  highlightedCodeBlockBg: new CustomProp('theme-highlighted-code-block-bg', undefined,
    colors.light),
  highlightedCodeBlockBgDisabled: new CustomProp('theme-highlighted-code-block-bg-disabled',
    undefined, colors.mediumGreyOpaque),
  highlightedCodeFg: new CustomProp('theme-highlighted-code-fg',
    undefined, colors.slate),
  highlightedCodeBorder: new CustomProp('theme-highlighted-code-border',
    undefined, colors.darkGrey),
  highlightedCodeBgDisabled: new CustomProp('theme-highlighted-code-bg-disabled',
    undefined, colors.mediumGreyOpaque),

  /* Login Page */
  loginPageBg: new CustomProp('theme-login-page-bg', undefined, 'white'),
  loginPageBackdrop: new CustomProp('theme-login-page-backdrop', undefined, '#F5F8FA'),
  loginPageLine: new CustomProp('theme-login-page-line', undefined, colors.lightGrey),
  loginPageGoogleButtonFg: new CustomProp('theme-login-page-google-button-fg', undefined,
    colors.dark),
  loginPageGoogleButtonBg: new CustomProp('theme-login-page-google-button-bg', undefined,
    colors.lightGrey),
  loginPageGoogleButtonBgHover: new CustomProp('theme-login-page-google-button-bg-hover',
    undefined, colors.mediumGrey),
  loginPageGoogleButtonBorder: new CustomProp('theme-login-page-google-button-border', undefined,
    colors.darkGrey),

  /* Formula Assistant */
  formulaAssistantHeaderBg: new CustomProp(
    'theme-formula-assistant-header-bg', undefined, colors.lightGrey),
  formulaAssistantBorder: new CustomProp(
    'theme-formula-assistant-border', undefined, colors.darkGrey),
  formulaAssistantPreformattedTextBg: new CustomProp(
    'theme-formula-assistant-preformatted-text-bg', undefined, colors.lightGrey),

  /* Attachments */
  attachmentsEditorButtonFg: new CustomProp(
    'theme-attachments-editor-button-fg', undefined, colors.darkGreen),
  attachmentsEditorButtonHoverFg: new CustomProp(
    'theme-attachments-editor-button-hover-fg', undefined, colors.lightGreen),
  attachmentsEditorButtonBg: new CustomProp(
    'theme-attachments-editor-button-bg', undefined, colors.light),
  attachmentsEditorButtonHoverBg: new CustomProp(
    'theme-attachments-editor-button-hover-bg', undefined, colors.mediumGreyOpaque),
  attachmentsEditorButtonBorder: new CustomProp(
    'theme-attachments-editor-button-border', undefined, colors.darkGrey),
  attachmentsEditorButtonIcon: new CustomProp(
    'theme-attachments-editor-button-icon', undefined, colors.slate),
  attachmentsEditorBorder: new CustomProp(
    'theme-attachments-editor-border', undefined, colors.mediumGreyOpaque),
  attachmentsCellIconFg: new CustomProp(
    'theme-attachments-cell-icon-fg', undefined, 'white'),
  attachmentsCellIconBg: new CustomProp(
    'theme-attachments-cell-icon-bg', undefined, '#D9D9D9'),
  attachmentsCellIconHoverBg: new CustomProp(
    'theme-attachments-cell-icon-hover-bg', undefined, '#929299'),

  /* Announcement Popups */
  announcementPopupFg: new CustomProp('theme-announcement-popup-fg', undefined, '#000000'),
  announcementPopupBg: new CustomProp('theme-announcement-popup-bg', undefined, '#DCF4EB'),

  /* Switches */
  switchSliderFg: new CustomProp('theme-switch-slider-fg', undefined, '#ccc'),
  switchCircleFg: new CustomProp('theme-switch-circle-fg', undefined, 'white'),

  /* Toggle Checkboxes */
  toggleCheckboxFg: new CustomProp('theme-toggle-checkbox-fg', undefined, '#606060'),

  /* Numeric Spinners */
  numericSpinnerFg: new CustomProp('theme-numeric-spinner-fg', undefined, '#606060'),
};

const cssColors = values(colors).map(v => v.decl()).join('\n');
const cssVars = values(vars).map(v => v.decl()).join('\n');
const cssFontParams = `
  font-family: ${vars.fontFamily};
  font-size: ${vars.mediumFontSize};
  -moz-osx-font-smoothing: grayscale;
  -webkit-font-smoothing: antialiased;
`;

// We set box-sizing globally to match bootstrap's setting of border-box, since we are integrating
// into an app which already has it set, and it's impossible to make things look consistently with
// AND without it. This duplicates bootstrap's setting.
const cssBorderBox = `
  *, *:before, *:after {
  -webkit-box-sizing: border-box;
     -moz-box-sizing: border-box;
          box-sizing: border-box;
  }
`;

// These styles duplicate bootstrap's global settings, which we rely on even on pages that don't
// have bootstrap.
const cssInputFonts = `
  button, input, select, textarea {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
  }
`;

// Font style classes used by style selector.
const cssFontStyles = `
  .font-italic {
    font-style: italic;
  }
  .font-bold {
    font-weight: 800;
  }
  .font-underline {
    text-decoration: underline;
  }
  .font-strikethrough {
    text-decoration: line-through;
  }
  .font-strikethrough.font-underline {
    text-decoration: line-through underline;
  }
`;

const cssVarsOnly = styled('div', cssColors + cssVars);
const cssBodyVars = styled('div', cssFontParams + cssColors + cssVars + cssBorderBox + cssInputFonts + cssFontStyles);

const cssBody = styled('body', `
  margin: 0;
  height: 100%;
`);

const cssRoot = styled('html', `
  height: 100%;
  overflow: hidden;
`);

export const cssRootVars = cssBodyVars.className;

// Also make a globally available testId, with a simple "test-" prefix (i.e. in tests, query css
// class ".test-{name}". Ideally, we'd use noTestId() instead in production.
export const testId: TestId = makeTestId('test-');

// Min width for normal screen layout (in px). Note: <768px is bootstrap's definition of small
// screen (covers phones, including landscape, but not tablets).
const largeScreenWidth = 992;
const mediumScreenWidth = 768;
const smallScreenWidth = 576;   // Anything below this is extra-small (e.g. portrait phones).

// Fractional width for max-query follows https://getbootstrap.com/docs/4.0/layout/overview/#responsive-breakpoints
export const mediaMedium = `(max-width: ${largeScreenWidth - 0.02}px)`;
export const mediaSmall = `(max-width: ${mediumScreenWidth - 0.02}px)`;
export const mediaNotSmall = `(min-width: ${mediumScreenWidth}px)`;
export const mediaXSmall = `(max-width: ${smallScreenWidth - 0.02}px)`;

export const mediaDeviceNotSmall = `(min-device-width: ${mediumScreenWidth}px)`;

export function isNarrowScreen() {
  return window.innerWidth < mediumScreenWidth;
}

let _isNarrowScreenObs: Observable<boolean>|undefined;

// Returns a singleton observable for whether the screen is a small one.
export function isNarrowScreenObs(): Observable<boolean> {
  if (!_isNarrowScreenObs) {
    const obs = Observable.create<boolean>(null, isNarrowScreen());
    window.addEventListener('resize', () => obs.set(isNarrowScreen()));
    _isNarrowScreenObs = obs;
  }
  return _isNarrowScreenObs;
}

export function isXSmallScreen() {
  return window.innerWidth < smallScreenWidth;
}

let _isXSmallScreenObs: Observable<boolean>|undefined;

// Returns a singleton observable for whether the screen is an extra small one.
export function isXSmallScreenObs(): Observable<boolean> {
  if (!_isXSmallScreenObs) {
    const obs = Observable.create<boolean>(null, isXSmallScreen());
    window.addEventListener('resize', () => obs.set(isXSmallScreen()));
    _isXSmallScreenObs = obs;
  }
  return _isXSmallScreenObs;
}

export const cssHideForNarrowScreen = styled('div', `
  @media ${mediaSmall} {
    & {
      display: none !important;
    }
  }
`);

let _isScreenResizingObs: Observable<boolean>|undefined;

// Returns a singleton observable for whether user is currently resizing the window. (listen to
// `resize` events and uses a timer of 1000ms).
export function isScreenResizing(): Observable<boolean> {
  if (!_isScreenResizingObs) {
    const obs = Observable.create<boolean>(null, false);
    const ping = debounce(() => obs.set(false), 1000);
    window.addEventListener('resize', () => { obs.set(true); ping(); });
    _isScreenResizingObs = obs;
  }
  return _isScreenResizingObs;
}

export function prefersDarkMode(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

let _prefersDarkModeObs: PausableObservable<boolean>|undefined;

/**
 * Returns a singleton observable for whether the user agent prefers dark mode.
 */
export function prefersDarkModeObs(): PausableObservable<boolean> {
  if (!_prefersDarkModeObs) {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const obs = createPausableObs<boolean>(null, query.matches);
    query.addEventListener('change', event => obs.set(event.matches));
    _prefersDarkModeObs = obs;
  }
  return _prefersDarkModeObs;
}

let _prefersColorSchemeThemeObs: Computed<Theme>|undefined;

/**
 * Returns a singleton observable for the Grist theme matching the current
 * user agent color scheme preference ("light" or "dark").
 */
export function prefersColorSchemeThemeObs(): Computed<Theme> {
  if (!_prefersColorSchemeThemeObs) {
    const obs = Computed.create(null, prefersDarkModeObs(), (_use, prefersDarkTheme) => {
      if (prefersDarkTheme) {
        return {
          appearance: 'dark',
          colors: getThemeColors('GristDark'),
        } as const;
      } else {
        return {
          appearance: 'light',
          colors: getThemeColors('GristLight'),
        } as const;
      }
    });
    _prefersColorSchemeThemeObs = obs;
  }
  return _prefersColorSchemeThemeObs;
}

/**
 * Attaches the global css properties to the document's root to make them available in the page.
 */
export function attachCssRootVars(productFlavor: ProductFlavor, varsOnly: boolean = false) {
  dom.update(document.documentElement, varsOnly ? dom.cls(cssVarsOnly.className) : dom.cls(cssRootVars));
  document.documentElement.classList.add(cssRoot.className);
  document.body.classList.add(cssBody.className);
  const customTheme = getTheme(productFlavor);
  if (customTheme.bodyClassName) {
    document.body.classList.add(customTheme.bodyClassName);
  }
  const interfaceStyle = urlState().state.get().params?.style || 'full';
  document.body.classList.add(`interface-${interfaceStyle}`);
}

export function attachTheme(themeObs: Observable<Theme>) {
  // Attach the current theme to the DOM.
  attachCssThemeVars(themeObs.get());

  // Whenever the theme changes, re-attach it to the DOM.
  return themeObs.addListener((newTheme, oldTheme) => {
    if (isEqual(newTheme, oldTheme)) { return; }

    attachCssThemeVars(newTheme);
  });
}

/**
 * Attaches theme-related css properties to the theme style element.
 */
function attachCssThemeVars({appearance, colors: themeColors}: Theme) {
  // Custom CSS is incompatible with custom themes.
  if (getGristConfig().enableCustomCss) { return; }

  // Prepare the custom properties needed for applying the theme.
  const properties = Object.entries(themeColors)
    .map(([name, value]) => `--grist-theme-${name}: ${value};`);

  // Include properties for styling the scrollbar.
  properties.push(...getCssScrollbarProperties(appearance));

  // Include properties for picking an appropriate background image.
  properties.push(...getCssThemeBackgroundProperties(appearance));

  // Apply the properties to the theme style element.
  getOrCreateStyleElement('grist-theme').textContent = `:root {
${properties.join('\n')}
  }`;

  // Make the browser aware of the color scheme.
  document.documentElement.style.setProperty(`color-scheme`, appearance);

  // Cache the appearance in local storage; this is currently used to apply a suitable
  // background image that's shown while the application is loading.
  getStorage().setItem('appearance', appearance);
}

/**
 * Gets scrollbar-related css properties that are appropriate for the given `appearance`.
 *
 * Note: Browser support for customizing scrollbars is still a mixed bag; the bulk of customization
 * is non-standard and unsupported by Firefox. If support matures, we could expose some of these in
 * custom themes, but for now we'll just go with reasonable presets.
 */
function getCssScrollbarProperties(appearance: ThemeAppearance) {
  return [
    '--scroll-bar-fg: ' +
      (appearance === 'dark' ? '#6B6B6B;' : '#A8A8A8;'),
    '--scroll-bar-hover-fg: ' +
      (appearance === 'dark' ? '#7B7B7B;' : '#8F8F8F;'),
    '--scroll-bar-active-fg: ' +
      (appearance === 'dark' ? '#8B8B8B;' : '#7C7C7C;'),
    '--scroll-bar-bg: ' +
      (appearance === 'dark' ? '#2B2B2B;' : '#F0F0F0;'),
  ];
}

/**
 * Gets background-related css properties that are appropriate for the given `appearance`.
 *
 * Currently, this sets a property for showing a background image that's visible while a page
 * is loading.
 */
function getCssThemeBackgroundProperties(appearance: ThemeAppearance) {
  const value = appearance === 'dark'
    ? 'url("img/prismpattern.png")'
    : 'url("img/gplaypattern.png")';
  return [`--grist-theme-bg: ${value};`];
}

/**
 * Gets or creates a style element in the head of the document with the given `id`.
 *
 * Useful for grouping CSS values such as theme custom properties without needing to
 * pollute the document with in-line styles.
 */
function getOrCreateStyleElement(id: string) {
  let style = document.head.querySelector(`#${id}`);
  if (style) { return style; }
  style = document.createElement('style');
  style.setAttribute('id', id);
  document.head.append(style);
  return style;
}

// A dom method to hide element in print view
export function hideInPrintView(): DomElementMethod {
  return cssHideInPrint.cls('');
}

const cssHideInPrint = styled('div', `
  @media print {
    & {
      display: none !important;
    }
  }
`);
