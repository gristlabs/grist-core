import {allCommands} from 'app/client/components/commands';
import {makeT} from 'app/client/lib/localization';
import {ColumnRec, ViewSectionRec} from 'app/client/models/DocModel';
import {basicButton, cssButton, primaryButton} from 'app/client/ui2018/buttons';
import {squareCheckbox} from 'app/client/ui2018/checkbox';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {cssDragger} from 'app/client/ui2018/draggableList';
import {icon} from 'app/client/ui2018/icons';
import {unstyledButton} from 'app/client/ui2018/unstyled';
import {visuallyHiddenStyles} from 'app/client/ui2018/visuallyHidden';
import {Computed, Disposable, dom, fromKo, makeTestId, Observable, styled} from 'grainjs';
import * as ko from 'knockout';

const testId = makeTestId('test-vfc-');
const t = makeT('MappedFieldsConfig');

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

    const anyUnmappedSelected = Computed.create(this, (use) => {
      return use(unmappedColumns).some(c => use(c.selected));
    });

    const anyMappedSelected = Computed.create(this, (use) => {
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
      dom('div', {role: 'group', 'aria-labelledby': 'mapped-fields-label'},
        cssHeader(
          cssFieldListHeader(
            dom.text(t("Mapped")),
            {id: 'mapped-fields-label'},
          ),
          selectAllLabel(
            dom.on('click', () => {
              mappedColumns.get().forEach(col => col.selected.set(true));
            }),
            dom.show(/* any mapped columns */ use => use(mappedColumns).length > 0),
            {"aria-describedby": 'mapped-fields-label'},
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
              testId('visible-hide'),
            ),
            basicButton(
              t("Clear"),
              dom.on('click', () => mappedColumns.get().forEach(col => col.selected.set(false))),
              testId('visible-clear')
            ),
            testId('visible-batch-buttons')
          ),
        ),
      ),
      dom('div', {role: 'group', 'aria-labelledby': 'unmapped-fields-label'},
        cssHeader(
          cssFieldListHeader(
            dom.text(t("Unmapped")),
            {id: 'unmapped-fields-label'},
          ),
          selectAllLabel(
            dom.on('click', () => {
              unmappedColumns.get().forEach(col => col.selected.set(true));
            }),
            dom.show(/* any unmapped columns */ use => use(unmappedColumns).length > 0),
            {"aria-describedby": 'unmapped-fields-label'},
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
              testId('hidden-show'),
            ),
            basicButton(
              t("Clear"),
              dom.on('click', () => unmappedColumns.get().forEach(col => col.selected.set(false))),
              testId('hidden-clear')
            ),
            testId('visible-batch-buttons')
          ),
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
        cssHideIconButton(
          icon('EyeShow'),
          testId('hide'),
          dom.on('click', () => {
            allCommands.showColumns.run([column.colId.peek()]);
          }),
          dom.attr('aria-label', use => t("Unmap {{label}}", {label: use(column.label)})),
        ),
        cssSquareCheckbox(
          props.selected,
          dom.attr('aria-label', use => t("Unmap {{label}} (batch mode)", {label: use(column.label)})),
        ),
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
        cssHideIconButton(
          icon('EyeHide'),
          testId('hide'),
          dom.attr('aria-label', use => t("Hide {{label}}", {label: use(column.label)})),
          dom.on('click', () => {
            allCommands.hideFields.run([column.colId.peek()]);
          }),
        ),
        cssSquareCheckbox(
          props.selected,
          dom.attr('aria-label', use => t("Hide {{label}} (batch mode)", {label: use(column.label)})),
        ),
      ),
    );
  }
}

function selectAllLabel(...args: any[]) {
  return cssControlLabel(
    testId('select-all'),
    icon('Tick'),
    dom('span', t("Select all")),
    ...args
  );
}

const cssControlLabel = styled(unstyledButton, `
  --icon-color: ${theme.controlFg};
  color: ${theme.controlFg};
  cursor: pointer;
  line-height: 16px;
`);


// TODO: reuse them
const cssDragRow = styled('div', `
  display: flex;
  align-items: center;
  margin: 0 16px 0px 0px;
  margin-bottom: 2px;
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

const cssHideIconButton = styled(unstyledButton, `
  --icon-color: ${theme.lightText};
  line-height: 1;
  flex: none;
  margin-right: 8px;
  &:not(:focus, :focus-within, .${cssFieldEntry.className}:hover &) {
    ${visuallyHiddenStyles}
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
