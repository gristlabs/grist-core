import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { ApiError } from "app/common/ApiError";
import { LogMethods } from "app/server/lib/LogMethods";
import { RequestContext } from 'app/server/lib/scim/v2/ScimTypes';

import SCIMMY from "scimmy";

export class BaseController {
  protected logger = new LogMethods(this.constructor.name, () => ({}));
  protected invalidIdError: string;

  constructor(
    protected dbManager: HomeDBManager,
    protected checkAccess: (context: RequestContext) => void,
  ) {}

  protected getIdFromResource(resource: any) {
    const id = parseInt(resource.id, 10);
    if (Number.isNaN(id)) {
      throw new SCIMMY.Types.Error(400, 'invalidValue', this.invalidIdError);
    }
    return id;
  }


  /**
   * Runs the passed callback and handles any errors that might occur.
   * Also checks if the user has access to the operation.
   * Any public method of this class should be run through this method.
   *
   * @param context The request context to check access for the user
   * @param cb The callback to run
   */
  protected async runAndHandleErrors<T>(context: RequestContext, cb: () => Promise<T>): Promise<T> {
    try {
      this.checkAccess(context);
      return await cb();
    } catch (err) {
      if (err instanceof ApiError) {
        this.logger.error(null, ' ApiError: ', err.status, err.message);
        if (err.status === 409) {
          throw new SCIMMY.Types.Error(err.status, 'uniqueness', err.message);
        }
        throw new SCIMMY.Types.Error(err.status, null!, err.message);
      }
      if (err instanceof SCIMMY.Types.Error) {
        this.logger.error(null, ' SCIMMY.Types.Error: ', err.message);
        throw err;
      }
      // By default, return a 500 error
      this.logger.error(null, ' Error: ', err.message);
      throw new SCIMMY.Types.Error(500, null!, err.message);
    }
  }
}
