import {Ace, loadAce} from 'app/client/lib/imports';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {gristThemeObs} from 'app/client/ui2018/theme';
import {
  BindableValue,
  Disposable,
  DomElementArg,
  Observable,
  styled,
  subscribeElem,
} from 'grainjs';

interface BuildCodeHighlighterOptions {
  maxLines?: number;
}

let _ace: Ace;
let _highlighter: any;
let _PythonMode: any;
let _aceDom: any;
let _chrome: any;
let _dracula: any;
let _mode: any;

async function fetchAceModules() {
  return {
    ace: _ace || (_ace = await loadAce()),
    highlighter: _highlighter || (_highlighter = _ace.require('ace/ext/static_highlight')),
    PythonMode: _PythonMode || (_PythonMode = _ace.require('ace/mode/python').Mode),
    aceDom: _aceDom || (_aceDom = _ace.require('ace/lib/dom')),
    chrome: _chrome || (_chrome = _ace.require('ace/theme/chrome')),
    dracula: _dracula || (_dracula = _ace.require('ace/theme/dracula')),
    mode: _mode || (_mode = new _PythonMode()),
  };
}

/**
 * Returns a function that accepts a string of text representing code and returns
 * a highlighted version of it as an HTML string.
 *
 * This is useful for scenarios where highlighted code needs to be displayed outside of
 * grainjs. For example, when using `marked`'s `highlight` option to highlight code
 * blocks in a Markdown string.
 */
export async function buildCodeHighlighter(options: BuildCodeHighlighterOptions = {}) {
  const {maxLines} = options;
  const {highlighter, aceDom, chrome, dracula, mode} = await fetchAceModules();

  return (code: string) => {
    if (maxLines) {
      // If requested, trim to maxLines, and add an ellipsis at the end.
      // (Long lines are also truncated with an ellpsis via text-overflow style.)
      const lines = code.split(/\n/);
      if (lines.length > maxLines) {
        code = lines.slice(0, maxLines).join("\n") + " \u2026";  // Ellipsis
      }
    }

    let aceThemeName: 'chrome' | 'dracula';
    let aceTheme: any;
    if (gristThemeObs().get().appearance === 'dark') {
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
    const {html, css} = highlighter.render(code, mode, aceTheme, 1, true);
    aceDom.importCssString(css, `${aceThemeName}-highlighted-code`);
    return html;
  };
}

interface BuildHighlightedCodeOptions extends BuildCodeHighlighterOptions {
  placeholder?: string;
}

/**
 * Builds a block of highlighted `code`.
 *
 * Highlighting applies an appropriate Ace theme (Chrome or Dracula) based on
 * the current Grist theme, and automatically re-applies it whenever the Grist
 * theme changes.
 */
export function buildHighlightedCode(
  owner: Disposable,
  code: BindableValue<string>,
  options: BuildHighlightedCodeOptions,
  ...args: DomElementArg[]
): HTMLElement {
  const {placeholder, maxLines} = options;
  const codeText = Observable.create(owner, '');
  const codeTheme = Observable.create(owner, gristThemeObs().get());

  async function updateHighlightedCode(elem: HTMLElement) {
    let text = codeText.get();
    if (!text) {
      elem.textContent = placeholder || '';
      return;
    }

    const {highlighter, aceDom, chrome, dracula, mode} = await fetchAceModules();
    if (owner.isDisposed()) { return; }

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
    if (codeTheme.get().appearance === 'dark') {
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
    elem => subscribeElem(elem, code, async (newCodeText) => {
      codeText.set(newCodeText);
      await updateHighlightedCode(elem);
      }),
    elem => subscribeElem(elem, gristThemeObs(), async (newCodeTheme) => {
      codeTheme.set(newCodeTheme);
      await updateHighlightedCode(elem);
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
  overflow: hidden;
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
    white-space: nowrap;
  }
`);
