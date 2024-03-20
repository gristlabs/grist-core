import {FormLayoutNode} from 'app/client/components/FormRenderer';
import {buildEditor} from 'app/client/components/Forms/Editor';
import {FieldModel} from 'app/client/components/Forms/Field';
import {buildMenu} from 'app/client/components/Forms/Menu';
import {BoxModel} from 'app/client/components/Forms/Model';
import * as style from 'app/client/components/Forms/styles';
import {makeTestId} from 'app/client/lib/domUtils';
import {icon} from 'app/client/ui2018/icons';
import * as menus from 'app/client/ui2018/menus';
import {inlineStyle, not} from 'app/common/gutil';
import {bundleChanges, Computed, dom, IDomArgs, MultiHolder, Observable, styled} from 'grainjs';
import {v4 as uuidv4} from 'uuid';

const testId = makeTestId('test-forms-');

export class ColumnsModel extends BoxModel {
  private _columnCount = Computed.create(this, use => use(this.children).length);

  public removeChild(box: BoxModel) {
    if (box.type === 'Placeholder') {
      // Make sure we have at least one rendered.
      if (this.children.get().length <= 1) {
        return;
      }
      return super.removeChild(box);
    }
    // We will replace this box with a placeholder.
    this.replace(box, Placeholder());
  }

  // Dropping a box on this component (Columns) directly will add it as a new column.
  public accept(dropped: FormLayoutNode): BoxModel {
    if (!this.parent) { throw new Error('No parent'); }

    // We need to remove it from the parent, so find it first.
    const droppedRef = dropped.id ? this.root().find(dropped.id) : null;

    // If this is already my child, don't do anything.
    if (droppedRef && droppedRef.parent === this) {
      return droppedRef;
    }

    droppedRef?.removeSelf();

    return this.append(dropped);
  }

  public render(...args: IDomArgs<HTMLElement>): HTMLElement {
    const dragHover = Observable.create(null, false);

    const content: HTMLElement = style.cssColumns(
      dom.autoDispose(dragHover),

      // Pass column count as a css variable (to style the grid).
      inlineStyle(`--css-columns-count`, this._columnCount),

      // Render placeholders as children.
      dom.forEach(this.children, (child) => {
        const toRender = child ?? BoxModel.new(Placeholder(), this);
        return toRender.render(testId('column'));
      }),

      // Append + button at the end.
      cssPlaceholder(
        testId('add'),
        icon('Plus'),
        dom.on('click', () => this.placeAfterListChild()(Placeholder())),
        style.cssColumn.cls('-add-button'),
        style.cssColumn.cls('-drag-over', dragHover),

        dom.on('dragleave', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          // Just remove the style and stop propagation.
          dragHover.set(false);
        }),
        dom.on('dragover', (ev) => {
          // As usual, prevent propagation.
          ev.stopPropagation();
          ev.preventDefault();
          // Here we just change the style of the element.
          ev.dataTransfer!.dropEffect = "move";
          dragHover.set(true);
        }),
      ),

      ...args,
    );
    return buildEditor({ box: this, content });
  }

  public async deleteSelf(): Promise<void> {
    // Prepare all the fields that are children of this column for removal.
    const fieldsToRemove = (Array.from(this.filter(b => b instanceof FieldModel)) as FieldModel[]);
    const fieldIdsToRemove = fieldsToRemove.map(f => f.leaf.get());

    await this.parent?.save(async () => {
      // FormView is particularly sensitive to the order that view fields and
      // the form layout are modified. Specifically, if the layout is
      // modified before view fields are removed, deleting a column with
      // mapped fields inside seems to break. The same issue affects sections
      // containing mapped fields. Reversing the order causes no such issues.
      //
      // TODO: narrow down why this happens and see if it's worth fixing.
      if (fieldIdsToRemove.length > 0) {
        await this.view.viewSection.removeField(fieldIdsToRemove);
      }

      // Remove each child of this column from the layout.
      this.children.get().forEach(child => { child.removeSelf(); });

      // Remove this column from the layout.
      this.removeSelf();
    });
  }
}

export class PlaceholderModel extends BoxModel {
  public render(...args: IDomArgs<HTMLElement>): HTMLElement {
    const [box, view] = [this, this.view];
    const scope = new MultiHolder();

    const liveIndex = Computed.create(scope, (use) => {
      if (!box.parent) { return -1; }
      const parentChildren = use(box.parent.children);
      return parentChildren.indexOf(box);
    });

    const boxModelAt = Computed.create(scope, (use) => {
      const index = use(liveIndex);
      if (index === null) { return null; }
      const childBox = use(box.children)[index];
      if (!childBox) {
        return null;
      }
      return childBox;
    });

    const dragHover = Observable.create(scope, false);

    return cssPlaceholder(
      style.cssDrop(),
      testId('Placeholder'),
      testId('element'),
      dom.attr('data-box-model', String(box.type)),
      dom.autoDispose(scope),

      style.cssColumn.cls('-drag-over', dragHover),
      style.cssColumn.cls('-empty', not(boxModelAt)),
      style.cssColumn.cls('-selected', use => use(view.selectedBox) === box),

      buildMenu({
        box: this,
        insertBox,
        customItems: [menus.menuItem(removeColumn, menus.menuIcon('Remove'), 'Remove Column')],
      }),

      dom.on('contextmenu', (ev) => {
        ev.stopPropagation();
      }),

      dom.on('dragleave', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        // Just remove the style and stop propagation.
        dragHover.set(false);
      }),

      dom.on('dragover', (ev) => {
        // As usual, prevent propagation.
        ev.stopPropagation();
        ev.preventDefault();
        // Here we just change the style of the element.
        ev.dataTransfer!.dropEffect = "move";
        dragHover.set(true);
      }),

      dom.on('drop', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        dragHover.set(false);

        // Get the box that was dropped.
        const dropped = JSON.parse(ev.dataTransfer!.getData('text/plain'));

        // We need to remove it from the parent, so find it first.
        const droppedId = dropped.id;
        const droppedRef = box.root().find(droppedId);

        // Make sure that the dropped stuff is not our parent.
        if (droppedRef) {
          for(const child of droppedRef.traverse()) {
            if (this === child) {
              return;
            }
          }
        }

        // Now we simply insert it after this box.
        bundleChanges(() => {
          droppedRef?.removeSelf();
          const parent = box.parent!;
          parent.replace(box, dropped);
          parent.save().catch(reportError);
        });
      }),
      // If we an occupant, render it.
      dom.maybe(boxModelAt, (child) => child.render()),
      // If not, render a placeholder.
      dom.maybe(not(boxModelAt), () =>
        dom('span', `Column `, dom.text(use => String(use(liveIndex) + 1)))
      ),
      ...args,
    );

    function insertBox(childBox: FormLayoutNode) {
      // Make sure we have at least as many columns as the index we are inserting at.
      if (!box.parent) { throw new Error('No parent'); }
      return box.parent.replace(box, childBox);
    }

    function removeColumn() {
      box.removeSelf();
    }
  }
}

export function Placeholder(): FormLayoutNode {
  return {id: uuidv4(), type: 'Placeholder'};
}

export function Columns(): FormLayoutNode {
  return {id: uuidv4(), type: 'Columns', children: [Placeholder(), Placeholder()]};
}

const cssPlaceholder = styled('div', `
  position: relative;
  & * {
    /* Otherwise it will emit drag events that we want to ignore to avoid flickering */
    pointer-events: none;
  }
`);
