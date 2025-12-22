import {ThemeTokens, tokens} from 'app/common/ThemePrefs';
import {Base} from 'app/common/themes/Base';

/**
 * Default Grist theme. Uses the BaseTheme and describes the light-theme colors.
 */
export const GristLight: ThemeTokens = {
  ...Base,

  body: '#262633',
  emphasis: tokens.black,
  veryLight: tokens.white,

  bg: tokens.white,
  bgSecondary: '#f7f7f7',
  bgTertiary: 'rgba(217,217,217,0.6)',
  bgEmphasis: '#262633',

  decoration: '#d9d9d9',
  decorationSecondary: '#e8e8e8',
  decorationTertiary: '#d9d9d9',

  primary: '#16b378',
  primaryMuted: '#009058',
  primaryDim: '#007548',
  primaryEmphasis: '#b1ffe2',
  primaryTranslucent: 'rgba(22, 179, 120, 0.5)',

  secondary: '#929299',
  secondaryMuted: '#777777',

  controlBorderRadius: '4px',

  cursor: tokens.primary,
  cursorInactive: '#a2e1c9',

  selection: 'rgba(22,179,120,0.15)',
  selectionOpaque: '#dcf4eb',
  selectionDarkerOpaque: '#d6eee5',
  selectionDarker: 'rgba(22,179,120,0.25)',
  selectionDarkest: 'rgba(22,179,120,0.35)',

  hover: '#bfbfbf',
  backdrop: 'rgba(38,38,51,0.9)',

  components: {
    ...Base.components,

    /* Text */
    mediumText: '#494949',
    errorText: tokens.error,
    errorTextHover: '#a10000',

    /* Page */
    pageBackdrop: '#808080',

    /* Top Bar */
    topBarButtonErrorFg: tokens.error,

    /* Toasts */
    toastMemoBg: tokens.bgEmphasis,

    /* Modals */
    modalInnerShadow: 'rgba(31,37,50,0.31)',
    modalOuterShadow: 'rgba(76,86,103,0.24)',

    /* Popups */
    popupInnerShadow: 'rgba(31,37,50,0.31)',
    popupOuterShadow: 'rgba(76,86,103,0.24)',

    /* Prompts */
    promptFg: '#606060',

    /* Progress Bars */
    progressBarErrorFg: tokens.error,

    /* Hover */
    lightHover: tokens.bgSecondary,

    /* Cell Editor */
    cellEditorFg: tokens.body,

    /* Tables */
    tableHeaderSelectedBg: tokens.decorationSecondary,
    tableHeaderBorder: 'lightgrey',
    tableAddNewBg: 'inherit',
    tableScrollShadow: '#444444',
    tableFrozenColumnsBorder: '#999999',
    tableDragDropIndicator: '#808080',
    tableDragDropShadow: '#f0f0f0',

    /* Cards */
    cardCompactWidgetBg: tokens.bgTertiary,
    cardBlocksBg: tokens.bgTertiary,
    cardFormBorder: 'lightgrey',
    cardEditingLayoutBg: 'rgba(192,192,192,0.2)',

    /* Selection */
    selection: tokens.selection,
    selectionDarker: tokens.selectionDarker,
    selectionDarkest: tokens.selectionDarkest,
    selectionOpaqueBg: tokens.selectionOpaque,
    selectionOpaqueDarkBg: tokens.selectionDarkerOpaque,
    selectionHeader: tokens.bgTertiary,

    /* Widgets */
    widgetInactiveStripesDark: tokens.decorationSecondary,

    /* Controls */
    controlHoverFg: tokens.primaryMuted,
    controlDisabledFg: tokens.white,
    controlDisabledBg: tokens.secondary,
    controlBorder: '1px solid #11B683',

    /* Checkboxes */
    checkboxBorderHover: tokens.hover,

    /* Filter Bar */
    filterBarButtonSavedBg: tokens.secondary,

    /* Icons */
    iconError: tokens.error,

    /* Icon Buttons */
    iconButtonPrimaryHoverBg: tokens.primaryMuted,

    /* Left Panel */
    pageHoverBg: tokens.bgTertiary,
    disabledPageFg: '#bdbdbd',
    pageInitialsBg: tokens.secondary,
    pageInitialsEmojiOutline: '#bdbdbd',
    pageInitialsEmojiBg: tokens.white,

    /* Right Panel */
    rightPanelTabButtonHoverBg: tokens.primaryMuted,
    rightPanelSubtabFg: '#707070',
    rightPanelFieldSettingsBg: tokens.decorationSecondary,
    rightPanelFieldSettingsButtonBg: 'lightgrey',

    /* Document History */
    documentHistorySnapshotBorder: tokens.bgTertiary,
    documentHistoryTableBorder: 'lightgrey',

    /* Inputs */
    inputInvalid: tokens.error,
    inputReadonlyBorder: tokens.decorationSecondary,

    /* Choice Tokens */
    choiceTokenBg: tokens.decorationSecondary,
    choiceTokenSelectedBg: tokens.decoration,
    choiceTokenInvalidBg: tokens.white,

    /* Choice Entry */
    choiceEntryBorderHover: tokens.hover,

    /* Select Buttons */
    selectButtonBorderInvalid: tokens.error,

    /* Menus */
    menuBorder: tokens.decorationSecondary,
    menuShadow: 'rgba(38,38,51,0.6)',

    /* Autocomplete */
    autocompleteItemSelectedBg: tokens.decorationSecondary,

    /* Search */
    searchBorder: '#808080',
    searchPrevNextButtonBg: tokens.bgTertiary,

    /* Site Switcher */
    siteSwitcherActiveBg: tokens.bgEmphasis,

    /* Shortcut Keys */
    shortcutKeyPrimaryFg: tokens.primaryMuted,

    /* Breadcrumbs */
    breadcrumbsTagBg: tokens.secondary,

    /* Page Widget Picker */
    widgetPickerItemFg: tokens.body,
    widgetPickerSummaryIcon: tokens.primaryMuted,
    widgetPickerShadow: 'rgba(38,38,51,0.20)',

    /* Code View */
    codeViewText: '#444444',
    codeViewKeyword: '#444444',
    codeViewComment: '#888888',
    codeViewMeta: '#1f7199',
    codeViewTitle: '#880000',
    codeViewParams: '#444444',
    codeViewString: '#880000',
    codeViewNumber: '#880000',
    codeViewBuiltin: '#397300',
    codeViewLiteral: '#78a960',

    /* Importer */
    importerOutsideBg: tokens.bgSecondary,
    importerMainContentBg: tokens.bg,
    importerInactiveFileBg: tokens.bgTertiary,

    /* Menu Toggles */
    menuToggleHoverFg: tokens.primaryMuted,
    menuToggleActiveFg: tokens.primaryDim,

    /* Button Groups */
    buttonGroupBgHover: tokens.bgSecondary,
    buttonGroupBorderHover: tokens.hover,

    /* Cells */
    cellZebraBg: '#f8f8f8',

    /* Charts */
    chartFg: '#444444',
    chartLegendBg: '#ffffff80',
    chartXAxis: '#444444',
    chartYAxis: '#444444',

    /* Comments */
    commentsUserNameFg: '#494949',
    commentsPanelTopicBorder: '#cccccc',
    commentsPanelResolvedTopicBg: '#f0f0f0',

    /* Date Picker */
    datePickerSelectedFg: tokens.body,
    datePickerSelectedBg: tokens.decoration,
    datePickerSelectedBgHover: '#cfcfcf',
    datePickerRangeStartEndBg: tokens.decoration,
    datePickerRangeStartEndBgHover: '#cfcfcf',
    datePickerRangeBg: '#eeeeee',
    datePickerRangeBgHover: tokens.decoration,

    /* Tutorials */
    tutorialsPopupBoxBg: '#f5f5f5',
    tutorialsPopupCodeFg: '#333333',
    tutorialsPopupCodeBg: tokens.bg,
    tutorialsPopupCodeBorder: '#e1e4e5',

    /* Ace */
    aceAutocompletePrimaryFg: '#444444',
    aceAutocompleteSecondaryFg: '#8f8f8f',
    aceAutocompleteBg: '#fbfbfb',
    aceAutocompleteBorder: 'lightgrey',
    aceAutocompleteLinkHighlighted: '#009058',
    aceAutocompleteActiveLineBg: '#cad6fa',
    aceAutocompleteLineBorderHover: '#abbffe',
    aceAutocompleteLineBgHover: 'rgba(233,233,253,0.4)',

    /* Color Select */
    colorSelectFg: tokens.body,
    colorSelectShadow: 'rgba(38,38,51,0.6)',
    colorSelectFontOptionsBorder: tokens.decoration,
    colorSelectFontOptionBgHover: tokens.decoration,
    colorSelectColorSquareBorder: tokens.decoration,

    /* Highlighted Code */
    highlightedCodeBlockBg: tokens.bg,
    highlightedCodeBlockBgDisabled: tokens.decorationSecondary,
    highlightedCodeBgDisabled: tokens.decorationSecondary,

    /* Login Page */
    loginPageBackdrop: '#f5f8fa',
    loginPageLine: tokens.bgSecondary,
    loginPageGoogleButtonFg: tokens.body,
    loginPageGoogleButtonBg: tokens.bgSecondary,
    loginPageGoogleButtonBgHover: tokens.decorationSecondary,

    /* Attachments */
    attachmentsEditorButtonFg: tokens.primaryMuted,
    attachmentsEditorButtonBg: tokens.white,
    attachmentsEditorButtonHoverBg: tokens.decorationSecondary,
    attachmentsEditorBorder: tokens.decorationSecondary,
    attachmentsCellIconFg: tokens.white,
    attachmentsCellIconBg: tokens.decoration,
    attachmentsCellIconHoverBg: tokens.secondary,

    /* Announcement Popups */
    announcementPopupBg: tokens.selectionOpaque,

    /* Scroll Shadow */
    scrollShadow: tokens.bgTertiary,

    /* Toggle Checkboxes */
    toggleCheckboxFg: '#606060',

    /* Numeric Spinners */
    numericSpinnerFg: '#606060',

    /* Custom Widget Gallery */
    widgetGalleryBorder: tokens.decoration,
    widgetGalleryShadow: 'rgba(0,0,0,0.1)',
    widgetGallerySecondaryHeaderBg: tokens.secondary,
    widgetGallerySecondaryHeaderBgHover: '#7e7e85',

    /* Markdown Cell */
    markdownCellLightBg: tokens.bgSecondary,
    markdownCellLightBorder: tokens.decorationSecondary,
    markdownCellMediumBorder: tokens.decoration,

    /* App Header */
    appHeaderBorder: tokens.decorationSecondary,
    appHeaderBorderHover: '#b0b0b0',

    /* Card Button */
    cardButtonBorder: tokens.decoration,
  },
};
