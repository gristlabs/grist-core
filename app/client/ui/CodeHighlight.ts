import {theme, vars} from 'app/client/ui2018/cssVars';
import {Theme} from 'app/common/ThemePrefs';
import {getGristConfig} from 'app/common/urlUtils';
import * as ace from 'brace';
import {BindableValue, Computed, dom, DomElementArg, Observable, styled, subscribeElem} from 'grainjs';

// tslint:disable:no-var-requires
require('brace/ext/static_highlight');
require("brace/mode/python");
require("brace/theme/chrome");
require('brace/theme/dracula');

export interface ICodeOptions {
  gristTheme: Computed<Theme>;
  placeholder?: string;
  maxLines?: number;
}

export function buildHighlightedCode(
  code: BindableValue<string>, options: ICodeOptions, ...args: DomElementArg[]
): HTMLElement {
  const {gristTheme, placeholder, maxLines} = options;
  const {enableCustomCss} = getGristConfig();

  const highlighter = ace.acequire('ace/ext/static_highlight');
  const PythonMode = ace.acequire('ace/mode/python').Mode;
  const chrome = ace.acequire('ace/theme/chrome');
  const dracula = ace.acequire('ace/theme/dracula');
  const mode = new PythonMode();

  const codeText = Observable.create(null, '');
  const codeTheme = Observable.create(null, gristTheme.get());

  function updateHighlightedCode(elem: HTMLElement) {
    let text = codeText.get();
    if (text) {
      if (maxLines) {
        // If requested, trim to maxLines, and add an ellipsis at the end.
        // (Long lines are also truncated with an ellpsis via text-overflow style.)
        const lines = text.split(/\n/);
        if (lines.length > maxLines) {
          text = lines.slice(0, maxLines).join("\n") + " \u2026";  // Ellipsis
        }
      }

      const aceTheme = codeTheme.get().appearance === 'dark' && !enableCustomCss ? dracula : chrome;
      elem.innerHTML = highlighter.render(text, mode, aceTheme, 1, true).html;
    } else {
      elem.textContent = placeholder || '';
    }
  }

  return cssHighlightedCode(
    dom.autoDispose(codeText),
    dom.autoDispose(codeTheme),
    elem => subscribeElem(elem, code, (newCodeText) => {
      codeText.set(newCodeText);
      updateHighlightedCode(elem);
      }),
    elem => subscribeElem(elem, gristTheme, (newCodeTheme) => {
      codeTheme.set(newCodeTheme);
      updateHighlightedCode(elem);
    }),
    ...args,
  );
}

// Use a monospace font, a subset of what ACE editor seems to use.
export const cssCodeBlock = styled('div', `
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: ${vars.smallFontSize};
  background-color: ${theme.highlightedCodeBlockBg};
  &[disabled], &.disabled {
    background-color: ${theme.highlightedCodeBlockBgDisabled};
  }
`);

const cssHighlightedCode = styled(cssCodeBlock, `
  position: relative;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  border: 1px solid ${theme.highlightedCodeBorder};
  border-radius: 3px;
  min-height: 28px;
  padding: 5px 6px;
  color: ${theme.highlightedCodeFg};

  &.disabled, &.disabled .ace-chrome, &.disabled .ace-dracula {
    background-color: ${theme.highlightedCodeBgDisabled};
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
    --icon-color: ${theme.iconDisabled};
  }
  &-disabled {
    pointer-events: none;
  }
`);
