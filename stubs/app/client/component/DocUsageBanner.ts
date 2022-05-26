import {DocPageModel} from 'app/client/models/DocPageModel';
import {Disposable} from 'grainjs';

export class DocUsageBanner extends Disposable {
  constructor(_docPageModel: DocPageModel) { super(); }

  public buildDom() {
    return null;
  }
}
