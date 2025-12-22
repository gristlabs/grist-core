import {GristDoc} from 'app/client/components/GristDoc';
import {ApiData, RawFormat, VirtualDoc} from 'app/client/components/VirtualDoc';
import {makeT} from 'app/client/lib/localization';
import {urlState} from 'app/client/models/gristUrlState';
import {docListHeader} from 'app/client/ui/DocMenuCss';
import {mediaSmall} from 'app/client/ui2018/cssVars';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {FormulaTimingInfo} from 'app/common/ActiveDocAPI';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {not} from 'app/common/gutil';
import {dom, makeTestId, Observable, styled} from 'grainjs';

const t = makeT('TimingPage');
const testId = makeTestId('test-timing-page-');

export class TimingPage extends DisposableWithEvents {
  private _data: Observable<FormulaTimingInfo[]|null> = Observable.create(this, null);
  private _doc = VirtualDoc.create(this, this._gristDoc.appModel);

  constructor(private _gristDoc: GristDoc) {
    super();

    this._doc.addTable({
      name: 'Timing',
      columns: [
        {label: t('Table ID'), type: 'Text', colId: 'tableId'},
        {label: t('Column ID'), type: 'Text', colId: 'colId'},
        {label: t('Total Time (s)'), type: 'Numeric', colId: 'sum'},
        {label: t('Number of Calls'), type: 'Numeric', colId: 'calls'},
        {label: t('Average Time (s)'), type: 'Numeric', colId: 'average'},
        {label: t('Max Time (s)'), type: 'Numeric', colId: 'max'},
      ],
      data: new ApiData(() => this._data.get() || []),
      format: new RawFormat(),
      initialFocus: true,
    });


    if (this._gristDoc.isTimingOn.get() === false) {
      // Just redirect back to the settings page.
      this._openSettings();
    }
 else {
      this._start().catch((ex) => {
        this._openSettings();
        reportError(ex);
      });
    }
  }

  public buildDom() {
    return cssContainer(
      dom.maybe(this._data, () =>
        dom('div', {style: 'display: flex; justify-content: space-between; align-items: baseline'},
          cssHeader(t('Formula timer')),
        ),
      ),
      dom.maybe(this._data, () => {
        return this._doc.buildDom();
      }),
      dom.maybe(not(this._data), () => cssLoaderScreen(
        loadingSpinner(),
        dom('div', t('Loading timing data. Don\'t close this tab.')),
        testId('spinner'),
      )),
    );
  }

  private _openSettings() {
    urlState().pushUrl({docPage: 'settings'}).catch(reportError);
  }

  private async _start() {
    const docApi = this._gristDoc.docPageModel.appModel.api.getDocAPI(this._gristDoc.docId());
    // Get the data from the server (and wait for the engine to calculate everything if it hasn't already).
    const data = await docApi.stopTiming();
    if (this.isDisposed()) { return; }
    this._data.set(data);
  }
}

const cssHeader = styled(docListHeader, `
  margin-bottom: 12px;
`);

const cssContainer = styled('div', `
  overflow-y: auto;
  position: relative;
  height: 100%;
  padding: 32px 64px 24px 64px;

  display: flex;
  flex-direction: column;
  @media ${mediaSmall} {
    & {
      padding: 32px 24px 24px 24px;
    }
  }
  & .viewsection_content {
    margin: 0px;
    margin-left: 4px;
  }
`);

const cssLoaderScreen = styled('div', `
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
`);
