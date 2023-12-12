import * as style from 'app/client/components/Forms/styles';
import {Box, BoxModel, RenderContext} from 'app/client/components/Forms/Model';
import {makeTestId} from 'app/client/lib/domUtils';
import {icon} from 'app/client/ui2018/icons';
import * as menus from 'app/client/ui2018/menus';
import {inlineStyle, not} from 'app/common/gutil';
import {bundleChanges, Computed, dom, MultiHolder, Observable, styled} from 'grainjs';

const testId = makeTestId('test-forms-');

export class ColumnsModel extends BoxModel {
  private _columnCount = Computed.create(this, use => use(this.children).length);

  public removeChild(box: BoxModel) {
    if (box.type.get() === 'Placeholder') {
      // Make sure we have at least one rendered.
      if (this.children.get().length <= 1) {
        return;
      }
      return super.removeChild(box);
    }
    // We will replace this box with a placeholder.
    this.replace(box, Placeholder());
  }

  // Dropping a box on a column will replace it.
  public drop(dropped: Box): BoxModel {
    if (!this.parent) { throw new Error('No parent'); }

    // We need to remove it from the parent, so find it first.
    const droppedId = dropped.id;
    const droppedRef = this.root().find(droppedId);

    // Now we simply insert it after this box.
    droppedRef?.removeSelf();

    return this.parent.replace(this, dropped);
  }
  public render(context: RenderContext): HTMLElement {
    context.overlay.set(false);

    // Now render the dom.
    const renderedDom = style.cssColumns(
      // Pass column count as a css variable (to style the grid).
      inlineStyle(`--css-columns-count`, this._columnCount),

      // Render placeholders as children.
      dom.forEach(this.children, (child) => {
        return this.view.renderBox(
          this.children,
          child || BoxModel.new(Placeholder(), this),
          testId('column')
        );
      }),

      // Append + button at the end.
      dom('div',
        testId('add'),
        icon('Plus'),
        dom.on('click', () => this.placeAfterListChild()(Placeholder())),
        style.cssColumn.cls('-add-button')
      ),
    );
    return renderedDom;
  }
}

export class PlaceholderModel extends BoxModel {

  public render(context: RenderContext): HTMLElement {
    const [box, view, overlay] = [this, this.view, context.overlay];
    const scope = new MultiHolder();
    overlay.set(false);

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
      style.cssDrag(),
      testId('placeholder'),
      dom.autoDispose(scope),

      style.cssColumn.cls('-drag-over', dragHover),
      style.cssColumn.cls('-empty', not(boxModelAt)),
      style.cssColumn.cls('-selected', use => use(view.selectedBox) === box),

      view.buildAddMenu(insertBox, {
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
        if (!droppedRef) { return; }

        // Now we simply insert it after this box.
        bundleChanges(() => {
          droppedRef.removeSelf();
          const parent = box.parent!;
          parent.replace(box, dropped);
          parent.save().catch(reportError);
        });
      }),

      dom.maybeOwned(boxModelAt, (mscope, child) => view.renderBox(mscope, child)),
      dom.maybe(use => !use(boxModelAt) && use(view.isEdit), () => {
        return dom('span', `Column `, dom.text(use => String(use(liveIndex) + 1)));
      }),
    );

    function insertBox(childBox: Box) {
      // Make sure we have at least as many columns as the index we are inserting at.
      if (!box.parent) { throw new Error('No parent'); }
      return box.parent.replace(box, childBox);
    }

    function removeColumn() {
      box.removeSelf();
    }
  }
}

export function Placeholder(): Box {
  return {type: 'Placeholder'};
}

export function Columns(): Box {
  return {type: 'Columns', children: [Placeholder(), Placeholder()]};
}

const cssPlaceholder = styled('div', `
  position: relative;
`);
