import { ALL_PERMISSION_PROPS, emptyPermissionSet,
         makePartialPermissions, mergePartialPermissions, mergePermissions,
         MixedPermissionSet, PartialPermissionSet, PermissionSet, TablePermissionSet,
         toMixed } from 'app/common/ACLPermissions';
import { ACLRuleCollection } from 'app/common/ACLRuleCollection';
import { AclMatchInput, RuleSet, UserInfo } from 'app/common/GranularAccessClause';
import { getSetMapValue } from 'app/common/gutil';
import log from 'app/server/lib/log';
import { mapValues } from 'lodash';

/**
 * A PermissionSet with context about how it was created.  Allows us to produce more
 * informative error messages.
 */
export interface PermissionSetWithContextOf<T = PermissionSet> {
  perms: T;
  ruleType: 'full'|'table'|'column'|'row';
  getMemos: () => MemoSet;
}

export type MixedPermissionSetWithContext = PermissionSetWithContextOf<MixedPermissionSet>;
export type TablePermissionSetWithContext = PermissionSetWithContextOf<TablePermissionSet>;
export type PermissionSetWithContext = PermissionSetWithContextOf<PermissionSet<string>>;

// Accumulator for memos of relevant rules.
export type MemoSet = PermissionSet<string[]>;

// Merge MemoSets by collecting all memos with de-duplication.
export function mergeMemoSets(psets: MemoSet[]): MemoSet {
  const result: Partial<MemoSet> = {};
  for (const prop of ALL_PERMISSION_PROPS) {
    const merged = new Set<string>();
    for (const p of psets) {
      for (const memo of p[prop]) {
        merged.add(memo);
      }
    }
    result[prop] = [...merged];
  }
  return result as MemoSet;
}

export function emptyMemoSet(): MemoSet {
  return {
    read: [],
    create: [],
    update: [],
    delete: [],
    schemaEdit: [],
  };
}

/**
 * Abstract base class for processing rules given a particular input.
 * Main use of this class will be to calculate permissions, but will also
 * be used to calculate metadata about permissions.
 */
abstract class RuleInfo<MixedT extends TableT, TableT> {

  // Construct a RuleInfo for a particular input, which is a combination of user and
  // optionally a record.
  constructor(protected _acls: ACLRuleCollection, protected _input: AclMatchInput) {}

  public getColumnAspect(tableId: string, colId: string): MixedT {
    const ruleSet: RuleSet|undefined = this._acls.getColumnRuleSet(tableId, colId);
    return ruleSet ? this._processColumnRule(ruleSet) : this._getTableDefaultAspect(tableId);
  }

  public getTableAspect(tableId: string): TableT {
    const columnAccess = this._acls.getAllColumnRuleSets(tableId).map(rs => this._processColumnRule(rs));
    columnAccess.push(this._getTableDefaultAspect(tableId));
    return this._mergeTableAccess(columnAccess);
  }

  public getFullAspect(): MixedT {
    const tableAccess = this._acls.getAllTableIds().map(tableId => this.getTableAspect(tableId));
    tableAccess.push(this._getDocDefaultAspect());

    return this._mergeFullAccess(tableAccess);
  }

  public getUser(): UserInfo {
    return this._input.user;
  }

  protected abstract _processRule(ruleSet: RuleSet, defaultAccess?: () => MixedT): MixedT;
  protected abstract _mergeTableAccess(access: MixedT[]): TableT;
  protected abstract _mergeFullAccess(access: TableT[]): MixedT;

  private _getTableDefaultAspect(tableId: string): MixedT {
    const ruleSet: RuleSet|undefined = this._acls.getTableDefaultRuleSet(tableId);
    return ruleSet ? this._processRule(ruleSet, () => this._getDocDefaultAspect()) :
      this._getDocDefaultAspect();
  }

  private _getDocDefaultAspect(): MixedT {
    return this._processRule(this._acls.getDocDefaultRuleSet());
  }

  private _processColumnRule(ruleSet: RuleSet): MixedT {
    return this._processRule(ruleSet, () => this._getTableDefaultAspect(ruleSet.tableId));
  }
}

/**
 * Pool memos from rules, on the assumption that access has been denied and we are looking
 * for possible explanations to offer the user.
 */
