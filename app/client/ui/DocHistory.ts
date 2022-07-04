import {createSessionObs} from 'app/client/lib/sessionObs';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {reportError} from 'app/client/models/errors';
import {urlState} from 'app/client/models/gristUrlState';
import {getTimeFromNow} from 'app/client/models/HomeModel';
import {buildConfigContainer} from 'app/client/ui/RightPanel';
import {buttonSelect} from 'app/client/ui2018/buttonSelect';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuAnnotate, menuItemLink} from 'app/client/ui2018/menus';
import {buildUrlId, parseUrlId} from 'app/common/gristUrls';
import {StringUnion} from 'app/common/StringUnion';
import {DocSnapshot} from 'app/common/UserAPI';
import {Disposable, dom, IDomComponent, MultiHolder, Observable, styled} from 'grainjs';
import moment from 'moment';

const DocHistorySubTab = StringUnion("activity", "snapshots");

export class DocHistory extends Disposable implements IDomComponent {
  private _subTab = createSessionObs(this, "docHistorySubTab", "snapshots", DocHistorySubTab.guard);

  constructor(private _docPageModel: DocPageModel, private _actionLog: IDomComponent) {
    super();
  }

  public buildDom() {
    const tabs = [
      {value: 'activity', label: 'Activity'},
      {value: 'snapshots', label: 'Snapshots'},
    ];
    return [
      cssSubTabs(
        buttonSelect(this._subTab, tabs, {}, testId('doc-history-tabs')),
      ),
      dom.domComputed(this._subTab, (subTab) =>
        buildConfigContainer(
          subTab === 'activity' ? this._actionLog.buildDom() :
          subTab === 'snapshots' ? dom.create(this._buildSnapshots.bind(this)) :
          null
        )
      ),
    ];
  }

  private _buildSnapshots(owner: MultiHolder) {
    // Fetch snapshots, and render.
    const doc = this._docPageModel.currentDoc.get();
    if (!doc) { return null; }

    // origUrlId is the snapshot-less URL, which we use to fetch snapshot history, and for
    // snapshot comparisons.
    const origUrlId = buildUrlId({...doc.idParts, snapshotId: undefined});

    // If comparing one snapshot to another, get the other ID, so that we can highlight it too.
    const compareUrlId = urlState().state.get().params?.compare;
    const compareSnapshotId = compareUrlId && parseUrlId(compareUrlId).snapshotId;

    // Helper to set a link to open a snapshot, optionally comparing it with a docId.
    // We include urlState().state to preserve the currently selected page.
    function setLink(snapshot: DocSnapshot, compareDocId?: string) {
      return dom.attr('href', (use) => urlState().makeUrl({
        ...use(urlState().state), doc: snapshot.docId,
        params: (compareDocId ? {compare: compareDocId} : {})
      }));
    }

    const snapshots = Observable.create<DocSnapshot[]>(owner, []);
    const userApi = this._docPageModel.appModel.api;
    const docApi = userApi.getDocAPI(origUrlId);
    docApi.getSnapshots().then(result =>
      snapshots.isDisposed() || snapshots.set(result.snapshots)).catch(reportError);
    return dom('div',
      // Note that most recent snapshots are first.
      dom.domComputed(snapshots, (snapshotList) => snapshotList.map((snapshot, index) => {
        const modified = moment(snapshot.lastModified);
        const prevSnapshot = snapshotList[index + 1] || null;
        return cssSnapshot(
          cssSnapshotTime(getTimeFromNow(snapshot.lastModified)),
          cssSnapshotCard(
            cssSnapshotCard.cls('-current', Boolean(
              snapshot.snapshotId === doc.idParts.snapshotId ||
              (compareSnapshotId && snapshot.snapshotId === compareSnapshotId)
            )),
            dom('div',
              cssDatePart(modified.format('ddd ll')), ' ',
              cssDatePart(modified.format('LT'))
            ),
            cssMenuDots(icon('Dots'),
              menu(() => [
                  menuItemLink(setLink(snapshot), 'Open Snapshot'),
                  menuItemLink(setLink(snapshot, origUrlId), 'Compare to Current',
                    menuAnnotate('Beta')),
                  prevSnapshot && menuItemLink(setLink(prevSnapshot, snapshot.docId), 'Compare to Previous',
                    menuAnnotate('Beta')),
                ],
                {placement: 'bottom-end', parentSelectorToMark: '.' + cssSnapshotCard.className}
              ),
              testId('doc-history-snapshot-menu'),
            ),
            testId('doc-history-card'),
          ),
          testId('doc-history-snapshot'),
        );
      })),
    );
  }
}

const cssSubTabs = styled('div', `
  padding: 16px;
  border-bottom: 1px solid ${colors.mediumGrey};
`);

const cssSnapshot = styled('div', `
  margin: 8px 16px;
`);

const cssSnapshotTime = styled('div', `
  text-align: right;
  color: ${colors.slate};
  font-size: ${vars.smallFontSize};
`);

const cssSnapshotCard = styled('div', `
  border: 1px solid ${colors.mediumGrey};
  padding: 8px;
  background: white;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  --icon-color: ${colors.slate};

  &-current {
    background-color: ${colors.dark};
    color: ${colors.light};
    --icon-color: ${colors.light};
  }
`);

const cssDatePart = styled('span', `
  display: inline-block;
`);

const cssMenuDots = styled('div', `
  flex: none;
  margin: 0 4px 0 auto;
  height: 24px;
  width: 24px;
  padding: 4px;
  line-height: 0px;
  border-radius: 3px;
  cursor: default;
  &:hover, &.weasel-popup-open {
    background-color: ${colors.mediumGrey};
  }
`);
