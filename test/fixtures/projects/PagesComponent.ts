import { dom, observable, styled } from 'grainjs';
import { addNewPage, addPages } from "test/fixtures/projects/helpers/Pages";
import { withLocale } from 'test/fixtures/projects/helpers/withLocale';
import { initGristStyles } from "test/fixtures/projects/helpers/gristStyles";

const container = styled('div', `
  width: 240px;
  box-shadow: 0px 2px 4px 0px rgba(0, 0, 0, 0.5);
  padding-top: 20px;
  padding-bottom: 20px;
  float: left;
`);

function setupTest() {
  return [
    container(
      addPages(observable(true)),
    ),
    dom('input', { type: 'button', value: 'create new page' },
      dom.on('click', addNewPage),
      { style: 'float: right;' },
    ),
  ];
}

initGristStyles();
void withLocale(() => dom.update(document.body, setupTest()));
