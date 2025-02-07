import * as commands from 'app/client/components/commands';
import {makeT} from 'app/client/lib/localization';
import {ColumnRec, DocModel} from 'app/client/models/DocModel';
import {cssCode} from 'app/client/ui/DocTutorial';
import {withInfoTooltip} from 'app/client/ui/tooltips';
import {bigBasicButton, bigPrimaryButton, textButton} from 'app/client/ui2018/buttons';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {theme} from 'app/client/ui2018/cssVars';
import {cssModalBody, cssModalButtons, cssModalTitle, cssModalWidth, modal} from 'app/client/ui2018/modals';
import {DocAction} from 'app/common/DocActions';
import {cached} from 'app/common/gutil';
import {decodeObject, encodeObject} from 'app/plugin/objtypes';
import {dom, Observable, styled} from 'grainjs';
import mapValues from 'lodash/mapValues';

const t = makeT('ReassignModal');

/**
 * Builds a modal that shows the user that they can't reassign records because of uniqueness
 * constraints on the Ref/RefList column. It shows the user the conflicts and provides option
 * to resolve the confilic and retry the change.
 *
 * Currently we support uniquness only on 2-way referenced columns. While it is techincally
 * possible to support it on plain Ref/RefList columns, the implementation assumes that we
 * have the reverse column somewhere and can use it to find the conflicts without building
 * a dedicated index.
 *
 * Mental model of data structure:
 * Left table: Owners
 * Columns: [Name, Pets: RefList(Pets)]
 *
 * Right table: Pets
 * Columns: [Name, Owner: Ref(Owners)]
 *
 * Actions that were send to the server were updating the Owners table.
 *
 * Note: They could affect multiple columns, not only the Pets column.
 */
