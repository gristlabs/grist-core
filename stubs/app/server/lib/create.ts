import {ICreate} from "app/server/lib/ICreate";
import {makeCoreCreator} from "app/server/lib/coreCreator";

export const create: ICreate = makeCoreCreator();

/**
 * Fetch the ICreate object for grist-core.
 * Placeholder to enable eventual refactoring away from a global singleton constant.
 * Needs to exist in all repositories before core can be switched!
 */
export function getCreator(): ICreate {
  return create;
}
