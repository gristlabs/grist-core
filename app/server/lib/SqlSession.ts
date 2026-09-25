/**
 * SqlSession: per-connection SQL session with transaction support.
 *
 * Handles the stateful parts of SQL execution: transaction lifecycle
 * (BEGIN/COMMIT/ROLLBACK), write lock management, undo-based rollback,
 * and routing between the granular SQL pipeline and the transaction DML path.
 *
 * ActiveDoc creates one per WebSocket docSession and delegates the "sql"
 * method to it.
 */
import { ApiError } from "app/common/ApiError";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { OptDocSession } from "app/server/lib/DocSession";
import {
  dmlResultToGranular, GranularSqlResult, runSQLQuery, validateForRestrictedUser,
} from "app/server/lib/runSQLQuery";
import { executeDMLFromParsed } from "app/server/lib/runSQLWrite";
import { isDMLAst, ParsedSQL, parseSQL } from "app/server/lib/SqlParser";
import { loadColumnTypes } from "app/server/lib/SqlValues";

const TXN_TIMEOUT_MS = 30_000;

const TXN_COMMANDS: Record<string, "begin" | "commit" | "rollback"> = {
  begin: "begin",
  begin_transaction: "begin",
  start_transaction: "begin",
  commit: "commit",
  end: "commit",
  end_transaction: "commit",
  rollback: "rollback",
  abort: "rollback",
};

interface Transaction {
  release: () => void;
  actionNums: number[];
  timedOut: boolean;
  timeout?: ReturnType<typeof setTimeout>;
}

export class SqlSession {
  private _txn: Transaction | null = null;

  constructor(
    private _activeDoc: ActiveDoc,
    private _docSession: OptDocSession,
  ) {}

  public async exec(sql: string): Promise<GranularSqlResult> {
    const trimmed = sql.trim();

    const txnCmd = this._getTransactionCommand(trimmed);
    if (txnCmd === "begin") { return this._begin(); }
    if (txnCmd === "commit") { return this._commit(); }
    if (txnCmd === "rollback") { return this._rollback(); }

    if (this._txn?.timedOut) {
      await this._doRollback();
      throw new ApiError("Transaction timed out and was rolled back", 400);
    }

    // Within a transaction, DML goes through the transaction path.
    // Parse once here; reuse the AST in _execDmlInTransaction.
    if (this._txn) {
      const parsed = parseSQL(trimmed);
      if (isDMLAst(parsed.ast)) {
        return this._execDmlInTransaction(trimmed, parsed);
      }
    }

    // Regular statement (no transaction, or SELECT within transaction)
    return await runSQLQuery(
      this._docSession, this._activeDoc, { sql: trimmed, granular: true },
    ) as GranularSqlResult;
  }

  /** Clean up on disconnect — release lock if transaction is open. */
  public endSession(): void {
    if (this._txn) { this._endTransaction(); }
  }

  private _getTransactionCommand(sql: string): "begin" | "commit" | "rollback" | null {
    // Use a lookup table keyed by normalized SQL. Transaction commands are
    // always simple one- or two-word statements, so normalization is safe.
    const key = sql.toLowerCase().replace(/\s+/g, "_").replace(/;$/, "");
    return TXN_COMMANDS[key] || null;
  }

  private async _begin(): Promise<GranularSqlResult> {
    if (this._txn) {
      throw new ApiError("Already in a transaction", 400);
    }
    await this._activeDoc.waitForInitialization();
    const release = await this._activeDoc.acquireTransactionLock();
    const txn: Transaction = { release, actionNums: [], timedOut: false };
    txn.timeout = setTimeout(() => { txn.timedOut = true; }, TXN_TIMEOUT_MS);
    this._txn = txn;
    return { statement: "BEGIN", command: "BEGIN", rowCount: 0 };
  }

  private async _commit(): Promise<GranularSqlResult> {
    if (this._txn) { this._endTransaction(); }
    return { statement: "COMMIT", command: "COMMIT", rowCount: 0 };
  }

  private async _rollback(): Promise<GranularSqlResult> {
    if (this._txn) { await this._doRollback(); }
    return { statement: "ROLLBACK", command: "ROLLBACK", rowCount: 0 };
  }

  private async _execDmlInTransaction(originalSql: string, parsed: ParsedSQL): Promise<GranularSqlResult> {
    // Validate the SAME parsed result we'll execute — no re-parsing.
    if (!(await this._activeDoc.canCopyEverything(this._docSession))) {
      const columnTypes = loadColumnTypes(this._activeDoc.docData!);
      validateForRestrictedUser(parsed, columnTypes);
    }
    const result = await executeDMLFromParsed(
      parsed, this._activeDoc, this._docSession, { withinTransaction: true });
    const granular = dmlResultToGranular(originalSql, result);
    if (granular.actionNum) { this._txn!.actionNums.push(granular.actionNum); }
    return granular;
  }

  private async _doRollback(): Promise<void> {
    const txn = this._txn;
    if (!txn) { return; }
    try {
      if (txn.actionNums.length > 0) {
        const nums = [...txn.actionNums].reverse();
        const undoActions = await this._activeDoc.getUndoActions(nums);
        if (undoActions.length > 0) {
          await this._activeDoc.applyUserActionsWithinTransaction(
            this._docSession, [["ApplyUndoActions", undoActions]]);
        }
      }
    } finally {
      this._endTransaction();
    }
  }

  private _endTransaction(): void {
    const txn = this._txn;
    if (!txn) { return; }
    this._txn = null;
    if (txn.timeout) { clearTimeout(txn.timeout); }
    txn.release();
  }
}
