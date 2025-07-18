import { CssCustomProp } from './CssCustomProp';

export interface ThemePrefs {
  appearance: ThemeAppearance;
  syncWithOS: boolean;
  colors: {
    light: ThemeName;
    dark: ThemeName;
  }
}

export const themeAppearances = ['light', 'dark'] as const;
export type ThemeAppearance = typeof themeAppearances[number];

export type ThemeNameOrTokens = ThemeName | ThemeTokens;

export const themeNames = ['GristLight', 'GristDark', 'HighContrastLight'] as const;
export type ThemeName = typeof themeNames[number];

export const themeNameAppearances = {
  GristLight: 'light',
  GristDark: 'dark',
  HighContrastLight: 'light',
} as const;

export function getDefaultThemePrefs(): ThemePrefs {
  return {
    appearance: 'light',
    syncWithOS: true,
    colors: {
      // Note: the colors object is not used for its original purpose.
      // It's currently our way to store the theme name in user prefs (without having to change the user prefs schema).
      // This is why we just repeat the name in both `light` and `dark` properties.
      light: 'GristLight',
      dark: 'GristLight',
    }
  };
}

export interface Theme {
  appearance: ThemeAppearance;
  name: ThemeName;
  colors: ThemeTokens;
}

export interface ThemeWithCssVars {
  appearance: ThemeAppearance;
  name: ThemeName;
  colors: {
    [key: string]: string;
  };
}

type Token = string | CssCustomProp;

/*
 * List of all possible theme tokens (except component specific ones, see below)
 *
 * This is used to generate the `tokens` object, that initializes CSS variables for every token.
 * Actual values are defined in a theme.
 *
 * Actual CSS variables appended to the DOM will have a 'grist-theme' prefix.
 * Example: the bgSecondary variable is appended as `--grist-theme-bg-secondary` css variable.
 */
export const tokensCssMapping = {
  body: 'body',
  emphasis: 'emphasis',
  secondary: 'secondary',
  veryLight: 'very-light',

  bg: 'bg-default', // names don't match here to prevent conflicting with internal --grist-theme-bg var
  bgSecondary: 'bg-secondary',
  bgTertiary: 'bg-tertiary',
  bgEmphasis: 'bg-emphasis',

  decoration: 'decoration',
  decorationSecondary: 'decoration-secondary',
  decorationTertiary: 'decoration-tertiary',

  primary: 'primary',
  primaryMuted: 'primary-muted',
  primaryDim: 'primary-dim',
  primaryEmphasis: 'primary-emphasis',

  white: 'white',
  black: 'black',

  error: 'error',
  errorLight: 'error-light',

  warning: 'warning',
  warningLight: 'warning-light',

  info: 'info',
  infoLight: 'info-light',

  fontFamily: 'font-family',
  fontFamilyData: 'font-family-data',

  xxsmallFontSize: 'xx-small-font-size',
  xsmallFontSize: 'x-small-font-size',
  smallFontSize: 'small-font-size',
  mediumFontSize: 'medium-font-size',
  introFontSize: 'intro-font-size',
  largeFontSize: 'large-font-size',
  xlargeFontSize: 'x-large-font-size',
  xxlargeFontSize: 'xx-large-font-size',
  xxxlargeFontSize: 'xxx-large-font-size',

  bigControlFontSize: 'big-control-font-size',
  headerControlFontSize: 'header-control-font-size',

  bigControlTextWeight: 'big-control-text-weight',
  headerControlTextWeight: 'header-control-text-weight',

  controlBorderRadius: 'control-border-radius',

  // some css vars below are prefixed with 'token-' to avoid conflicts with component vars
  cursor: 'token-cursor',
  cursorInactive: 'token-cursor-inactive',

  selection: 'token-selection',
  selectionOpaque: 'token-selection-opaque',
  selectionDarkerOpaque: 'token-selection-darker-opaque',
  selectionDarker: 'token-selection-darker',
  selectionDarkest: 'token-selection-darkest',

  hover: 'token-hover',
  backdrop: 'backdrop',

  logoBg: 'logo-bg',
  logoSize: 'logo-size',
} as const;

/*
 * List of all components theme tokens
 *
 * This is used to generate the `components` object, that initializes CSS variables for every token.
 * Actual values are defined in a theme.
 *
 * Actual CSS variables appended to the DOM will have a 'grist-theme' prefix.
 * Example: the lightText variable is appended as `--grist-theme-light-text` css variable.
 */
