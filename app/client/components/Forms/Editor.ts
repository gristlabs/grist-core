import {allCommands} from 'app/client/components/commands';
import {BoxModel, parseBox} from 'app/client/components/Forms/Model';
import {buildMenu} from 'app/client/components/Forms/Menu';
import * as style from 'app/client/components/Forms/styles';
import {makeTestId, stopEvent} from 'app/client/lib/domUtils';
import {makeT} from 'app/client/lib/localization';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {IconName} from 'app/client/ui2018/IconList';
import {icon} from 'app/client/ui2018/icons';
import {BindableValue, dom, DomContents, IDomArgs, MultiHolder, Observable} from 'grainjs';

const testId = makeTestId('test-forms-');
const t = makeT('FormView.Editor');

interface Props {
  box: BoxModel,
  /** Should we show an overlay */
  overlay?: Observable<boolean>,
  /** Custom drag indicator slot */
  drag?: HTMLElement,
  /**
   * Actual element to put into the editor. This is the main content of the editor.
   */
  content: DomContents,
  /**
   * Click handler. If not provided, then clicking on the editor will select it.
   */
  click?: (ev: MouseEvent, box: BoxModel) => void,
  /**
   * Whether to show the remove button. Defaults to true.
   */
  showRemoveButton?: BindableValue<boolean>,
  /**
   * Custom remove icon.
   */
  removeIcon?: IconName,
  /**
   * Custom remove button rendered atop overlay.
   */
  removeButton?: DomContents,
  /**
   * Tooltip for the remove button.
   */
  removeTooltip?: string,
  /**
   * Position of the remove button. Defaults to inside.
   */
  removePosition?: 'inside'|'right',
  editMode?: Observable<boolean>,
}

