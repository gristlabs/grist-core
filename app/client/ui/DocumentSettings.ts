/**
 * This module export a component for editing some document settings consisting of the timezone,
 * (new settings to be added here ...).
 */
import {GristDoc} from 'app/client/components/GristDoc';
import {ACIndexImpl} from 'app/client/lib/ACIndex';
import {ACSelectItem, buildACSelect} from 'app/client/lib/ACSelect';
import {copyToClipboard} from 'app/client/lib/clipboardUtils';
import {makeT} from 'app/client/lib/localization';
import {reportError} from 'app/client/models/AppModel';
import type {DocPageModel} from 'app/client/models/DocPageModel';
import {urlState} from 'app/client/models/gristUrlState';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {docListHeader} from 'app/client/ui/DocMenuCss';
import {showTransientTooltip} from 'app/client/ui/tooltips';
import {primaryButtonLink} from 'app/client/ui2018/buttons';
import {mediaSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {select} from 'app/client/ui2018/menus';
import {confirmModal} from 'app/client/ui2018/modals';
import {buildCurrencyPicker} from 'app/client/widgets/CurrencyPicker';
import {buildTZAutocomplete} from 'app/client/widgets/TZAutocomplete';
import {EngineCode} from 'app/common/DocumentSettings';
import {GristLoadConfig} from 'app/common/gristUrls';
import {propertyCompare} from 'app/common/gutil';
import {getCurrency, locales} from 'app/common/Locales';
import {Computed, Disposable, dom, fromKo, IDisposableOwner, styled} from 'grainjs';
import * as moment from 'moment-timezone';

const t = makeT('DocumentSettings');

export class DocSettingsPage extends Disposable {
  private _docInfo = this._gristDoc.docInfo;

  private _timezone = this._docInfo.timezone;
  private _locale: KoSaveableObservable<string> = this._docInfo.documentSettingsJson.prop('locale');
  private _currency: KoSaveableObservable<string|undefined> = this._docInfo.documentSettingsJson.prop('currency');
  private _engine: Computed<EngineCode|undefined> = Computed.create(this, (
    use => use(this._docInfo.documentSettingsJson.prop('engine'))
  ))
    .onWrite(val => this._setEngine(val));

  constructor(private _gristDoc: GristDoc) {
    super();
  }

  public buildDom() {
    const canChangeEngine = getSupportedEngineChoices().length > 0;
    const docPageModel = this._gristDoc.docPageModel;

    return cssContainer(
      cssHeader(t('Document Settings')),
      cssDataRow(t("Time Zone:")),
      cssDataRow(
        dom.create(buildTZAutocomplete, moment, fromKo(this._timezone), (val) => this._timezone.saveOnly(val))
      ),
      cssDataRow(t("Locale:")),
      cssDataRow(dom.create(buildLocaleSelect, this._locale)),
      cssDataRow(t("Currency:")),
      cssDataRow(dom.domComputed(fromKo(this._locale), (l) =>
        dom.create(buildCurrencyPicker, fromKo(this._currency), (val) => this._currency.saveOnly(val),
          {defaultCurrencyLabel: t("Local currency ({{currency}})", {currency: getCurrency(l)})})
      )),
      canChangeEngine ? cssDataRow([
        // Small easter egg: you can click on the skull-and-crossbones to
        // force a reload of the document.
        cssDataRow(t("Engine (experimental {{span}} change at own risk):", {span:
          dom('span', '☠',
            dom.style('cursor', 'pointer'),
            dom.on('click', async () => {
              await docPageModel.appModel.api.getDocAPI(docPageModel.currentDocId.get()!).forceReload();
              document.location.reload();
            }))
          })),
        select(this._engine, getSupportedEngineChoices()),
      ]) : null,
      cssHeader(t('API')),
      cssDataRow(t("This document's ID (for API use):")),
      cssDataRow(cssHoverWrapper(
        dom('tt', docPageModel.currentDocId.get()),
        dom.on('click', async (e, d) => {
          e.stopImmediatePropagation();
          e.preventDefault();
          showTransientTooltip(d, t("Document ID copied to clipboard"), {
            key: 'copy-document-id'
          });
          await copyToClipboard(docPageModel.currentDocId.get()!);
        }),
      )),
      cssDataRow(primaryButtonLink(t('API Console'), {
        target: '_blank',
        href: getApiConsoleLink(docPageModel),
      })),
      cssHeader(t('Webhooks'), cssBeta('Beta')),
      cssDataRow(primaryButtonLink(t('Manage Webhooks'), urlState().setLinkUrl({docPage: 'webhook'}))),
    );
  }

  private async _setEngine(val: EngineCode|undefined) {
    confirmModal(t('Save and Reload'), t('Ok'), () => this._doSetEngine(val));
  }

  private async _doSetEngine(val: EngineCode|undefined) {
    const docPageModel = this._gristDoc.docPageModel;
    if (this._engine.get() !== val) {
      await this._docInfo.documentSettingsJson.prop('engine').saveOnly(val);
      await docPageModel.appModel.api.getDocAPI(docPageModel.currentDocId.get()!).forceReload();
    }
  }
}

function getApiConsoleLink(docPageModel: DocPageModel) {
  const url = new URL(location.href);
  url.pathname = '/apiconsole';
  url.searchParams.set('docId', docPageModel.currentDocId.get()!);
  // Some extra question marks to placate a test fixture at test/fixtures/projects/DocumentSettings.ts
  url.searchParams.set('workspaceId', String(docPageModel.currentWorkspace?.get()?.id || ''));
  url.searchParams.set('orgId', String(docPageModel.appModel?.topAppModel.currentSubdomain.get()));
  return url.href;
}

type LocaleItem = ACSelectItem & {locale?: string};

function buildLocaleSelect(
  owner: IDisposableOwner,
  locale: KoSaveableObservable<string>,
) {
  const localeList: LocaleItem[] = locales.map(l => ({
    value: l.name, // Use name as a value, we will translate the name into the locale on save
    label: l.name,
    locale: l.code,
    cleanText: l.name.trim().toLowerCase(),
  })).sort(propertyCompare("label"));
  const acIndex = new ACIndexImpl<LocaleItem>(localeList, {maxResults: 200, keepOrder: true});
  // AC select will show the value (in this case locale) not a label when something is selected.
  // To show the label - create another observable that will be in sync with the value, but
  // will contain text.
  const textObs = Computed.create(owner, use => {
    const localeCode = use(locale);
    const localeName = locales.find(l => l.code === localeCode)?.name || localeCode;
    return localeName;
  });
  return buildACSelect(owner,
    {
      acIndex, valueObs: textObs,
      save(_value, item: LocaleItem | undefined) {
        if (!item) { throw new Error("Invalid locale"); }
        locale.saveOnly(item.locale!).catch(reportError);
      },
    },
    testId("locale-autocomplete")
  );
}

const cssHeader = styled(docListHeader, `
  margin-bottom: 0;
  &:not(:first-of-type) {
    margin-top: 40px;
  }
`);

const cssContainer = styled('div', `
  overflow-y: auto;
  position: relative;
  height: 100%;
  padding: 32px 64px 24px 64px;
  @media ${mediaSmall} {
    & {
      padding: 32px 24px 24px 24px;
    }
  }
`);

const cssHoverWrapper = styled('div', `
  display: inline-block;
  cursor: default;
  color: ${theme.lightText};
  transition: background 0.05s;
  &:hover {
    background: ${theme.lightHover};
  }
`);

// This matches the style used in showProfileModal in app/client/ui/AccountWidget.
const cssDataRow = styled('div', `
  margin: 16px 0px;
  font-size: ${vars.largeFontSize};
  color: ${theme.text};
  width: 360px;
`);

const cssBeta = styled('sup', `
  text-transform: uppercase;
  color: ${theme.text};
  font-size: ${vars.smallFontSize};
  margin-left: 8px;
`);

// Check which engines can be selected in the UI, if any.
export function getSupportedEngineChoices(): EngineCode[] {
  const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
  return gristConfig.supportEngines || [];
}
