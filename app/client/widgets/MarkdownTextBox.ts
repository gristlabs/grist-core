import { DataRowModel } from 'app/client/models/DataRowModel';
import { ViewFieldRec } from 'app/client/models/entities/ViewFieldRec';
import { buildCodeHighlighter } from 'app/client/ui/CodeHighlight';
import { renderer } from 'app/client/ui/MarkdownCellRenderer';
import { sanitizeHTML } from 'app/client/ui/sanitizeHTML';
import { theme, vars } from 'app/client/ui2018/cssVars';
import { gristThemeObs } from 'app/client/ui2018/theme';
import { NTextBox } from 'app/client/widgets/NTextBox';
import { dom, styled, subscribeBindable } from 'grainjs';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';

/**
 * Creates a widget for displaying Markdown-formatted text.
 */
export class MarkdownTextBox extends NTextBox {
  private _marked: Marked;

  constructor(field: ViewFieldRec) {
    super(field);

    const highlightCodePromise = buildCodeHighlighter({maxLines: 60});
    this._marked = new Marked(
      markedHighlight({
        async: true,
        highlight: async (code) => {
          const highlightCode = await highlightCodePromise;
          return highlightCode(code);
        },
      })
    );
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId()];
    return cssFieldClip(
      cssFieldClip.cls('-text-wrap', this.wrapping),
      dom.style('text-align', this.alignment),
      (el) => dom.autoDisposeElem(el, subscribeBindable(value, async () => {
        el.innerHTML = sanitizeHTML(await this._marked.parse(String(value.peek()), {gfm: false, renderer}));
        this.field.viewSection().events.trigger('rowHeightChange');
      })),
      // Note: the DOM needs to be rebuilt on theme change, as Ace needs to switch between
      // light and dark themes. If we switch to using a custom Grist Ace theme (with CSS
      // variables used for highlighting), we can remove the listener below (and elsewhere).
      (el) => dom.autoDisposeElem(el, subscribeBindable(gristThemeObs(), async () => {
        el.innerHTML = sanitizeHTML(await this._marked.parse(String(value.peek()), {gfm: false, renderer}));
      })),
    );
  }
}

const cssFieldClip = styled('div.field_clip', `
  white-space: nowrap;

  &-text-wrap {
    white-space: normal;
    word-break: break-word;
  }
  &:not(&-text-wrap) p,
  &:not(&-text-wrap) h1,
  &:not(&-text-wrap) h2,
  &:not(&-text-wrap) h3,
  &:not(&-text-wrap) h4,
  &:not(&-text-wrap) h5,
  &:not(&-text-wrap) h6
  {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  & > *:first-child {
     margin-top: 0px !important;
  }
  & > *:last-child {
     margin-bottom: 0px !important;
  }
  & h1, & h2, & h3, & h4, & h5, & h6 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
  }
  & h1 {
    padding-bottom: .3em;
    font-size: 2em;
  }
  & h2 {
    padding-bottom: .3em;
    font-size: 1.5em;
  }
  & h3 {
    font-size: 1.25em;
  }
  & h4 {
    font-size: 1em;
  }
  & h5 {
    font-size: .875em;
  }
  & h6 {
    color: ${theme.lightText};
    font-size: .85em;
  }
  & p, & blockquote, & ul, & ol, & dl, & pre {
    margin-top: 0px;
    margin-bottom: 10px;
  }
  & code, & pre {
    color: ${theme.text};
    font-size: 85%;
    background-color: ${theme.markdownCellLightBg};
    border: 0;
    border-radius: 6px;
  }
  & code {
    padding: .2em .4em;
    margin: 0;
    white-space: nowrap;
  }
  &-text-wrap code {
    white-space: break-spaces;
  }
  & pre {
    padding: 16px;
    overflow: auto;
    line-height: 1.45;
  }
  & pre code {
    font-size: 100%;
    display: inline;
    max-width: auto;
    margin: 0;
    padding: 0;
    overflow: visible;
    line-height: inherit;
    word-wrap: normal;
    background: transparent;
  }
  & pre > code {
    background: transparent;
    white-space: nowrap;
    word-break: normal;
    margin: 0;
    padding: 0;
  }
  &-text-wrap pre > code {
    white-space: normal;
  }
  & pre .ace-chrome, & pre .ace-dracula {
    background: ${theme.markdownCellLightBg} !important;
  }
  & .ace_indent-guide {
    background: none;
  }
  & .ace_static_highlight {
    white-space: nowrap;
  }
  & ul, & ol {
    list-style-position: inside;
    padding-left: 1em;
  }
  & li > ol, & li > ul {
    margin: 0;
  }
  &:not(&-text-wrap) li {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  & li + li,
  & li > ol > li:first-child,
  & li > ul > li:first-child {
    margin-top: .25em;
  }
  & blockquote {
    font-size: ${vars.mediumFontSize};
    border-left: .25em solid ${theme.markdownCellMediumBorder};
    padding: 0 1em;
  }
`);
