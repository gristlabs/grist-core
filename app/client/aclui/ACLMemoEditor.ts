import {theme} from 'app/client/ui2018/cssVars';
import {dom, DomElementArg, Observable, styled} from 'grainjs';

export function aclMemoEditor(obs: Observable<string>, ...args: DomElementArg[]): HTMLInputElement {
  return cssMemoInput(
    dom.prop('value', obs),
    dom.on('input', (_e, elem) => obs.set(elem.value)),
    ...args,
  );
}

const cssMemoInput = styled('input', `
  width: 100%;
  min-height: 28px;
  padding: 4px 5px;
  border-radius: 3px;
  border: 1px solid transparent;
  cursor: pointer;
  color: ${theme.controlFg};
  background-color: ${theme.inputBg};
  caret-color : ${theme.inputFg};
  font: 12px 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    border: 1px solid ${theme.inputBorder};
  }
  &:not(&-disabled):focus-within {
    outline: none !important;
    cursor: text;
    box-shadow: inset 0 0 0 1px ${theme.controlFg};
    border-color: ${theme.controlFg};
  }
`);
