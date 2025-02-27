import { dom, styled } from "grainjs";
import { dropdownWithSearch } from "app/client/ui/searchDropdown";
import { cssRootVars, testId } from "app/client/ui2018/cssVars";
import { withLocale } from "./helpers/withLocale";

const options = [
  'Foo', 'Bar',
  'Fusion', 'Maya', 'Santa', 'Alice', 'Bob', 'Sam', 'Clara', 'Tarzan',
  'Apple', 'Microsoft', 'Bill Gates', 'Elon Musk', 'Klimt', 'Goran', 'Vengo',
  'Bach', 'Otello', 'Romeo', 'Juliet', 'Grease', 'Stencil', 'Yahoo', 'AOL', 'Bing', 'Google',
  'Meta', 'Metaverse', 'Zoro', 'Atom', 'Tesla', 'Lenovo',
  'A very very long even longer than that nameeeeeee '
    + 'A very very long even longer than that nameeeeeee',
];


function setupTest() {
  const logElem = dom('div');

  const addDropdown = () => dropdownWithSearch<string>({
    options: () => options,
    action: (val) => logElem.appendChild(cssLogEntry(`click: ${val}`, testId('logs'))),
  });

  const resetBtn = () => dom('button', dom.on('click', () => {
    while(logElem.firstChild) { logElem.firstChild.remove(); }
  }), 'Reset', {style: 'width: 50px'}, testId('reset'));

  return cssTestBox(

    cssExample(
      'searchableDropdown with a plain button',
      dom(
        'button', 'Add column',
        addDropdown(),
      )
    ),

    dom('h3', 'Logs: '), resetBtn(),
    logElem
  );
}

const cssTestBox = styled('div', `
  display: flex;
  flex-direction: column;
  margin: 40px;
  max-width: 600px;
`);

const cssLogEntry = styled('p', `
  color: red;
`);

const cssExample = styled('div', `
  margin: 16px;
`);

void withLocale(() => dom.update(document.body, dom.cls(cssRootVars), setupTest()));