export const componentsCssMapping = {
  text: 'text',
  lightText: 'text-light',
  mediumText: 'text-medium',
  darkText: 'text-dark',
  errorText: 'text-error',
  errorTextHover: 'text-error-hover',
  dangerText: 'text-danger',
  disabledText: 'text-disabled',
  pageBg: 'page-bg',
  pageBackdrop: 'page-backdrop',
  mainPanelBg: 'page-panels-main-panel-bg',
  leftPanelBg: 'page-panels-left-panel-bg',
  rightPanelBg: 'page-panels-right-panel-bg',
  topHeaderBg: 'page-panels-top-header-bg',
  bottomFooterBg: 'page-panels-bottom-footer-bg',
  pagePanelsBorder: 'page-panels-border',
  pagePanelsBorderResizing: 'page-panels-border-resizing',
  sidePanelOpenerFg: 'page-panels-side-panel-opener-fg',
  sidePanelOpenerActiveFg: 'page-panels-side-panel-opener-active-fg',
  sidePanelOpenerActiveBg: 'page-panels-side-panel-opener-active-bg',
  addNewCircleFg: 'add-new-circle-fg',
  addNewCircleBg: 'add-new-circle-bg',
  addNewCircleHoverBg: 'add-new-circle-hover-bg',
  addNewCircleSmallFg: 'add-new-circle-small-fg',
  addNewCircleSmallBg: 'add-new-circle-small-bg',
  addNewCircleSmallHoverBg: 'add-new-circle-small-hover-bg',
  topBarButtonPrimaryFg: 'top-bar-button-primary-fg',
  topBarButtonSecondaryFg: 'top-bar-button-secondary-fg',
  topBarButtonDisabledFg: 'top-bar-button-disabled-fg',
  topBarButtonErrorFg: 'top-bar-button-error-fg',
  notificationsPanelHeaderBg: 'notifications-panel-header-bg',
  notificationsPanelBodyBg: 'notifications-panel-body-bg',
  notificationsPanelBorder: 'notifications-panel-border',
  toastText: 'toast-text',
  toastLightText: 'toast-text-light',
  toastBg: 'toast-bg',
  toastMemoText: 'toast-memo-text',
  toastMemoBg: 'toast-memo-bg',
  toastErrorIcon: 'toast-error-icon',
  toastErrorBg: 'toast-error-bg',
  toastSuccessIcon: 'toast-success-icon',
  toastSuccessBg: 'toast-success-bg',
  toastWarningIcon: 'toast-warning-icon',
  toastWarningBg: 'toast-warning-bg',
  toastInfoIcon: 'toast-info-icon',
  toastInfoBg: 'toast-info-bg',
  toastControlFg: 'toast-control-fg',
  toastInfoControlFg: 'toast-control-info-fg',
  tooltipFg: 'tooltip-fg',
  tooltipBg: 'tooltip-bg',
  tooltipIcon: 'tooltip-icon',
  tooltipCloseButtonFg: 'tooltip-close-button-fg',
  tooltipCloseButtonHoverFg: 'tooltip-close-button-hover-fg',
  tooltipCloseButtonHoverBg: 'tooltip-close-button-hover-bg',
  modalBg: 'modal-bg',
  modalBackdrop: 'modal-backdrop',
  modalBorder: 'modal-border',
  modalBorderDark: 'modal-border-dark',
  modalBorderHover: 'modal-border-hover',
  modalInnerShadow: 'modal-shadow-inner',
  modalOuterShadow: 'modal-shadow-outer',
  modalCloseButtonFg: 'modal-close-button-fg',
  modalBackdropCloseButtonFg: 'modal-backdrop-close-button-fg',
  modalBackdropCloseButtonHoverFg: 'modal-backdrop-close-button-hover-fg',
  popupBg: 'popup-bg',
  popupSecondaryBg: 'popup-secondary-bg',
  popupInnerShadow: 'popup-shadow-inner',
  popupOuterShadow: 'popup-shadow-outer',
  popupCloseButtonFg: 'popup-close-button-fg',
  promptFg: 'prompt-fg',
  progressBarFg: 'progress-bar-fg',
  progressBarErrorFg: 'progress-bar-error-fg',
  progressBarBg: 'progress-bar-bg',
  link: 'link',
  linkHover: 'link-hover',
  hover: 'hover',
  lightHover: 'hover-light',
  cellEditorFg: 'cell-editor-fg',
  cellEditorPlaceholderFg: 'cell-editor-placeholder-fg',
  cellEditorBg: 'cell-editor-bg',
  cursor: 'cursor',
  cursorInactive: 'cursor-inactive',
  cursorReadonly: 'cursor-readonly',
  tableHeaderFg: 'table-header-fg',
  tableHeaderSelectedFg: 'table-header-selected-fg',
  tableHeaderBg: 'table-header-bg',
  tableHeaderSelectedBg: 'table-header-selected-bg',
  tableHeaderBorder: 'table-header-border',
  tableBodyBg: 'table-body-bg',
  tableBodyBorder: 'table-body-border',
  tableAddNewBg: 'table-add-new-bg',
  tableScrollShadow: 'table-scroll-shadow',
  tableFrozenColumnsBorder: 'table-frozen-columns-border',
  tableDragDropIndicator: 'table-drag-drop-indicator',
  tableDragDropShadow: 'table-drag-drop-shadow',
  tableCellSummaryBg: 'table-cell-summary-bg',
  cardCompactWidgetBg: 'card-compact-widget-bg',
  cardCompactRecordBg: 'card-compact-record-bg',
  cardBlocksBg: 'card-blocks-bg',
  cardFormLabel: 'card-form-label',
  cardCompactLabel: 'card-compact-label',
  cardBlocksLabel: 'card-blocks-label',
  cardFormBorder: 'card-form-border',
  cardCompactBorder: 'card-compact-border',
  cardEditingLayoutBg: 'card-editing-layout-bg',
  cardEditingLayoutBorder: 'card-editing-layout-border',
  cardListFormBorder: 'card-list-form-border',
  cardListBlocksBorder: 'card-list-blocks-border',
  selection: 'selection',
  selectionDarker: 'selection-darker',
  selectionDarkest: 'selection-darkest',
  selectionOpaqueFg: 'selection-opaque-fg',
  selectionOpaqueBg: 'selection-opaque-bg',
  selectionOpaqueDarkBg: 'selection-opaque-dark-bg',
  selectionHeader: 'selection-header',
  widgetBg: 'widget-bg',
  widgetBorder: 'widget-border',
  widgetActiveBorder: 'widget-active-border',
  widgetInactiveStripesLight: 'widget-inactive-stripes-light',
  widgetInactiveStripesDark: 'widget-inactive-stripes-dark',
  pinnedDocFooterBg: 'pinned-doc-footer-bg',
  pinnedDocBorder: 'pinned-doc-border',
  pinnedDocBorderHover: 'pinned-doc-border-hover',
  pinnedDocEditorBg: 'pinned-doc-editor-bg',
  rawDataTableBorder: 'raw-data-table-border',
  rawDataTableBorderHover: 'raw-data-table-border-hover',
  controlFg: 'control-fg',
  controlPrimaryFg: 'control-primary-fg',
  controlPrimaryBg: 'control-primary-bg',
  controlSecondaryFg: 'control-secondary-fg',
  controlSecondaryDisabledFg: 'control-secondary-disabled-fg',
  controlHoverFg: 'control-hover-fg',
  controlPrimaryHoverBg: 'control-primary-hover-bg',
  controlSecondaryHoverFg: 'control-secondary-hover-fg',
  controlSecondaryHoverBg: 'control-secondary-hover-bg',
  controlDisabledFg: 'control-disabled-fg',
  controlDisabledBg: 'control-disabled-bg',
  controlBorder: 'control-border',
  checkboxBg: 'checkbox-bg',
  checkboxSelectedFg: 'checkbox-selected-bg',
  checkboxDisabledBg: 'checkbox-disabled-bg',
  checkboxBorder: 'checkbox-border',
  checkboxBorderHover: 'checkbox-border-hover',
  moveDocsSelectedFg: 'move-docs-selected-fg',
  moveDocsSelectedBg: 'move-docs-selected-bg',
  moveDocsDisabledFg: 'move-docs-disabled-bg',
  filterBarButtonSavedFg: 'filter-bar-button-saved-fg',
  filterBarButtonSavedBg: 'filter-bar-button-saved-bg',
  filterBarButtonSavedHoverBg: 'filter-bar-button-saved-hover-bg',
  iconDisabled: 'icon-disabled',
  iconError: 'icon-error',
  iconButtonFg: 'icon-button-fg',
  iconButtonPrimaryBg: 'icon-button-primary-bg',
  iconButtonPrimaryHoverBg: 'icon-button-primary-hover-bg',
  iconButtonSecondaryBg: 'icon-button-secondary-bg',
  iconButtonSecondaryHoverBg: 'icon-button-secondary-hover-bg',
  pageHoverBg: 'left-panel-page-hover-bg',
  activePageFg: 'left-panel-active-page-fg',
  activePageBg: 'left-panel-active-page-bg',
  disabledPageFg: 'left-panel-disabled-page-fg',
  pageOptionsFg: 'left-panel-page-options-bg',
  pageOptionsHoverFg: 'left-panel-page-options-hover-fg',
  pageOptionsHoverBg: 'left-panel-page-options-hover-bg',
  pageOptionsSelectedHoverBg: 'left-panel-page-options-selected-hover-bg',
  pageInitialsFg: 'left-panel-page-initials-fg',
  pageInitialsBg: 'left-panel-page-initials-bg',
  pageInitialsEmojiBg: 'left-panel-page-emoji-fg',
  pageInitialsEmojiOutline: 'left-panel-page-emoji-outline',
  rightPanelTabFg: 'right-panel-tab-fg',
  rightPanelTabBg: 'right-panel-tab-bg',
  rightPanelTabIcon: 'right-panel-tab-icon',
  rightPanelTabIconHover: 'right-panel-tab-icon-hover',
  rightPanelTabBorder: 'right-panel-tab-border',
  rightPanelTabHoverBg: 'right-panel-tab-hover-bg',
  rightPanelTabHoverFg: 'right-panel-tab-hover-fg',
  rightPanelTabSelectedFg: 'right-panel-tab-selected-fg',
  rightPanelTabSelectedBg: 'right-panel-tab-selected-bg',
  rightPanelTabSelectedIcon: 'right-panel-tab-selected-icon',
  rightPanelTabButtonHoverBg: 'right-panel-tab-button-hover-bg',
  rightPanelSubtabFg: 'right-panel-subtab-fg',
  rightPanelSubtabSelectedFg: 'right-panel-subtab-selected-fg',
  rightPanelSubtabSelectedUnderline: 'right-panel-subtab-selected-underline',
  rightPanelSubtabHoverFg: 'right-panel-subtab-hover-fg',
  rightPanelDisabledOverlay: 'right-panel-disabled-overlay',
  rightPanelToggleButtonEnabledFg: 'right-panel-toggle-button-enabled-fg',
  rightPanelToggleButtonEnabledBg: 'right-panel-toggle-button-enabled-bg',
  rightPanelToggleButtonDisabledFg: 'right-panel-toggle-button-disabled-fg',
  rightPanelToggleButtonDisabledBg: 'right-panel-toggle-button-disabled-bg',
  rightPanelFieldSettingsBg: 'right-panel-field-settings-bg',
  rightPanelFieldSettingsButtonBg: 'right-panel-field-settings-button-bg',
  rightPanelCustomWidgetButtonFg: 'right-panel-custom-widget-button-fg',
  rightPanelCustomWidgetButtonBg: 'right-panel-custom-widget-button-bg',
  documentHistorySnapshotFg: 'document-history-snapshot-fg',
  documentHistorySnapshotSelectedFg: 'document-history-snapshot-selected-fg',
  documentHistorySnapshotBg: 'document-history-snapshot-bg',
  documentHistorySnapshotSelectedBg: 'document-history-snapshot-selected-bg',
  documentHistorySnapshotBorder: 'document-history-snapshot-border',
  documentHistoryActivityText: 'document-history-activity-text',
  documentHistoryActivityLightText: 'document-history-activity-text-light',
  documentHistoryTableHeaderFg: 'document-history-table-header-fg',
  documentHistoryTableBorder: 'document-history-table-border',
  documentHistoryTableBorderLight: 'document-history-table-border-light',
  accentIcon: 'accent-icon',
  accentBorder: 'accent-border',
  accentText: 'accent-text',
  inputFg: 'input-fg',
  inputBg: 'input-bg',
  inputDisabledFg: 'input-disabled-fg',
  inputDisabledBg: 'input-disabled-bg',
  inputPlaceholderFg: 'input-placeholder-fg',
  inputBorder: 'input-border',
  inputValid: 'input-valid',
  inputInvalid: 'input-invalid',
  inputFocus: 'input-focus',
  inputReadonlyBg: 'input-readonly-bg',
  inputReadonlyBorder: 'input-readonly-border',
  choiceTokenFg: 'choice-token-fg',
  choiceTokenBlankFg: 'choice-token-blank-fg',
  choiceTokenBg: 'choice-token-bg',
  choiceTokenSelectedBg: 'choice-token-selected-bg',
  choiceTokenSelectedBorder: 'choice-token-selected-border',
  choiceTokenInvalidFg: 'choice-token-invalid-fg',
  choiceTokenInvalidBg: 'choice-token-invalid-bg',
  choiceTokenInvalidBorder: 'choice-token-invalid-border',
  choiceEntryBg: 'choice-entry-bg',
  choiceEntryBorder: 'choice-entry-border',
  choiceEntryBorderHover: 'choice-entry-border-hover',
  selectButtonFg: 'select-button-fg',
  selectButtonPlaceholderFg: 'select-button-placeholder-fg',
  selectButtonBg: 'select-button-bg',
  selectButtonBorder: 'select-button-border',
  selectButtonBorderInvalid: 'select-button-border-invalid',
  menuText: 'menu-text',
  menuLightText: 'menu-light-text',
  menuBg: 'menu-bg',
  menuSubheaderFg: 'menu-subheader-fg',
  menuBorder: 'menu-border',
  menuShadow: 'menu-shadow',
  menuItemFg: 'menu-item-fg',
  menuItemSelectedFg: 'menu-item-selected-fg',
  menuItemSelectedBg: 'menu-item-selected-bg',
  menuItemDisabledFg: 'menu-item-disabled-fg',
  menuItemIconFg: 'menu-item-icon-fg',
  menuItemIconSelectedFg: 'menu-item-icon-selected-fg',
  autocompleteMatchText: 'autocomplete-match-text',
  autocompleteSelectedMatchText: 'autocomplete-selected-match-text',
  autocompleteItemSelectedBg: 'autocomplete-item-selected-bg',
  autocompleteAddNewCircleFg: 'autocomplete-add-new-circle-fg',
  autocompleteAddNewCircleBg: 'autocomplete-add-new-circle-bg',
  autocompleteAddNewCircleSelectedBg: 'autocomplete-add-new-circle-selected-bg',
  searchBorder: 'search-border',
  searchPrevNextButtonFg: 'search-prev-next-button-fg',
  searchPrevNextButtonBg: 'search-prev-next-button-bg',
  loaderFg: 'loader-fg',
  loaderBg: 'loader-bg',
  siteSwitcherActiveFg: 'site-switcher-active-fg',
  siteSwitcherActiveBg: 'site-switcher-active-bg',
  docMenuDocOptionsFg: 'doc-menu-doc-options-fg',
  docMenuDocOptionsHoverFg: 'doc-menu-doc-options-hover-fg',
  docMenuDocOptionsHoverBg: 'doc-menu-doc-options-hover-bg',
  shortcutKeyFg: 'shortcut-key-fg',
  shortcutKeyPrimaryFg: 'shortcut-key-primary-fg',
  shortcutKeySecondaryFg: 'shortcut-key-secondary-fg',
  shortcutKeyBg: 'shortcut-key-bg',
  shortcutKeyBorder: 'shortcut-key-border',
  breadcrumbsTagFg: 'breadcrumbs-tag-fg',
  breadcrumbsTagBg: 'breadcrumbs-tag-bg',
  breadcrumbsTagAlertBg: 'breadcrumbs-tag-alert-fg',
  widgetPickerPrimaryBg: 'widget-picker-primary-bg',
  widgetPickerSecondaryBg: 'widget-picker-secondary-bg',
  widgetPickerItemFg: 'widget-picker-item-fg',
  widgetPickerItemSelectedBg: 'widget-picker-item-selected-bg',
  widgetPickerItemDisabledBg: 'widget-picker-item-disabled-bg',
  widgetPickerIcon: 'widget-picker-icon',
  widgetPickerPrimaryIcon: 'widget-picker-primary-icon',
  widgetPickerSummaryIcon: 'widget-picker-summary-icon',
  widgetPickerBorder: 'widget-picker-border',
  widgetPickerShadow: 'widget-picker-shadow',
  codeViewText: 'code-view-text',
  codeViewKeyword: 'code-view-keyword',
  codeViewComment: 'code-view-comment',
  codeViewMeta: 'code-view-meta',
  codeViewTitle: 'code-view-title',
  codeViewParams: 'code-view-params',
  codeViewString: 'code-view-string',
  codeViewNumber: 'code-view-number',
  codeViewBuiltin: 'code-view-builtin',
  codeViewLiteral: 'code-view-literal',
  importerTableInfoBorder: 'importer-table-info-border',
  importerPreviewBorder: 'importer-preview-border',
  importerSkippedTableOverlay: 'importer-skipped-table-overlay',
  importerMatchIcon: 'importer-match-icon',
  importerOutsideBg: 'importer-outside-bg',
  importerMainContentBg: 'importer-main-content-bg',
  importerActiveFileBg: 'importer-active-file-bg',
  importerActiveFileFg: 'importer-active-file-fg',
  importerInactiveFileBg: 'importer-inactive-file-bg',
  importerInactiveFileFg: 'importer-inactive-file-fg',
  menuToggleFg: 'menu-toggle-fg',
  menuToggleHoverFg: 'menu-toggle-hover-fg',
  menuToggleActiveFg: 'menu-toggle-active-fg',
  menuToggleBg: 'menu-toggle-bg',
  menuToggleBorder: 'menu-toggle-border',
  infoButtonFg: 'info-button-fg',
  infoButtonHoverFg: 'info-button-hover-fg',
  infoButtonActiveFg: 'info-button-active-fg',
  buttonGroupFg: 'button-group-fg',
  buttonGroupLightFg: 'button-group-light-fg',
  buttonGroupBg: 'button-group-bg',
  buttonGroupBgHover: 'button-group-bg-hover',
  buttonGroupIcon: 'button-group-icon',
  buttonGroupBorder: 'button-group-border',
  buttonGroupBorderHover: 'button-group-border-hover',
  buttonGroupSelectedFg: 'button-group-selected-fg',
  buttonGroupLightSelectedFg: 'button-group-light-selected-fg',
  buttonGroupSelectedBg: 'button-group-selected-bg',
  buttonGroupSelectedBorder: 'button-group-selected-border',
  accessRulesTableHeaderFg: 'access-rules-table-header-fg',
  accessRulesTableHeaderBg: 'access-rules-table-header-bg',
  accessRulesTableBodyFg: 'access-rules-table-body-fg',
  accessRulesTableBodyLightFg: 'access-rules-table-body-light-fg',
  accessRulesTableBorder: 'access-rules-table-border',
  accessRulesColumnListBorder: 'access-rules-column-list-border',
  accessRulesColumnItemFg: 'access-rules-column-item-fg',
  accessRulesColumnItemBg: 'access-rules-column-item-bg',
  accessRulesColumnItemIconFg: 'access-rules-column-item-icon-fg',
  accessRulesColumnItemIconHoverFg: 'access-rules-column-item-icon-hover-fg',
  accessRulesColumnItemIconHoverBg: 'access-rules-column-item-icon-hover-bg',
  accessRulesFormulaEditorBg: 'access-rules-formula-editor-bg',
  accessRulesFormulaEditorBorderHover: 'access-rules-formula-editor-border-hover',
  accessRulesFormulaEditorBgDisabled: 'access-rules-formula-editor-bg-disabled',
  accessRulesFormulaEditorFocus: 'access-rules-formula-editor-focus',
  cellFg: 'cell-fg',
  cellBg: 'cell-bg',
  cellZebraBg: 'cell-zebra-bg',
  chartFg: 'chart-fg',
  chartBg: 'chart-bg',
  chartLegendBg: 'chart-legend-bg',
  chartXAxis: 'chart-x-axis',
  chartYAxis: 'chart-y-axis',
  commentsPopupHeaderBg: 'comments-popup-header-bg',
  commentsPopupBodyBg: 'comments-popup-body-bg',
  commentsPopupBorder: 'comments-popup-border',
  commentsUserNameFg: 'comments-user-name-fg',
  commentsPanelTopicBg: 'comments-panel-topic-bg',
  commentsPanelTopicBorder: 'comments-panel-topic-border',
  commentsPanelResolvedTopicBg: 'comments-panel-resolved-topic-bg',
  datePickerSelectedFg: 'date-picker-selected-fg',
  datePickerSelectedBg: 'date-picker-selected-bg',
  datePickerSelectedBgHover: 'date-picker-selected-bg-hover',
  datePickerTodayFg: 'date-picker-today-fg',
  datePickerTodayBg: 'date-picker-today-bg',
  datePickerTodayBgHover: 'date-picker-today-bg-hover',
  datePickerRangeStartEndBg: 'date-picker-range-start-end-bg',
  datePickerRangeStartEndBgHover: 'date-picker-range-start-end-bg-hover',
  datePickerRangeBg: 'date-picker-range-bg',
  datePickerRangeBgHover: 'date-picker-range-bg-hover',
  tutorialsPopupBorder: 'tutorials-popup-border',
  tutorialsPopupHeaderFg: 'tutorials-popup-header-fg',
  tutorialsPopupBoxBg: 'tutorials-popup-box-bg',
  tutorialsPopupCodeFg: 'tutorials-popup-code-fg',
  tutorialsPopupCodeBg: 'tutorials-popup-code-bg',
  tutorialsPopupCodeBorder: 'tutorials-popup-code-border',
  aceEditorBg: 'ace-editor-bg',
  aceAutocompletePrimaryFg: 'ace-autocomplete-primary-fg',
  aceAutocompleteSecondaryFg: 'ace-autocomplete-secondary-fg',
  aceAutocompleteHighlightedFg: 'ace-autocomplete-highlighted-fg',
  aceAutocompleteBg: 'ace-autocomplete-bg',
  aceAutocompleteBorder: 'ace-autocomplete-border',
  aceAutocompleteLink: 'ace-autocomplete-link',
  aceAutocompleteLinkHighlighted: 'ace-autocomplete-link-highlighted',
  aceAutocompleteActiveLineBg: 'ace-autocomplete-active-line-bg',
  aceAutocompleteLineBorderHover: 'ace-autocomplete-line-border-hover',
  aceAutocompleteLineBgHover: 'ace-autocomplete-line-bg-hover',
  colorSelectFg: 'color-select-fg',
  colorSelectBg: 'color-select-bg',
  colorSelectShadow: 'color-select-shadow',
  colorSelectFontOptionsBorder: 'color-select-font-options-border',
  colorSelectFontOptionFg: 'color-select-font-option-fg',
  colorSelectFontOptionBgHover: 'color-select-font-option-bg-hover',
  colorSelectFontOptionFgSelected: 'color-select-font-option-fg-selected',
  colorSelectFontOptionBgSelected: 'color-select-font-option-bg-selected',
  colorSelectColorSquareBorder: 'color-select-color-square-border',
  colorSelectColorSquareBorderEmpty: 'color-select-color-square-border-empty',
  colorSelectInputFg: 'color-select-input-fg',
  colorSelectInputBg: 'color-select-input-bg',
  colorSelectInputBorder: 'color-select-input-border',
  highlightedCodeBlockBg: 'highlighted-code-block-bg',
  highlightedCodeBlockBgDisabled: 'highlighted-code-block-bg-disabled',
  highlightedCodeFg: 'highlighted-code-fg',
  highlightedCodeBorder: 'highlighted-code-border',
  highlightedCodeBgDisabled: 'highlighted-code-bg-disabled',
  loginPageBg: 'login-page-bg',
  loginPageBackdrop: 'login-page-backdrop',
  loginPageLine: 'login-page-line',
  loginPageGoogleButtonFg: 'login-page-google-button-fg',
  loginPageGoogleButtonBg: 'login-page-google-button-bg',
  loginPageGoogleButtonBgHover: 'login-page-google-button-bg-hover',
  loginPageGoogleButtonBorder: 'login-page-google-button-border',
  formulaAssistantHeaderBg: 'formula-assistant-header-bg',
  formulaAssistantBorder: 'formula-assistant-border',
  formulaAssistantPreformattedTextBg: 'formula-assistant-preformatted-text-bg',
  attachmentsEditorButtonFg: 'attachments-editor-button-fg',
  attachmentsEditorButtonHoverFg: 'attachments-editor-button-hover-fg',
  attachmentsEditorButtonBg: 'attachments-editor-button-bg',
  attachmentsEditorButtonHoverBg: 'attachments-editor-button-hover-bg',
  attachmentsEditorButtonBorder: 'attachments-editor-button-border',
  attachmentsEditorButtonIcon: 'attachments-editor-button-icon',
  attachmentsEditorBorder: 'attachments-editor-border',
  attachmentsCellIconFg: 'attachments-cell-icon-fg',
  attachmentsCellIconBg: 'attachments-cell-icon-bg',
  attachmentsCellIconHoverBg: 'attachments-cell-icon-hover-bg',
  announcementPopupFg: 'announcement-popup-fg',
  announcementPopupBg: 'announcement-popup-bg',
  switchSliderFg: 'switch-slider-fg',
  switchCircleFg: 'switch-circle-fg',
  scrollShadow: 'scroll-shadow',
  toggleCheckboxFg: 'toggle-checkbox-fg',
  numericSpinnerFg: 'numeric-spinner-fg',
  widgetGalleryBorder: 'widget-gallery-border',
  widgetGalleryBorderSelected: 'widget-gallery-border-selected',
  widgetGalleryShadow: 'widget-gallery-shadow',
  widgetGalleryBgHover: 'widget-gallery-bg-hover',
  widgetGallerySecondaryHeaderFg: 'widget-gallery-secondary-header-fg',
  widgetGallerySecondaryHeaderBg: 'widget-gallery-secondary-header-bg',
  widgetGallerySecondaryHeaderBgHover: 'widget-gallery-secondary-header-bg-hover',
  markdownCellLightBg: 'markdown-cell-light-bg',
  markdownCellLightBorder: 'markdown-cell-light-border',
  markdownCellMediumBorder: 'markdown-cell-medium-border',
  appHeaderBg: 'app-header-bg',
  appHeaderBorder: 'app-header-border',
  appHeaderBorderHover: 'app-header-border-hover',
  cardButtonBorder: 'card-button-border',
  cardButtonBorderSelected: 'card-button-border-selected',
  cardButtonShadow: 'card-button-shadow',
  formulaIcon: 'formula-icon',
  textButtonHoverBg: 'text-button-hover-bg',
  textButtonHoverBorder: 'text-button-hover-border',
} as const;

