import {DocModel, IRowModel} from 'app/client/models/DocModel';
import * as modelUtil from 'app/client/models/modelUtil';
import {jsonObservable, savingComputed} from 'app/client/models/modelUtil';
import {DocumentSettings} from 'app/common/DocumentSettings';
import * as ko from 'knockout';

// The document-wide metadata. It's all contained in a single record with id=1.
export interface DocInfoRec extends IRowModel<"_grist_DocInfo"> {
  documentSettingsJson: modelUtil.SaveableObjObservable<DocumentSettings>
  defaultViewId: ko.Computed<number>;
  newDefaultViewId: ko.Computed<number>;
  attachmentStorage: modelUtil.KoSaveableObservable<'internal'|'external'>;
  attachmentTransfer: ko.Observable<'done'|'not-started'|'in-progress'|'failed'>;

  beginTransfer(): Promise<void>;
}

export function createDocInfoRec(this: DocInfoRec, docModel: DocModel): void {
  this.documentSettingsJson = jsonObservable(this.documentSettings);
  this.defaultViewId = this.autoDispose(ko.pureComputed(() => {
    const tab = docModel.allTabs.at(0);
    return tab ? tab.viewRef() : 0;
  }));
  this.newDefaultViewId = this.autoDispose(ko.pureComputed(() => {
    const page = docModel.visibleDocPages()[0];
    return page ? page.viewRef() : 0;
  }));

  const storage = this.autoDispose(ko.observable('internal') as any);

  this.attachmentStorage = savingComputed({
    read: () => storage(),
    write: (setter, val) => storage(val),
  });

  this.attachmentTransfer = this.autoDispose(ko.observable('done') as any);

  this.autoDispose(this.attachmentStorage.subscribe((newVal) => {
    this.attachmentTransfer('not-started');
  }));

  this.beginTransfer = async () => {
    this.attachmentTransfer('in-progress');
    const timeout = setTimeout(() => this.attachmentTransfer('done'), 3000);
    this.autoDisposeCallback(() => clearTimeout(timeout));
  };
}
