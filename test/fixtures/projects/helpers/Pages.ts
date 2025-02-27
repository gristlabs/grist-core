import { find, fromTableData, TreeItemRecord, TreeNodeRecord } from "app/client/models/TreeModel";
import { addTreeView } from "app/client/ui/TreeViewComponent";
import { buildPageDom } from "app/client/ui2018/pages";
import { nativeCompare } from "app/common/gutil";
import { dom, makeTestId, observable, Observable } from 'grainjs';

const testId = makeTestId('test-pages-');

interface TreeRecord {
  indentation: number;
  id: number;
  pagePos: number;
  name: Observable<string>;
}

const sampleData = ["Interactions:0", "People:0", "User & Leads:1", "Overview:1", "Last:0"];
let records = sampleData
  .map((s) => s.split(':'))
  .map((chunks, index) => ({
    id: index,
    indentation: Number(chunks[1]),
    name: observable(chunks[0]),
    pagePos: index,
  }));

TreeNodeRecord.prototype.sendActions = async (actions: {update?: TreeRecord[]}) => {
  if (actions.update && actions.update.length) {
    const map = actions.update.reduce((acc, rec) => (acc[rec.id] = rec, acc), {} as {[id: number]: TreeRecord});
    records = records.map(rec => map[rec.id] || rec).sort((a, b) => nativeCompare(a.pagePos, b.pagePos));
    updateModel();
  }
};

function buildModel() {
  const table = {getRecords: () => records};
  return fromTableData(table as any, buildDom);
}

export const pagesModel = observable(buildModel());
export const selected = observable<TreeItemRecord>(pagesModel.get().children().get()[0]);

function updateModel() {
  pagesModel.set(buildModel());
}

async function removePage(page: TreeRecord) {
  const index = records.indexOf(page);
  if (index + 1 < records.length) {
    records[index + 1].indentation = Math.min(records[index + 1].indentation, records[index].indentation);
  }
  records.splice(index, 1);
  updateModel();
}

export async function addNewPage() {
  records.push({
    id: records.length,
    name: observable(`New Page${records.length}`),
    indentation: 0,
    pagePos: records[records.length - 1].pagePos + 1
  });
  updateModel();
}

export function addPages(isOpen: Observable<boolean>) {
  return addTreeView(pagesModel, {isOpen, selected});
}

function buildDom(id: number) {
  const page = records.find(rec => rec.id === id)!;
  const onRename = async (newName: string) => page.name.set(newName);
  const onRemove = () => removePage(page);
  const isRemoveDisabled = () => false;
  const isReadonly = Observable.create(null, false);
  const onDuplicate = () => null;
  return buildPageDom(
    page.name, {onRename, onRemove, isRemoveDisabled, isReadonly, onDuplicate},
    testId('page'),
    dom.on('click', () => {
      const item = find(pagesModel.get(), (i: any) => i.record.id === id);
      selected.set(item || null);
    })
  );
}
