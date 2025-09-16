import {ThemeTokens, tokens} from 'app/common/ThemePrefs';
import {Base} from 'app/common/themes/Base';

/**
 * Dark Grist theme. Uses the BaseTheme and describes the dark-theme colors.
 */
export const GristDark: ThemeTokens = {
  ...Base,

  body: "#efefef",
  emphasis: tokens.white,
  veryLight: "#efefef",

  bg: '#32323f',
  bgSecondary: '#262633',
  bgTertiary: 'rgba(111,111,125,0.6)',
  bgEmphasis: '#646473',

  decoration: '#70707d',
  decorationSecondary: '#60606d',
  decorationTertiary: '#555563',

  primary: '#17b378',
  primaryMuted: '#1da270',
  primaryDim: '#157a54',
  primaryEmphasis: '#13d78d',
  primaryTranslucent: 'rgba(23, 179, 120, 0.5)',

  secondary: '#a4a4b1',
  secondaryMuted: '#bebebe',

  controlBorderRadius: '4px',

  cursor: tokens.primaryMuted,
  cursorInactive: 'rgba(29,162,112,0.5)',

  selection: 'rgba(22,179,120,0.15)',
  selectionOpaque: '#2f4748',
  selectionDarkerOpaque: '#253e3e',
  selectionDarker: 'rgba(22,179,120,0.25)',
  selectionDarkest: 'rgba(22,179,120,0.35)',

  hover: '#a4a4b1',
  backdrop: 'rgba(0,0,0,0.6)',

  components: {
    ...Base.components,

    /* Text */
    mediumText: '#d5d5d5',
    errorText: '#e63946',
    errorTextHover: '#ff5c5c',

    /* Page */
    pageBackdrop: tokens.black,

    /* Page Panels */
    pagePanelsBorder: tokens.decorationSecondary,

    /* Add New */
    addNewCircleBg: '#0a5438',
    addNewCircleSmallBg: tokens.primaryDim,

    /* Top Bar */
    topBarButtonErrorFg: tokens.errorLight,

    /* Toasts */
    toastMemoBg: tokens.decorationTertiary,
    toastControlFg: '#16b378',
    toastSuccessIcon: '#009058',
    toastSuccessBg: '#009058',

    /* Modals */
    modalInnerShadow: tokens.black,
    modalOuterShadow: tokens.black,

    /* Popups */
    popupInnerShadow: tokens.black,
    popupOuterShadow: tokens.black,

    /* Prompts */
    promptFg: tokens.secondary,

    /* Progress Bars */
    progressBarErrorFg: tokens.errorLight,

    /* Hover */
    lightHover: 'rgba(111,111,125,0.4)',

    /* Cell Editor */
    cellEditorFg: tokens.white,

    /* Tables */
    tableHeaderFg: tokens.body,
    tableHeaderSelectedFg: tokens.body,
    tableHeaderSelectedBg: '#414358',
    tableHeaderBorder: tokens.decoration,
    tableBodyBorder: tokens.decorationSecondary,
    tableAddNewBg: '#4a4a5d',
    tableScrollShadow: tokens.black,
    tableFrozenColumnsBorder: tokens.secondary,
    tableDragDropIndicator: tokens.secondary,
    tableDragDropShadow: tokens.bgTertiary,

    /* Cards */
    cardCompactWidgetBg: tokens.bgSecondary,
    cardBlocksBg: '#404150',
    cardFormBorder: tokens.decoration,
    cardEditingLayoutBg: 'rgba(85,85,99,0.2)',

    /* Card Lists */
    cardListFormBorder: tokens.decorationSecondary,
    cardListBlocksBorder: tokens.decorationSecondary,

    /* Selection */
    selection: tokens.selection,
    selectionDarker: tokens.selectionDarker,
    selectionDarkest: tokens.selectionDarkest,
    selectionOpaqueBg: tokens.selectionOpaque,
    selectionOpaqueDarkBg: tokens.selectionDarkerOpaque,
    selectionHeader: 'rgba(107,107,144,0.4)',

    /* Widgets */
    widgetActiveBorder: tokens.primaryDim,
    widgetInactiveStripesDark: tokens.bg,

    /* Pinned Docs */
    pinnedDocBorder: tokens.decorationSecondary,
    pinnedDocEditorBg: tokens.decorationSecondary,

    /* Raw Data */
    rawDataTableBorder: tokens.decorationSecondary,

    /* Controls */
    controlPrimaryBg: tokens.primaryDim,
    controlHoverFg: tokens.primaryEmphasis,
    controlSecondaryDisabledFg: tokens.decorationSecondary,
    controlSecondaryHoverBg: tokens.decorationSecondary,
    controlDisabledFg: tokens.secondary,
    controlDisabledBg: tokens.decoration,
    controlBorder: `1px solid ${tokens.primary}`,

    /* Checkboxes */
    checkboxBorderHover: tokens.secondary,

    /* Move Docs */
    moveDocsSelectedBg: tokens.primaryDim,

    /* Filter Bar */
    filterBarButtonSavedBg: tokens.decorationTertiary,

    /* Icons */
    iconError: '#ffa500',

    /* Icon Buttons */
    iconButtonPrimaryHoverBg: tokens.primaryEmphasis,

    /* Left Panel */
    pageHoverBg: 'rgba(111,111,117,0.25)',
    disabledPageFg: tokens.decoration,
    pageInitialsBg: '#8e8ea0',
    pageInitialsEmojiOutline: tokens.decoration,
    pageInitialsEmojiBg: tokens.black,

    /* Right Panel */
    rightPanelTabBorder: tokens.decorationSecondary,
    rightPanelTabSelectedIcon: '#16b378',
    rightPanelTabButtonHoverBg: '#0a5438',
    rightPanelSubtabSelectedUnderline: tokens.primaryMuted,
    rightPanelToggleButtonDisabledFg: tokens.bgEmphasis,
    rightPanelToggleButtonDisabledBg: tokens.bg,
    rightPanelFieldSettingsBg: '#404150',
    rightPanelFieldSettingsButtonBg: tokens.bgEmphasis,
    rightPanelCustomWidgetButtonBg: tokens.decorationSecondary,

    /* Document History */
    documentHistorySnapshotBorder: tokens.decoration,
    documentHistoryTableHeaderFg: tokens.body,
    documentHistoryTableBorder: tokens.decoration,
    documentHistoryTableBorderLight: tokens.decorationSecondary,

    /* Accents */
    accentBorder: tokens.primaryDim,

    /* Inputs */
    inputFg: tokens.body,
    inputInvalid: tokens.errorLight,
    inputReadonlyBorder: tokens.decoration,

    /* Choice Tokens */
    choiceTokenBg: tokens.decoration,
    choiceTokenSelectedBg: tokens.decorationTertiary,
    choiceTokenInvalidBg: '#323240',

    /* Choice Entry */
    choiceEntryBorderHover: tokens.secondary,

    /* Select Buttons */
    selectButtonBorderInvalid: tokens.errorLight,

    /* Menus */
    menuBorder: tokens.decoration,
    menuShadow: tokens.black,

    /* Menu Items */
    menuItemSelectedFg: tokens.white,
    menuItemSelectedBg: tokens.primaryDim,

    /* Autocomplete */
    autocompleteItemSelectedBg: tokens.decoration,
    autocompleteAddNewCircleBg: tokens.primaryDim,

    /* Search */
    searchBorder: tokens.decoration,
    searchPrevNextButtonBg: '#24242f',

    /* Site Switcher */
    siteSwitcherActiveBg: tokens.black,

    /* Shortcut Keys */
    shortcutKeyPrimaryFg: tokens.primary,

    /* Breadcrumbs */
    breadcrumbsTagBg: tokens.decoration,

    /* Page Widget Picker */
    widgetPickerItemFg: tokens.white,
    widgetPickerSummaryIcon: tokens.primary,
    widgetPickerShadow: tokens.black,

    /* Code View */
    codeViewText: '#d2d2d2',
    codeViewKeyword: '#d2d2d2',
    codeViewComment: '#888888',
    codeViewMeta: '#7cd4ff',
    codeViewTitle: '#ed7373',
    codeViewParams: '#d2d2d2',
    codeViewString: '#ed7373',
    codeViewNumber: '#ed7373',
    codeViewBuiltin: '#bfe6d8',
    codeViewLiteral: '#9ed682',

    /* Importer */
    importerOutsideBg: tokens.bg,
    importerMainContentBg: tokens.bgSecondary,
    importerActiveFileBg: '#16b378',
    importerInactiveFileBg: '#808080',

    /* Menu Toggles */
    menuToggleHoverFg: tokens.primary,
    menuToggleActiveFg: tokens.primaryEmphasis,

    /* Button Groups */
    buttonGroupBgHover: 'rgba(111,111,125,0.25)',
    buttonGroupBorderHover: tokens.bgEmphasis,

    /* Access Rules */
    accessRulesTableHeaderBg: tokens.decorationSecondary,

    /* Cells */
    cellZebraBg: tokens.bgSecondary,

    /* Charts */
    chartFg: tokens.secondary,
    chartLegendBg: 'rgba(50,50,63,0.5)',
    chartXAxis: tokens.secondary,
    chartYAxis: tokens.secondary,

    /* Comments */
    commentsUserNameFg: tokens.body,
    commentsPanelTopicBorder: tokens.decorationTertiary,
    commentsPanelResolvedTopicBg: tokens.bgSecondary,

    /* Date Picker */
    datePickerSelectedFg: tokens.white,
    datePickerSelectedBg: '#7a7a8d',
    datePickerSelectedBgHover: '#8d8d9c',
    datePickerTodayBg: tokens.primaryDim,
    datePickerRangeStartEndBg: '#7a7a8d',
    datePickerRangeStartEndBgHover: '#8d8d9c',
    datePickerRangeBg: tokens.decorationSecondary,
    datePickerRangeBgHover: '#7a7a8d',

    /* Tutorials */
    tutorialsPopupBoxBg: tokens.decorationSecondary,
    tutorialsPopupCodeFg: tokens.white,
    tutorialsPopupCodeBg: tokens.bgSecondary,
    tutorialsPopupCodeBorder: '#929299',

    /* Ace */
    aceAutocompletePrimaryFg: tokens.body,
    aceAutocompleteSecondaryFg: tokens.secondary,
    aceAutocompleteBg: tokens.bg,
    aceAutocompleteBorder: tokens.decoration,
    aceAutocompleteLink: '#28be86',
    aceAutocompleteLinkHighlighted: '#45d48b',
    aceAutocompleteActiveLineBg: tokens.decorationTertiary,
    aceAutocompleteLineBorderHover: 'rgba(111,111,125,0.3)',
    aceAutocompleteLineBgHover: 'rgba(111,111,125,0.3)',

    /* Color Select */
    colorSelectFg: tokens.secondary,
    colorSelectShadow: tokens.black,
    colorSelectFontOptionsBorder: tokens.decorationTertiary,
    colorSelectFontOptionBgHover: 'rgba(111,111,125,0.25)',
    colorSelectColorSquareBorder: tokens.secondary,

    /* Highlighted Code */
    highlightedCodeBlockBg: tokens.bgSecondary,
    highlightedCodeBlockBgDisabled: tokens.decorationTertiary,
    highlightedCodeBgDisabled: tokens.bg,

    /* Login Page */
    loginPageBackdrop: '#404150',
    loginPageLine: tokens.decorationSecondary,
    loginPageGoogleButtonFg: tokens.white,
    loginPageGoogleButtonBg: '#404150',
    loginPageGoogleButtonBgHover: tokens.decorationTertiary,

    /* Attachments */
    attachmentsEditorButtonFg: tokens.primary,
    attachmentsEditorButtonHoverFg: tokens.primaryEmphasis,
    attachmentsEditorButtonBg: '#404150',
    attachmentsEditorButtonHoverBg: tokens.decorationTertiary,
    attachmentsEditorBorder: tokens.secondary,
    attachmentsCellIconFg: tokens.secondary,
    attachmentsCellIconBg: tokens.decorationTertiary,
    attachmentsCellIconHoverBg: tokens.decoration,

    /* Announcement Popups */
    announcementPopupBg: '#404150',

    /* Switches */
    switchActivePill: tokens.bgSecondary,

    /* Scroll Shadow */
    scrollShadow: 'rgba(0,0,0,0.25)',

    /* Toggle Checkboxes */
    toggleCheckboxFg: tokens.secondary,

    /* Numeric Spinners */
    numericSpinnerFg: tokens.secondary,

    /* Custom Widget Gallery */
    widgetGalleryBorder: tokens.decorationTertiary,
    widgetGalleryShadow: 'rgba(0,0,0,0.5)',
    widgetGallerySecondaryHeaderBg: tokens.decoration,
    widgetGallerySecondaryHeaderBgHover: tokens.decorationSecondary,

    /* Markdown Cell */
    markdownCellLightBg: '#494958',
    markdownCellLightBorder: tokens.bg,
    markdownCellMediumBorder: tokens.decorationTertiary,

    /* App Header */
    appHeaderBorder: tokens.bg,
    appHeaderBorderHover: '#78788c',

    /* Card Button */
    cardButtonBorder: tokens.decorationTertiary,
  }
};
