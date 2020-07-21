import { Rpc } from "grain-rpc";

/**
 * ActionRouter allows to choose what actions to send over rpc. Action are posted as message `{type:
 * "docAction", action }` over rpc.
 */
export class ActionRouter {

  private _subscribedTables: Set<string> = new Set();

  constructor(private _rpc: Rpc) {}

  /**
   * Subscribe to send all actions related to a table. Keeps sending actions if table is renamed.
   */
  public subscribeTable(tableId: string): Promise<void> {
    this._subscribedTables.add(tableId);
    return Promise.resolve();
  }

  /**
   * Stop sending all message related to a table.
   */
  public unsubscribeTable(tableId: string): Promise<void> {
    this._subscribedTables.delete(tableId);
    return Promise.resolve();
  }

  /**
   * Process a action updates subscription set in case of table rename and table remove, and post
   * action if it matches a subscriptions.
   */
  public process(action: any[]): Promise<void> {
    const tableId = action[1];
    if (!this._subscribedTables.has(tableId)) {
      return Promise.resolve();
    }
    switch (action[0]) {
      case "RemoveTable":
        this._subscribedTables.delete(tableId);
        break;
      case "RenameTable":
        this._subscribedTables.delete(tableId);
        this._subscribedTables.add(action[2]);
        break;
    }
    return this._rpc.postMessage({type: "docAction", action});
  }
}