export class MemoInfo extends RuleInfo<MemoSet, MemoSet> {
  protected _processRule(ruleSet: RuleSet, defaultAccess?: () => MemoSet): MemoSet {
    const pset = extractMemos(ruleSet, this._input);
    return defaultAccess ? mergeMemoSets([pset, defaultAccess()]) : pset;
  }

  protected _mergeTableAccess(access: MemoSet[]): MemoSet {
    return mergeMemoSets(access);
  }

  protected _mergeFullAccess(access: MemoSet[]): MemoSet {
    return mergeMemoSets(access);
  }
}

export interface IPermissionInfo {
  getColumnAccess(tableId: string, colId: string): MixedPermissionSetWithContext;
  getTableAccess(tableId: string): TablePermissionSetWithContext;
  getFullAccess(): MixedPermissionSetWithContext;
  getRuleCollection(): ACLRuleCollection;
}

/**
 * Helper for evaluating rules given a particular user and optionally a record. It evaluates rules
 * for a column, table, or document, with caching to avoid evaluating the same rule multiple times.
 */
export class PermissionInfo extends RuleInfo<MixedPermissionSet, TablePermissionSet> implements IPermissionInfo {
  private _ruleResults = new Map<RuleSet, MixedPermissionSet>();

  // Get permissions for "tableId:colId", defaulting to "tableId:*" and "*:*" as needed.
  // If 'mixed' is returned, different rows may have different permissions. It should never return
  // 'mixed' if the input includes `rec`.
   // Wrap permissions with information about how they were computed.  This allows
  // us to issue more informative error messages.
  public getColumnAccess(tableId: string, colId: string): MixedPermissionSetWithContext {
    return {
      perms: this.getColumnAspect(tableId, colId),
      ruleType: 'column',
      getMemos: () => new MemoInfo(this._acls, this._input).getColumnAspect(tableId, colId)
    };
  }

  // Combine permissions from all rules for the given table.
  // If 'mixedColumns' is returned, different columns have different permissions, but they do NOT
  // depend on rows. If 'mixed' is returned, some permissions depend on rows.
  // Wrap permission sets for better error messages.
  public getTableAccess(tableId: string): TablePermissionSetWithContext {
    return {
      perms: this.getTableAspect(tableId),
      ruleType: this._input?.rec ? 'row' : 'table',
      getMemos: () => new MemoInfo(this._acls, this._input).getTableAspect(tableId)
    };
  }

  // Combine permissions from all rules throughout.
  // If 'mixed' is returned, then different tables, rows, or columns have different permissions.
  // Wrap permission sets for better error messages.
  public getFullAccess(): MixedPermissionSetWithContext {
    return {
      perms: this.getFullAspect(),
      ruleType: 'full',
      getMemos: () => new MemoInfo(this._acls, this._input).getFullAspect()
    };
  }

  public getRuleCollection() {
    return this._acls;
  }

  protected _processRule(ruleSet: RuleSet, defaultAccess?: () => MixedPermissionSet): MixedPermissionSet {
    return getSetMapValue(this._ruleResults, ruleSet, () => {
      const pset = evaluateRule(ruleSet, this._input);
      return toMixed(defaultAccess ? mergePartialPermissions(pset, defaultAccess()) : pset);
    });
  }

  protected _mergeTableAccess(access: MixedPermissionSet[]): TablePermissionSet {
    return mergePermissions(access, (bits) => (
      bits.every(b => b === 'allow') ? 'allow' :
      bits.every(b => b === 'deny') ? 'deny' :
      bits.every(b => b === 'allow' || b === 'deny') ? 'mixedColumns' :
        'mixed'
    ));
  }

  protected _mergeFullAccess(access: TablePermissionSet[]): MixedPermissionSet {
    return mergePermissions(access, (bits) => (
      bits.every(b => b === 'allow') ? 'allow' :
        bits.every(b => b === 'deny') ? 'deny' :
        'mixed'
    ));
  }
}

/**
 * Evaluate a RuleSet on a given input (user and optionally record). If a record is needed but not
 * included, the result may include permission values like 'allowSome', 'denySome', or 'mixed' (for
 * rules with memo).
 */