export async function buildReassignModal(options: {
  docModel: DocModel,
  actions: DocAction[],
}) {
  const {docModel, actions} = options;

  const tableRec = cached((tableId: string) => {
    return docModel.getTableModel(tableId).tableMetaRow;
  });

  const columnRec = cached((tableId: string, colId: string) => {
    const result = tableRec(tableId).columns().all().find(c => c.colId() === colId);
    if (!result) {
      throw new Error(`Column ${colId} not found in table ${tableId}`);
    }
    return result;
  });

  // Helper that gets records, but caches and copies them, so that we can amend them when needed.
  const amended = new Map<string, any>();
  const getRow = (tableId: string, rowId: number) => {
    const key = `${tableId}:${rowId}`;
    if (amended.has(key)) {
      return amended.get(key);
    }
    const tableData = docModel.getTableModel(tableId).tableData;
    const origRow = tableData.getRecord(rowId);
    if (!origRow) {
      return null;
    }
    const row = structuredClone(origRow);
    amended.set(key, row);
    return row;
  };

  // Helper that returns name of the row (as seen in Ref editor).
  const rowDisplay = cached((tableId: string, rowId: number, colId: string) => {
    const col = columnRec(tableId, colId);
    // Name of the row (for 2-way reference) is the value of visible column in reverse table.
    const visibleCol = col.reverseColModel().visibleColModel().colId();
    const record = getRow(tableId, rowId);
    return record?.[visibleCol] ?? String(rowId);
  });

  // We will generate set of problems, and then explain it.
  class Problem {
    constructor(public data: {
      tableId: string,
      colRec: ColumnRec,
      revRec: ColumnRec,
      pointer: number,
      newRowId: number,
      oldRowId: number,
    }) {}

    public buildReason() {
      // Pets record Azor is already assigned to Owners record Bob.
      const {colRec, revRec, pointer, oldRowId} = this.data;
      const Pets = revRec.table().tableNameDef();
      const Owners = colRec.table().tableNameDef();
      const Azor = rowDisplay(revRec.table().tableId(), pointer, revRec.colId()) as string;
      const Bob = rowDisplay(colRec.table().tableId(), oldRowId, colRec.colId()) as string;
      const text = t(
        `{{targetTable}} record {{targetName}} is already assigned to {{sourceTable}} record \
         {{oldSourceName}}.`,
        {
          targetTable: cssCode(Pets),
          sourceTable: cssCode(Owners),
          targetName: cssName(Azor),
          oldSourceName: cssName(Bob),
        });

      return cssBulletLine(text);
    }

    public buildHeader() {
      // Generally we try to show a text like this:
      // Each Pets record may only be assigned to a single Owners record.
      const {colRec, revRec} = this.data;
      // Task is the name of the revRec table
      const Pets = revRec.table().tableNameDef();
      const Owners = colRec.table().tableNameDef();
      return cssHigherLine([
        t(`Each {{targetTable}} record may only be assigned to a single {{sourceTable}} record.`,
          {
            targetTable: cssCode(Pets),
            sourceTable: cssCode(Owners),
          })
      ]);
    }

    public fixUserAction() {
      // Fix action is the action that removes Task 17 from Bob.
      const tableId = this.data.tableId;
      const colId = this.data.colRec.colId();
      const oldRowId = this.data.oldRowId;
      const oldRecord = getRow(tableId, oldRowId);
      const oldValue = decodeObject(oldRecord[colId]);
      let newValue: any = Array.isArray(oldValue)
              ? oldValue.filter(v => v !== this.data.pointer)
              : 0;
      if (Array.isArray(newValue) && newValue.length === 0) {
        newValue = null;
      }
      oldRecord[colId] = encodeObject(newValue);
      return ['UpdateRecord', tableId, oldRowId, {[colId]: oldRecord[colId]}];
    }

    public buildAction(checked: Observable<boolean>, multiple: boolean = false) {
      // Shows a checkbox and explanation what can be done, checkbox has a text
      // Reassing to People record Ann
      // Reasing to new Poeple records.
      const {colRec, newRowId} = this.data;
      const Ann = rowDisplay(colRec.table().tableId(), newRowId, colRec.colId()) as string;
      const singleText = () => t(`Reassign to {{sourceTable}} record {{sourceName}}.`,
        {
          sourceTable: cssCode(colRec.table().tableNameDef()),
          sourceName: cssName(Ann),
        });
      const multiText = () => t(`Reassign to new {{sourceTable}} records.`,
        {
          sourceTable: cssCode(colRec.table().tableNameDef()),
        });
      return cssCheckbox(checked, multiple ? multiText() : singleText());
    }
  }

  // List of problems we found in actions.
  const problems: Problem[] = [];
  const uniqueColumns: ColumnRec[] = [];
  const newOwners = new Set<number|null>();

  // We will hold changes in references, so that we can clear the action itself.
  const newValues = new Map<string, Map<number, number>>();
  const assignPet = (colId: string, petId: number, ownerId: number) => {
    if (!newValues.has(colId)) {
      newValues.set(colId, new Map());
    }
    newValues.get(colId)!.set(petId, ownerId);
  };
  const wasPetJustAssigned = (colId: string, petId: number) => {
    return newValues.has(colId) && newValues.get(colId)!.get(petId);
  };

  const properActions = [] as DocAction[];
  // Helper that unassigns a pet from the owner, by amanding the value stored in Ref/RefList column.
  function unassign(value: any, pet: number) {
    const newValue = decodeObject(value);
    const newValueArray = Array.isArray(newValue) ? newValue : [newValue] as any;
    const filteredOut = newValueArray.filter((v: any) => v !== pet);
    const wasArray = Array.isArray(newValue);
    if (wasArray) {
      if (newValueArray.length === 0) {
        return null;
      }
      return encodeObject(filteredOut);
    } else {
      return filteredOut[0] ?? null;
    }
  }

  // We will go one by one for each action (either update or add), we will flat bulk actions
  // and simulate applying them to the data, to test if the following actions won't produce
  // conflicts.
  for(const origAction of bulkToSingle(actions)) {
    const action = structuredClone(origAction);
    if (action[0] === 'UpdateRecord' || action[0] === 'AddRecord') {
      const ownersTable = action[1]; // this is same for each action.
      const newOwnerId = action[2];
      newOwners.add(newOwnerId);
      const valuesInAction = action[3];
      for(const colId of Object.keys(valuesInAction)) {
        // We are only interested in uqniue ref columns with reverse column.
        const petsCol = columnRec(ownersTable, colId);
        const ownerRevCol = petsCol.reverseColModel();
        if (!ownerRevCol || !ownerRevCol.id()) {
          continue;
        }
        if (petsCol.reverseColModel().pureType() !== 'Ref') {
          continue;
        }
        const petsTable = ownerRevCol.table().tableId();
        uniqueColumns.push(petsCol); // TODO: what it does

        // Prepare the data for testing, we will treat Ref as RefList to simplify the code.
        const newValue = decodeObject(valuesInAction[colId]);
        let petsAfter: number[] = Array.isArray(newValue) ? newValue : [newValue] as any;
        const prevValue = decodeObject(getRow(ownersTable, newOwnerId)?.[colId]) ?? [];
        const petsBefore: number[] = Array.isArray(prevValue) ? prevValue : [prevValue] as any;

        // The new owner will have new pets. We are only interested in a situation
        // where owner is assigned with a new pet, if pet was removed, we don't care as this
        // won't cause a conflict.
        petsAfter = petsAfter.filter(p => !petsBefore.includes(p));
        if (petsAfter.length === 0) {
          continue;
        }
        // Now find current owners of the pets that will be assigned to the new owner.
        for(const pet of petsAfter) {
          // We will use data available in that other table (Pets). Notice that we assume, that
          // the reverse column (Owner in Pets) is Ref column.
          const oldOwner = getRow(petsTable, pet)?.[ownerRevCol.colId()] as number;
          // If the pet didn't have an owner previously, we don't care, we are fine reasigning it.
          if (!oldOwner || (typeof oldOwner !== 'number')) {
            // We ignore it, but there might be other actions that will try to move this pet
            // to other owner, so remember that one.

            // But before remembering, check if that hasn't happend already.
            const assignedTo = wasPetJustAssigned(petsCol.colId(), pet);
            if (assignedTo) {
              // We have two actions that will assign the same pet to two different owners.
              // We can't allow that, so we will remove this update from the action.
              valuesInAction[colId] = unassign(valuesInAction[colId], pet);
            } else {
              assignPet(colId, pet, newOwnerId);
            }
          } else {
            // If we will assign it to someone else in previous action, ignore this update.
            if (wasPetJustAssigned(petsCol.colId(), pet)) {
              valuesInAction[colId] = unassign(valuesInAction[colId], pet);
              continue;
            } else {
              assignPet(colId, pet, newOwnerId);
              problems.push(new Problem({
                tableId: ownersTable,
                pointer: pet,
                colRec: petsCol,
                revRec: ownerRevCol,
                newRowId: newOwnerId,
                oldRowId: oldOwner,
              }));
            }
          }
        }
      }

      properActions.push(action);
    } else {
      throw new Error(`Unsupported action ${action[0]}`);
    }
  }

  if (!problems.length) {
    throw new Error('No problems found');
  }

  const checked = Observable.create(null, false);

  const multipleOrNew = newOwners.size > 1 || newOwners.has(null);

  modal((ctl) => {
    const reassign = async () => {
      await docModel.docData.sendActions([
        ...problems.map(p => p.fixUserAction()).filter(Boolean),
        ...properActions
      ]);
      ctl.close();
    };
    const configureReference = async () => {
      ctl.close();
      if (!uniqueColumns.length) { return; }
      const revCol = uniqueColumns[0].reverseColModel();
      const rawViewSection = revCol.table().rawViewSection();
      if (!rawViewSection) { return; }
      await commands.allCommands.showRawData.run(rawViewSection.id());
      const reverseColId = revCol.colId.peek();
      if (!reverseColId) { return; } // might happen if it is censored.
      const targetField = rawViewSection.viewFields.peek().all()
                                        .find(f => f.colId.peek() === reverseColId);
      if (!targetField) { return; }
      await commands.allCommands.setCursor.run(null, targetField);
      await commands.allCommands.rightPanelOpen.run();
      await commands.allCommands.fieldTabOpen.run();
    };
    return [
      cssModalWidth('normal'),
      cssModalTitle(t('Record already assigned', {count: problems.length})),
      cssModalBody(() => {
        // Show single problem in a simple way.
        return dom('div',
          problems[0].buildHeader(),
          dom('div',
            dom.style('margin-top', '18px'),
            dom('div', problems.slice(0, 4).map(p => p.buildReason())),
            problems.length <= 4 ? null : dom('div', `... and ${problems.length - 4} more`),
            dom('div',
              problems[0].buildAction(checked, multipleOrNew),
              dom.style('margin-top', '18px'),
            ),
          ),
        );
      }),
      cssModalButtons(
        dom.style('display', 'flex'),
        dom.style('justify-content', 'space-between'),
        dom.style('align-items', 'baseline'),
        dom.domComputed(checked, (v) => [
          v ? bigPrimaryButton(t('Reassign'), dom.on('click', reassign))
            : bigBasicButton(t('Cancel'), dom.on('click', () => ctl.close())),
        ]),
        dom('div',
          withInfoTooltip(
            textButton('Configure reference', dom.on('click', configureReference)),
            'reassignTwoWayReference',
          )
        )
      )
    ];
  });
}

/**
 * This function is used to traverse through the actions, and if there are bulk actions, it will
 * flatten them to equivalent single actions.
 */
function* bulkToSingle(actions: DocAction[]): Iterable<DocAction> {
  for(const a of actions) {
    if (a[0].startsWith('Bulk')) {
      const name = a[0].replace('Bulk', '') as 'AddRecord' | 'UpdateRecord';
      const rowIds = a[2] as number[];
      const tableId = a[1];
      const colValues = a[3] as any;
      for (let i = 0; i < rowIds.length; i++) {
        yield [name, tableId, rowIds[i], mapValues(colValues, (values) => values[i])];
      }
    } else {
      yield a;
    }
  }
}

const cssBulletLine = styled('div', `
  margin-bottom: 8px;
  line-height: 22px;
  &::before {
    content: '•';
    margin-right: 4px;
    color: ${theme.lightText};
  }
`);

const cssHigherLine = styled('div', `
  line-height: 22px;
`);

const cssName = (text: string) => dom('span', `"${text}"`);

const cssCheckbox = styled(labeledSquareCheckbox, `
  line-height: 22px;
  & > span {
    overflow: unset; /* make some room for cssCode */
  }
`);