export const tokens = Object.fromEntries(
  Object.entries(tokensCssMapping).map(([name, value]) => [
    name,
    new CssCustomProp(value, undefined, undefined, 'theme')
  ])
) as {[K in keyof typeof tokensCssMapping]: CssCustomProp};

export const components = Object.fromEntries(
  Object.entries(componentsCssMapping).map(([name, value]) => [
    name,
    new CssCustomProp(value, undefined, undefined, 'theme')
  ])
) as {[K in keyof typeof componentsCssMapping]: CssCustomProp};

/**
 * Mapping of deprecated variables to the new theme variables.
 *
 * This is an array because we want to keep the order of the variables
 * for declaration priority purposes.
 *
 * Used to fix old custom.css files that use deprecated variables.
 * Any cssVars#colors and cssVars#vars targeting theme tokens should match
 * (see test/client/ui2018/cssVars.ts).
 */
export const legacyVarsMapping: {old: string, new: string}[] = [
  {old: '--grist-color-light-grey', new: tokens.bgSecondary.var()},
  {old: '--grist-color-medium-grey', new: tokens.bgTertiary.var()},
  {old: '--grist-color-medium-grey-opaque', new: tokens.decorationSecondary.var()},
  {old: '--grist-color-dark-grey', new: tokens.decoration.var()},
  {old: '--grist-color-light', new: tokens.white.var()},
  {old: '--grist-color-dark', new: tokens.body.var()},
  {old: '--grist-color-dark-bg', new: tokens.bgEmphasis.var()},
  {old: '--grist-color-slate', new: tokens.secondary.var()},
  {old: '--grist-color-lighter-green', new: tokens.primaryEmphasis.var()},
  {old: '--grist-color-light-green', new: tokens.primary.var()},
  {old: '--grist-color-dark-green', new: tokens.primaryMuted.var()},
  {old: '--grist-color-darker-green', new: tokens.primaryDim.var()},
  {old: '--grist-color-lighter-blue', new: tokens.infoLight.var()},
  {old: '--grist-color-light-blue', new: tokens.info.var()},
  {old: '--grist-color-orange', new: tokens.warningLight.var()},
  {old: '--grist-color-cursor', new: tokens.cursor.var()},
  {old: '--grist-color-selection', new: tokens.selection.var()},
  {old: '--grist-color-selection-opaque', new: tokens.selectionOpaque.var()},
  {old: '--grist-color-selection-darker-opaque', new: tokens.selectionDarkerOpaque.var()},
  {old: '--grist-color-inactive-cursor', new: tokens.cursorInactive.var()},
  {old: '--grist-color-hover', new: tokens.hover.var()},
  {old: '--grist-color-error', new: tokens.error.var()},
  {old: '--grist-color-warning', new: tokens.warningLight.var()},
  {old: '--grist-color-warning-bg', new: tokens.warning.var()},
  {old: '--grist-color-backdrop', new: tokens.backdrop.var()},
  {old: '--grist-font-family', new: tokens.fontFamily.var()},
  {old: '--grist-font-family-data', new: tokens.fontFamilyData.var()},
  {old: '--grist-xx-font-size', new: tokens.xxsmallFontSize.var()},
  {old: '--grist-x-small-font-size', new: tokens.xsmallFontSize.var()},
  {old: '--grist-small-font-size', new: tokens.smallFontSize.var()},
  {old: '--grist-medium-font-size', new: tokens.mediumFontSize.var()},
  {old: '--grist-intro-font-size', new: tokens.introFontSize.var()},
  {old: '--grist-large-font-size', new: tokens.largeFontSize.var()},
  {old: '--grist-x-large-font-size', new: tokens.xlargeFontSize.var()},
  {old: '--grist-xx-large-font-size', new: tokens.xxlargeFontSize.var()},
  {old: '--grist-xxx-large-font-size', new: tokens.xxxlargeFontSize.var()},
  {old: '--grist-big-control-font-size', new: tokens.bigControlFontSize.var()},
  {old: '--grist-header-control-font-size', new: tokens.headerControlFontSize.var()},
  {old: '--grist-big-text-weight', new: tokens.bigControlTextWeight.var()},
  {old: '--grist-header-text-weight', new: tokens.headerControlTextWeight.var()},
  {old: '--grist-primary-bg', new: tokens.white.var()},
  {old: '--grist-primary-fg-hover', new: tokens.primaryMuted.var()},
  {old: '--grist-primary-fg', new: tokens.primary.var()},
  {old: '--grist-control-border', new: components.controlBorder.var()},
  {old: '--grist-border-radius', new: tokens.controlBorderRadius.var()},
  {old: '--grist-logo-bg', new: tokens.logoBg.var()},
  {old: '--grist-logo-size', new: tokens.logoSize.var()},
];


