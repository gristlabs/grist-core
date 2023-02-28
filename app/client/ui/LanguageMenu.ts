import {detectCurrentLang, makeT, setAnonymousLocale} from 'app/client/lib/localization';
import {AppModel} from 'app/client/models/AppModel';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {cssHoverCircle} from 'app/client/ui/TopBarCss';
import {theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuItem} from 'app/client/ui2018/menus';
import {getCountryCode} from 'app/common/Locales';
import {getGristConfig} from 'app/common/urlUtils';
import {dom, makeTestId, styled} from 'grainjs';

const testId = makeTestId('test-language-');
const t = makeT('LanguageMenu');

export function buildLanguageMenu(appModel: AppModel) {
  // Get the list of languages from the config, or default to English.
  const languages = getGristConfig().supportedLngs ?? ['en'];
  // Get the current language (from user's preference, cookie or browser)
  const userLanguage = detectCurrentLang();

  if (appModel.currentValidUser) {
    // For logged in users, we don't need to show the menu (they have a preference in their profile).
    // But for tests we will show a hidden indicator.
    return dom('input', {type: 'hidden'}, (testId(`current-` + userLanguage)));
  }

  // When we switch language, we need to reload the page to get the new translations.
  // This button is only for anonymous users, so we don't need to save the preference or wait for anything.
  const changeLanguage = (lng: string) => {
    setAnonymousLocale(lng);
    window.location.reload();
  };
  const flagIcon = buildFlagIcon(userLanguage);
  return cssFlagButton(
    // Flag or emoji flag if we have it.
    cssFlagIconWrapper(flagIcon),
    // Expose for test the current language use.
    testId(`current-` + userLanguage),
    menu(
      // Convert the list of languages we support to menu items.
      () => languages.map((lng) => menuItem(() => changeLanguage(lng), [
        // Try to convert the locale to nice name, fallback to locale itself.
        cssFirstUpper(translateLocale(lng) ?? lng),
        // If this is current language, mark it with a tick (by default we mark en).
        userLanguage === lng ? cssWrapper(icon('Tick'), testId('selected')) : null,
        testId(`lang-` + lng),
      ])),
      {
        placement: 'bottom-end',
      }
    ),
    hoverTooltip(t('Language'), {key: 'topBarBtnTooltip'}),
    testId('button'),
  );
}

function buildFlagIcon(locale: string) {
  const countryCode = getCountryCode(locale);
  return [
    // Try to show an icon of the country's flag. (The icon may not exist.)
    !countryCode ? null : cssFlagIcon({
      // Unfortunately, Windows doesn't support emoji flags, so we need to use SVG icons.
      style: `background-image: url("icons/locales/${countryCode}.svg");`,
    }, testId('button-icon')),
    // Display a placeholder icon behind the one above, to act as a fallback.
    cssPlaceholderFlagIcon('Flag'),
  ];
}

export function translateLocale(locale: string) {
  try {
    locale = locale.replace("_", "-");
    // This API might not be available in all browsers.
    const languageNames = new Intl.DisplayNames([locale], {type: 'language'});
    return languageNames.of(locale) || null;
  } catch (err) {
    return null;
  }
}

const cssWrapper = styled('div', `
  margin-left: auto;
  display: inline-block;
`);

const cssFirstUpper = styled('span', `
  &::first-letter {
    text-transform: capitalize;
  }
`);

const cssFlagButton = styled(cssHoverCircle, `
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 5px;
  cursor: pointer;
`);

const cssFlagIconWrapper = styled('div', `
  position: relative;
  width: 16px;
  height: 16px;
`);

const cssFlagIcon = styled('div', `
  position: absolute;
  width: 16px;
  height: 16px;
  background-repeat: no-repeat;
  background-position: center;
  background-color: transparent;
  background-size: contain;
  z-index: 1;
`);

const cssPlaceholderFlagIcon = styled(icon, `
  position: absolute;
  --icon-color: ${theme.topBarButtonPrimaryFg};
`);
