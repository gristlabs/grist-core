/**
 * API definitions for CustomSection plugins.
 */


import {RenderTarget} from './RenderOptions';

export interface CustomSectionAPI {
  createSection(inlineTarget: RenderTarget): Promise<void>;
}
