import * as style from './styles';
import {buildEditor} from 'app/client/components/Forms/Editor';
import {buildMenu} from 'app/client/components/Forms/Menu';
import {BoxModel} from 'app/client/components/Forms/Model';
import {makeTestId} from 'app/client/lib/domUtils';
import {Box} from 'app/common/Forms';
import {dom, styled} from 'grainjs';

const testId = makeTestId('test-forms-');

/**
 * Component that renders a section of the form.
 */
export class SectionModel extends BoxModel {
  public override render(): HTMLElement {
    const children = this.children;
    return buildEditor({
      box: this,
      // Custom drag element that is little bigger and at the top of the section.
      drag: style.cssDragWrapper(style.cssDrag('DragDrop', style.cssDrag.cls('-top'))),
      // No way to remove section now.
      removeIcon: null,
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
  public override accept(dropped: Box) {
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
}

const cssSectionItems = styled('div.hover_border', `
`);
