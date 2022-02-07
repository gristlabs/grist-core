import {GristDoc} from 'app/client/components/GristDoc';
import {buildViewSectionDom, ViewSectionHelper} from 'app/client/components/ViewLayout';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {Disposable, dom, domComputed} from 'grainjs';

export class DataTables extends Disposable {
  constructor(private _gristDoc: GristDoc) {
    super();
  }

  public buildDom() {
    return [
      dom(
        'ul',
        this._gristDoc.docModel.allTables.all().map(t => dom(
          'li', t.rawViewSection().title() || t.tableId(),
          dom.on('click', () => this._gristDoc.viewModel.activeSectionId(t.rawViewSection.peek().getRowId())),
        ))
      ),
      domComputed<ViewSectionRec>(
        this._gristDoc.viewModel.activeSection,
        (viewSection) => {
          if (!viewSection.getRowId()) {
            return;
          }
          ViewSectionHelper.create(this, this._gristDoc, viewSection);
          return buildViewSectionDom(this._gristDoc, viewSection.getRowId());
        }
      )
    ];
  }
}
