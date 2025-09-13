/**
 * Base interface whose all attributes are optional.
 */
interface ServiceAccountAllOptional {
  label: string|undefined;
  description: string|undefined;
  endOfLife: string|undefined;
}

export type PatchServiceAccount = ServiceAccountAllOptional;

export interface PostServiceAccount extends ServiceAccountAllOptional {
  // endOfLife required for creation
  endOfLife: string;
}
