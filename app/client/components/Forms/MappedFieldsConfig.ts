import {allCommands} from 'app/client/components/commands';
import {makeT} from 'app/client/lib/localization';
import {ColumnRec, ViewSectionRec} from 'app/client/models/DocModel';
import {basicButton, cssButton, primaryButton} from 'app/client/ui2018/buttons';
import {squareCheckbox} from 'app/client/ui2018/checkbox';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {cssDragger} from 'app/client/ui2018/draggableList';
import {icon} from 'app/client/ui2018/icons';
import {Computed, Disposable, dom, fromKo, makeTestId, Observable, styled} from 'grainjs';
import * as ko from 'knockout';

const testId = makeTestId('test-vfc-');
const t = makeT('VisibleFieldsConfig');

/**
 * This is a component used in the RightPanel. It replaces hidden fields section on other views, and adds
 * the ability to drag and drop fields onto the form.
 */
export class MappedFieldsConfig extends Disposable {

  constructor(private _section: ViewSectionRec) {
    super();
  }

  public buildDom() {
    const unmappedColumns = fromKo(this.autoDispose(ko.pureComputed(() => {
      if (this._section.isDisposed()) {
        return [];
      }
      const fields = new Set(this._section.viewFields().map(f => f.colId()).all());
      const cols = this._section.table().visibleColumns()
        .filter(c => c.isFormCol() && !fields.has(c.colId()));
      return cols.map(col => ({
        col,
        selected: Observable.create(null, false),
      }));
    })));
    const mappedColumns = fromKo(this.autoDispose(ko.pureComputed(() => {
      if (this._section.isDisposed()) {
        return [];
      }
      const cols = this._section.viewFields().map(f => f.column()).all()
        .filter(c => c.isFormCol());
      return cols.map(col => ({
        col,
        selected: Observable.create(null, false),
      }));
    })));

    const anyUnmappedSelected = Computed.create(this, use => {
      return use(unmappedColumns).some(c => use(c.selected));
    });

    const anyMappedSelected = Computed.create(this, use => {
      return use(mappedColumns).some(c => use(c.selected));
    });

    const mapSelected = async () => {
      await allCommands.showColumns.run(
        unmappedColumns.get().filter(c => c.selected.get()).map(c => c.col.colId.peek()));
    };

    const unMapSelected = async () => {
      await allCommands.hideFields.run(
        mappedColumns.get().filter(c => c.selected.get()).map(c => c.col.colId.peek()));
    };

    return [
      cssHeader(
        cssFieldListHeader(dom.text(t("Mapped"))),
        selectAllLabel(
          dom.on('click', () => {
            mappedColumns.get().forEach((col) => col.selected.set(true));
          }),
          dom.show(/* any mapped columns */ use => use(mappedColumns).length > 0),
        ),
      ),
      dom('div',
        testId('visible-fields'),
        dom.forEach(mappedColumns, (field) => {
          return this._buildMappedField(field);
        })
      ),
      dom.maybe(anyMappedSelected, () =>
        cssRow(
          primaryButton(
            dom.text(t("Unmap fields")),
            dom.on('click', unMapSelected),
            testId('visible-hide')
          ),
          basicButton(
            t("Clear"),
            dom.on('click', () => mappedColumns.get().forEach((col) => col.selected.set(false))),
            testId('visible-clear')
          ),
          testId('visible-batch-buttons')
        ),
      ),
      cssHeader(
        cssFieldListHeader(t("Unmapped")),
        selectAllLabel(
          dom.on('click', () => {
            unmappedColumns.get().forEach((col) => col.selected.set(true));
          }),
          dom.show(/* any unmapped columns */ use => use(unmappedColumns).length > 0),
        ),
      ),
      dom('div',
        testId('hidden-fields'),
        dom.forEach(unmappedColumns, (field) => {
          return this._buildUnmappedField(field);
        })
      ),
      dom.maybe(anyUnmappedSelected, () =>
        cssRow(
          primaryButton(
            dom.text(t("Map fields")),
            dom.on('click', mapSelected),
            testId('visible-hide')
          ),
          basicButton(
            t("Clear"),
            dom.on('click', () => unmappedColumns.get().forEach((col) => col.selected.set(false))),
            testId('visible-clear')
          ),
          testId('visible-batch-buttons')
        ),
      ),
    ];
  }

  private _buildUnmappedField(props: {col: ColumnRec, selected: Observable<boolean>}) {
    const column = props.col;
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
        cssSquareCheckbox(props.selected),
      ),
    );
  }


  private _buildMappedField(props: {col: ColumnRec, selected: Observable<boolean>}) {
    const column = props.col;
    return cssDragRow(
      testId('visible-field'),
      cssSimpleDragger(
        cssSimpleDragger.cls('-hidden'),
      ),
      cssFieldEntry(
        cssFieldLabel(dom.text(column.label)),
        cssHideIcon('EyeHide',
          testId('hide'),
          dom.on('click', () => {
            allCommands.hideFields.run([column.colId.peek()]);
          }),
        ),
        cssSquareCheckbox(props.selected),
      ),
    );
  }
}

function selectAllLabel(...args: any[]) {
  return cssControlLabel(
    testId('select-all'),
    icon('Tick'),
    dom('span', t("Select All")),
    ...args
  );
}

const cssControlLabel = styled('div', `
  --icon-color: ${theme.controlFg};
  color: ${theme.controlFg};
  cursor: pointer;
  line-height: 16px;
`);


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
  &-hidden {
    visibility: hidden !important;
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
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
  line-height: 1em;
  & * {
    line-height: 1em;
  }
`);

const cssSquareCheckbox = styled(squareCheckbox, `
  flex-shrink: 0;
`);
