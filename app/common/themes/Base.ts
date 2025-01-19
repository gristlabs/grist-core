import { BaseThemeTokens, tokens } from "app/common/ThemePrefs";

/**
 * Base theme tokens that can be used as a starting point for any theme.
 */
export const Base: BaseThemeTokens = {
  white: '#FFFFFF',
  lightGrey: '#F7F7F7',
  mediumGreyOpaque: '#E8E8E8',
  mediumGrey: 'rgba(217,217,217,0.6)',
  darkGrey: '#D9D9D9',
  slate: '#929299',
  darkText: '#494949',
  dark: '#262633',
  black: '#000000',

  hover: '#bfbfbf',
  backdrop: 'rgba(38,38,51,0.9)',

  error: '#D0021B',
  warningLight: '#F9AE41',
  warningDark: '#dd962c',

  /**
   * The fonts used attempt to default to system fonts as described here:
   *  https://css-tricks.com/snippets/css/system-font-stack/
   */
  fontFamily: `-apple-system,BlinkMacSystemFont,Segoe UI,Liberation Sans,
    Helvetica,Arial,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol`,
  /**
   * This is more monospace and looks better for data that should often align (e.g. to have 00000
   * take similar space to 11111). This is the main font for user data.
   */
  fontFamilyData:
    `Liberation Sans,Helvetica,Arial,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol`,
  xxsmallFontSize: '8px',
  xsmallFontSize: '10px',
  smallFontSize: '11px',
  mediumFontSize: '13px',
  introFontSize:  '14px',
  largeFontSize: '16px',
  xlargeFontSize: '18px',
  xxlargeFontSize: '20px',
  xxxlargeFontSize: '22px',
  controlFontSize: '12px',
  smallControlFontSize: '10px',
  bigControlFontSize: '13px',
  headerControlFontSize: '22px',
  bigControlTextWeight: '500',
  headerControlTextWeight: '600',
  labelTextSize: 'medium',
  labelTextBg: tokens.white,
  labelActiveBg: tokens.lightGrey,
  controlMargin: '2px',
  controlPadding: '3px 5px',
  tightPadding: '1px 2px',
  loosePadding: '5px 15px',

  /* Control colors and borders */
  primaryBg: tokens.primaryLight,
  primaryBgHover: tokens.primaryDark,
  primaryFg: tokens.white,

  controlBg: tokens.white,
  controlFg: tokens.primaryLight,
  controlFgHover: tokens.primaryDark,
  controlBorderColor: tokens.primaryLight,
  controlBorder: `1px solid ${tokens.primaryLight}`,
  controlBorderRadius: '4px',

  logoBg: '#040404',
  logoSize: '22px 22px',
  toastBg: '#040404',

  primaryLightBg: tokens.primaryLight,
  primaryLightFg: tokens.primaryLight,

  /**
   * legacy variables are meant to target theme-agnostic tokens,
   * so that we don't have to override them all in each theme.
   *
   * the tokens here all target theme-agnostic tokens to show the idea,
   * lots of others must be implemented in each theme still.
   */
  legacyVariables: {
    /* Text */
    text: tokens.text,
    lightText: tokens.textLight,
    darkText: tokens.textDark,
    disabledText: tokens.textLight,

    /* Page */
    pageBg: tokens.panelBg,

    /* Page Panels */
    mainPanelBg: tokens.mainBg,
    leftPanelBg: tokens.panelBg,
    rightPanelBg: tokens.panelBg,
    topHeaderBg: tokens.mainBg,
    bottomFooterBg: tokens.mainBg,
    pagePanelsBorder: tokens.borderLighterTransparent,
    pagePanelsBorderResizing: tokens.primaryLightFg,
    sidePanelOpenerFg: tokens.textLight,
    sidePanelOpenerActiveFg: tokens.white,
    sidePanelOpenerActiveBg: tokens.primaryLightFg,

    /* Add New */
    addNewCircleFg: tokens.white,
    addNewCircleSmallFg: tokens.white,
    addNewCircleSmallBg: tokens.primaryLightBg,

    /* Top Bar */
    topBarButtonPrimaryFg: tokens.primaryLightFg,
    topBarButtonSecondaryFg: tokens.textLight,
    topBarButtonDisabledFg: tokens.borderLighter,

    /* Notifications */
    notificationsPanelHeaderBg: tokens.panelBg,
    notificationsPanelBodyBg: tokens.mainBg,
    notificationsPanelBorder: tokens.borderLighter,

    /* Toasts */
    toastText: tokens.white,
    toastMemoText: tokens.textVeryLight,

    /* Tooltips */
    tooltipFg: tokens.white,
    tooltipIcon: tokens.textLight,
    tooltipCloseButtonFg: tokens.white,
    tooltipCloseButtonHoverBg: tokens.white,

    /* Modals */
    modalBg: tokens.mainBg,
    modalBorderDark: tokens.borderLighter,
    modalBorderHover: tokens.textLight,
    modalCloseButtonFg: tokens.textLight,
    modalBackdropCloseButtonFg: tokens.primaryLightFg,

    /* Popups */
    popupBg: tokens.mainBg,
    popupSecondaryBg: tokens.panelBg,
    popupCloseButtonFg: tokens.textLight,

    /* Progress Bars */
    progressBarFg: tokens.primaryLightFg,
    progressBarBg: tokens.borderLighter,

    /* Links */
    link: tokens.primaryLightFg,
    linkHover: tokens.primaryLightFg,

    /* Cell Editor */
    cellEditorPlaceholderFg: tokens.textLight,
    cellEditorBg: tokens.mainBg,

    /* Cursor */
    cursorReadonly: tokens.textLight,

    /* Tables */
    tableHeaderBg: tokens.panelBg,
    tableBodyBg: tokens.mainBg,
    tableBodyBorder: tokens.borderLight,

    /* Cards */
    cardCompactRecordBg: tokens.mainBg,
    cardFormLabel: tokens.textLight,
    cardCompactLabel: tokens.textLight,
    cardBlocksLabel: tokens.textLight,
    cardCompactBorder: tokens.borderLighter,
    cardEditingLayoutBorder: tokens.borderLighter,

    /* Card Lists */
    cardListFormBorder: tokens.borderLight,
    cardListBlocksBorder: tokens.borderLight,

    /* Selection */
    selectionOpaqueFg: tokens.textDark,

    /* Widgets */
    widgetBg: tokens.mainBg,
    widgetBorder: tokens.borderLighter,
    widgetActiveBorder: tokens.primaryLightBg,
    widgetInactiveStripesLight: tokens.panelBg,

    /* Pinned Docs */
    pinnedDocFooterBg: tokens.mainBg,
    pinnedDocBorder: tokens.borderLighterTransparent,
    pinnedDocBorderHover: tokens.textLight,
    pinnedDocEditorBg: tokens.borderLighterTransparent,

    /* Raw Data */
    rawDataTableBorder: tokens.borderLighterTransparent,
    rawDataTableBorderHover: tokens.textLight,

    /* Controls */
    controlFg: tokens.primaryLightFg,
    controlPrimaryFg: tokens.white,
    controlPrimaryBg: tokens.primaryLightBg,
    controlSecondaryFg: tokens.textLight,
    controlSecondaryDisabledFg: tokens.borderLight,
    controlSecondaryHoverFg: tokens.text,
    controlSecondaryHoverBg: tokens.borderLight,

    /* Checkboxes */
    checkboxBg: tokens.mainBg,
    checkboxSelectedFg: tokens.primaryLight,
    checkboxDisabledBg: tokens.borderLighter,
    checkboxBorder: tokens.borderLighter,

    /* Move Docs */
    moveDocsSelectedFg: tokens.white,
    moveDocsSelectedBg: tokens.primaryLightBg,
    moveDocsDisabledFg: tokens.borderLighter,

    /* Filter Bar */
    filterBarButtonSavedFg: tokens.white,
    filterBarButtonSavedHoverBg: tokens.borderLighter,

    /* Icons */
    iconDisabled: tokens.textLight,

    /* Icon Buttons */
    iconButtonFg: tokens.white,
    iconButtonPrimaryBg: tokens.primaryLightFg,
    iconButtonSecondaryBg: tokens.borderLighter,
    iconButtonSecondaryHoverBg: tokens.textLight,

    /* Left Panel */
    activePageFg: tokens.textVeryLight,
    activePageBg: tokens.activeBg,
    pageOptionsFg: tokens.slate,
    pageOptionsHoverFg: tokens.white,
    pageOptionsHoverBg: tokens.borderLighter,
    pageOptionsSelectedHoverBg: tokens.textLight,
    pageInitialsFg: tokens.white,

    /* Right Panel */
    rightPanelTabFg: tokens.textLight,
    rightPanelTabBg: tokens.mainBg,
    rightPanelTabIcon: tokens.textLight,
    rightPanelTabIconHover: tokens.text,
    rightPanelTabBorder: tokens.borderLighterTransparent,
    rightPanelTabHoverBg: tokens.mainBg,
    rightPanelTabHoverFg: tokens.text,
    rightPanelTabSelectedFg: tokens.text,
    rightPanelTabSelectedBg: tokens.panelBg,
    rightPanelSubtabFg: tokens.primaryLightFg,
    rightPanelSubtabSelectedFg: tokens.text,
    rightPanelDisabledOverlay: tokens.panelBg,
    rightPanelToggleButtonEnabledFg: tokens.white,
    rightPanelToggleButtonEnabledBg: tokens.activeBg,
    rightPanelCustomWidgetButtonFg: tokens.text,
    rightPanelCustomWidgetButtonBg: tokens.borderLight,

    /* Document History */
    documentHistorySnapshotFg: tokens.text,
    documentHistorySnapshotSelectedFg: tokens.textVeryLight,
    documentHistorySnapshotBg: tokens.mainBg,
    documentHistorySnapshotSelectedBg: tokens.activeBg,
    documentHistoryActivityText: tokens.text,
    documentHistoryActivityLightText: tokens.textLight,
    documentHistoryTableBorderLight: tokens.borderLight,

    /* Accents */
    accentIcon: tokens.primaryLightFg,
    accentBorder: tokens.primaryLightBg,
    accentText: tokens.primaryLightFg,

    /* Inputs */
    inputBg: tokens.mainBg,
    inputDisabledFg: tokens.textLight,
    inputDisabledBg: tokens.panelBg,
    inputPlaceholderFg: tokens.textLight,
    inputBorder: tokens.borderLighter,
    inputValid: tokens.primaryLightFg,
    inputReadonlyBg: tokens.panelBg,

    /* Choice Tokens */
    choiceTokenFg: tokens.textDark,
    choiceTokenBlankFg: tokens.textLight,
    choiceTokenSelectedBorder: tokens.primaryLightFg,
    choiceTokenInvalidFg: tokens.textDark,

    /* Choice Entry */
    choiceEntryBg: tokens.mainBg,
    choiceEntryBorder: tokens.borderLighter,

    /* Select Buttons */
    selectButtonFg: tokens.text,
    selectButtonPlaceholderFg: tokens.textLight,
    selectButtonBg: tokens.mainBg,
    selectButtonBorder: tokens.borderLighter,

    /* Menus */
    menuText: tokens.textLight,
    menuLightText: tokens.textLight,
    menuBg: tokens.mainBg,
    menuSubheaderFg: tokens.text,

    /* Menu Items */
    menuItemFg: tokens.textDark,
    menuItemSelectedFg: tokens.white,
    menuItemSelectedBg: tokens.primaryLightBg,
    menuItemDisabledFg: tokens.borderLighter,
    menuItemIconFg: tokens.textLight,
    menuItemIconSelectedFg: tokens.white,

    /* Autocomplete */
    autocompleteMatchText: tokens.primaryLightFg,
    autocompleteAddNewCircleFg: tokens.white,
    autocompleteAddNewCircleBg: tokens.primaryLightBg,

    /* Search */
    searchPrevNextButtonFg: tokens.textLight,

    /* Loaders */
    loaderFg: tokens.primaryLightFg,
    loaderBg: tokens.borderLighter,

    /* Site Switcher */
    siteSwitcherActiveFg: tokens.white,

    /* Doc Menu */
    docMenuDocOptionsFg: tokens.borderLighter,
    docMenuDocOptionsHoverFg: tokens.textLight,
    docMenuDocOptionsHoverBg: tokens.borderLighter,

    /* Shortcut Keys */
    shortcutKeyFg: tokens.textDark,
    shortcutKeySecondaryFg: tokens.textLight,
    shortcutKeyBg: tokens.mainBg,
    shortcutKeyBorder: tokens.textLight,

    /* Breadcrumbs */
    breadcrumbsTagFg: tokens.white,
    breadcrumbsTagAlertBg: tokens.error,

    /* Page Widget Picker */
    widgetPickerPrimaryBg: tokens.mainBg,
    widgetPickerSecondaryBg: tokens.panelBg,
    widgetPickerIcon: tokens.textLight,
    widgetPickerPrimaryIcon: tokens.primaryLightFg,

    /* Importer */
    importerTableInfoBorder: tokens.borderLighter,
    importerPreviewBorder: tokens.borderLighter,
    importerMatchIcon: tokens.borderLighter,

    // tabs
    importerActiveFileFg: tokens.white,
    importerInactiveFileFg: tokens.white,

    /* Menu Toggles */
    menuToggleFg: tokens.textLight,
    menuToggleBg: tokens.mainBg,
    menuToggleBorder: tokens.textLight,

    /* Button Groups */
    buttonGroupFg: tokens.text,
    buttonGroupLightFg: tokens.textLight,
    buttonGroupIcon: tokens.textLight,
    buttonGroupBorder: tokens.borderLighter,
    buttonGroupSelectedFg: tokens.textVeryLight,
    buttonGroupLightSelectedFg: tokens.primaryLightFg,
    buttonGroupSelectedBg: tokens.activeBg,
    buttonGroupSelectedBorder: tokens.activeBg,

    /* Access Rules */
    accessRulesTableHeaderFg: tokens.text,
    accessRulesTableHeaderBg: tokens.borderLighterTransparent,
    accessRulesTableBodyFg: tokens.textLight,
    accessRulesTableBodyLightFg: tokens.borderLighter,
    accessRulesTableBorder: tokens.textLight,
    accessRulesColumnListBorder: tokens.borderLighter,
    accessRulesColumnItemFg: tokens.text,
    accessRulesColumnItemIconFg: tokens.textLight,
    accessRulesColumnItemIconHoverFg: tokens.textVeryLight,
    accessRulesColumnItemIconHoverBg: tokens.textLight,
    accessRulesFormulaEditorBg: tokens.mainBg,
    accessRulesFormulaEditorBorderHover: tokens.borderLighter,
    accessRulesFormulaEditorFocus: tokens.primaryLightFg,

    /* Cells */
    cellFg: tokens.textDark,
    cellBg: tokens.mainBg,

    /* Charts */
    chartBg: tokens.mainBg,

    /* Comments */
    commentsPopupHeaderBg: tokens.panelBg,
    commentsPopupBodyBg: tokens.mainBg,
    commentsPopupBorder: tokens.borderLighter,
    commentsPanelTopicBg: tokens.mainBg,

    /* Date Picker */
    datePickerTodayFg: tokens.white,
    datePickerTodayBg: tokens.primaryLightBg,

    /* Tutorials */
    tutorialsPopupBorder: tokens.borderLighter,
    tutorialsPopupHeaderFg: tokens.white,

    /* Ace */
    aceEditorBg: tokens.mainBg,
    aceAutocompleteHighlightedFg: tokens.textDark,

    /* Color Select */
    colorSelectBg: tokens.mainBg,
    colorSelectFontOptionFg: tokens.text,
    colorSelectFontOptionFgSelected: tokens.textVeryLight,
    colorSelectFontOptionBgSelected: tokens.activeBg,
    colorSelectColorSquareBorderEmpty: tokens.text,
    colorSelectInputFg: tokens.textLight,
    colorSelectInputBg: tokens.mainBg,
    colorSelectInputBorder: tokens.borderLighter,

    /* Highlighted Code */
    highlightedCodeFg: tokens.textLight,
    highlightedCodeBorder: tokens.borderLighter,

    /* Login Page */
    loginPageBg: tokens.mainBg,
    loginPageGoogleButtonBorder: tokens.borderLighter,

    /* Formula Assistant */
    formulaAssistantHeaderBg: tokens.panelBg,
    formulaAssistantBorder: tokens.borderLighter,
    formulaAssistantPreformattedTextBg: tokens.panelBg,

    /* Attachments */
    attachmentsEditorButtonBorder: tokens.borderLighter,
    attachmentsEditorButtonIcon: tokens.textLight,

    /* Announcement Popups */
    announcementPopupFg: tokens.textDark,

    /* Switches */
    switchCircleFg: tokens.textVeryLight,

    /* Custom Widget Gallery */
    widgetGalleryBorderSelected: tokens.primaryLightFg,
    widgetGalleryBgHover: tokens.panelBg,
    widgetGallerySecondaryHeaderFg: tokens.white,

    /* Card Button */
    cardButtonBorderSelected: tokens.primaryLightFg,
  }
};


