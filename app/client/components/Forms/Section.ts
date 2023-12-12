import * as style from './styles';
import {BoxModel, RenderContext} from 'app/client/components/Forms/Model';
import {dom} from 'grainjs';

/**
 * Component that renders a section of the form.
 */
export class SectionModel extends BoxModel {
  public render(context: RenderContext) {
    const children = this.children;
    context.overlay.set(false);
    const view = this.view;
    const box = this;

    const element = style.cssSection(
      style.cssDrag(),
      dom.forEach(children, (child) =>
        child ? view.renderBox(children, child) : dom('div', 'Empty')
      ),
      view.buildDropzone(children, box.placeAfterListChild()),
    );

    return element;
  }
}
