import {allCommands} from 'app/client/components/commands';
import {makeT} from 'app/client/lib/localization';
import {ColumnRec, ViewSectionRec} from 'app/client/models/DocModel';
import {cssButton} from 'app/client/ui2018/buttons';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {cssDragger} from 'app/client/ui2018/draggableList';
import {icon} from 'app/client/ui2018/icons';
import {Disposable, dom, fromKo, makeTestId, styled} from 'grainjs';
import * as ko from 'knockout';

const testId = makeTestId('test-vfc-');
const t = makeT('VisibleFieldsConfig');

/**
 * This is a component used in the RightPanel. It replaces hidden fields section on other views, and adds
 * the ability to drag and drop fields onto the form.
 */
export class HiddenQuestionConfig extends Disposable {

  constructor(private _section: ViewSectionRec) {
    super();
  }

  public buildDom() {
    const hiddenColumns = fromKo(this.autoDispose(ko.pureComputed(() => {
      const fields = new Set(this._section.viewFields().map(f => f.colId()).all());
      return this._section.table().visibleColumns().filter(c => !fields.has(c.colId()));
    })));
    return [
      cssHeader(
        cssFieldListHeader(dom.text(t("Hidden fields"))),
      ),
      dom('div',
        testId('hidden-fields'),
        dom.forEach(hiddenColumns, (field) => {
          return this._buildHiddenFieldItem(field);
        })
      )
    ];
  }

  private _buildHiddenFieldItem(column: ColumnRec) {
    return cssDragRow(
      testId('hidden-field'),
      {draggable: "true"},
      dom.on('dragstart', (ev) => {
        // Prevent propagation, as we might be in a nested editor.
        ev.stopPropagation();
        ev.dataTransfer?.setData('text/plain', JSON.stringify({
          type: 'Field',
          leaf: column.colId.peek(), // TODO: convert to Field
        }));
        ev.dataTransfer!.dropEffect = "move";
      }),
      cssSimpleDragger(),
      cssFieldEntry(
        cssFieldLabel(dom.text(column.label)),
        cssHideIcon('EyeShow',
          testId('hide'),
          dom.on('click', () => {
            allCommands.showColumns.run([column.colId.peek()]);
          }),
        ),
      ),
    );
  }

}

// TODO: reuse them
const cssDragRow = styled('div', `
  display: flex !important;
  align-items: center;
  margin: 0 16px 0px 0px;
  margin-bottom: 2px;
  cursor: grab;
`);

const cssFieldEntry = styled('div', `
  display: flex;
  background-color: ${theme.hover};
  border-radius: 2px;
  margin: 0 8px 0 0;
  padding: 4px 8px;
  cursor: default;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;

  --icon-color: ${theme.lightText};
`);

const cssSimpleDragger = styled(cssDragger, `
  cursor: grab;
  .${cssDragRow.className}:hover & {
    visibility: visible;
  }
`);

const cssHideIcon = styled(icon, `
  --icon-color: ${theme.lightText};
  display: none;
  cursor: pointer;
  flex: none;
  margin-right: 8px;
  .${cssFieldEntry.className}:hover & {
    display: block;
  }
`);

const cssFieldLabel = styled('span', `
  color: ${theme.text};
  flex: 1 1 auto;
  text-overflow: ellipsis;
  overflow: hidden;
`);

const cssFieldListHeader = styled('span', `
  color: ${theme.text};
  flex: 1 1 0px;
  font-size: ${vars.xsmallFontSize};
  text-transform: uppercase;
`);

const cssRow = styled('div', `
  display: flex;
  margin: 16px;
  overflow: hidden;
  --icon-color: ${theme.lightText};
  & > .${cssButton.className} {
    margin-right: 8px;
  }
`);

const cssHeader = styled(cssRow, `
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`);
