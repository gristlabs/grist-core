import { CoreCreate } from "app/server/lib/coreCreator";
import { ICreate } from "app/server/lib/ICreate";

let create: ICreate | undefined;

/**
 * Returns the {@link ICreate} for this build, constructing it on first use.
 *
 * Note: Construction is deferred rather than done at module level so that every build
 * resolves its ICreate at the same point in startup, after `AppSettings` has been
 * initialized from the database (the full edition build depends on this to pick its ICreate).
 */
export function getCreate(): ICreate {
  return create ??= new CoreCreate();
}
