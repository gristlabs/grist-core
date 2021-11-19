import {ColumnRec, DocModel, IRowModel, refRecord, ViewSectionRec} from 'app/client/models/DocModel';
import * as modelUtil from 'app/client/models/modelUtil';
import * as ko from 'knockout';

// Represents a column filter for a view section.
export interface FilterRec extends IRowModel<"_grist_Filters"> {
  viewSection: ko.Computed<ViewSectionRec>;
  column: ko.Computed<ColumnRec>;

  // Observable for the parsed filter object.
  activeFilter: modelUtil.CustomComputed<string>;
}

export function createFilterRec(this: FilterRec, docModel: DocModel): void {
  this.viewSection = refRecord(docModel.viewSections, this.viewSectionRef);
  this.column = refRecord(docModel.columns, this.colRef);

  // Observable for the active filter that's initialized from the value saved to the server.
  this.activeFilter = modelUtil.customComputed({
    read: () => { const f = this.filter(); return f === 'null' ? '' : f; }, // To handle old empty filters.
  });
}
