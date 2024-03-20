import {allCommands} from 'app/client/components/commands';
import {FormLayoutNode} from 'app/client/components/FormRenderer';
import {buildEditor} from 'app/client/components/Forms/Editor';
import {FieldModel} from 'app/client/components/Forms/Field';
import {FormView} from 'app/client/components/Forms/FormView';
import {buildMenu} from 'app/client/components/Forms/Menu';
import {BoxModel, LayoutModel} from 'app/client/components/Forms/Model';
import {Paragraph} from 'app/client/components/Forms/Paragraph';
import * as style from 'app/client/components/Forms/styles';
import {makeTestId} from 'app/client/lib/domUtils';
import {makeT} from 'app/client/lib/localization';
import * as menus from 'app/client/ui2018/menus';
import {dom, styled} from 'grainjs';
import {v4 as uuidv4} from 'uuid';

const t = makeT('FormView');

const testId = makeTestId('test-forms-');

/**
 * Component that renders a section of the form.
 */
export class SectionModel extends BoxModel {
  constructor(box: FormLayoutNode, parent: BoxModel | null, view: FormView) {
    super(box, parent, view);
  }

  public override render(): HTMLElement {
    const children = this.children;
    return buildEditor({
      box: this,
      // Custom drag element that is little bigger and at the top of the section.
      drag: style.cssDragWrapper(style.cssDrag('DragDrop', style.cssDrag.cls('-top'))),
      showRemoveButton: use => !use((this.root() as LayoutModel).disableDeleteSection),
      // Content is just a list of children.
      content: style.cssSection(
        // Wrap them in a div that mutes hover events.
        cssSectionItems(
          dom.forEach(children, (child) => child.render()),
        ),
        // Plus icon
        style.cssPlusButton(
          testId('plus'),
          style.cssDrop(),
          style.cssCircle(
            style.cssPlusIcon('Plus'),
            buildMenu({
              box: this,
              customItems: [
                menus.menuItem(
                  () => allCommands.insertFieldBefore.run({structure: 'Section'}),
                  menus.menuIcon('Section'),
                  t('Insert section above'),
                ),
                menus.menuItem(
                  () => allCommands.insertFieldAfter.run({structure: 'Section'}),
                  menus.menuIcon('Section'),
                  t('Insert section below'),
                ),
              ],
            })
          ),
        )
      )},
      style.cssSectionEditor.cls(''),
    );
  }

  public override willAccept(): 'sibling' | 'child' | null {
    return 'child';
  }

  /**
   * Accepts box from clipboard and inserts it before this box or if this is a container box, then
   * as a first child. Default implementation is to insert before self.
   */
  public override accept(dropped: FormLayoutNode) {
    // Get the box that was dropped.
    if (!dropped) { return null; }
    if (dropped.id === this.id) {
      return null;
    }
    // We need to remove it from the parent, so find it first.
    const droppedRef = dropped.id ? this.root().find(dropped.id) : null;
    if (droppedRef) {
      droppedRef.removeSelf();
    }

    // Depending of the type of dropped box we need to insert it in different places.
    // By default we insert it before this box.
    let place = this.placeBeforeMe();
    if (dropped.type === 'Field') {
      // Fields are inserted after last child.
      place = this.placeAfterListChild();
    }

    return place(dropped);
  }

  public async deleteSelf(): Promise<void> {
    // Prepare all the fields that are children of this section for removal.
    const fieldsToRemove = Array.from(this.filter(b => b instanceof FieldModel)) as FieldModel[];
    const fieldIdsToRemove = fieldsToRemove.map(f => f.leaf.get());

    await this.parent?.save(async () => {
      // Remove the fields.
      if (fieldIdsToRemove.length > 0) {
        await this.view.viewSection.removeField(fieldIdsToRemove);
      }

      // Remove each child of this section from the layout.
      this.children.get().forEach(child => { child.removeSelf(); });

      // Remove this section from the layout.
      this.removeSelf();
    });
  }

  public canRemove() {
    return !((this.parent as LayoutModel).disableDeleteSection.get());
  }
}

export function Section(...children: FormLayoutNode[]): FormLayoutNode {
  return {
    id: uuidv4(),
    type: 'Section',
    children: [
      Paragraph('### **Header**'),
      Paragraph('Description'),
      ...children,
    ],
  };
}

const cssSectionItems = styled('div.hover_border', `
`);
