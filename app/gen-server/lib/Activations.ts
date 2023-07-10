import { makeId } from 'app/server/lib/idUtils';
import { Activation } from 'app/gen-server/entity/Activation';
import { HomeDBManager } from 'app/gen-server/lib/HomeDBManager';

/**
 * Manage activations. Not much to do currently, there is at most one
 * activation. The activation singleton establishes an id and creation
 * time for the installation.
 */
export class Activations {
  constructor(private _db: HomeDBManager) {
  }

  // Get the current activation row, creating one if necessary.
  // It will be created with an empty key column, which will get
  // filled in once an activation key is presented.
  public current(): Promise<Activation> {
    return this._db.connection.manager.transaction(async manager => {
      let activation = await manager.findOne(Activation, {where: {}});
      if (!activation) {
        activation = manager.create(Activation);
        activation.id = makeId();
        activation.prefs = {};
        await activation.save();
      }
      return activation;
    });
  }
}
