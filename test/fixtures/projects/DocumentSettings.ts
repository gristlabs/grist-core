import {addSaveInterface, KoSaveableObservable, objObservable} from 'app/client/models/modelUtil';
import {DocSettingsPage} from 'app/client/ui/DocumentSettings';
import {cssRootVars, testId} from 'app/client/ui2018/cssVars';
import {ColValues} from 'app/common/DocActions';
import {DocumentSettings} from 'app/common/DocumentSettings';
import {Computed, dom, fromKo, input, observable, Observable, styled} from "grainjs";
import * as ko from "knockout";
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';

function savable<T>(initial: T) {
  async function save(value: T) {
    result(value);
  }
  const result = addSaveInterface(ko.observable<T>(initial), save);
  return result;
}

function setupTest() {
  const timezone = savable('');
  const documentSettingsJson: KoSaveableObservable<DocumentSettings> = objObservable(savable<DocumentSettings>({
    locale: 'en-US',
  }));
  const docInfo = {
    timezone,
    documentSettingsJson,
    updateColValues: async function({timezone: newTimezone, documentSettings}: ColValues): Promise<void> {
      await timezone.saveOnly(String(newTimezone));
      await documentSettingsJson.saveOnly(JSON.parse(String(documentSettings)));
    }
  };
  const docPageModel = {
    currentDocId: Observable.create(null, 'docId'),
    currentDoc: Observable.create(null, {access: 'owners'}),
    type: Observable.create(null, null),
  };
  const gristDoc: any = {
    docInfo,
    docPageModel,
    isTimingOn: observable(false),
    attachmentTransfer: observable(null),
    docApi: {
      getAttachmentTransferStatus: async () => undefined,
      getAttachmentStores: async () => [],
      transferAllAttachments: async () => undefined,
    },
  };

  const locale = Computed.create(null, fromKo(documentSettingsJson),
    (_use, settings) => settings.locale);
  const currency = Computed.create(null, fromKo(documentSettingsJson),
    (_use, settings) => String(settings.currency));

  return [
    testBox(
      dom('div', "Document Settings"),
      dom.create(DocSettingsPage, gristDoc)
    ),
    testBox(
      dom('div', "Timezone Value"),
      dom('div', input(fromKo(timezone), {}, testId('result-timezone'))),
    ),
    testBox(
      dom('div', "Locale Value"),
      dom('div', input(locale, {}, testId('result-locale'))),
    ),
    testBox(
      dom('div', "Currency Value"),
      dom('div', input(currency, {}, testId('result-currency'))),
    ),
  ];
}

const testBox = styled('div', `
  float: left;
  width: 25rem;
  font-family: sans-serif;
  font-size: 1rem;
  box-shadow: 1px 1px 4px 2px #AAA;
  padding: 1rem;
  margin: 1rem;
  & > div { margin: 1rem; }
`);

void withLocale(() => dom.update(document.body, dom.cls(cssRootVars), setupTest()));
