export interface BasketClientAPI {
  /**
   * Returns an array of all tableIds in this basket.
   */
  getBasketTables(): Promise<string[]>;

  /**
   * Adds, updates or deletes a table's data to/from Grist Basket.
   */
  embedTable(tableId: string, action: "add"|"update"|"delete"): Promise<void>;
}
