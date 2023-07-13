import * as ace from 'ace-builds';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {Theme} from 'app/common/ThemePrefs';
import {getGristConfig} from 'app/common/urlUtils';
import {BindableValue, Computed, dom, DomElementArg, Observable, styled, subscribeElem} from 'grainjs';

// ace-builds also has a minified build (src-min-noconflict), but we don't
// use it since webpack already handles minification.
require('ace-builds/src-noconflict/ext-static_highlight');
require('ace-builds/src-noconflict/mode-python');
require('ace-builds/src-noconflict/theme-chrome');
require('ace-builds/src-noconflict/theme-dracula');

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

  const highlighter = ace.require('ace/ext/static_highlight');
  const PythonMode = ace.require('ace/mode/python').Mode;
  const aceDom = ace.require('ace/lib/dom');
  const chrome = ace.require('ace/theme/chrome');
  const dracula = ace.require('ace/theme/dracula');
  const mode = new PythonMode();

  const codeText = Observable.create(null, '');
  const codeTheme = Observable.create(null, gristTheme.get());

  function updateHighlightedCode(elem: HTMLElement) {
    let text = codeText.get();
    if (!text) {
      elem.textContent = placeholder || '';
      return;
    }

    if (maxLines) {
      // If requested, trim to maxLines, and add an ellipsis at the end.
      // (Long lines are also truncated with an ellpsis via text-overflow style.)
      const lines = text.split(/\n/);
      if (lines.length > maxLines) {
        text = lines.slice(0, maxLines).join("\n") + " \u2026";  // Ellipsis
      }
    }

    let aceThemeName: 'chrome' | 'dracula';
    let aceTheme: any;
    if (codeTheme.get().appearance === 'dark' && !enableCustomCss) {
      aceThemeName = 'dracula';
      aceTheme = dracula;
    } else {
      aceThemeName = 'chrome';
      aceTheme = chrome;
    }

    // Rendering highlighted code gives you back the HTML to insert into the DOM, as well
    // as the CSS styles needed to apply the theme. The latter typically isn't included in
    // the document until an Ace editor is opened, so we explicitly import it here to avoid
    // leaving highlighted code blocks without a theme applied.
    const {html, css} = highlighter.render(text, mode, aceTheme, 1, true);
    elem.innerHTML = html;
    aceDom.importCssString(css, `${aceThemeName}-highlighted-code`);
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
