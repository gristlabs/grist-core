/**
 * API to manage Custom Widget state.
 */
export interface WidgetAPI {
  /**
   * Gets all options stored by the widget. Options are stored as plain JSON object.
   */
  getOptions(): Promise<object | null>;
  /**
   * Replaces all options stored by the widget.
   */
  setOptions(options: {[key: string]: any}): Promise<void>;
  /**
   * Clears all the options.
   */
  clearOptions(): Promise<void>;
  /**
   * Store single value in the Widget options object (and create it if necessary).
   */
  setOption(key: string, value: any): Promise<void>;
  /**
   * Get single value from Widget options object.
   */
  getOption(key: string): Promise<any>;
}