/**
 * Helper that converts a theme file object to a "theme css vars" object
 *
 * Used to prepare data before appending css vars in the DOM in both the app and external code like grist-plugin-api.
 *
 * It transforms the "colors" object to change camelCase keys to css vars kebab-case keys,
 * puts the components tokens at the root lvl,
 * and transforms any CssCustomProp object to its actual value as a string.
 *
 * ⚠ Note the css var keys returned are not actual css vars (they miss the --grist-theme prefix),
 * because the code attaching the css vars apply the prefix themselves.
 *
 * We use this trick because theme-related code notably changed in beginning of 2025,
 * and the grist-plugin-api code is a bit troublesome to update with breaking changes.
 * This small parser helps in keeping the grist-plugin-api "old code" working with the current theme system.
 *
 * Example: {
 *   appearance: 'light',
 *   colors: {
 *     bgEmphasis: { name: 'bg-dark', value: '#000', fallback: undefined },
 *     components: { cardButtonBorder: '#fff' }
 *   }
 * }
 * becomes:
 * {
 *   appearance: 'light',
 *   colors: {
 *     'bg-emphasis': 'var(--theme-bg-dark)',
 *     'card-button-border': '#fff'
 *   }
 * }
 */
export const convertThemeKeysToCssVars = (theme: Theme): ThemeWithCssVars => {
  const { components: componentsTokens, ...rest } = theme.colors;

  const mainCssVars = Object.fromEntries(
    Object.entries(rest).map(([key, value]) => {
      return [
        tokensCssMapping[key as keyof typeof tokensCssMapping],
        value.toString()
      ];
    })
  );

  const componentsCssVars = Object.fromEntries(
    Object.entries(componentsTokens).map(([key, value]) => {
      return [
        componentsCssMapping[key as keyof typeof componentsCssMapping],
        value.toString()
      ];
    })
  );

  return {
    ...theme,
    colors: {
      ...mainCssVars,
      ...componentsCssVars,
    },
  };
};



