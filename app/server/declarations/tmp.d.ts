import {Options, SimpleOptions} from "tmp";

// Add declarations of the promisifies methods of tmp.
declare module "tmp" {
  function dirAsync(config?: Options): Promise<string>;
  function fileAsync(config?: Options): Promise<string>;
  function tmpNameAsync(config?: SimpleOptions): Promise<string>;
}
