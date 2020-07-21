/**
 * Where to append the content that a plugin renders.
 */
export type RenderTarget = "fullscreen" | number;

/**
 * Options for the `grist.render` function.
 */
export interface RenderOptions {
  height?: string;
}
