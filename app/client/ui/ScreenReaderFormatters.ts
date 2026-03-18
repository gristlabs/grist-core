import { makeT } from "app/client/lib/localization";
import { ViewFieldRec } from "app/client/models/entities/ViewFieldRec";
import { DocData } from "app/common/DocData";
import * as gristTypes from "app/common/gristTypes";

import { extname } from "path";

import { marked, Token, Tokens } from "marked";

const t = makeT("ScreenReaderFormatters");

/**
 * Formats a cell value for screen reader announcement.
 *
 * Depending on the formatter type and widget used, we vocalize things differently.
 * The idea is to make the value understandable by a human when hearing the string.
 *
 * For example, checkboxes values are usually formatted as "true" or "false". For screen readers,
 * we vocalize them as "Checked"/"Unchecked".
 *
 * Note that this specifically returns a string as we can't rely on DOM element semantics when vocalizing content in
 * a aria-live region.
 */
export function formatForScreenReader(field: ViewFieldRec, value: any): string {
  const formatter = field.formatter();
  const widget = formatter.widgetOpts.widget;
  switch (gristTypes.extractTypeFromColType(formatter.type)) {
    case "Attachments":
      return formatAttachments(value, field._table.tableData.docData);
    case "Bool":
      return widget === "Switch" ? formatSwitch(value) : formatCheckbox(value);
    case "Text":
    case "Any":
      if (widget === "HyperLink") {
        return formatHyperLink(value);
      }
      if (widget === "Markdown") {
        return formatMarkdown(value);
      }
      return formatter.formatAny(value);
    default:
      return formatter.formatAny(value);
  }
}

/**
 * Announces each attachment as either "Image" or the file extension (e.g. "PDF").
 */
function formatAttachments(value: any, docData: DocData): string {
  if (!Array.isArray(value)) {
    return "";
  }
  const attachmentIds = value.slice(1) as number[];
  if (!attachmentIds.length) {
    return "";
  }

  const attachmentsTable = docData.getMetaTable("_grist_Attachments");
  const labels = attachmentIds
    .filter(id => !isNaN(id))
    .map((id) => {
      if (attachmentsTable.getValue(id, "imageHeight")) {
        return t("Image");
      }
      const fileName = attachmentsTable.getValue(id, "fileName") || "";
      const fileIdent = attachmentsTable.getValue(id, "fileIdent") || "";
      const extension = extname("x" + fileName).slice(1) || extname("x" + fileIdent).slice(1) || "?";
      return extension.toUpperCase();
    });
  return labels.join(", ");
}

function formatCheckbox(value: any): string {
  return value ? t("Checked") : t("Unchecked");
}

function formatSwitch(value: any): string {
  return value ? t("Toggled on") : t("Toggled off");
}

/**
 * HyperLink values are stored as "label url" (space-separated, last segment is the URL).
 * The display shows only the label part; screen readers should announce it as a link.
 */
function formatHyperLink(value: any): string {
  if (typeof value !== "string" || !value) {
    return "";
  }
  const index = value.lastIndexOf(" ");
  const label = index >= 0 ? value.slice(0, index) : value;
  return t("link {{- label}}", { label });
}

/**
 * Transforms raw markdown (like `# Meeting notes`) to a string meant to be placed in a aria-live region
 * (like `heading Meeting notes`).
 *
 * We do this because DOM content vocalized in live regions is stripped of its semantics, so we can't
 * just use actual DOM elements and rely on screen reader support for HTML (sadly).
 *
 * This is a rather simple translation that doesn't handle everything but does handle the most common cases.
 */
function formatMarkdown(value: any): string {
  if (typeof value !== "string" || !value) {
    return "";
  }
  const tokens = marked.lexer(value, { gfm: false });
  return tokens.map(formatMarkdownToken).filter(Boolean).join("\n");
}

function formatMarkdownToken(token: Token): string {
  switch (token.type) {
    case "heading":
      return t("heading {{- text}}", { text: formatInlineTokens(token.tokens) });
    case "paragraph":
      return formatInlineTokens(token.tokens);
    case "list":
      // Punctuation is not used lightly here. Screen readers make actual pauses on punctuation, so we can
      // use them to help make content more understandable.
      return t("list: {{- items}}", {
        items: token.items.map((item: Tokens.ListItem) => formatInlineTokens(item.tokens)).join(", "),
      });
    case "space":
      return "";
    default:
      return "text" in token ? String(token.text) : "";
  }
}

function formatInlineTokens(tokens: Token[] | undefined): string {
  if (!tokens) {
    return "";
  }
  return tokens.map(formatSingleInlineToken).join("");
}

/**
 * This strips ** and _ "tags", and formats [text](url) as "text (link)".
 */
function formatSingleInlineToken(token: Token): string {
  switch (token.type) {
    case "strong":
    case "em":
      return formatInlineTokens((token as Tokens.Strong | Tokens.Em).tokens);
    case "link":
      return t("{{- text}} (link)", { text: formatInlineTokens((token as Tokens.Link).tokens) });
    default:
      return "text" in token ? String(token.text) : "";
  }
}
