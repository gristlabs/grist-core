# Internationalization and Localization

## General description

Localization support (translations) in Grist is implemented via
[https://www.i18next.com](https://www.i18next.com/overview/plugins-and-utils) javascript library. It
is used both on the server (node) and the client side (browser). It has very good documentation,
supports all needed features (like interpolation, pluralization and context), and has a rich plugin
ecosystem. It is also very popular and widely used.

## Localization setup

Resource files are located in a `static/locales` directory, but Grist can be configured to read them
from any other location by using the `GRIST_LOCALES_DIR` environmental variable. All resource files
are read when the server starts. The default and required language code is `en` (English), all other
languages are optional and will be supported if server can find a resource file with proper language
code. Languages are resolved hierarchically, from most specific to a general one, for example, for
Polish code _pl-PL_, the library will first try _pl-PL_, then _pl_, and then will fallback to a
default language _en_ (https://www.i18next.com/principles/translation-resolution).

All language variants (e.g., _fr-FR_, _pl-PL_, _en-UK_) are supported if Grist can find a main
language resource file. For example, to support a _fr-FR_ language code, Grist expects to have at
least _fr.client.json_ file. The main language file will be used as a default fallback for all French
language codes like _fr-FR_ or _fr-CA_, in case there is no resource file for a specif variant (like
`fr-CA.client.json`) or some keys are missing from the variant file.

Here is an example of a language resource file `en.client.json` currently used by Grist:

```json
{
  "AddNewButton": {
    "AddNew": "Add New"
  },
  "DocMenu": {
    "OtherSites": "Other Sites",
    "OtherSitesWelcome": "You are on the {{siteName}} site. You also have access to the following sites:",
    "OtherSitesWelcome_personal": "You are on your personal site. You also have access to the following sites:",
    "AllDocuments": "All Documents",
    "ExamplesAndTemplates": "Examples and Templates",
    "MoreExamplesAndTemplates": "More Examples and Templates"
  },
  "HomeIntro": {
    "Welcome": "Welcome to Grist!",
    "SignUp": "Sign up"
  }
}
```

It maps a key to a translated message. It also has an example of interpolation and context features
in the `DocMenu.OtherSitesWelcome` resource key. More information about how to use those features can be
found at https://www.i18next.com/translation-function/interpolation and
https://www.i18next.com/translation-function/context.

Client and server code (node.js) use separate resource files. A resource file name format
follows a pattern: [language code].[product].json (e.g. `pl-Pl.client.json`, `en-US.client.json`,
`en.client.json`). Grist can be packaged as several different products, and each product can have its
own translation files that are added to the core. Products are supported by leveraging `i18next`
feature called `namespaces` https://www.i18next.com/principles/namespaces.

For now we use only two products called `client` and `server`.
Each of them is then organized by filename, in order to avoid conflicts.

## Translation instruction

### Client

The entry point for all translations is a function exported from 'app/client/lib/localization'.

```ts
import {t} from 'app/client/lib/localization';
```

It is a wrapper around `i18next` exported method with the same interface
https://www.i18next.com/overview/api#t. As a future improvement, all resource keys used in
translation files will be extracted and converted to a TypeScript definition file, for a “compile”
time error detection and and better development experience. Here are couple examples how this method
is used:

_app/client/ui.DocMenu.ts_

```ts
  css.otherSitesHeader(
    t('DocMenu.OtherSites'),
    .....
  ),
  dom.maybe((use) => !use(hideOtherSitesObs), () => {
    const personal = Boolean(home.app.currentOrg?.owner);
    const siteName = home.app.currentOrgName;
    return [
      dom('div',
        t('DocMenu.OtherSitesWelcome', { siteName, context: personal ? 'personal' : '' }),
        testId('other-sites-message')
```

_app/client/ui/HomeIntro.ts_

```ts
function makeAnonIntro(homeModel: HomeModel) {
  const signUp = cssLink({href: getLoginOrSignupUrl()}, t('HomeIntro.SignUp'));
  return [
    css.docListHeader(t('HomeIntro.Welcome'), testId('welcome-title')),
```


Function `t` on the client side is also able to use `DomContents` values (so material produced by
the GrainJS library) for interpolation. For example:

```ts
dom('span', t('Argument', {
  arg1: dom('span', 'First'),
  arg2: dom.domComputed(obs, (value) => dom('span', value))
}));
```

Some things are not supported at this moment and will need to be addressed in future development
tasks:

- Date time picker component. It has its own resource files that are already imported by Grist but
  not used in the main application. https://bootstrap-datepicker.readthedocs.io/en/latest/i18n.html
- Static HTML files used as a placeholder (for example, for Custom widgets).
- Formatting dates. Grist is using `moment.js` library, which has its own i18n support. Date formats
  used by Grist are shared between client, server and sandbox code and are not compatible with
  `i18next` library.

### Server

For server-side code, Grist is using https://github.com/i18next/i18next-http-middleware plugin,
which exposes `i18next` API in the `Request` object. It automatically detects user language (from
request headers) and configures all API methods to use the proper language (either requested by the
client or a default one). `Comm` object and `webSocket` API use a very similar approach, each
`Client` object has its own instance of `i18next` library configured with a proper language (also
detected from the HTTP headers).

Naturally, most of the text that should be translated on the server side is used by the Error
handlers. This requires a significant amount of work to change how errors are reported to the
client, and it is still in a design state.

Here is an example of how to use the API to translate a message from an HTTP endpoint in
`HomeServer`.

_app/server/lib/sendAppPage.ts_

```ts
function getPageTitle(req: express.Request, config: GristLoadConfig): string {
  const maybeDoc = getDocFromConfig(config);
  if (!maybeDoc) {
    return req.t('sendAppPage.Loading') + '...';
  }

  return handlebars.Utils.escapeExpression(maybeDoc.name);
}
```

### Next steps

- Annotate all client code and create all resource files in `en.client.json` and `en.server.json` files.
  Almost all static text is ready for translation.
- Store language settings with the user profile and allow a user to change it on the Account Page.
  Consider also adding a cookie-based solution that custom widgets can use, or extend the
  **WidgetFrame** component so that it can pass current user language to the hosted widget page.
- Generate type declaration files at build time to provide `missing key` error detection as soon as
  possible.
- Dynamically Include calendar control language resource files based on the currently selected
  language.
- Refactor server-side code that is handling errors or creating user-facing messages. Currently,
  error messages are created at the place where the Error has occurred. Preferably errors should
  include error codes and all information needed to assemble the error message by the client code.
- Add localization support to the `moment.js` library to format dates properly according to the
  currently selected language.
- Add support for custom HTML page translation. For example `custom-widget.html`
