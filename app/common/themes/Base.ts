import { BaseThemeTokens, components, tokens } from "app/common/ThemePrefs";

/**
 * Base theme tokens that can be used as a starting point for any theme.
 */
export const Base: BaseThemeTokens = {
  /* Direct colors tokens.
   *
   * While these can be fine-tuned in each theme, they are not meant to be _drastically_ changed.
   * Components that are the same color no matter the theme can directly target these tokens.
   *
   * More "semantic" colors tokens, like "primary" or "secondary" colors,
   * are not listed in the Base theme and are defined in each specific theme.
   */
  white: '#ffffff',
  black: '#000000',

  error: '#d0021b',
  errorLight: '#ff6666',

  warning: '#dd962c',
  warningLight: '#f9ae41',

  info: '#3b82f6',
  infoLight: '#87b2f9',

  logoBg: '#040404',
  logoSize: '22px 22px',

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

  bigControlFontSize: '13px',
  headerControlFontSize: '22px',

  bigControlTextWeight: '500',
  headerControlTextWeight: '600',

  /**
   * Component-specific tokens.
   *
   * Those listed in this base theme should not need any override
   * in either light or dark theme so that everything renders correctly:
   * they already target theme-aware tokens.
   *
   * Lots of other variables must be defined in each specific theme
   * though, as work to make them target theme-aware tokens has not been done yet.
   */
  components: {
    /* Text */
    text: tokens.body,
    lightText: tokens.secondary,
    darkText: tokens.emphasis,
    disabledText: tokens.secondary,
    dangerText: '#ffa500',

    /* Page */
    pageBg: tokens.bgSecondary,

    /* Page Panels */
    mainPanelBg: tokens.bg,
    leftPanelBg: tokens.bgSecondary,
    rightPanelBg: tokens.bgSecondary,
    topHeaderBg: tokens.bg,
    bottomFooterBg: tokens.bg,
    pagePanelsBorder: tokens.bgTertiary,
    pagePanelsBorderResizing: tokens.primary,
    sidePanelOpenerFg: tokens.secondary,
    sidePanelOpenerActiveFg: tokens.white,
    sidePanelOpenerActiveBg: tokens.primary,

    /* Add New */
    addNewCircleFg: tokens.white,
    addNewCircleBg: tokens.primaryMuted,
    addNewCircleHoverBg: tokens.primaryDim,
    addNewCircleSmallFg: tokens.white,
    addNewCircleSmallBg: tokens.primary,
    addNewCircleSmallHoverBg: tokens.primaryMuted,

    /* Top Bar */
    topBarButtonPrimaryFg: tokens.primary,
    topBarButtonSecondaryFg: tokens.secondary,
    topBarButtonDisabledFg: tokens.decoration,

    /* Notifications */
    notificationsPanelHeaderBg: tokens.bgSecondary,
    notificationsPanelBodyBg: tokens.bg,
    notificationsPanelBorder: tokens.decoration,

    /* Toasts */
    toastBg: '#040404',
    toastLightText: tokens.secondary,
    toastText: tokens.white,
    toastMemoText: tokens.veryLight,
    toastErrorIcon: tokens.error,
    toastErrorBg: tokens.error,
    toastSuccessIcon: tokens.primaryMuted,
    toastSuccessBg: tokens.primaryMuted,
    toastWarningIcon: tokens.warningLight,
    toastWarningBg: tokens.warning,
    toastInfoIcon: tokens.info,
    toastInfoBg: tokens.info,
    toastInfoControlFg: tokens.infoLight,
    toastControlFg: tokens.primary,

    /* Tooltips */
    tooltipBg: 'rgba(0, 0, 0, 0.75)',
    tooltipCloseButtonHoverFg: tokens.black,
    tooltipFg: tokens.white,
    tooltipIcon: tokens.secondary,
    tooltipCloseButtonFg: tokens.white,
    tooltipCloseButtonHoverBg: tokens.white,

    /* Modals */
    modalBackdrop: tokens.backdrop,
    modalBg: tokens.bg,
    modalBorder: tokens.decorationSecondary,
    modalBorderDark: tokens.decoration,
    modalBorderHover: tokens.secondary,
    modalCloseButtonFg: tokens.secondary,
    modalBackdropCloseButtonFg: tokens.primary,
    modalBackdropCloseButtonHoverFg: tokens.primaryEmphasis,

    /* Popups */
    popupBg: tokens.bg,
    popupSecondaryBg: tokens.bgSecondary,
    popupCloseButtonFg: tokens.secondary,

    /* Progress Bars */
    progressBarFg: tokens.primary,
    progressBarBg: tokens.decoration,

    /* Hover */
    hover: tokens.bgTertiary,

    /* Links */
    link: tokens.primary,
    linkHover: tokens.primary,

    /* Cell Editor */
    cellEditorPlaceholderFg: tokens.secondary,
    cellEditorBg: tokens.bg,

    /* Cursor */
    cursor: tokens.cursor,
    cursorInactive: tokens.cursorInactive,
    cursorReadonly: tokens.secondary,

    /* Tables */
    tableHeaderFg: tokens.emphasis,
    tableHeaderSelectedFg: tokens.emphasis,
    tableHeaderBg: tokens.bgSecondary,
    tableBodyBg: tokens.bg,
    tableBodyBorder: tokens.decoration,
    tableCellSummaryBg: tokens.bgTertiary,

    /* Cards */
    cardCompactRecordBg: tokens.bg,
    cardFormLabel: tokens.secondary,
    cardCompactLabel: tokens.secondary,
    cardBlocksLabel: tokens.secondary,
    cardCompactBorder: tokens.decoration,
    cardEditingLayoutBorder: tokens.decoration,

    /* Card Lists */
    cardListFormBorder: tokens.decoration,
    cardListBlocksBorder: tokens.decoration,

    /* Selection */
    selectionOpaqueFg: tokens.emphasis,

    /* Widgets */
    widgetBg: tokens.bg,
    widgetBorder: tokens.decoration,
    widgetActiveBorder: tokens.primary,
    widgetActiveNonFocusedBorder: tokens.primaryTranslucent,
    widgetInactiveStripesLight: tokens.bgSecondary,

    /* Pinned Docs */
    pinnedDocFooterBg: tokens.bg,
    pinnedDocBorder: tokens.bgTertiary,
    pinnedDocBorderHover: tokens.secondary,
    pinnedDocEditorBg: tokens.bgTertiary,

    /* Raw Data */
    rawDataTableBorder: tokens.bgTertiary,
    rawDataTableBorderHover: tokens.secondary,

    /* Controls */
    controlFg: tokens.primary,
    controlPrimaryFg: tokens.white,
    controlPrimaryBg: tokens.primary,
    controlPrimaryHoverBg: tokens.primaryMuted,
    controlSecondaryFg: tokens.secondary,
    controlSecondaryDisabledFg: tokens.decoration,
    controlSecondaryHoverFg: tokens.body,
    controlSecondaryHoverBg: tokens.decoration,

    /* Checkboxes */
    checkboxBg: tokens.bg,
    checkboxSelectedFg: tokens.primary,
    checkboxDisabledBg: tokens.decoration,
    checkboxBorder: tokens.decoration,

    /* Move Docs */
    moveDocsSelectedFg: tokens.white,
    moveDocsSelectedBg: tokens.primary,
    moveDocsDisabledFg: tokens.decoration,

    /* Filter Bar */
    filterBarButtonSavedFg: tokens.white,
    filterBarButtonSavedHoverBg: tokens.decoration,

    /* Icons */
    iconDisabled: tokens.secondary,

    /* Icon Buttons */
    iconButtonFg: tokens.white,
    iconButtonPrimaryBg: tokens.primary,
    iconButtonSecondaryBg: tokens.decoration,
    iconButtonSecondaryHoverBg: tokens.secondary,

    /* Left Panel */
    activePageFg: tokens.veryLight,
    activePageBg: tokens.bgEmphasis,
    pageOptionsFg: tokens.secondary,
    pageOptionsHoverFg: tokens.white,
    pageOptionsHoverBg: tokens.decoration,
    pageOptionsSelectedHoverBg: tokens.secondary,
    pageInitialsFg: tokens.white,

    /* Right Panel */
    rightPanelTabFg: tokens.secondary,
    rightPanelTabBg: tokens.bg,
    rightPanelTabIcon: tokens.secondary,
    rightPanelTabIconHover: tokens.body,
    rightPanelTabBorder: tokens.bgTertiary,
    rightPanelTabHoverBg: tokens.bg,
    rightPanelTabHoverFg: tokens.body,
    rightPanelTabSelectedFg: tokens.body,
    rightPanelTabSelectedBg: tokens.bgSecondary,
    rightPanelTabSelectedIcon: tokens.primary,
    rightPanelSubtabFg: tokens.secondary,
    rightPanelSubtabHoverFg: tokens.body,
    rightPanelSubtabSelectedFg: tokens.body,
    rightPanelSubtabSelectedUnderline: tokens.primary,
    rightPanelDisabledOverlay: tokens.bgSecondary,
    rightPanelToggleButtonEnabledFg: tokens.white,
    rightPanelToggleButtonEnabledBg: tokens.bgEmphasis,
    rightPanelCustomWidgetButtonFg: tokens.body,
    rightPanelCustomWidgetButtonBg: tokens.decoration,

    /* Document History */
    documentHistorySnapshotFg: tokens.body,
    documentHistorySnapshotSelectedFg: tokens.veryLight,
    documentHistorySnapshotBg: tokens.bg,
    documentHistorySnapshotSelectedBg: tokens.bgEmphasis,
    documentHistoryActivityText: tokens.body,
    documentHistoryActivityLightText: tokens.secondary,
    documentHistoryTableHeaderFg: tokens.emphasis,
    documentHistoryTableBorderLight: tokens.decoration,

    /* Accents */
    accentIcon: tokens.primary,
    accentBorder: tokens.primary,
    accentText: tokens.primary,

    /* Inputs */
    inputFg: tokens.emphasis,
    inputBg: tokens.bg,
    inputDisabledFg: tokens.secondary,
    inputDisabledBg: tokens.bgSecondary,
    inputPlaceholderFg: tokens.secondary,
    inputBorder: tokens.decoration,
    inputValid: tokens.primary,
    inputFocus: '#5e9ed6',
    inputReadonlyBg: tokens.bgSecondary,

    /* Choice Tokens */
    choiceTokenFg: tokens.emphasis,
    choiceTokenBlankFg: tokens.secondary,
    choiceTokenSelectedBorder: tokens.primary,
    choiceTokenInvalidFg: tokens.emphasis,
    choiceTokenInvalidBorder: tokens.error,

    /* Choice Entry */
    choiceEntryBg: tokens.bg,
    choiceEntryBorder: tokens.decoration,

    /* Select Buttons */
    selectButtonFg: tokens.body,
    selectButtonPlaceholderFg: tokens.secondary,
    selectButtonBg: tokens.bg,
    selectButtonBorder: tokens.decoration,

    /* Menus */
    menuText: tokens.secondary,
    menuLightText: tokens.secondary,
    menuBg: tokens.bg,
    menuSubheaderFg: tokens.body,

    /* Menu Items */
    menuItemFg: tokens.emphasis,
    menuItemSelectedFg: tokens.white,
    menuItemSelectedBg: tokens.primary,
    menuItemDisabledFg: tokens.decoration,
    menuItemIconFg: tokens.secondary,
    menuItemIconSelectedFg: tokens.white,

    /* Autocomplete */
    autocompleteMatchText: tokens.primary,
    autocompleteAddNewCircleFg: tokens.white,
    autocompleteAddNewCircleBg: tokens.primary,
    autocompleteAddNewCircleSelectedBg: tokens.primaryMuted,
    autocompleteSelectedMatchText: tokens.primaryEmphasis,

    /* Search */
    searchPrevNextButtonFg: tokens.secondary,

    /* Loaders */
    loaderFg: tokens.primary,
    loaderBg: tokens.decoration,

    /* Site Switcher */
    siteSwitcherActiveFg: tokens.white,

    /* Doc Menu */
    docMenuDocOptionsFg: tokens.decoration,
    docMenuDocOptionsHoverFg: tokens.secondary,
    docMenuDocOptionsHoverBg: tokens.decoration,

    /* Shortcut Keys */
    shortcutKeyFg: tokens.emphasis,
    shortcutKeySecondaryFg: tokens.secondary,
    shortcutKeyBg: tokens.bg,
    shortcutKeyBorder: tokens.secondary,

    /* Breadcrumbs */
    breadcrumbsTagFg: tokens.white,
    breadcrumbsTagAlertBg: tokens.error,

    /* Page Widget Picker */
    widgetPickerItemSelectedBg: tokens.bgTertiary,
    widgetPickerItemDisabledBg: tokens.bgTertiary,
    widgetPickerPrimaryBg: tokens.bg,
    widgetPickerSecondaryBg: tokens.bgSecondary,
    widgetPickerIcon: tokens.secondary,
    widgetPickerPrimaryIcon: tokens.primary,
    widgetPickerBorder: tokens.bgTertiary,

    /* Importer */
    importerActiveFileBg: tokens.primary,
    importerTableInfoBorder: tokens.decoration,
    importerPreviewBorder: tokens.decoration,
    importerMatchIcon: tokens.decoration,
    importerSkippedTableOverlay: tokens.bgTertiary,

    // tabs
    importerActiveFileFg: tokens.white,
    importerInactiveFileFg: tokens.white,

    /* Menu Toggles */
    menuToggleFg: tokens.secondary,
    menuToggleBg: tokens.bg,
    menuToggleBorder: tokens.secondary,

    /* Info Button */
    infoButtonFg: '#8f8f8f',
    infoButtonHoverFg: '#707070',
    infoButtonActiveFg: '#5c5c5c',

    /* Button Groups */
    buttonGroupBg: 'transparent',
    buttonGroupFg: tokens.body,
    buttonGroupLightFg: tokens.secondary,
    buttonGroupIcon: tokens.secondary,
    buttonGroupBorder: tokens.decoration,
    buttonGroupSelectedFg: tokens.veryLight,
    buttonGroupLightSelectedFg: tokens.primary,
    buttonGroupSelectedBg: tokens.bgEmphasis,
    buttonGroupSelectedBorder: tokens.bgEmphasis,

    /* Access Rules */
    accessRulesTableHeaderFg: tokens.body,
    accessRulesTableHeaderBg: tokens.bgTertiary,
    accessRulesTableBodyFg: tokens.secondary,
    accessRulesTableBodyLightFg: tokens.decoration,
    accessRulesTableBorder: tokens.secondary,
    accessRulesColumnListBorder: tokens.decoration,
    accessRulesColumnItemFg: tokens.body,
    accessRulesColumnItemIconFg: tokens.secondary,
    accessRulesColumnItemIconHoverFg: tokens.veryLight,
    accessRulesColumnItemIconHoverBg: tokens.secondary,
    accessRulesColumnItemBg: tokens.decorationSecondary,
    accessRulesFormulaEditorBg: tokens.bg,
    accessRulesFormulaEditorBgDisabled: tokens.decorationSecondary,
    accessRulesFormulaEditorBorderHover: tokens.decoration,
    accessRulesFormulaEditorFocus: tokens.primary,

    /* Cells */
    cellFg: tokens.emphasis,
    cellBg: tokens.bg,

    /* Charts */
    chartBg: tokens.bg,

    /* Comments */
    commentsPopupHeaderBg: tokens.bgSecondary,
    commentsPopupBodyBg: tokens.bg,
    commentsPopupBorder: tokens.decoration,
    commentsPanelTopicBg: tokens.bg,

    /* Date Picker */
    datePickerTodayFg: tokens.white,
    datePickerTodayBg: tokens.primary,
    datePickerTodayBgHover: tokens.primaryMuted,

    /* Tutorials */
    tutorialsPopupBorder: tokens.decoration,
    tutorialsPopupHeaderFg: tokens.white,

    /* Ace */
    aceAutocompleteLink: tokens.primary,
    aceEditorBg: tokens.bg,
    aceAutocompleteHighlightedFg: tokens.emphasis,

    /* Color Select */
    colorSelectBg: tokens.bg,
    colorSelectFontOptionFg: tokens.body,
    colorSelectFontOptionFgSelected: tokens.veryLight,
    colorSelectFontOptionBgSelected: tokens.bgEmphasis,
    colorSelectColorSquareBorderEmpty: tokens.body,
    colorSelectInputFg: tokens.secondary,
    colorSelectInputBg: tokens.bg,
    colorSelectInputBorder: tokens.decoration,

    /* Highlighted Code */
    highlightedCodeFg: tokens.secondary,
    highlightedCodeBorder: tokens.decoration,

    /* Login Page */
    loginPageBg: tokens.bg,
    loginPageGoogleButtonBorder: tokens.decoration,

    /* Formula Assistant */
    formulaAssistantHeaderBg: tokens.bgSecondary,
    formulaAssistantBorder: tokens.decoration,
    formulaAssistantPreformattedTextBg: tokens.bgSecondary,

    /* Attachments */
    attachmentsEditorButtonHoverFg: tokens.primary,
    attachmentsEditorButtonBorder: tokens.decoration,
    attachmentsEditorButtonIcon: tokens.secondary,

    /* Announcement Popups */
    announcementPopupFg: tokens.emphasis,

    /* Switches */
    switchInactiveSlider: tokens.bgSecondary,
    switchInactivePill: tokens.secondary,
    switchActiveSlider: tokens.primaryMuted,
    switchActivePill: tokens.bg,
    switchHoverShadow: components.switchActiveSlider,

    /* Custom Widget Gallery */
    widgetGalleryBorderSelected: tokens.primary,
    widgetGalleryBgHover: tokens.bgSecondary,
    widgetGallerySecondaryHeaderFg: tokens.white,

    /* App Header */
    appHeaderBg: tokens.bg,

    /* Card Button */
    cardButtonBorderSelected: tokens.primary,
    cardButtonShadow: 'rgba(0,0,0,0.1)',

    formulaIcon: '#D0D0D0',

    /* Text Button */
    textButtonHoverBg: 'transparent',
    textButtonHoverBorder: 'transparent',

    /* Keyboard Focus Highlighter */
    kbFocusHighlight: tokens.primary,

    /* Active User List */
    userListRemainingUsersBg: tokens.primary,
  }
};
