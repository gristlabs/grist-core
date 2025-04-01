import {addNewButton} from 'app/client/ui/AddNewButton';
import {resizeFlexVHandle} from 'app/client/ui/resizeHandle';
import {dom, makeTestId, observable, styled} from "grainjs";
import {initGristStyles} from "test/fixtures/projects/helpers/gristStyles";

const testId = makeTestId('test-add-');

function setupTest() {
  const isOpen = observable(false);
  return [
    testBox(
      cssFlex(
        {style: 'width: 480px'},
        cssButtonBox({style: 'width: 160px;'}, addNewButton({isOpen: true})),
        resizeFlexVHandle({target: 'left', onSave: () => null}, testId('left-resizer')),
        cssButtonBox({style: 'flex: 1 1 0px;'}, addNewButton({isOpen: true})),
      ),
      cssFlex(
        dom('div', {style: 'margin: auto 16px'},
          dom('input', {type: 'checkbox'},
            testId('expand'),
            dom.prop('checked', isOpen),
            dom.on('change', (ev, elem) => isOpen.set(elem.checked))
          ),
          'Expand this button',
        ),
        dom('div', {style: 'flex: none'},
          dom.style('width', (use) => use(isOpen) ? '240px' : '48px'),
          addNewButton({isOpen})),
      ),
    ),
  ];
}

const cssFlex = styled('div', `display: flex; position: relative; height: 100px`);
const cssButtonBox = styled('div', `min-width: 160px; max-width: 320px;`);

const testBox = styled('div', `
  width: 80vw;
  margin: 1rem;
  box-shadow: 1px 1px 4px 2px #AAA;
  overflow: hidden;
`);

initGristStyles();
dom.update(document.body, setupTest());