/**
 * tokens that a given theme must always define
 */
export interface SpecificThemeTokens {
  /**
   * main body text
   */
  body: Token;

  /**
   * pronounced text
   */
  emphasis: Token;

  /**
   * secondary, less visually pronounced text
   */
  secondary: Token;

  /**
   * text that is always light, whatever the current appearance (light or dark theme)
   */
  veryLight: Token;

  /**
   * default body bg color
   */
  bg: Token;

  /**
   * bg color mostly used on panels
   */
  bgSecondary: Token;

  /**
   * transparent bg, mostly used on hover effects
   */
  bgTertiary: Token;

  /**
   * pronounced bg color, mostly used on selected items
   */
  bgEmphasis: Token;

  /**
   * main decoration color, mostly used on borders
   */
  decoration: Token;

  /**
   * less pronounced decoration color
   */
  decorationSecondary: Token;

  /**
   * even less pronounced decoration color
   */
  decorationTertiary: Token;

  /**
   * main accent color used mostly on interactive elements
   */
  primary: Token;

  /**
   * alternative primary color, mostly used on hover effects
   */
  primaryMuted: Token;

  /**
   * dimmer primary color, rarely used
   */
  primaryDim: Token;

  /**
   * more pronounced primary color variant, rarely used
   */
  primaryEmphasis: Token;