function evaluateRule(ruleSet: RuleSet, input: AclMatchInput): PartialPermissionSet {
  let pset: PartialPermissionSet = emptyPermissionSet();
  for (const rule of ruleSet.body) {
    try {
      if (rule.matchFunc!(input)) {
        pset = mergePartialPermissions(pset, rule.permissions);
      }
    } catch (e) {
      if (e.code === 'NEED_ROW_DATA') {
        pset = mergePartialPermissions(pset, makePartialPermissions(rule.permissions));
        if (rule.memo) {
          // Quick reminder:
          // - memos are only shown for denies, if user can't update/delete/create, they are not shown when user
          //   can't read. Schema permissions are not row dependent.
          // - memos can be extracted if ACL allows something, but they are not shown.
          // - partial permissions are merged, so denySome + deny = deny, and allowSome + allow = allow.
          // - but allow + denySome + deny = mixed, and allow + allowSome + deny = mixed.
          // - mixed is a final state, it can't be combined with anything else and disables any optimizations (forces
          //   row checks).
          // - allowSome and denySome are not final states, they will be replaced by allow/deny/mixed.

          // If rule has a memo, it will be shown if user is denied access to something, only if:
          // - this rule denied this access
          // - this rule would have allowed this access, but it didn't pass (e.g. row check failed, different user, etc)
          //
          // But there is one problem. If there is mix of deny and denySome (so some rules deny access based on the row,
          // and some denies access unconditionally - or based on a user), the overall access is denied, and there is no
          // reason to know exactly which row dependent rule denied it. So the access is denied at table/column level,
          // without actually scanning the rows. This is a good optimization, but it means that we won't be able to show
          // the memo, because we won't have the row data (rec in input) to test which rule (a row dependent rule)
          // matched the data (see extractMemos below).

          // To fix that, we need to convert denySome to mixed, which is a final state, and will force row checks, as
          // the optimizer won't be able to tell if the access is denied or not, without actually scanning each row that
          // is touched in the bundle. With that, we will be able to determine which rule denied the access, as the
          // check will be performed for each row.

          // We don't need to do that for allowSome, as this bit is converted only to "allow" or "mixed". When it is
          // "allow", the memos won't be shown, and when it is "mixed", rows will be scanned anyway.

          // We'll replace only denySome in create/update/delete bits. read doesn't show memo and schemaEdit is not row
          // dependent.
          const dataChangePerms: Array<keyof PermissionSet> = ['create', 'update', 'delete'];
          const changesData = (perm: string) => dataChangePerms.includes(perm as keyof PermissionSet);
          pset = mapValues(pset, (val, perm) => val === 'denySome' && changesData(perm) ? "mixed" : val);
        }
      } else {
        // Unexpected error. Interpret rule pessimistically.
        // Anything it would explicitly allow, no longer allow through this rule.
        // Anything it would explicitly deny, go ahead and deny.
        pset = mergePartialPermissions(pset, mapValues(rule.permissions, val => (val === 'allow' ? "" : val)));
        const prefixedTableName = input.docId ? `${input.docId}.${ruleSet.tableId}` : ruleSet.tableId;
        log.warn("ACLRule for %s (`%s`) failed: %s", prefixedTableName, rule.aclFormula, e.stack);
      }
    }
  }
  return pset;
}

/**
 * If a rule has a memo, and passes, add that memo for all permissions it denies.
 * If a rule has a memo, and fails, add that memo for all permissions it allows.
 */
function extractMemos(ruleSet: RuleSet, input: AclMatchInput): MemoSet {
  const pset = emptyMemoSet();
  for (const rule of ruleSet.body) {
    try {
      const passing = rule.matchFunc!(input);
      for (const prop of ALL_PERMISSION_PROPS) {
        const p = rule.permissions[prop];
        const memos: string[] = pset[prop];
        if (rule.memo) {
          if (passing && p === 'deny') {
            memos.push(rule.memo);
          } else if (!passing && p === 'allow') {
            memos.push(rule.memo);
          }
        }
      }
    } catch (e) {
      if (e.code !== 'NEED_ROW_DATA') {
        // If a rule is failing unexpectedly, give some information via memos.
        // TODO: Could give a more structured result.
        for (const prop of ALL_PERMISSION_PROPS) {
          pset[prop].push(`Rule [${rule.aclFormula}] for ${ruleSet.tableId} has an error: ${e.message}`);
        }
      }
    }
  }
  return pset;
}
