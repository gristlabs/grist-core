/**
 * This module export a component for editing some document settings consisting of the timezone,
 * (new settings to be added here ...).
 */
import {cssPrimarySmallLink, cssSmallButton, cssSmallLinkButton} from 'app/client/components/Forms/styles';
import {GristDoc} from 'app/client/components/GristDoc';
import {ACIndexImpl} from 'app/client/lib/ACIndex';
import {ACSelectItem, buildACSelect} from 'app/client/lib/ACSelect';
import {copyToClipboard} from 'app/client/lib/clipboardUtils';
import {makeT} from 'app/client/lib/localization';
import {cssMarkdownSpan} from 'app/client/lib/markdown';
import {reportError} from 'app/client/models/AppModel';
import type {DocPageModel} from 'app/client/models/DocPageModel';
import {urlState} from 'app/client/models/gristUrlState';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {AdminSection, AdminSectionItem} from 'app/client/ui/AdminPanelCss';
import {hoverTooltip, showTransientTooltip, withInfoTooltip} from 'app/client/ui/tooltips';
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {cssRadioCheckboxOptions, radioCheckboxOption} from 'app/client/ui2018/checkbox';
import {colors, mediaSmall, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {select} from 'app/client/ui2018/menus';
import {confirmModal, cssModalButtons, cssModalTitle, cssSpinner, modal} from 'app/client/ui2018/modals';
import {buildCurrencyPicker} from 'app/client/widgets/CurrencyPicker';
import {buildTZAutocomplete} from 'app/client/widgets/TZAutocomplete';
import {EngineCode} from 'app/common/DocumentSettings';
import {commonUrls, GristLoadConfig} from 'app/common/gristUrls';
import {not, propertyCompare} from 'app/common/gutil';
import {getCurrency, locales} from 'app/common/Locales';
import {isOwner, isOwnerOrEditor} from 'app/common/roles';
import {
  DOCTYPE_NORMAL,
  DOCTYPE_TEMPLATE,
  DOCTYPE_TUTORIAL,
  DocumentType
} from 'app/common/UserAPI';
import {
  Computed,
  Disposable,
  dom,
  DomElementMethod,
  fromKo,
  IDisposableOwner,
  IDomArgs,
  makeTestId,
  Observable,
  styled
} from 'grainjs';
import * as moment from 'moment-timezone';

const t = makeT('DocumentSettings');
const testId = makeTestId('test-settings-');

export class DocSettingsPage extends Disposable {
  private _docInfo = this._gristDoc.docInfo;

  private _timezone = this._docInfo.timezone;
  private _locale: KoSaveableObservable<string> = this._docInfo.documentSettingsJson.prop('locale');
  private _currency: KoSaveableObservable<string|undefined> = this._docInfo.documentSettingsJson.prop('currency');
  private _engine: Computed<EngineCode|undefined> = Computed.create(this, (
    use => use(this._docInfo.documentSettingsJson.prop('engine'))
  ))
    .onWrite(val => this._setEngine(val));

  private _engines = getSupportedEngineChoices().map((engine) => ({
    value: engine,
    label: engine === 'python3' ? t(`python3 (recommended)`) : t(`python2 (legacy)`),
  }));

  constructor(private _gristDoc: GristDoc) {
    super();
  }

  public buildDom() {
    const canChangeEngine = getSupportedEngineChoices().length > 0;
    const docPageModel = this._gristDoc.docPageModel;
    const isTimingOn = this._gristDoc.isTimingOn;
    const isDocOwner = isOwner(docPageModel.currentDoc.get());
    const isDocEditor = isOwnerOrEditor(docPageModel.currentDoc.get());

    return cssContainer(
      dom.create(AdminSection, t('Document Settings'), [
        dom.create(AdminSectionItem, {
          id: 'timezone',
          name: t('Time Zone'),
          description: t('Default for DateTime columns'),
          value: dom.create(cssTZAutoComplete, moment, fromKo(this._timezone), (val) => this._timezone.saveOnly(val)),
        }),
        dom.create(AdminSectionItem, {
          id: 'locale',
          name: t('Locale'),
          description: t('For number and date formats'),
          value: dom.create(cssLocalePicker, this._locale),
        }),
        dom.create(AdminSectionItem, {
          id: 'currency',
          name: t('Currency'),
          description: t('For currency columns'),
          value: dom.domComputed(fromKo(this._locale), (l) =>
            dom.create(cssCurrencyPicker, fromKo(this._currency), (val) => this._currency.saveOnly(val),
              {defaultCurrencyLabel: t("Local currency ({{currency}})", {currency: getCurrency(l)})})
          )
        }),
        dom.create(AdminSectionItem, {
          id: 'templateMode',
          name: t('Template mode'),
          description: t('Change document type'),
          value: cssDocTypeContainer(
            dom.create(
              displayCurrentType,
              docPageModel.type,
            ),
            cssSmallButton(t('Edit'),
              dom.on('click', this._buildDocumentTypeModal.bind(this)),
              testId('doctype-edit')
            ),
          ),
          disabled: isDocOwner ? false : t('Only available to document owners'),
        }),
      ]),

      dom.create(AdminSection, t('Data Engine'), [
        dom.create(AdminSectionItem, {
          id: 'timings',
          name: t('Formula timer'),
          description: dom('div',
            dom.maybe(isTimingOn, () => cssRedText(t('Timing is on') + '...')),
            dom.maybe(not(isTimingOn), () => t('Find slow formulas')),
            testId('timing-desc')
          ),
          value: dom.domComputed(isTimingOn, (timingOn) => {
            if (timingOn) {
              return dom('div', {style: 'display: flex; gap: 4px'},
                cssPrimarySmallLink(
                  t('Stop timing...'),
                  urlState().setHref({docPage: 'timing'}),
                  {target: '_blank'},
                  testId('timing-stop')
                )
              );
            } else {
              return cssSmallButton(t('Start timing'),
                dom.on('click', this._startTiming.bind(this)),
                testId('timing-start')
              );
            }
          }),
          expandedContent: dom('div', t(
            'Once you start timing, Grist will measure the time it takes to evaluate each formula. ' +
            'This allows diagnosing which formulas are responsible for slow performance when a ' +
            'document is first opened, or when a document responds to changes.'
          )),
          disabled: isDocOwner ? false : t('Only available to document owners'),
        }),
        dom.create(AdminSectionItem, {
          id: 'reload',
          name: t('Reload'),
          description: t('Hard reset of data engine'),
          value: cssSmallButton(t('Reload data engine'), dom.on('click', this._reloadEngine.bind(this, true))),
          disabled: isDocEditor ? false : t('Only available to document editors'),
        }),
        canChangeEngine ? dom.create(AdminSectionItem, {
          id: 'python',
          name: t('Python'),
          description: t('Python version used'),
          value: cssSelect(this._engine, this._engines),
        }) : null,
      ]),

      dom.create(AdminSection, t('API'), [
        dom.create(AdminSectionItem, {
          id: 'documentId',
          name: t('Document ID'),
          description: t('ID for API use'),
          value: cssHoverWrapper(
            cssInput(docPageModel.currentDocId.get(), {tabIndex: "-1"}, clickToSelect(), readonly()),
            cssCopyButton(
              cssIcon('Copy'),
              hoverTooltip(t('Copy to clipboard'), {
                key: TOOLTIP_KEY,
              }),
              copyHandler(() => docPageModel.currentDocId.get()!, t("Document ID copied to clipboard")),
            ),
          ),
          expandedContent: dom('div',
            cssWrap(
              t('Document ID to use whenever the REST API calls for {{docId}}. See {{apiURL}}', {
                apiURL: cssLink({href: commonUrls.helpAPI, target: '_blank'}, t('API documentation.')),
                docId: dom('code', 'docId')
              })
            ),
            dom.domComputed(urlState().makeUrl({
              api: true,
              docPage: undefined,
              doc: docPageModel.currentDocId.get(),
            }), url => [
              cssWrap(t('Base doc URL: {{docApiUrl}}', {
                docApiUrl: cssCopyLink(
                  {href: url},
                  dom('span', url),
                  copyHandler(() => url, t("API URL copied to clipboard")),
                  hoverTooltip(t('Copy to clipboard'), {
                    key: TOOLTIP_KEY,
                  }),
                )
              })),
            ]),
          ),
        }),
        dom.create(AdminSectionItem, {
          id: 'api-console',
          name: t('API Console'),
          description: t('Try API calls from the browser'),
          value: cssSmallLinkButton(t('API console'), {
            target: '_blank',
            href: getApiConsoleLink(docPageModel),
          }),
        }),
        dom.create(AdminSectionItem, {
          id: 'webhooks',
          name: t('Webhooks'),
          description: t('Notify other services on doc changes'),
          value: cssSmallLinkButton(t('Manage webhooks'), urlState().setLinkUrl({docPage: 'webhook'})),
        }),
      ]),

      isDocOwner ? this._buildTransferDom() : null,
    );
  }

  private _buildTransferDom() {
    const INTERNAL = 'internal', EXTERNAL = 'external';

    const storageType = Computed.create(this, use => {
      const id = use(this._docInfo.documentSettingsJson).attachmentStoreId;
      return id ? EXTERNAL : INTERNAL;
    });
    storageType.onWrite(async (type) => {
      // We use this method, instead of updating the observable directly, to ensure that the
      // active doc has a chance to send us updates about the transfer.
      await this._gristDoc.docApi.setAttachmentStore(type);
    });
    const storageOptions = [{value: INTERNAL, label: 'Internal'}, {value: EXTERNAL, label: 'External'}];

    const transfer = this._gristDoc.attachmentTransfer;
    const locationSummary = Computed.create(this, use => use(transfer)?.locationSummary);
    const inProgress = Computed.create(this, use => !!use(transfer)?.status.isRunning);
    const allInCurrent = Computed.create(this, use => {
      const summary = use(locationSummary);
      const current = use(storageType);
      return summary && summary === current || summary === 'none';
    });
    const stores = Observable.create(this, [] as string[]);

    const stillInternal = Computed.create(this, use => {
      const currentExternal = use(storageType) === EXTERNAL;
      return currentExternal && (use(inProgress) || !use(allInCurrent));
    });

    const stillExternal = Computed.create(this, use => {
      const currentInternal = use(storageType) === INTERNAL;
      return currentInternal && (use(inProgress) || !use(allInCurrent));
    });

    const loadStatus = async () => {
      if (transfer.get()) {
        return;
      }
      const status = await this._gristDoc.docApi.getAttachmentTransferStatus();
      if (transfer.get()) {
        return;
      }
      transfer.set(status);
    };

    const checkAvailableStores = () => this._gristDoc.docApi.getAttachmentStores().then(r => {
      if (r.stores.length === 0) {
        // There are no external providers (for now there can be at most 1).
        stores.set([]);
      } else {
        stores.set([INTERNAL, EXTERNAL]);
      }
    });

    const beginTransfer = async () => {
      await this._gristDoc.docApi.transferAllAttachments();
    };

    const attachmentsReady = Observable.create(this, false);

    Promise.all([
        loadStatus(),
        checkAvailableStores(),
      ])
      .then(() => attachmentsReady.set(true))
      .catch(reportError);

    return dom.create(AdminSection, t('Attachment storage'), [
      dom.create(AdminSectionItem, {
        id: 'preferredStorage',
        name: withInfoTooltip(
          dom('span', t('Preferred storage for this document'), testId('transfer-header')),
          'attachmentStorage',
        ),
        value: cssFlex(
          dom.maybe(use => !use(allInCurrent) && !use(inProgress), () => [
            cssButton(
              t('Start transfer'),
              dom.on('click', () => beginTransfer()),
              testId('transfer-start-button')
            ),
          ]),
          dom.maybe(inProgress, () => [
            cssButton(
              cssLoadingSpinner(
                loadingSpinner.cls('-inline'),
                cssLoadingSpinner.cls('-disabled'),
                testId('transfer-spinner')
              ),
              t('Being transfer'),
              dom.prop('disabled', true),
              testId('transfer-button-in-progress')
            ),
          ]),
          dom.update(cssSmallSelect(storageType, storageOptions, {
            disabled: use => use(inProgress) || !use(attachmentsReady) || use(stores).length === 0,
          }), testId('transfer-storage-select')),
        )
      }),
      dom('div',
        dom.maybe(attachmentsReady, () => [
          dom.maybe(stillInternal, () => stillInternalCopy(
            inProgress,
            testId('transfer-message'),
            testId('transfer-still-internal-copy')
          )),
          dom.maybe(stillExternal, () => stillExternalCopy(
            inProgress,
            testId('transfer-message'),
            testId('transfer-still-external-copy')
          )),
          dom.maybe(use => use(stores).length === 0, () => [
            dom('span',
              t('No external stores available'),
              testId('transfer-message'),
              testId('transfer-no-stores-warning')
            ),
          ]),
        ]),
      ),
    ]);
  }

  private async _reloadEngine(ask = true) {
    const docPageModel = this._gristDoc.docPageModel;
    const handler =  async () => {
      await docPageModel.appModel.api.getDocAPI(docPageModel.currentDocId.get()!).forceReload();
      document.location.reload();
    };
    if (!ask) {
      return handler();
    }
    confirmModal(t('Reload data engine?'), t('Reload'), handler, {
      explanation: t(
        'This will perform a hard reload of the data engine. This ' +
        'may help if the data engine is stuck in an infinite loop, is ' +
        'indefinitely processing the latest change, or has crashed. ' +
        'No data will be lost, except possibly currently pending actions.'
      )
    });
  }

  private async _setEngine(val: EngineCode|undefined) {
    confirmModal(t('Save and Reload'), t('Ok'), () => this._doSetEngine(val));
  }

  private async _startTiming() {
    const docPageModel = this._gristDoc.docPageModel;
    modal((ctl, owner) => {
      this.onDispose(() => ctl.close());
      const selected = Observable.create<TimingModalOption>(owner, TimingModalOption.Adhoc);
      const page = Observable.create<TimingModalPage>(owner, TimingModalPage.Start);

      const startTiming = async () => {
        if (selected.get() === TimingModalOption.Reload) {
          page.set(TimingModalPage.Spinner);
          await this._gristDoc.docApi.startTiming();
          await docPageModel.appModel.api.getDocAPI(docPageModel.currentDocId.get()!).forceReload();
          ctl.close();
          urlState().pushUrl({docPage: 'timing'}).catch(reportError);
        } else {
          await this._gristDoc.docApi.startTiming();
          ctl.close();
        }
      };

      const startPage = () => [
        cssRadioCheckboxOptions(
          dom.style('max-width', '400px'),
          radioCheckboxOption(selected, TimingModalOption.Adhoc, dom('div',
            dom('div',
              dom('strong', t('Start timing')),
            ),
            dom('div',
              dom.style('margin-top', '8px'),
              dom('span', t('You can make changes to the document, then stop timing to see the results.'))
            ),
            testId('timing-modal-option-adhoc'),
          )),
          radioCheckboxOption(selected, TimingModalOption.Reload, dom('div',
            dom('div',
              dom('strong', t('Time reload')),
            ),
            dom('div',
              dom.style('margin-top', '8px'),
              dom('span', t('Force reload the document while timing formulas, and show the result.'))
            ),
            testId('timing-modal-option-reload'),
          ))
        ),
        cssModalButtons(
          bigPrimaryButton(t(`Start timing`),
            dom.on('click', startTiming),
            testId('timing-modal-confirm'),
          ),
          bigBasicButton(t('Cancel'), dom.on('click', () => ctl.close()), testId('timing-modal-cancel')),
        )
      ];

      const spinnerPage = () => [
        cssSpinner(
          loadingSpinner(),
          testId('timing-modal-spinner'),
          dom.style('width', 'fit-content')
        ),
      ];

      return [
        cssModalTitle(t(`Formula timer`)),
        dom.domComputed(page, (p) => p === TimingModalPage.Start ? startPage() : spinnerPage()),
        testId('timing-modal'),
      ];
    });
  }

  private _buildDocumentTypeModal() {
    const docPageModel = this._gristDoc.docPageModel;
    modal((ctl, owner) => {
      this.onDispose(() => ctl.close());
      const currentDocType = docPageModel.type.get() as string;
      let currentDocTypeOption;
      switch (currentDocType) {
        case DOCTYPE_TEMPLATE:
          currentDocTypeOption = DocTypeOption.Template;
          break;
        case DOCTYPE_TUTORIAL:
          currentDocTypeOption = DocTypeOption.Tutorial;
          break;
        default:
          currentDocTypeOption = DocTypeOption.Regular;
      }

      const selected = Observable.create<DocTypeOption>(owner, currentDocTypeOption);

      const doSetDocumentType = async () => {
        let docType: DocumentType;
        if (selected.get() === DocTypeOption.Regular) {
          docType = DOCTYPE_NORMAL;
        } else if (selected.get() === DocTypeOption.Template) {
          docType = DOCTYPE_TEMPLATE;
        } else {
          docType = DOCTYPE_TUTORIAL;
        }

        const {trunkId} = docPageModel.currentDoc.get()!.idParts;
        await docPageModel.appModel.api.updateDoc(trunkId, {type: docType});
        window.location.replace(urlState().makeUrl({
          docPage: "settings",
          fork: undefined, // will be automatically set once the page is reloaded
          doc: trunkId,
        }));
      };

      const docTypeOption = (
        {
          type,
          label,
          description,
          itemTestId
        }: {
          type: DocTypeOption,
          label: string,
          description: string,
          itemTestId: DomElementMethod | null
        }) => {
        return radioCheckboxOption(selected, type, dom('div',
          dom('div',
            dom('strong', label),
          ),
          dom('div',
            dom.style('margin-top', '8px'),
            dom('span', description)
          ),
          itemTestId,
        ));
      };

      const documentTypeOptions = () => [
        cssRadioCheckboxOptions(
          dom.style('max-width', '400px'),
          docTypeOption({
            type: DocTypeOption.Regular,
            label: t('Regular document'),
            description: t('Normal document behavior. All users work on the same copy of the document.'),
            itemTestId: testId('doctype-modal-option-regular'),
          }),
          docTypeOption({
            type: DocTypeOption.Template,
            label: t('Template'),
            description:  t('Document automatically opens in {{fiddleModeDocUrl}}. ' +
              'Anyone may edit, which will create a new unsaved copy.',
              {
                fiddleModeDocUrl: cssLink({href: commonUrls.helpAPI, target: '_blank'}, t('fiddle mode'))
              }
            ),
            itemTestId: testId('doctype-modal-option-template'),
          }),
          docTypeOption({
            type: DocTypeOption.Tutorial,
            label: t('Tutorial'),
            description: t('Document automatically opens as a user-specific copy.'),
            itemTestId: testId('doctype-modal-option-tutorial'),
          }),
        ),
        cssModalButtons(
          bigBasicButton(t('Cancel'), dom.on('click', () => ctl.close()), testId('doctype-modal-cancel')),
          bigPrimaryButton(t(`Confirm change`),
            dom.on('click', doSetDocumentType),
            testId('doctype-modal-confirm'),
          ),
        )
      ];
      return [
        cssModalTitle(t(`Change document type`)),
        documentTypeOptions(),
        testId('doctype-modal'),
      ];
    });
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

type DocumentTypeItem = ACSelectItem & {type?: string};

function displayCurrentType(
  owner: IDisposableOwner,
  type: Observable<DocumentType|null>,
) {
  const typeList: DocumentTypeItem[] = [{
    label: t('Regular'),
    type: ''
  }, {
      label: t('Template'),
      type: 'template'
    }, {
      label: t('Tutorial'),
      type: 'tutorial'
    }].map((el) => ({
    ...el,
    value: el.label,
    cleanText: el.label.trim().toLowerCase()
  }));
  const typeObs = Computed.create(owner, use => {
    const typeCode = use(type) ?? "";
    const typeName = typeList.find(ty => ty.type === typeCode)?.label || typeCode;
    return typeName;
  });
  return dom(
    'div',
    dom.text(typeObs),
    testId('doctype-value')
  );
}



function stillExternalCopy(inProgress: Observable<boolean>, ...args: IDomArgs<HTMLSpanElement>) {
  const someExternal = () => t(
    '**Some existing attachments are still external**.',
  );

  const startToInternal = () => t(
    'Click "Start transfer" to transfer those to Internal storage (stored in the document SQLite file).'
  );

  const newInInternal = () => t(
    'Newly uploaded attachments will be placed in Internal storage.'
  );

  return dom.domComputed(inProgress, (yes) => {
    if (yes) {
      return cssMarkdownSpan(
        `${someExternal()} ${newInInternal()}`, ...args, testId('transfer-message-in-progress'));
    } else {
      return cssMarkdownSpan(
        `${someExternal()} ${startToInternal()} ${newInInternal()}`,
        ...args,
        testId('transfer-message-static'));
    }
  });
}

function stillInternalCopy(inProgress: Observable<boolean>, ...args: IDomArgs<HTMLSpanElement>) {
  const someInternal = () => t(
    '**Some existing attachments are still internal** (stored in SQLite file).',
  );

  const startToExternal = () => t(
    'Click "Start transfer" to transfer those to External storage.'
  );

  const newInExternal = () => t(
    'Newly uploaded attachments will be placed in External storage.'
  );

  return dom.domComputed(inProgress, (yes) => {
    if (yes) {
      return cssMarkdownSpan(
        `${someInternal()} ${newInExternal()}`,
        testId('transfer-message-in-progress'),
        ...args
      );
    } else {
      return cssMarkdownSpan(
        `${someInternal()} ${startToExternal()} ${newInExternal()}`,
        testId('transfer-message-static'),
        ...args
      );
    }
  });
}


const cssContainer = styled('div', `
  overflow-y: auto;
  position: relative;
  height: 100%;
  padding: 32px 64px 24px 64px;
  color: ${theme.text};
  @media ${mediaSmall} {
    & {
      padding: 32px 24px 24px 24px;
    }
  }
`);

const cssCopyButton = styled('div', `
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 24px;
  right: 0;
  top: 0;
  --icon-color: ${theme.lightText};
  &:hover {
    --icon-color: ${colors.lightGreen};
  }
`);

const cssIcon = styled(icon, `
`);

const cssInput = styled('div', `
  border: none;
  outline: none;
  background: transparent;
  width: 100%;
  min-width: 180px;
  height: 100%;
  padding: 5px;
  padding-right: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssHoverWrapper = styled('div', `
  max-width: 280px;
  text-overflow: ellipsis;
  overflow: hidden;
  text-wrap: nowrap;
  display: inline-block;
  cursor: pointer;
  transition: all 0.05s;
  border-radius: 4px;
  border-color: ${theme.inputBorder};
  border-style: solid;
  border-width: 1px;
  height: 30px;
  align-items: center;
  position: relative;
`);

// This matches the style used in showProfileModal in app/client/ui/AccountWidget.


// Check which engines can be selected in the UI, if any.
export function getSupportedEngineChoices(): EngineCode[] {
  const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
  return gristConfig.supportEngines || [];
}

const TOOLTIP_KEY = 'copy-on-settings';


function copyHandler(value: () => string, confirmation: string) {
  return dom.on('click', async (e, d) => {
    e.stopImmediatePropagation();
    e.preventDefault();
    showTransientTooltip(d as Element, confirmation, {
      key: TOOLTIP_KEY
    });
    await copyToClipboard(value());
  });
}

function readonly() {
  return [
    { contentEditable: 'false', spellcheck: 'false' },
  ];
}

function clickToSelect() {
  return dom.on('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const range = document.createRange();
    range.selectNodeContents(e.target as Node);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
}

/**
 * Enum for the different pages of the timing modal.
 */
enum TimingModalPage {
  Start, // The initial page with options to start timing.
  Spinner, // The page with a spinner while we are starting timing and reloading the document.
}

/**
 * Enum for the different options in the timing modal.
 */
enum TimingModalOption {
  /**
   * Start timing and immediately forces a reload of the document and waits for the
   * document to be loaded, to show the results.
   */
  Reload,
  /**
   * Just starts the timing, without reloading the document.
   */
  Adhoc,
}

/**
 * Enum for the different options in the document type Modal.
 */
enum DocTypeOption {
  Regular,
  Template,
  Tutorial,
}

// A version that is not underlined, and on hover mouse pointer indicates that copy is available
const cssCopyLink = styled(cssLink, `
  word-wrap: break-word;
  &:hover {
    border-radius: 4px;
    text-decoration: none;
    background: ${theme.lightHover};
    outline-color: ${theme.linkHover};
    outline-offset: 1px;
  }
`);

const cssAutoComplete = `
  width: 172px;
  cursor: pointer;
  & input {
    text-overflow: ellipsis;
    padding-right: 24px;
  }
`;

const cssTZAutoComplete = styled(buildTZAutocomplete, cssAutoComplete);
const cssCurrencyPicker = styled(buildCurrencyPicker, cssAutoComplete);
const cssLocalePicker = styled(buildLocaleSelect, cssAutoComplete);

const cssWrap = styled('p', `
  overflow-wrap: anywhere;
  & * {
    word-break: break-all;
  }
`);

const cssRedText = styled('span', `
  color: ${theme.errorText};
`);

const cssDocTypeContainer = styled('div', `
  display: flex;
  width: 172px;
  align-items: center;
  justify-content: space-between;
  & > * {
    display: inline-block;
  }
`);
const cssFlex = styled('div', `
  display: flex;
  align-items: center;
  gap: 8px;
`);

const cssButton = styled(cssSmallButton, `
  white-space: nowrap;
`);

const cssSmallSelect = styled(select, `
  width: 100px;
`);

const cssSelect = styled(select, `
  min-width: 170px; /* to match the width of the timezone picker */
`);

const cssLoadingSpinner = styled(loadingSpinner, `
  &-disabled {
    --loader-bg: ${theme.loaderBg};
    --loader-fg: white;
  }
  @media (prefers-color-scheme: dark) {
    &-disabled {
      --loader-bg: #adadad;
    }
  }
`);
