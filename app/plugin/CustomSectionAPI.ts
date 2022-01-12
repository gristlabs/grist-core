/**
 * API definitions for CustomSection plugins.
 */

/**
 * Initial message sent by the CustomWidget with initial requirements.
 */
export interface InteractionOptionsRequest {
  /**
   * Required access level. If it wasn't granted already, Grist will prompt user to change the current access
   * level.
   */
  requiredAccess?: string,
  /**
   * Instructs Grist to show additional menu options that will trigger onEditOptions callback, that Widget
   * can use to show custom options screen.
   */
  hasCustomOptions?: boolean,
}

/**
 * Widget configuration set and approved by Grist, sent as part of ready message.
 */
export interface InteractionOptions {
  /**
   * Granted access level.
   */
  accessLevel: string
}

export interface CustomSectionAPI {
  configure(customOptions: InteractionOptionsRequest): Promise<void>;
}
