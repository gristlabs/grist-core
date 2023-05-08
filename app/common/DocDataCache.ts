import { AlternateActions, AlternateStorage, ProcessedAction} from 'app/common/AlternateActions';
import { DocAction, UserAction } from 'app/common/DocActions';
import { DocData } from 'app/common/DocData';
import max from 'lodash/max';

/**
 * An implementation of an in-memory storage that can handle UserActions,
 * generating DocActions and retValues that work as for regular storage.
 * It shares an implementation with on-demand tables.
 */
export class DocDataCache implements AlternateStorage {
  public docData: DocData;
  private _altActions: AlternateActions;
  constructor(actions?: DocAction[]) {
    this.docData = new DocData(
      async (tableId) => {
        throw new Error(`no ${tableId}`);
      },
      null,
    );
    this._altActions = new AlternateActions(this);
    for (const action of actions || []) {
      this.docData.receiveAction(action);
    }
  }

  public async sendTableActions(actions: UserAction[]): Promise<ProcessedAction[]> {
    const results: ProcessedAction[] = [];
    for (const userAction of actions) {
      const processedAction = await this._altActions.processUserAction(userAction);
      results.push(processedAction);
      for (const storedAction of processedAction.stored) {
        this.docData.receiveAction(storedAction);
      }
    }
    return results;
  }

  public async fetchActionData(tableId: string, rowIds: number[], colIds?: string[]) {
    const table = await this.docData.requireTable(tableId);
    return table.getTableDataAction(
      rowIds,
      colIds,
    );
  }

  public async getNextRowId(tableId: string): Promise<number> {
    const table = await this.docData.requireTable(tableId);
    return (max(table.getRowIds()) || 0) + 1;
  }
}
