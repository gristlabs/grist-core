import {ThemeTokens, tokens} from 'app/common/ThemePrefs';
import {GristLight} from 'app/common/themes/GristLight';

/**
 * High Contrast Light theme. Uses the default Grist theme as base.
 */
export const HighContrastLight: ThemeTokens = {
  ...GristLight,

  secondary: '#717178',

  decoration: '#8F8F8F',
  decorationSecondary: '#cfcfcf',
  decorationTertiary: '#dfdfdf',

  primary: '#0f7b51',
  primaryMuted: '#196C47',
  primaryDim: '#196C47',

  components: {
    ...GristLight.components,
    appHeaderBorder: tokens.decoration,
    pagePanelsBorder: tokens.decorationSecondary,
    tooltipBg: '#000',
    controlBorder: '1px solid #0f7b51',
    controlSecondaryHoverBg: tokens.decorationTertiary,
    buttonGroupBgHover: tokens.decorationSecondary,
    tableHeaderBorder: tokens.decoration,
    tableHeaderSelectedBg: tokens.decorationSecondary,
    selectionHeader: tokens.decorationSecondary,
    tableBodyBorder: tokens.decorationSecondary,
    choiceTokenBg: tokens.decorationTertiary,
    cardFormBorder: tokens.decoration,
    accessRulesFormulaEditorBgDisabled: tokens.decorationTertiary,
    rightPanelTabBorder: tokens.decoration,
    rightPanelSubtabSelectedFg: '#000',
    rightPanelSubtabSelectedUnderline: '#000',
    rightPanelSubtabUnderlineSize: '2px',
    formulaIcon: tokens.decoration,
  }
};
