import {ThemeTokens, tokens} from 'app/common/ThemePrefs';
import {Base} from 'app/common/themes/Base';

/**
 * Dark Grist theme. Uses the BaseTheme and describes the dark-theme colors.
 */
export const GristDark: ThemeTokens = {
  ...Base,
  primaryLighter: '#b1ffe2',
  primaryLight: '#17b378',
  primaryDark: '#009058',
  primaryDarker: '#007548',
  secondaryLighter: '#87b2f9',
  secondaryLight: '#3B82F6',
  inactiveCursor: '#A2E1C9',
  cursor: tokens.primaryLight,
  selection: 'rgba(22,179,120,0.15)',
  selectionOpaque: '#DCF4EB',
  selectionDarkerOpaque: '#d6eee5',

  warningBg: tokens.warningDark,

  text: "#efefef",
  textLight: "#a4a4b1",
  textVeryLight: "#efefef",
  textDark: tokens.white,

  mainBg: "#32323f",
  panelBg: tokens.dark,
  activeBg: "#646473",
  transparentBg: "rgba(111,111,125,0.6)",

  borderLight: "#60606d",
  borderLighter: "#70707d",
  borderLighterTransparent: "#60606d",

  primaryLightBg: '#157a54',

  legacyVariables: {
    ...Base.legacyVariables,

    /* Text */
    mediumText: '#d5d5d5',
    errorText: '#e63946',
    errorTextHover: '#ff5c5c',
    dangerText: '#ffa500',

    /* Page */
    pageBackdrop: '#000000',

    /* Add New */
    addNewCircleBg: '#0a5438',
    addNewCircleHoverBg: '#157a54',
    addNewCircleSmallHoverBg: '#1da270',

    /* Top Bar */
    topBarButtonErrorFg: 'ff6666',

    /* Toasts */
    toastLightText: '#929299',
    toastBg: '#040404',
    toastMemoBg: '#555563',
    toastErrorIcon: '#d0021b',
    toastErrorBg: '#d0021b',
    toastSuccessIcon: '#009058',
    toastSuccessBg: '#009058',
    toastWarningIcon: '#f9ae41',
    toastWarningBg: '#dd962c',
    toastInfoIcon: '#3b82f6',
    toastInfoBg: '#3b82f6',
    toastControlFg: '#16b378',
    toastInfoControlFg: '#87b2f9',

    /* Tooltips */
    tooltipBg: 'rgba(0,0,0,0.75)',
    tooltipCloseButtonHoverFg: '#000000',

    /* Modals */
    modalBackdrop: 'rgba(0,0,0,0.6)',
    modalBorder: '#60606d',
    modalInnerShadow: '#000000',
    modalOuterShadow: '#000000',
    modalBackdropCloseButtonHoverFg: '#13d78d',

    /* Popups */
    popupInnerShadow: '#000000',
    popupOuterShadow: '#000000',

    /* Prompts */
    promptFg: '#a4a4b1',

    /* Progress Bars */
    progressBarErrorFg: '#ff6666',

    /* Hover */
    hover: 'rgba(111,111,125,0.6)',
    lightHover: 'rgba(111,111,125,0.4)',

    /* Cell Editor */
    cellEditorFg: '#ffffff',

    /* Cursor */
    cursor: '#1da270',
    cursorInactive: 'rgba(29,162,112,0.5)',

    /* Tables */
    tableHeaderFg: '#efefef',
    tableHeaderSelectedFg: '#efefef',
    tableHeaderSelectedBg: '#414358',
    tableHeaderBorder: '#70707d',
    tableAddNewBg: '#4a4a5d',
    tableScrollShadow: '#000000',
    tableFrozenColumnsBorder: '#a4a4b1',
    tableDragDropIndicator: '#a4a4b1',
    tableDragDropShadow: 'rgba(111,111,125,0.6)',
    tableCellSummaryBg: 'rgba(111,111,125,0.6)',

    /* Cards */
    cardCompactWidgetBg: '#262633',
    cardBlocksBg: '#404150',
    cardFormBorder: '#70707d',
    cardEditingLayoutBg: 'rgba(85,85,99,0.2)',

    /* Selection */
    selection: 'rgba(22,179,120,0.15)',
    selectionDarker: 'rgba(22,179,120,0.25)',
    selectionDarkest: 'rgba(22,179,120,0.35)',
    selectionOpaqueBg: '#2f4748',
    selectionOpaqueDarkBg: '#253e3e',
    selectionHeader: 'rgba(107,107,144,0.4)',

    /* Widgets */
    widgetInactiveStripesDark: '#32323f',

    /* Controls */
    controlHoverFg: '#13d78d',
    controlPrimaryHoverBg: '#1da270',
    controlDisabledFg: '#a4a4b1',
    controlDisabledBg: '#70707d',
    controlBorder: '1px solid #17b378',

    /* Checkboxes */
    /* MISSING */ checkboxSelectedFg: tokens.primaryLight,
    checkboxBorderHover: '#a4a4b1',

    /* Filter Bar */
    filterBarButtonSavedBg: '#555563',

    /* Icons */
    iconError: '#ffa500',

    /* Icon Buttons */
    iconButtonPrimaryHoverBg: '#13d78d',

    /* Left Panel */
    pageHoverBg: 'rgba(111,111,117,0.25)',
    disabledPageFg: '#70707d',
    pageOptionsFg: '#a4a4b1',
    pageInitialsBg: '#8e8ea0',
    pageInitialsEmojiBg: '#000000',
    pageInitialsEmojiOutline: '#70707d',

    /* Right Panel */
    rightPanelTabSelectedIcon: '#16b378',
    rightPanelTabButtonHoverBg: '#0a5438',
    rightPanelSubtabSelectedUnderline: '#1da270',
    rightPanelSubtabHoverFg: '#13d78d',
    rightPanelSubtabHoverUnderline: '#13d78d',
    rightPanelToggleButtonDisabledFg: '#646473',
    rightPanelToggleButtonDisabledBg: '#32323f',
    rightPanelFieldSettingsBg: '#404150',
    rightPanelFieldSettingsButtonBg: '#646473',

    /* Document History */
    documentHistorySnapshotBorder: '#70707d',
    documentHistoryTableHeaderFg: '#efefef',
    documentHistoryTableBorder: '#70707d',

    /* Inputs */
    inputFg: '#efefef',
    inputInvalid: '#ff6666',
    inputFocus: '#5e9ed6',
    inputReadonlyBorder: '#70707d',

    /* Choice Tokens */
    choiceTokenBg: '#70707d',
    choiceTokenSelectedBg: '#555563',
    choiceTokenInvalidBg: '#323240',
    choiceTokenInvalidBorder: '#d0021b',

    /* Choice Entry */
    choiceEntryBorderHover: '#a4a4b1',

    /* Select Buttons */
    selectButtonBorderInvalid: '#ff6666',

    /* Menus */
    menuBorder: '#70707d',
    menuShadow: '#000000',

    /* Autocomplete */
    autocompleteSelectedMatchText: '#13d78d',
    autocompleteItemSelectedBg: '#70707d',
    autocompleteAddNewCircleSelectedBg: '#1da270',

    /* Search */
    searchBorder: '#70707d',
    searchPrevNextButtonBg: '#24242f',

    /* Site Switcher */
    siteSwitcherActiveBg: '#000000',

    /* Shortcut Keys */
    shortcutKeyPrimaryFg: '#17b378',

    /* Breadcrumbs */
    breadcrumbsTagBg: '#70707d',
    breadcrumbsTagAlertBg: '#d0021b',

    /* Page Widget Picker */
    widgetPickerItemFg: '#ffffff',
    widgetPickerItemSelectedBg: 'rgba(111,111,125,0.6)',
    widgetPickerItemDisabledBg: 'rgba(111,111,125,0.6)',
    widgetPickerSummaryIcon: '#17b378',
    widgetPickerBorder: 'rgba(111,111,125,0.6)',
    widgetPickerShadow: '#000000',

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
    importerSkippedTableOverlay: 'rgba(111,111,125,0.6)',
    importerOutsideBg: '#32323f',
    importerMainContentBg: '#262633',
    importerActiveFileBg: '#16b378',
    importerInactiveFileBg: '#808080',

    /* Menu Toggles */
    menuToggleHoverFg: '#17b378',
    menuToggleActiveFg: '#13d78d',

    /* Info Button */
    infoButtonFg: '#8f8f8f',
    infoButtonHoverFg: '#707070',
    infoButtonActiveFg: '#5c5c5c',

    /* Button Groups */
    buttonGroupBg: 'transparent',
    buttonGroupBgHover: 'rgba(111,111,125,0.25)',
    buttonGroupBorderHover: '#646473',

    /* Access Rules */
    accessRulesColumnItemBg: '#60606d',
    accessRulesFormulaEditorBgDisabled: '#60606d',

    /* Cells */
    cellZebraBg: '#262633',

    /* Charts */
    chartFg: '#a4a4b1',
    chartLegendBg: 'rgba(50,50,63,0.5)',
    chartXAxis: '#a4a4b1',
    chartYAxis: '#a4a4b1',

    /* Comments */
    commentsUserNameFg: '#efefef',
    commentsPanelTopicBorder: '#555563',
    commentsPanelResolvedTopicBg: '#262633',

    /* Date Picker */
    datePickerSelectedFg: '#ffffff',
    datePickerSelectedBg: '#7a7a8d',
    datePickerSelectedBgHover: '#8d8d9c',
    datePickerTodayBgHover: '#1da270',
    datePickerRangeStartEndBg: '#7a7a8d',
    datePickerRangeStartEndBgHover: '#8d8d9c',
    datePickerRangeBg: '#60606d',
    datePickerRangeBgHover: '#7a7a8d',

    /* Tutorials */
    tutorialsPopupBoxBg: '#60606d',
    tutorialsPopupCodeFg: '#ffffff',
    tutorialsPopupCodeBg: '#262633',
    tutorialsPopupCodeBorder: '#929299',

    /* Ace */
    aceAutocompletePrimaryFg: '#efefef',
    aceAutocompleteSecondaryFg: '#a4a4b1',
    aceAutocompleteBg: '#32323f',
    aceAutocompleteBorder: '#70707d',
    aceAutocompleteLink: '#28be86',
    aceAutocompleteLinkHighlighted: '#45d48b',
    aceAutocompleteActiveLineBg: '#555563',
    aceAutocompleteLineBorderHover: 'rgba(111,111,125,0.3)',
    aceAutocompleteLineBgHover: 'rgba(111,111,125,0.3)',

    /* Color Select */
    colorSelectFg: '#a4a4b1',
    colorSelectShadow: '#000000',
    colorSelectFontOptionsBorder: '#555563',
    colorSelectFontOptionBgHover: 'rgba(111,111,125,0.25)',
    colorSelectColorSquareBorder: '#a4a4b1',

    /* Highlighted Code */
    highlightedCodeBlockBg: '#262633',
    highlightedCodeBlockBgDisabled: '#555563',
    highlightedCodeBgDisabled: '#32323f',

    /* Login Page */
    loginPageBackdrop: '#404150',
    loginPageLine: '#60606d',
    loginPageGoogleButtonFg: '#ffffff',
    loginPageGoogleButtonBg: '#404150',
    loginPageGoogleButtonBgHover: '#555563',

    /* Attachments */
    attachmentsEditorButtonFg: '#17b378',
    attachmentsEditorButtonHoverFg: '#13d78d',
    attachmentsEditorButtonBg: '#404150',
    attachmentsEditorButtonHoverBg: '#555563',
    attachmentsEditorBorder: '#a4a4b1',
    attachmentsCellIconFg: '#a4a4b1',
    attachmentsCellIconBg: '#555563',
    attachmentsCellIconHoverBg: '#70707d',

    /* Announcement Popups */
    announcementPopupBg: '#404150',

    /* Switches */
    switchSliderFg: '#70707d',

    /* Scroll Shadow */
    scrollShadow: 'rgba(0,0,0,0.25)',

    /* Toggle Checkboxes */
    toggleCheckboxFg: '#a4a4b1',

    /* Numeric Spinners */
    numericSpinnerFg: '#a4a4b1',

    /* Custom Widget Gallery */
    widgetGalleryBorder: '#555563',
    widgetGalleryShadow: '#00000080',
    widgetGallerySecondaryHeaderBg: '#70707d',
    widgetGallerySecondaryHeaderBgHover: '#60606d',

    /* Markdown Cell */
    markdownCellLightBg: '#494958',
    markdownCellLightBorder: '#32323f',
    markdownCellMediumBorder: '#555563',

    /* App Header */
    appHeaderBg: '#32323f',
    appHeaderBorder: '#32323f',
    appHeaderBorderHover: '#78788c',

    /* Card Button */
    cardButtonBorder: '#555563',
    cardButtonShadow: '#0000001a',
  }
};
