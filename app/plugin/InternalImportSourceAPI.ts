import { RenderTarget } from './RenderOptions';

import { ImportSource } from './ImportSourceAPI';

export * from  './ImportSourceAPI';

/**
 * This internal interface is implemented by grist-plugin-api.ts to support
 * `grist.addImporter(...)`. This is this interface that grist stubs to calls
 * `ImportSourceAPI`. However, some of the complexity (ie: rendering targets) is hidden from the
 * plugin author which implements directly the simpler `ImportSourceAPI`.
 *
 * Reason for this interface is because we want to have the `inlineTarget` parameter but we don't
 * want plugin author to have it.
 */
export interface InternalImportSourceAPI {
  /**
   * The `inlineTarget` argument which will be passed to the implementation of this method, can be
   * used as follow `grist.api.render('index.html', inlineTarget)` to embbed `index.html` in the
   * import panel. Or it can be ignored and use `'fullscreen'` in-place. It is used in
   * `grist.addImporter(...)` according to the value of the `mode` argument.
   */
  getImportSource(inlineTarget: RenderTarget): Promise<ImportSource|undefined>;
}
