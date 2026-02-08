import { hashCode } from "app/client/lib/hashUtils";
import { splitPageInitial } from "app/client/ui2018/pages";
import { isValidHex, useBindable } from "app/common/gutil";

import emojiRegex from "emoji-regex";
import { BindableValue, dom, DomElementArg, styled } from "grainjs";

export interface DocIconOptions {
  docId: string;
  docName: BindableValue<string>;
  icon?: {
    backgroundColor?: BindableValue<string>;
    color?: BindableValue<string>;
    emoji?: BindableValue<string | null>;
  } | null;
}

export function buildDocIcon(options: DocIconOptions, ...args: DomElementArg[]) {
  const { docId, docName, icon } = options;
  const { color: defaultColor, backgroundColor: defaultBackgroundColor } =
    getDefaultIconColors(docId);
  return cssDocIcon(
    dom.domComputed((use) => {
      const emoji = useBindable(use, icon?.emoji);
      if (isEmoji(emoji)) {
        return cssEmoji(emoji);
      } else {
        return cssInitials(getIconFromName(useBindable(use, docName)));
      }
    }),
    dom.style("color", (use) => {
      const color = useBindable(use, icon?.color);
      return isValidHex(color) ? color : defaultColor;
    }),
    dom.style("background-color", (use) => {
      const backgroundColor = useBindable(use, icon?.backgroundColor);
      return isValidHex(backgroundColor) ?
        backgroundColor :
        defaultBackgroundColor;
    }),
    ...args,
  );
}

export function getDefaultIconColors(docId: string) {
  let index = hashCode(docId) % DEFAULT_DOC_ICON_COLORS.length;
  if (index < 0) {
    index += DEFAULT_DOC_ICON_COLORS.length;
  }
  return DEFAULT_DOC_ICON_COLORS[index];
}

function isEmoji(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  return emojiRegex().test(value);
}

function getIconFromName(name: string) {
  // If name starts with emoji, use this as icon, and name as rest.
  // Reuse the method for getting page initials. If name starts with an emoji we want
  // to show what pages are showing.
  const pageInitials = splitPageInitial(name);
  if (pageInitials.hasEmoji) {
    return pageInitials.initial;
  }

  // Otherwise use first two letters/digits from two first words.
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map(w => [...w][0])
    .join("")
    // https://www.regular-expressions.info/unicode.html
    .replace(/[^\p{L}\p{Nd}]$/u, "")
    .toUpperCase();
}

/**
 * Extract the name part to display from doc name (by removing emoji from the start)
 * and return it. If there is no emoji, return the name as is.
 * If there is an preselected icon, return the name as is.
 */
export function stripIconFromName(name: string, hasIcon: boolean) {
  if (hasIcon) {
    return name;
  }
  // Reuse the page initials logic to get the display name. But if the display name is empty (name contains just the
  // emoji), we want to show this emoji as a name, not the empty string like pages do.
  const pageInitials = splitPageInitial(name);
  return pageInitials.displayName;
}

const DEFAULT_DOC_ICON_COLORS = [
  { color: "#494949", backgroundColor: "#E1FEDE" },
  { color: "#494949", backgroundColor: "#FED6FB" },
  { color: "#494949", backgroundColor: "#CCFEFE" },
  { color: "#494949", backgroundColor: "#FEE7C3" },
  { color: "#494949", backgroundColor: "#E8D0FE" },
  { color: "#494949", backgroundColor: "#FFFACD" },
  { color: "#494949", backgroundColor: "#D3E7FE" },
  { color: "#494949", backgroundColor: "#FECBCC" },
  { color: "#494949", backgroundColor: "#F3E1D2" },
  { color: "#494949", backgroundColor: "#CCCCCC" },
];

const cssDocIcon = styled("div", `
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 48px;
  height: 48px;
  border-radius: 4px;
`);

const cssEmoji = styled("div", `
  font-size: 20px;
`);

const cssInitials = styled("div", `
  font-size: 18px;
  font-weight: 600;
`);