  controlBorderRadius: Token;

  /**
   * cursor color in widgets
   */
  cursor: Token;
  cursorInactive: Token;

  /**
   * transparent background of selected cells
   */
  selection: Token;
  selectionOpaque: Token;
  selectionDarkerOpaque: Token;
  selectionDarker: Token;
  selectionDarkest: Token;

  /**
   * non-transparent hover effect color, rarely used
   */
  hover: Token;

  /**
   * transparent modal backdrop bg color
   */
  backdrop: Token;

  components: {
    mediumText: Token;
    errorText: Token;
    errorTextHover: Token;
    pageBackdrop: Token;
    topBarButtonErrorFg: Token;
    toastMemoBg: Token;
    modalInnerShadow: Token;
    modalOuterShadow: Token;
    popupInnerShadow: Token;
    popupOuterShadow: Token;
    promptFg: Token;
    progressBarErrorFg: Token;
    lightHover: Token;
    cellEditorFg: Token;
    tableHeaderSelectedBg: Token;
    tableHeaderBorder: Token;
    tableAddNewBg: Token;
    tableScrollShadow: Token;
    tableFrozenColumnsBorder: Token;
    tableDragDropIndicator: Token;
    tableDragDropShadow: Token;
    cardCompactWidgetBg: Token;
    cardBlocksBg: Token;
    cardFormBorder: Token;
    cardEditingLayoutBg: Token;
    selection: Token;
    selectionDarker: Token;
    selectionDarkest: Token;
    selectionOpaqueBg: Token;
    selectionOpaqueDarkBg: Token;
    selectionHeader: Token;
    widgetInactiveStripesDark: Token;
    controlHoverFg: Token;
    controlDisabledFg: Token;
    controlDisabledBg: Token;
    controlBorder: Token;
    checkboxBorderHover: Token;
    filterBarButtonSavedBg: Token;
    iconError: Token;
    iconButtonPrimaryHoverBg: Token;
    pageHoverBg: Token;
    disabledPageFg: Token;
    pageInitialsBg: Token;
    pageInitialsEmojiOutline: Token;
    pageInitialsEmojiBg: Token;
    rightPanelTabButtonHoverBg: Token;
    rightPanelToggleButtonDisabledFg: Token;
    rightPanelToggleButtonDisabledBg: Token;
    rightPanelFieldSettingsBg: Token;
    rightPanelFieldSettingsButtonBg: Token;
    documentHistorySnapshotBorder: Token;
    documentHistoryTableBorder: Token;
    inputInvalid: Token;
    inputReadonlyBorder: Token;
    choiceTokenBg: Token;
    choiceTokenSelectedBg: Token;
    choiceTokenInvalidBg: Token;
    choiceEntryBorderHover: Token;
    selectButtonBorderInvalid: Token;
    menuBorder: Token;
    menuShadow: Token;
    autocompleteItemSelectedBg: Token;
    searchBorder: Token;
    searchPrevNextButtonBg: Token;
    siteSwitcherActiveBg: Token;
    shortcutKeyPrimaryFg: Token;
    breadcrumbsTagBg: Token;
    widgetPickerItemFg: Token;
    widgetPickerSummaryIcon: Token;
    widgetPickerShadow: Token;
    codeViewText: Token;
    codeViewKeyword: Token;
    codeViewComment: Token;
    codeViewMeta: Token;
    codeViewTitle: Token;
    codeViewParams: Token;
    codeViewString: Token;
    codeViewNumber: Token;
    codeViewBuiltin: Token;
    codeViewLiteral: Token;
    importerOutsideBg: Token;
    importerMainContentBg: Token;
    importerInactiveFileBg: Token;
    menuToggleHoverFg: Token;
    menuToggleActiveFg: Token;
    buttonGroupBgHover: Token;
    buttonGroupBorderHover: Token;
    cellZebraBg: Token;
    chartFg: Token;
    chartLegendBg: Token;
    chartXAxis: Token;
    chartYAxis: Token;
    commentsUserNameFg: Token;
    commentsPanelTopicBorder: Token;
    commentsPanelResolvedTopicBg: Token;
    datePickerSelectedFg: Token;
    datePickerSelectedBg: Token;
    datePickerSelectedBgHover: Token;
    datePickerRangeStartEndBg: Token;
    datePickerRangeStartEndBgHover: Token;
    datePickerRangeBg: Token;
    datePickerRangeBgHover: Token;
    tutorialsPopupBoxBg: Token;
    tutorialsPopupCodeFg: Token;
    tutorialsPopupCodeBg: Token;
    tutorialsPopupCodeBorder: Token;
    aceAutocompletePrimaryFg: Token;
    aceAutocompleteSecondaryFg: Token;
    aceAutocompleteBg: Token;
    aceAutocompleteBorder: Token;
    aceAutocompleteLinkHighlighted: Token;
    aceAutocompleteActiveLineBg: Token;
    aceAutocompleteLineBorderHover: Token;
    aceAutocompleteLineBgHover: Token;
    colorSelectFg: Token;
    colorSelectShadow: Token;
    colorSelectFontOptionsBorder: Token;
    colorSelectFontOptionBgHover: Token;
    colorSelectColorSquareBorder: Token;
    highlightedCodeBlockBg: Token;
    highlightedCodeBlockBgDisabled: Token;
    highlightedCodeBgDisabled: Token;
    loginPageBackdrop: Token;
    loginPageLine: Token;
    loginPageGoogleButtonFg: Token;
    loginPageGoogleButtonBg: Token;
    loginPageGoogleButtonBgHover: Token;
    attachmentsEditorButtonFg: Token;
    attachmentsEditorButtonBg: Token;
    attachmentsEditorButtonHoverBg: Token;
    attachmentsEditorBorder: Token;
    attachmentsCellIconFg: Token;
    attachmentsCellIconBg: Token;
    attachmentsCellIconHoverBg: Token;
    announcementPopupBg: Token;
    switchSliderFg: Token;
    scrollShadow: Token;
    toggleCheckboxFg: Token;
    numericSpinnerFg: Token;
    widgetGalleryBorder: Token;
    widgetGalleryShadow: Token;
    widgetGallerySecondaryHeaderBg: Token;
    widgetGallerySecondaryHeaderBgHover: Token;
    markdownCellLightBg: Token;
    markdownCellLightBorder: Token;
    markdownCellMediumBorder: Token;
    appHeaderBorder: Token;
    appHeaderBorderHover: Token;
    cardButtonBorder: Token;
  };
}

