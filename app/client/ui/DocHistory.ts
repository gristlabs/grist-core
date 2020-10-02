import {createSessionObs} from 'app/client/lib/sessionObs';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {reportError} from 'app/client/models/errors';
import {urlState} from 'app/client/models/gristUrlState';
import {getTimeFromNow} from 'app/client/models/HomeModel';
import {buildConfigContainer} from 'app/client/ui/RightPanel';
import {buttonSelect} from 'app/client/ui2018/buttonSelect';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuItemLink} from 'app/client/ui2018/menus';
import {StringUnion} from 'app/common/StringUnion';
import {DocSnapshot} from 'app/common/UserAPI';
import {Disposable, dom, IDomComponent, MultiHolder, Observable, styled} from 'grainjs';
import * as moment from 'moment';

const DocHistorySubTab = StringUnion("activity", "snapshots");

export class DocHistory extends Disposable implements IDomComponent {
  private _subTab = createSessionObs(this, "docHistorySubTab", "activity", DocHistorySubTab.guard);

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

    // If this is a snapshot already, say so to the user. We won't find any list of snapshots of it (though we could
    // change that to list snapshots of the trunk, and highlight this one among them).
    if (doc.idParts.snapshotId) {
      return cssSnapshot(cssSnapshotCard('You are looking at a backup snapshot.'));
    }

    const snapshots = Observable.create<DocSnapshot[]>(owner, []);
    const userApi = this._docPageModel.appModel.api;
    const docApi = userApi.getDocAPI(doc.id);
    docApi.getSnapshots().then(result => snapshots.set(result.snapshots)).catch(reportError);
    return dom('div',
      dom.forEach(snapshots, (snapshot) => {
        const modified = moment(snapshot.lastModified);
        return cssSnapshot(
          cssSnapshotTime(getTimeFromNow(snapshot.lastModified)),
          cssSnapshotCard(
            dom('div',
              cssDatePart(modified.format('ddd ll')), ' ',
              cssDatePart(modified.format('LT'))
            ),
            cssMenuDots(icon('Dots'),
              menu(() => [menuItemLink(urlState().setLinkUrl({doc: snapshot.docId}), 'Open Snapshot')],
                {placement: 'bottom-end', parentSelectorToMark: '.' + cssSnapshotCard.className}),
              testId('doc-history-snapshot-menu'),
            ),
          ),
          testId('doc-history-snapshot'),
        );
      }),
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
  --icon-color: ${colors.slate};
  &:hover, &.weasel-popup-open {
    background-color: ${colors.mediumGrey};
    --icon-color: ${colors.slate};
  }
`);
