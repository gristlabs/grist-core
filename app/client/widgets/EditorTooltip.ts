import {makeT} from 'app/client/lib/localization';
import {ITooltipControl, showTooltip, tooltipCloseButton} from 'app/client/ui/tooltips';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {dom, styled} from 'grainjs';

const t = makeT('EditorTooltip');

export function showTooltipToCreateFormula(editorDom: HTMLElement, convert: () => void) {
  function buildTooltip(ctl: ITooltipControl) {
    return cssConvertTooltip(icon('Convert'),
      cssLink(t('Convert column to formula'),
        dom.on('mousedown', (ev) => { ev.preventDefault(); convert(); }),
        testId('editor-tooltip-convert'),
      ),
      tooltipCloseButton(ctl),
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
  --icon-color: ${theme.controlFg};

  & > .${cssLink.className} {
    margin-left: 8px;
  }
`);
