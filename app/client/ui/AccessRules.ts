/**
 * UI for managing granular ACLs.
 */
import {GristDoc} from 'app/client/components/GristDoc';
import {createObsArray} from 'app/client/lib/koArrayWrap';
import {shadowScroll} from 'app/client/ui/shadowScroll';
import {primaryButton} from 'app/client/ui2018/buttons';
import {colors} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuItem, select} from 'app/client/ui2018/menus';
import {readAclRules} from 'app/common/GranularAccessClause';
import {setDifference} from 'app/common/gutil';
import {Computed, Disposable, dom, ObsArray, obsArray, Observable, styled} from 'grainjs';
import isEqual = require('lodash/isEqual');

interface AclState {
  ownerOnlyTableIds: Set<string>;
  ownerOnlyStructure: boolean;
}

const MATCH_NON_OWNER = 'user.Access != "owners"';

function buildAclState(gristDoc: GristDoc): AclState {
  const {ruleSets} = readAclRules(gristDoc.docData, {log: console});
  console.log("FOUND RULE SETS", ruleSets);

  const ownerOnlyTableIds = new Set<string>();
  let ownerOnlyStructure = false;
  for (const ruleSet of ruleSets) {
    if (ruleSet.tableId === '*' && ruleSet.colIds === '*') {
      if (ruleSet.body.find(p => p.aclFormula === MATCH_NON_OWNER && p.permissionsText === '-S')) {
        ownerOnlyStructure = true;
      }
    } else if (ruleSet.tableId !== '*' && ruleSet.colIds === '*') {
      if (ruleSet.body.find(p => p.aclFormula === MATCH_NON_OWNER && p.permissionsText === 'none')) {
        ownerOnlyTableIds.add(ruleSet.tableId);
      }
    }
  }
  return {ownerOnlyTableIds, ownerOnlyStructure};
}

export class AccessRules extends Disposable {
  public isAnythingChanged: Computed<boolean>;

  // NOTE: For the time being, rules correspond one to one with resources.
  private _initialState: AclState = buildAclState(this._gristDoc);
  private _allTableIds: ObsArray<string> = createObsArray(this, this._gristDoc.docModel.allTableIds);

  private _ownerOnlyTableIds = this.autoDispose(obsArray([...this._initialState.ownerOnlyTableIds]));
  private _ownerOnlyStructure = Observable.create<boolean>(this, this._initialState.ownerOnlyStructure);
  private _currentState = Computed.create<AclState>(this, (use) => ({
      ownerOnlyTableIds: new Set(use(this._ownerOnlyTableIds)),
      ownerOnlyStructure: use(this._ownerOnlyStructure),
  }));

  constructor(private _gristDoc: GristDoc) {
    super();
    this.isAnythingChanged = Computed.create(this, (use) =>
      !isEqual(use(this._currentState), this._initialState));
  }

