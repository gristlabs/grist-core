// Add declarations of the promisifies methods of tmp.
import {Options, SimpleOptions} from "tmp";
declare module "tmp" {
  function dirAsync(config?: Options): Promise<string>;
  function fileAsync(config?: Options): Promise<string>;
  function tmpNameAsync(config?: SimpleOptions): Promise<string>;
}