export function buildEditor(props: Props, ...args: IDomArgs<HTMLElement>) {
  const owner: MultiHolder = new MultiHolder();
  const {box, overlay} = props;
  const view = box.view;
  const dragHover = Observable.create(owner, false);
  let element: HTMLElement;

  // When element is selected, scroll it into view.
  owner.autoDispose(view.selectedBox.addListener(selectedBox => {
    if (selectedBox === box) {
      element?.scrollIntoView({behavior: 'smooth', block: 'nearest', inline: 'nearest'});
    }
  }));

  // Default remove icon, can be overriden by props.
  const defaultRemoveButton = () => style.cssRemoveButton(
    icon((props.removeIcon as any) ?? 'RemoveBig'),
    dom.on('click', ev => {
      stopEvent(ev);
      box.view.selectedBox.set(box);
      allCommands.deleteFields.run();
    }),
    props.removeButton === null ? null : hoverTooltip(props.removeTooltip ?? t('Delete')),
    style.cssRemoveButton.cls('-right', props.removePosition === 'right'),
  );

  const onClick = (ev: MouseEvent) => {
    // Only if the click was in this element.
    const target = ev.target as HTMLElement;
    if (!target.closest) { return; }
    // Make sure that the closest editor is this one.
    const closest = target.closest(`.${style.cssFieldEditor.className}`);
    if (closest !== element) { return; }

    ev.stopPropagation();
    ev.preventDefault();
    props.click?.(ev, props.box);

    // Mark this box as selected.
    box.view.selectedBox.set(box);
  };

  const dragAbove = Observable.create(owner, false);
  const dragBelow = Observable.create(owner, false);
  const dragging = Observable.create(owner, false);


  return element = style.cssFieldEditor(
    testId('editor'),

    style.cssFieldEditor.cls('-drag-above', use => use(dragAbove) && use(dragHover)),
    style.cssFieldEditor.cls('-drag-below', use => use(dragBelow) && use(dragHover)),

    props.drag ?? style.cssDragWrapper(style.cssDrag('DragDrop')),
    style.cssFieldEditor.cls(`-${props.box.type}`),

    // Turn on active like state when we clicked here.
    style.cssFieldEditor.cls('-selected', box.selected),
    style.cssFieldEditor.cls('-cut', box.cut),
    testId('field-editor-selected', box.selected),

    // Select on click.
    dom.on('click', onClick),

    // Attach context menu.
    buildMenu({
      box,
      context: true,
    }),

    // And now drag and drop support.
    {draggable: "true"},

    // When started, we just put the box into the dataTransfer as a plain text.
    // TODO: this might be very sofisticated in the future.
    dom.on('dragstart', (ev) => {
      // Prevent propagation, as we might be in a nested editor.
      ev.stopPropagation();
      if (props.editMode?.get()) {
        ev.preventDefault();
        return;
      }

      ev.dataTransfer?.setData('text/plain', JSON.stringify(box.toJSON()));
      ev.dataTransfer!.dropEffect = "move";
      dragging.set(true);
    }),

    dom.on('dragover', (ev) => {
      // As usual, prevent propagation.
      ev.stopPropagation();
      ev.preventDefault();
      ev.stopImmediatePropagation();
      // Here we just change the style of the element.
      ev.dataTransfer!.dropEffect = "move";
      dragHover.set(true);

      // If we are being dragged, don't animate anything.
      if (dragging.get()) { return; }

      // We only animate if the box will add dropped element as sibling.
      if (box.willAccept() !== 'sibling') {
        return;
      }

      const myHeight = element.offsetHeight;
      const percentHeight = Math.round((ev.offsetY / myHeight) * 100);

      // If we are in the top half, we want to animate ourselves and transform a little below.
      if (percentHeight < 40) {
        dragAbove.set(true);
        dragBelow.set(false);
      } else if (percentHeight > 60) {
        dragAbove.set(false);
        dragBelow.set(true);
      } else {
        dragAbove.set(false);
        dragBelow.set(false);
      }
    }),

    dom.on('dragleave', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      // Just remove the style and stop propagation.
      dragHover.set(false);
      dragAbove.set(false);
      dragBelow.set(false);
    }),

    dom.on('dragend', () => {
      dragHover.set(false);
      dragAbove.set(false);
      dragBelow.set(false);
      dragging.set(false);
    }),

    dom.on('drop', async (ev) => {
      stopEvent(ev);
      dragHover.set(false);
      dragging.set(false);
      dragAbove.set(false);
      const wasBelow = dragBelow.get();
      dragBelow.set(false);

      const dropped = parseBox(ev.dataTransfer!.getData('text/plain'));
      if (!dropped) { return; }
      // We need to remove it from the parent, so find it first.
      const droppedId = dropped.id;
      if (droppedId === box.id) { return; }
      const droppedModel = box.root().find(droppedId);
      // It might happen that parent is dropped into child, so we need to check for that.
      if (droppedModel?.find(box.id)) { return; }

      if (!box.willAccept(droppedModel)) {
        return;
      }

      // TODO: accept should do the swapping.
      if (box.willAccept(droppedModel) === 'swap') {
        await box.save(async () => {
          box.parent!.swap(box, droppedModel!);
        });
        return;
      }

      await box.save(async () => {
        // When a field is dragged from the creator panel, it has a colId instead of a fieldRef (as there is no
        // field yet). In this case, we need to create a field first.
        if (dropped.type === 'Field' && typeof dropped.leaf === 'string') {
          dropped.leaf = await view.showColumn(dropped.leaf);
        }
        box.accept(dropped, wasBelow ? 'below' : 'above');
      });
    }),

    style.cssFieldEditor.cls('-drag-hover', dragHover),
    style.cssFieldEditorContent(
      props.content,
      style.cssDrop(),
    ),
    testId(box.type),
    testId('element'),
    dom.attr('data-box-model', String(box.type)),
    dom.maybe(overlay, () => style.cssSelectedOverlay()),
    dom.maybe(props.showRemoveButton ?? true, () => [
      props.removeButton ?? dom.maybe(use => !props.editMode || !use(props.editMode), defaultRemoveButton),
    ]),
    ...args,
  );
}
