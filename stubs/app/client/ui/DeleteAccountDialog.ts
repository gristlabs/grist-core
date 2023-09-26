import {FullUser} from 'app/common/UserAPI';
import {Disposable} from 'grainjs';

export class DeleteAccountDialog extends Disposable {
  constructor(appModel: FullUser) {
    super();
  }
  public buildDom() {
    return null;
  }
}
