import {ThemeTokens, tokens} from 'app/common/ThemePrefs';
import {Base} from 'app/common/themes/Base';

/**
 * Default Grist theme. Uses the BaseTheme and describes the light-theme colors.
 */
export const GristLight: ThemeTokens = {
  ...Base,
  primaryLighter: '#b1ffe2',
  primaryLight: '#16B378',
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

  text: tokens.dark,
  textLight: tokens.slate,
  textVeryLight: tokens.white,
  textDark: tokens.black,

  mainBg: tokens.white,
  panelBg: tokens.lightGrey,
  activeBg: tokens.dark,
  transparentBg: tokens.mediumGrey,

  borderLight: tokens.slate,
  borderLighter: tokens.darkGrey,
  borderLighterTransparent: tokens.mediumGrey,

  legacyVariables: {
    ...Base.legacyVariables,

    /* Text */
    mediumText: tokens.darkText,
    errorText: tokens.error,
    errorTextHover: '#BF0A31',
    dangerText: '#FFA500',

    /* Page */
    pageBackdrop: 'grey',

    /* Add New */
    addNewCircleBg: tokens.primaryDark,
    addNewCircleHoverBg: tokens.primaryDarker,
    addNewCircleSmallHoverBg: tokens.primaryDark,

    /* Top Bar */
    topBarButtonErrorFg: tokens.error,

    /* Toasts */
    toastLightText: tokens.slate,
    toastBg: tokens.toastBg,
    toastMemoBg: tokens.dark,
    toastErrorIcon: tokens.error,
    toastErrorBg: tokens.error,
    toastSuccessIcon: tokens.primaryDark,
    toastSuccessBg: tokens.primaryDark,
    toastWarningIcon: tokens.warningLight,
    toastWarningBg: tokens.warningBg,
    toastInfoIcon: tokens.secondaryLight,
    toastInfoBg: tokens.secondaryLight,
    toastControlFg: tokens.primaryLight,
    toastInfoControlFg: tokens.secondaryLighter,

    /* Tooltips */
    tooltipBg: 'rgba(0, 0, 0, 0.75)',
    tooltipCloseButtonHoverFg: 'black',

    /* Modals */
    modalBackdrop: tokens.backdrop,
    modalBorder: tokens.mediumGreyOpaque,
    modalInnerShadow: 'rgba(31, 37, 50, 0.31)',
    modalOuterShadow: 'rgba(76, 86, 103, 0.24)',
    modalBackdropCloseButtonHoverFg: tokens.primaryLighter,

    /* Popups */
    popupInnerShadow: 'rgba(31, 37, 50, 0.31)',
    popupOuterShadow: 'rgba(76, 86, 103, 0.24)',

    /* Prompts */
    promptFg: '#606060',

    /* Progress Bars */
    progressBarErrorFg: tokens.error,

    /* Hover */
    hover: tokens.mediumGrey,
    lightHover: tokens.lightGrey,

    /* Cell Editor */
    cellEditorFg: tokens.dark,

    /* Cursor */
    cursor: tokens.cursor,
    cursorInactive: tokens.inactiveCursor,

    /* Tables */
    tableHeaderFg: '#000',
    tableHeaderSelectedFg: '#000',
    tableHeaderSelectedBg: tokens.mediumGreyOpaque,
    tableHeaderBorder: 'lightgray',
    tableAddNewBg: 'inherit',
    tableScrollShadow: '#444444',
    tableFrozenColumnsBorder: '#999999',
    tableDragDropIndicator: 'gray',
    tableDragDropShadow: '#F0F0F0',
    tableCellSummaryBg: tokens.mediumGrey,

    /* Cards */
    cardCompactWidgetBg: tokens.mediumGrey,
    cardBlocksBg: tokens.mediumGrey,
    cardFormBorder: 'lightgrey',
    cardEditingLayoutBg: 'rgba(192, 192, 192, 0.2)',

    /* Selection */
    selection: tokens.selection,
    selectionDarker: 'rgba(22,179,120,0.25)',
    selectionDarkest: 'rgba(22,179,120,0.35)',
    selectionOpaqueBg: tokens.selectionOpaque,
    selectionOpaqueDarkBg: tokens.selectionDarkerOpaque,
    selectionHeader: tokens.mediumGrey,

    /* Widgets */
    widgetInactiveStripesDark: tokens.mediumGreyOpaque,

    /* Controls */
    controlHoverFg: tokens.controlFgHover,
    controlPrimaryHoverBg: tokens.primaryBgHover,
    controlDisabledFg: tokens.light,
    controlDisabledBg: tokens.slate,
    controlBorder: tokens.controlBorder,

    /* Checkboxes */
    checkboxSelectedFg: tokens.primaryLight,
    checkboxBorderHover: tokens.hover,

    /* Filter Bar */
    filterBarButtonSavedBg: tokens.slate,

    /* Icons */
    iconError: tokens.error,

    /* Icon Buttons */
    iconButtonPrimaryHoverBg: tokens.primaryDark,

    /* Left Panel */
    pageHoverBg: tokens.mediumGrey,
    disabledPageFg: tokens.darkGrey,
    pageOptionsFg: tokens.slate,
    pageInitialsBg: tokens.slate,
    pageInitialsEmojiBg: 'white',
    pageInitialsEmojiOutline: tokens.darkGrey,

    /* Right Panel */
    rightPanelTabSelectedIcon: tokens.primaryLight,
    rightPanelTabButtonHoverBg: tokens.primaryDark,
    rightPanelSubtabSelectedUnderline: tokens.primaryLight,
    rightPanelSubtabHoverFg: tokens.primaryDark,
    rightPanelSubtabHoverUnderline: tokens.primaryLight,
    rightPanelToggleButtonDisabledFg: tokens.light,
    rightPanelToggleButtonDisabledBg: tokens.mediumGreyOpaque,
    rightPanelFieldSettingsBg: tokens.mediumGreyOpaque,
    rightPanelFieldSettingsButtonBg: 'lightgrey',

    /* Document History */
    documentHistorySnapshotBorder: tokens.mediumGrey,
    documentHistoryTableHeaderFg: '#000',
    documentHistoryTableBorder: 'lightgray',

    /* Inputs */
    inputFg: 'black',
    inputInvalid: tokens.error,
    inputFocus: '#5E9ED6',
    inputReadonlyBorder: tokens.mediumGreyOpaque,

    /* Choice Tokens */
    choiceTokenBg: tokens.mediumGreyOpaque,
    choiceTokenSelectedBg: tokens.darkGrey,
    choiceTokenInvalidBg: 'white',
    choiceTokenInvalidBorder: tokens.error,

    /* Choice Entry */
    choiceEntryBorderHover: tokens.hover,

    /* Select Buttons */
    selectButtonBorderInvalid: tokens.error,

    /* Menus */
    menuBorder: tokens.mediumGreyOpaque,
    menuShadow: 'rgba(38, 38, 51, 0.6)',

    /* Autocomplete */
    autocompleteSelectedMatchText: tokens.primaryLighter,
    autocompleteItemSelectedBg: tokens.mediumGreyOpaque,
    autocompleteAddNewCircleSelectedBg: tokens.primaryDark,

    /* Search */
    searchBorder: 'grey',
    searchPrevNextButtonBg: tokens.mediumGrey,

    /* Site Switcher */
    siteSwitcherActiveBg: tokens.dark,

    /* Shortcut Keys */
    shortcutKeyPrimaryFg: tokens.primaryDark,

    /* Breadcrumbs */
    breadcrumbsTagBg: tokens.slate,
    breadcrumbsTagAlertBg: tokens.error,

    /* Page Widget Picker */
    widgetPickerItemFg: tokens.dark,
    widgetPickerItemSelectedBg: tokens.mediumGrey,
    widgetPickerItemDisabledBg: tokens.mediumGrey,
    widgetPickerSummaryIcon: tokens.primaryDark,
    widgetPickerBorder: tokens.mediumGrey,
    widgetPickerShadow: 'rgba(38,38,51,0.20)',

    /* Code View */
    codeViewText: '#444',
    codeViewKeyword: '#444',
    codeViewComment: '#888888',
    codeViewMeta: '#1F7199',
    codeViewTitle: '#880000',
    codeViewParams: '#444',
    codeViewString: '#880000',
    codeViewNumber: '#880000',
    codeViewBuiltin: '#397300',
    codeViewLiteral: '#78A960',

    /* Importer */
    importerSkippedTableOverlay: tokens.mediumGrey,
    importerOutsideBg: tokens.lightGrey,
    importerMainContentBg: '#FFFFFF',
    importerActiveFileBg: tokens.primaryLight,
    importerInactiveFileBg: tokens.mediumGrey,

    /* Menu Toggles */
    menuToggleHoverFg: tokens.primaryDark,
    menuToggleActiveFg: tokens.primaryDarker,

    /* Info Button */
    infoButtonFg: "#8F8F8F",
    infoButtonHoverFg: "#707070",
    infoButtonActiveFg: "#5C5C5C",

    /* Button Groups */
    buttonGroupBg: 'transparent',
    buttonGroupBgHover: tokens.hover,
    buttonGroupBorderHover: tokens.hover,

    /* Access Rules */
    accessRulesColumnItemBg: tokens.mediumGreyOpaque,
    accessRulesFormulaEditorBgDisabled: tokens.mediumGreyOpaque,

    /* Cells */
    cellZebraBg: '#F8F8F8',

    /* Charts */
    chartFg: '#444',
    chartLegendBg: '#FFFFFF80',
    chartXAxis: '#444',
    chartYAxis: '#444',

    /* Comments */
    commentsUserNameFg: tokens.darkText,
    commentsPanelTopicBorder: '#ccc',
    commentsPanelResolvedTopicBg: tokens.labelActiveBg,

    /* Date Picker */
    datePickerSelectedFg: tokens.light,
    datePickerSelectedBg: '#286090',
    datePickerSelectedBgHover: '#204d74',
    datePickerTodayBgHover: tokens.primaryDark,
    datePickerRangeStartEndBg: '#777',
    datePickerRangeStartEndBgHover: '#5E5E5E',
    datePickerRangeBg: tokens.mediumGreyOpaque,
    datePickerRangeBgHover: tokens.darkGrey,

    /* Tutorials */
    tutorialsPopupBoxBg: '#F5F5F5',
    tutorialsPopupCodeFg: '#333333',
    tutorialsPopupCodeBg: '#FFFFFF',
    tutorialsPopupCodeBorder: '#E1E4E5',

    /* Ace */
    aceAutocompletePrimaryFg: '#444',
    aceAutocompleteSecondaryFg: '#8f8f8f',
    aceAutocompleteBg: '#FBFBFB',
    aceAutocompleteBorder: 'lightgray',
    aceAutocompleteLink: tokens.primaryLight,
    aceAutocompleteLinkHighlighted: tokens.primaryDark,
    aceAutocompleteActiveLineBg: '#CAD6FA',
    aceAutocompleteLineBorderHover: '#abbffe',
    aceAutocompleteLineBgHover: 'rgba(233,233,253,0.4)',

    /* Color Select */
    colorSelectFg: tokens.dark,
    colorSelectShadow: 'rgba(38,38,51,0.6)',
    colorSelectFontOptionsBorder: tokens.darkGrey,
    colorSelectFontOptionBgHover: tokens.lightGrey,
    colorSelectColorSquareBorder: tokens.darkGrey,

    /* Highlighted Code */
    highlightedCodeBlockBg: tokens.light,
    highlightedCodeBlockBgDisabled: tokens.mediumGreyOpaque,
    highlightedCodeBgDisabled: tokens.mediumGreyOpaque,

    /* Login Page */
    loginPageBackdrop: '#F5F8FA',
    loginPageLine: tokens.lightGrey,
    loginPageGoogleButtonFg: tokens.dark,
    loginPageGoogleButtonBg: tokens.lightGrey,
    loginPageGoogleButtonBgHover: tokens.mediumGrey,

    /* Attachments */
    attachmentsEditorButtonFg: tokens.primaryDark,
    attachmentsEditorButtonHoverFg: tokens.primaryLight,
    attachmentsEditorButtonBg: tokens.light,
    attachmentsEditorButtonHoverBg: tokens.mediumGreyOpaque,
    attachmentsEditorBorder: tokens.mediumGreyOpaque,
    attachmentsCellIconFg: 'white',
    attachmentsCellIconBg: tokens.darkGrey,
    attachmentsCellIconHoverBg: '#929299',

    /* Announcement Popups */
    announcementPopupBg: tokens.selectionOpaque,

    /* Switches */
    switchSliderFg: '#ccc',

    /* Scroll Shadow */
    scrollShadow: 'rgba(217,217,217,0.6)',

    /* Toggle Checkboxes */
    toggleCheckboxFg: '#606060',

    /* Numeric Spinners */
    numericSpinnerFg: '#606060',

    /* Custom Widget Gallery */
    widgetGalleryBorder: tokens.darkGrey,
    widgetGalleryShadow: '#0000001A',
    widgetGallerySecondaryHeaderBg: tokens.slate,
    widgetGallerySecondaryHeaderBgHover: '#7E7E85',

    /* Markdown Cell */
    markdownCellLightBg: tokens.lightGrey,
    markdownCellLightBorder: tokens.mediumGreyOpaque,
    markdownCellMediumBorder: tokens.darkGrey,

    /* App Header */
    appHeaderBg: tokens.light,
    appHeaderBorder: tokens.mediumGreyOpaque,
    appHeaderBorderHover: tokens.slate,

    /* Card Button */
    cardButtonBorder: tokens.darkGrey,
    cardButtonShadow: "#0000001A",
  }
};