export interface BaseThemeTokens {
  white: Token;
  black: Token;

  error: Token;
  errorLight: Token;

  warning: Token;
  warningLight: Token;

  info: Token;
  infoLight: Token;

  fontFamily: Token;
  fontFamilyData: Token;

  xxsmallFontSize: Token;
  xsmallFontSize: Token;
  smallFontSize: Token;
  mediumFontSize: Token;
  introFontSize: Token;
  largeFontSize: Token;
  xlargeFontSize: Token;
  xxlargeFontSize: Token;
  xxxlargeFontSize: Token;

  bigControlFontSize: Token;
  headerControlFontSize: Token;
  bigControlTextWeight: Token;
  headerControlTextWeight: Token;

  logoBg: Token;
  logoSize: Token;

  components: {
    text: Token;
    lightText: Token;
    darkText: Token;
    disabledText: Token;
    dangerText: Token;
    pageBg: Token;
    mainPanelBg: Token;
    leftPanelBg: Token;
    rightPanelBg: Token;
    topHeaderBg: Token;
    bottomFooterBg: Token;
    pagePanelsBorder: Token;
    pagePanelsBorderResizing: Token;
    sidePanelOpenerFg: Token;
    sidePanelOpenerActiveFg: Token;
    sidePanelOpenerActiveBg: Token;
    addNewCircleFg: Token;
    addNewCircleBg: Token;
    addNewCircleHoverBg: Token;
    addNewCircleSmallFg: Token;
    addNewCircleSmallBg: Token;
    addNewCircleSmallHoverBg: Token;
    topBarButtonPrimaryFg: Token;
    topBarButtonSecondaryFg: Token;
    topBarButtonDisabledFg: Token;
    notificationsPanelHeaderBg: Token;
    notificationsPanelBodyBg: Token;
    notificationsPanelBorder: Token;
    toastBg: Token;
    toastLightText: Token;
    toastText: Token;
    toastMemoText: Token;
    toastErrorIcon: Token;
    toastErrorBg: Token;
    toastSuccessIcon: Token;
    toastSuccessBg: Token;
    toastWarningIcon: Token;
    toastWarningBg: Token;
    toastInfoIcon: Token;
    toastInfoBg: Token;
    toastInfoControlFg: Token;
    toastControlFg: Token;
    tooltipBg: Token;
    tooltipCloseButtonHoverFg: Token;
    tooltipFg: Token;
    tooltipIcon: Token;
    tooltipCloseButtonFg: Token;
    tooltipCloseButtonHoverBg: Token;
    modalBackdrop: Token;
    modalBg: Token;
    modalBorder: Token;
    modalBorderDark: Token;
    modalBorderHover: Token;
    modalCloseButtonFg: Token;
    modalBackdropCloseButtonFg: Token;
    modalBackdropCloseButtonHoverFg: Token;
    popupBg: Token;
    popupSecondaryBg: Token;
    popupCloseButtonFg: Token;
    progressBarFg: Token;
    progressBarBg: Token;
    hover: Token;
    link: Token;
    linkHover: Token;
    cellEditorPlaceholderFg: Token;
    cellEditorBg: Token;
    cursor: Token;
    cursorInactive: Token;
    cursorReadonly: Token;
    tableHeaderFg: Token;
    tableHeaderSelectedFg: Token;
    tableHeaderBg: Token;
    tableBodyBg: Token;
    tableBodyBorder: Token;
    tableCellSummaryBg: Token;
    cardCompactRecordBg: Token;
    cardFormLabel: Token;
    cardCompactLabel: Token;
    cardBlocksLabel: Token;
    cardCompactBorder: Token;
    cardEditingLayoutBorder: Token;
    cardListFormBorder: Token;
    cardListBlocksBorder: Token;
    selectionOpaqueFg: Token;
    widgetBg: Token;
    widgetBorder: Token;
    widgetActiveBorder: Token;
    widgetInactiveStripesLight: Token;
    pinnedDocFooterBg: Token;
    pinnedDocBorder: Token;
    pinnedDocBorderHover: Token;
    pinnedDocEditorBg: Token;
    rawDataTableBorder: Token;
    rawDataTableBorderHover: Token;
    controlFg: Token;
    controlPrimaryFg: Token;
    controlPrimaryBg: Token;
    controlPrimaryHoverBg: Token;
    controlSecondaryFg: Token;
    controlSecondaryDisabledFg: Token;
    controlSecondaryHoverFg: Token;
    controlSecondaryHoverBg: Token;
    checkboxBg: Token;
    checkboxSelectedFg: Token;
    checkboxDisabledBg: Token;
    checkboxBorder: Token;
    moveDocsSelectedFg: Token;
    moveDocsSelectedBg: Token;
    moveDocsDisabledFg: Token;
    filterBarButtonSavedFg: Token;
    filterBarButtonSavedHoverBg: Token;
    iconDisabled: Token;
    iconButtonFg: Token;
    iconButtonPrimaryBg: Token;
    iconButtonSecondaryBg: Token;
    iconButtonSecondaryHoverBg: Token;
    activePageFg: Token;
    activePageBg: Token;
    pageOptionsFg: Token;
    pageOptionsHoverFg: Token;
    pageOptionsHoverBg: Token;
    pageOptionsSelectedHoverBg: Token;
    pageInitialsFg: Token;
    rightPanelTabFg: Token;
    rightPanelTabBg: Token;
    rightPanelTabIcon: Token;
    rightPanelTabIconHover: Token;
    rightPanelTabBorder: Token;
    rightPanelTabHoverBg: Token;
    rightPanelTabHoverFg: Token;
    rightPanelTabSelectedFg: Token;
    rightPanelTabSelectedBg: Token;
    rightPanelTabSelectedIcon: Token;
    rightPanelSubtabFg: Token;
    rightPanelSubtabHoverFg: Token;
    rightPanelSubtabSelectedFg: Token;
    rightPanelSubtabSelectedUnderline: Token;
    rightPanelDisabledOverlay: Token;
    rightPanelToggleButtonEnabledFg: Token;
    rightPanelToggleButtonEnabledBg: Token;
    rightPanelCustomWidgetButtonFg: Token;
    rightPanelCustomWidgetButtonBg: Token;
    documentHistorySnapshotFg: Token;
    documentHistorySnapshotSelectedFg: Token;
    documentHistorySnapshotBg: Token;
    documentHistorySnapshotSelectedBg: Token;
    documentHistoryActivityText: Token;
    documentHistoryActivityLightText: Token;
    documentHistoryTableHeaderFg: Token;
    documentHistoryTableBorderLight: Token;
    accentIcon: Token;
    accentBorder: Token;
    accentText: Token;
    inputFg: Token;
    inputBg: Token;
    inputDisabledFg: Token;
    inputDisabledBg: Token;
    inputPlaceholderFg: Token;
    inputBorder: Token;
    inputValid: Token;
    inputFocus: Token;
    inputReadonlyBg: Token;
    choiceTokenFg: Token;
    choiceTokenBlankFg: Token;
    choiceTokenSelectedBorder: Token;
    choiceTokenInvalidFg: Token;
    choiceTokenInvalidBorder: Token;
    choiceEntryBg: Token;
    choiceEntryBorder: Token;
    selectButtonFg: Token;
    selectButtonPlaceholderFg: Token;
    selectButtonBg: Token;
    selectButtonBorder: Token;
    menuText: Token;
    menuLightText: Token;
    menuBg: Token;
    menuSubheaderFg: Token;
    menuItemFg: Token;
    menuItemSelectedFg: Token;
    menuItemSelectedBg: Token;
    menuItemDisabledFg: Token;
    menuItemIconFg: Token;
    menuItemIconSelectedFg: Token;
    autocompleteMatchText: Token;
    autocompleteAddNewCircleFg: Token;
    autocompleteAddNewCircleBg: Token;
    autocompleteAddNewCircleSelectedBg: Token;
    autocompleteSelectedMatchText: Token;
    searchPrevNextButtonFg: Token;
    loaderFg: Token;
    loaderBg: Token;
    siteSwitcherActiveFg: Token;
    docMenuDocOptionsFg: Token;
    docMenuDocOptionsHoverFg: Token;
    docMenuDocOptionsHoverBg: Token;
    shortcutKeyFg: Token;
    shortcutKeySecondaryFg: Token;
    shortcutKeyBg: Token;
    shortcutKeyBorder: Token;
    breadcrumbsTagFg: Token;
    breadcrumbsTagAlertBg: Token;
    widgetPickerItemSelectedBg: Token;
    widgetPickerItemDisabledBg: Token;
    widgetPickerPrimaryBg: Token;
    widgetPickerSecondaryBg: Token;
    widgetPickerIcon: Token;
    widgetPickerPrimaryIcon: Token;
    widgetPickerBorder: Token;
    importerActiveFileBg: Token;
    importerTableInfoBorder: Token;
    importerPreviewBorder: Token;
    importerMatchIcon: Token;
    importerSkippedTableOverlay: Token;
    importerActiveFileFg: Token;
    importerInactiveFileFg: Token;
    menuToggleFg: Token;
    menuToggleBg: Token;
    menuToggleBorder: Token;
    infoButtonFg: Token;
    infoButtonHoverFg: Token;
    infoButtonActiveFg: Token;
    buttonGroupBg: Token;
    buttonGroupFg: Token;
    buttonGroupLightFg: Token;
    buttonGroupIcon: Token;
    buttonGroupBorder: Token;
    buttonGroupSelectedFg: Token;
    buttonGroupLightSelectedFg: Token;
    buttonGroupSelectedBg: Token;
    buttonGroupSelectedBorder: Token;
    accessRulesTableHeaderFg: Token;
    accessRulesTableHeaderBg: Token;
    accessRulesTableBodyFg: Token;
    accessRulesTableBodyLightFg: Token;
    accessRulesTableBorder: Token;
    accessRulesColumnListBorder: Token;
    accessRulesColumnItemFg: Token;
    accessRulesColumnItemIconFg: Token;
    accessRulesColumnItemIconHoverFg: Token;
    accessRulesColumnItemIconHoverBg: Token;
    accessRulesColumnItemBg: Token;
    accessRulesFormulaEditorBg: Token;
    accessRulesFormulaEditorBgDisabled: Token;
    accessRulesFormulaEditorBorderHover: Token;
    accessRulesFormulaEditorFocus: Token;
    cellFg: Token;
    cellBg: Token;
    chartBg: Token;
    commentsPopupHeaderBg: Token;
    commentsPopupBodyBg: Token;
    commentsPopupBorder: Token;
    commentsPanelTopicBg: Token;
    datePickerTodayFg: Token;
    datePickerTodayBg: Token;
    datePickerTodayBgHover: Token;
    tutorialsPopupBorder: Token;
    tutorialsPopupHeaderFg: Token;
    aceAutocompleteLink: Token;
    aceEditorBg: Token;
    aceAutocompleteHighlightedFg: Token;
    colorSelectBg: Token;
    colorSelectFontOptionFg: Token;
    colorSelectFontOptionFgSelected: Token;
    colorSelectFontOptionBgSelected: Token;
    colorSelectColorSquareBorderEmpty: Token;
    colorSelectInputFg: Token;
    colorSelectInputBg: Token;
    colorSelectInputBorder: Token;
    highlightedCodeFg: Token;
    highlightedCodeBorder: Token;
    loginPageBg: Token;
    loginPageGoogleButtonBorder: Token;
    formulaAssistantHeaderBg: Token;
    formulaAssistantBorder: Token;
    formulaAssistantPreformattedTextBg: Token;
    attachmentsEditorButtonHoverFg: Token;
    attachmentsEditorButtonBorder: Token;
    attachmentsEditorButtonIcon: Token;
    announcementPopupFg: Token;
    switchCircleFg: Token;
    widgetGalleryBorderSelected: Token;
    widgetGalleryBgHover: Token;
    widgetGallerySecondaryHeaderFg: Token;
    appHeaderBg: Token;
    cardButtonBorderSelected: Token;
    cardButtonShadow: Token;
    formulaIcon: Token;
    textButtonHoverBg: Token;
    textButtonHoverBorder: Token;
  };
}

export interface ThemeTokens extends
  Omit<BaseThemeTokens, 'components'>,
  Omit<SpecificThemeTokens, 'components'> {
  components: BaseThemeTokens['components'] & SpecificThemeTokens['components'];
}
