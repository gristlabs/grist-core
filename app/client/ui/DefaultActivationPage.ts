import {AppModel} from 'app/client/models/AppModel';
import { Disposable, IDomCreator } from 'grainjs';

export type IActivationPageCreator = IDomCreator<[AppModel]>

/**
 * A blank ActivationPage stand-in, as it's possible for the frontend to try and load an "activation page",
 * even though there's no activation in core.
 */
export class DefaultActivationPage extends Disposable {
  constructor(_appModel: AppModel) {
    super();
  }

  public buildDom() {
    return null;
  }
}
