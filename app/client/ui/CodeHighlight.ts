import {colors, theme, vars} from 'app/client/ui2018/cssVars';
import * as ace from 'brace';
import {BindableValue, dom, DomElementArg, styled, subscribeElem} from 'grainjs';

// tslint:disable:no-var-requires
require('brace/ext/static_highlight');
require("brace/mode/python");
require("brace/theme/chrome");

export interface ICodeOptions {
  placeholder?: string;
  maxLines?: number;
}

export function buildHighlightedCode(
  code: BindableValue<string>, options: ICodeOptions, ...args: DomElementArg[]
): HTMLElement {
  const highlighter = ace.acequire('ace/ext/static_highlight');
  const PythonMode = ace.acequire('ace/mode/python').Mode;
  const theme = ace.acequire('ace/theme/chrome');
  const mode = new PythonMode();

  return cssHighlightedCode(
    dom('div',
      elem => subscribeElem(elem, code, (codeText) => {
        if (codeText) {
          if (options.maxLines) {
            // If requested, trim to maxLines, and add an ellipsis at the end.
            // (Long lines are also truncated with an ellpsis via text-overflow style.)
            const lines = codeText.split(/\n/);
            if (lines.length > options.maxLines) {
              codeText = lines.slice(0, options.maxLines).join("\n") + " \u2026";  // Ellipsis
            }
          }
          elem.innerHTML = highlighter.render(codeText, mode, theme, 1, true).html;
        } else {
          elem.textContent = options.placeholder || '';
        }
      }),
    ),
    ...args,
  );
}

// Use a monospace font, a subset of what ACE editor seems to use.
export const cssCodeBlock = styled('div', `
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: ${vars.smallFontSize};
  background-color: ${colors.light};
  &[disabled], &.disabled {
    background-color: ${colors.mediumGreyOpaque};
  }
`);

const cssHighlightedCode = styled(cssCodeBlock, `
  position: relative;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  border: 1px solid ${colors.darkGrey};
  border-radius: 3px;
  min-height: 28px;
  padding: 5px 6px;
  color: ${colors.slate};

  &.disabled, &.disabled .ace-chrome {
    background-color: ${colors.mediumGreyOpaque};
  }
  & .ace_line {
    overflow: hidden;
    text-overflow: ellipsis;
  }
`);

export const cssFieldFormula = styled(buildHighlightedCode, `
  flex: auto;
  cursor: pointer;
  margin-top: 4px;
  padding-left: 24px;
  --icon-color: ${theme.accentIcon};

  &-disabled-icon.formula_field_sidepane::before {
    --icon-color: ${theme.lightText};
  }
  &-disabled {
    pointer-events: none;
  }
`);
