import { domAsync } from 'app/client/lib/domAsync';
import { DataRowModel } from 'app/client/models/DataRowModel';
import { ViewFieldRec } from 'app/client/models/entities/ViewFieldRec';
import { buildCodeHighlighter } from 'app/client/ui/CodeHighlight';
import { renderer } from 'app/client/ui/MarkdownCellRenderer';
import { sanitizeHTML } from 'app/client/ui/sanitizeHTML';
import { theme, vars } from 'app/client/ui2018/cssVars';
import { gristThemeObs } from 'app/client/ui2018/theme';
import { NTextBox } from 'app/client/widgets/NTextBox';
import { AsyncCreate } from 'app/common/AsyncCreate';
import { dom, styled, subscribeElem } from 'grainjs';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import markedLinkifyIt from 'marked-linkify-it';

/**
 * Creates a widget for displaying Markdown-formatted text.
 */
export class MarkdownTextBox extends NTextBox {
  private static _marked?: AsyncCreate<Marked>;

  constructor(field: ViewFieldRec) {
    super(field);

    if (!MarkdownTextBox._marked) {
      MarkdownTextBox._marked = new AsyncCreate(async () => {
        const highlight = await buildCodeHighlighter({ maxLines: 60 });
        return new Marked(
          markedHighlight({
            highlight: (code) => highlight(code),
          }),
          markedLinkifyIt()
        );
      });
    }
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId()];
    return dom(
      "div.field_clip",
      domAsync(
        MarkdownTextBox._marked!.get().then(({ parse }) => {
          const renderMarkdown = (el: HTMLElement) => {
            el.innerHTML = sanitizeHTML(
              parse(String(value.peek()), {
                async: false,
                gfm: false,
                renderer,
              })
            );
          };

          return cssMarkdown(
            cssMarkdown.cls("-text-wrap", this.wrapping),
            dom.style("text-align", this.alignment),
            dom.on("contextmenu", (ev) => {
              // Disable Grist cell context menu on links.
              if ((ev.target as HTMLElement).closest("a")) {
                ev.stopPropagation();
              }
            }),
            (el) => {
              subscribeElem(el, value, () => renderMarkdown(el));
              // Picking up theme changes currently requires a re-render.
              // If we switch to using a custom Ace theme with CSS variables
              // from `cssVars.ts`, we can remove this.
              subscribeElem(el, gristThemeObs(), () => renderMarkdown(el));
              this.field.viewSection().events.trigger("rowHeightChange");
            },
          );
        })
      )
    );
  }
}

const cssMarkdown = styled('div', `
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
  & > :not(blockquote, ol, pre, ul):last-child {
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
    white-space: pre;
  }
  &-text-wrap code {
    white-space: pre-wrap;
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
  & pre .ace-chrome, & pre .ace-dracula {
    background: ${theme.markdownCellLightBg} !important;
  }
  & .ace_indent-guide {
    background: none;
  }
  & .ace_static_highlight {
    white-space: pre;
  }
  &-text-wrap .ace_static_highlight {
    white-space: pre-wrap;
  }
  & ul, & ol {
    padding-left: 2em;
  }
  & li > ol, & li > ul {
    margin: 0;
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
