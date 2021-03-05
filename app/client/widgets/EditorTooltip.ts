import {ITooltipControl, showTooltip} from 'app/client/ui/tooltips';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {dom, styled} from 'grainjs';

export function showTooltipToCreateFormula(editorDom: HTMLElement, convert: () => void) {
  function buildTooltip(ctl: ITooltipControl) {
    return cssConvertTooltip(icon('Convert'),
      cssLink('Convert column to formula',
        dom.on('mousedown', (ev) => { ev.preventDefault(); convert(); }),
        testId('editor-tooltip-convert'),
      ),
      cssCloseButton(icon('CrossSmall'), dom.on('click', ctl.close)),
    );
  }
  const offerCtl = showTooltip(editorDom, buildTooltip, {key: 'col-to-formula'});

  dom.onDisposeElem(editorDom, offerCtl.close);
  const lis = dom.onElem(editorDom, 'keydown', () => {
    lis.dispose();
    offerCtl.close();
  });
}

const cssConvertTooltip = styled('div', `
  display: flex;
  align-items: center;
  --icon-color: ${colors.lightGreen};

  & > .${cssLink.className} {
    margin-left: 8px;
  }
`);

const cssCloseButton = styled('div', `
  cursor: pointer;
  user-select: none;
  width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  margin: -4px -4px -4px 8px;
  --icon-color: white;
  border-radius: 16px;

  &:hover {
    background-color: white;
    --icon-color: black;
  }
`);
