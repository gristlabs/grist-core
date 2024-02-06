import {IRowModel} from 'app/client/models/DocModel';
import * as modelUtil from 'app/client/models/modelUtil';

export interface ShareRec extends IRowModel<"_grist_Shares"> {
  optionsObj: modelUtil.SaveableObjObservable<any>;
}

export function createShareRec(this: ShareRec): void {
  this.optionsObj = modelUtil.jsonObservable(this.options);
}
