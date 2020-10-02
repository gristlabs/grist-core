import {Disposable} from 'app/client/lib/dispose';
import {dom, styled} from 'grainjs';

const modalBacker = styled('div', `
  position: fixed;
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  z-index: 100;
  background-color: rgba(0, 0, 0, 0.5);
`);

const modal = styled('div', `
  background-color: white;
  color: black;
  margin: 0 auto;
  border-radius: 4px;
  box-shadow: 0px 0px 10px 0px rgba(0,0,0,0.2);
  border: 1px solid #aaa;
  padding: 10px;
`);

export const modalHeader = styled('div', `
  font-size: 12pt;
  color: #859394;
  padding: 5px;
`);

export const modalButtonRow = styled('div', `
  width: 70%;
  margin: 0 auto;
  text-align: center;

  & > button {
    width: 80px;
  }
`);

/**
 * A simple modal. Shows up in the middle of the screen with a tinted backdrop.
 * Created with the given body content and width.
 *
 * Closed and disposed via clicking anywhere outside the modal. May also be closed by
 * calling the `dispose()` function.
 */
export class Modal1 extends Disposable {
  private _dom: Element;

  public create(
    body: Element,
    width: number = 300
  ) {
    this._dom = modalBacker(
      modal({style: `width: ${width}px;`, tabindex: "-1"},
        dom.cls('clipboard_focus'),
        body,
        dom.on('click', (e) => e.stopPropagation())
      ),
      dom.on('click', () => this.dispose())
    );
    document.body.appendChild(this._dom);

    this.autoDisposeCallback(() => {
      document.body.removeChild(this._dom);
    });
  }
}