  public async save(): Promise<void> {
    if (!this.isAnythingChanged.get()) { return; }
    // If anything has changed, we re-fetch the state from the current docModel (it may have been
    // changed by other users), and apply changes, if any, relative to that.
    const latestState = buildAclState(this._gristDoc);
    const currentState = this._currentState.get();
    const docData = this._gristDoc.docData;
    const resourcesTable = docData.getTable('_grist_ACLResources')!;
    const rulesTable = docData.getTable('_grist_ACLRules')!;
    await this._gristDoc.docData.bundleActions('Update Access Rules', async () => {
      // If ownerOnlyStructure flag changed, add or remove the relevant resource record.
      const defaultResource = resourcesTable.findMatchingRowId({tableId: '*', colIds: '*'}) ||
        await resourcesTable.sendTableAction(['AddRecord', null, {tableId: '*', colIds: '*'}]);
      const ruleObj = {resource: defaultResource, aclFormula: MATCH_NON_OWNER, permissionsText: '-S'};
      const ruleRowId = rulesTable.findMatchingRowId(ruleObj);
      if (currentState.ownerOnlyStructure && !ruleRowId) {
        await rulesTable.sendTableAction(['AddRecord', null, ruleObj]);
      } else if (!currentState.ownerOnlyStructure && ruleRowId) {
        await rulesTable.sendTableAction(['RemoveRecord', ruleRowId]);
      }

      // Handle tables added to ownerOnlyTableIds.
      const tablesAdded = setDifference(currentState.ownerOnlyTableIds, latestState.ownerOnlyTableIds);
      for (const tableId of tablesAdded) {
        const resource = resourcesTable.findMatchingRowId({tableId, colIds: '*'}) ||
          await resourcesTable.sendTableAction(['AddRecord', null, {tableId, colIds: '*'}]);
        await rulesTable.sendTableAction(
          ['AddRecord', null, {resource, aclFormula: MATCH_NON_OWNER, permissionsText: 'none'}]);
      }
      // Handle table removed from ownerOnlyTableIds.
      const tablesRemoved = setDifference(latestState.ownerOnlyTableIds, currentState.ownerOnlyTableIds);
      for (const tableId of tablesRemoved) {
        const resource = resourcesTable.findMatchingRowId({tableId, colIds: '*'});
        if (resource) {
          const rowId = rulesTable.findMatchingRowId({resource, aclFormula: MATCH_NON_OWNER, permissionsText: 'none'});
          if (rowId) {
            await rulesTable.sendTableAction(['RemoveRecord', rowId]);
          }
        }
      }
    });
  }

  public buildDom() {
    return [
      cssAddTableRow(
        primaryButton(icon('Plus'), 'Add Table Rules',
          menu(() => [
            dom.forEach(this._allTableIds, (tableId) =>
              // Add the table on a timeout, to avoid disabling the clicked menu item
              // synchronously, which prevents the menu from closing on click.
              menuItem(() => setTimeout(() => this._ownerOnlyTableIds.push(tableId), 0),
                tableId,
                dom.cls('disabled', (use) => use(this._ownerOnlyTableIds).includes(tableId)),
              )
            ),
          ]),
        ),
      ),
      shadowScroll(
        dom.forEach(this._ownerOnlyTableIds, (tableId) => {
          return cssTableRule(
            cssTableHeader(
              dom('div', 'Rules for ', dom('b', dom.text(tableId))),
              cssRemove(icon('Remove'),
                dom.on('click', () =>
                  this._ownerOnlyTableIds.splice(this._ownerOnlyTableIds.get().indexOf(tableId), 1))
              ),
            ),
            cssTableBody(
              cssPermissions('All Access'),
              cssPrincipals('Owners'),
            ),
          );
        }),
        cssTableRule(
          cssTableHeader('Default Rule'),
          cssTableBody(
            cssPermissions('Schema Edit'),
            cssPrincipals(
              select(this._ownerOnlyStructure, [
                {label: 'Owners Only', value: true},
                {label: 'Owners & Editors', value: false}
              ]),
            )
          ),
        ),
      ),
    ];
  }
}

const cssAddTableRow = styled('div', `
  margin: 0 64px 16px 64px;
  display: flex;
  justify-content: flex-end;
`);

const cssTableRule = styled('div', `
  margin: 16px 64px;
  border: 1px solid ${colors.darkGrey};
  border-radius: 4px;
  padding: 8px 16px 16px 16px;
`);

const cssTableHeader = styled('div', `
  display: flex;
  align-items: center;
  margin-bottom: 8px;
`);

const cssTableBody = styled('div', `
  display: flex;
  align-items: center;
`);

const  cssPermissions = styled('div', `
  flex: 1;
  white-space: nowrap;
  color: ${colors.lightGreen};
`);

const  cssPrincipals = styled('div', `
  flex: 1;
  color: ${colors.lightGreen};
`);

const cssRemove = styled('div', `
  flex: none;
  margin: 0 4px 0 auto;
  height: 24px;
  width: 24px;
  padding: 4px;
  border-radius: 3px;
  cursor: default;
  --icon-color: ${colors.slate};
  &:hover {
    background-color: ${colors.darkGrey};
    --icon-color: ${colors.slate};
  }
`);
