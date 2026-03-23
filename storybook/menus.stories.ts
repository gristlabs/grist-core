import {
  menu, menuDivider, menuIcon, menuItem, menuItemSubmenu, menuSubHeader, menuText,
  searchableMenu, select,
} from "app/client/ui2018/menus";

import { action } from "@storybook/addon-actions";
import { dom, Observable, styled } from "grainjs";

export default {
  title: "Menus",
  parameters: {
    docs: { codePanel: true, source: { type: "code" } },
  },
};

/**
 * Grist popup menus, select dropdowns, and menu building blocks.
 *
 * ```
 * import { menu, menuItem, menuDivider, menuIcon } from "app/client/ui2018/menus";
 * import { select } from "app/client/ui2018/menus";
 *
 * // Attach a menu to any element:
 * dom("button", "Open", menu(() => [
 *   menuItem(() => doThing(), menuIcon("Plus"), "Add item"),
 *   menuDivider(),
 *   menuItem(() => doOther(), "Other action"),
 * ]))
 *
 * // Select dropdown bound to an observable:
 * const fruit = Observable.create(owner, "apple");
 * select(fruit, ["apple", "banana", "mango"])
 * ```
 *
 * `menu()` returns a DomElementMethod — attach it to a trigger element.
 * `menuItem()` takes a click handler, then label/icon content.
 * `select()` binds an observable to a dropdown of options.
 */
export const Overview = {
  render: (_args: any, { owner }: any) => {
    const fruit = Observable.create(owner, "apple");
    return cssRow(
      dom("button", "Click for menu", menu(() => [
        menuSubHeader("Actions"),
        menuItem(() => action("menu")("Add item"), menuIcon("Plus"), "Add item"),
        menuItem(() => action("menu")("Edit"), menuIcon("Pencil"), "Edit"),
        menuDivider(),
        menuItem(() => action("menu")("Delete"), menuIcon("Remove"), "Delete"),
      ])),
      select(fruit, ["apple", "banana", "mango"]),
    );
  },
  parameters: { docs: { source: { type: "code",
    transform: () => `dom("button", "Click for menu", menu(() => [\n` +
      `  menuSubHeader("Actions"),\n` +
      `  menuItem(() => addItem(), menuIcon("Plus"), "Add item"),\n` +
      `  menuItem(() => edit(), menuIcon("Pencil"), "Edit"),\n` +
      `  menuDivider(),\n` +
      `  menuItem(() => remove(), menuIcon("Remove"), "Delete"),\n` +
      `]))` } } },
};

/**
 * A basic dropdown menu with items, dividers, and a sub-header.
 */
export const BasicMenu = {
  render: () =>
    dom("button", "Open menu", menu(() => [
      menuSubHeader("File"),
      menuItem(() => action("menu")("New"), menuIcon("Plus"), "New"),
      menuItem(() => action("menu")("Open"), menuIcon("Folder"), "Open"),
      menuDivider(),
      menuItem(() => action("menu")("Close"), "Close"),
    ])),
  parameters: { docs: { source: { type: "code",
    transform: () => `dom("button", "Open menu", menu(() => [\n` +
      `  menuSubHeader("File"),\n` +
      `  menuItem(() => ..., menuIcon("Plus"), "New"),\n` +
      `  menuItem(() => ..., menuIcon("Folder"), "Open"),\n` +
      `  menuDivider(),\n` +
      `  menuItem(() => ..., "Close"),\n` +
      `]))` } } },
};

/**
 * Nested submenus via `menuItemSubmenu()`.
 */
export const WithSubmenu = {
  render: () =>
    dom("button", "Open menu", menu(() => [
      menuItem(() => action("menu")("Cut"), "Cut"),
      menuItem(() => action("menu")("Copy"), "Copy"),
      menuItemSubmenu(
        () => [
          menuItem(() => action("menu")("Plain text"), "Plain text"),
          menuItem(() => action("menu")("With formatting"), "With formatting"),
        ],
        {},
        "Paste special",
      ),
    ])),
  parameters: { docs: { source: { type: "code",
    transform: () => `menuItemSubmenu(\n` +
      `  () => [\n` +
      `    menuItem(() => ..., "Plain text"),\n` +
      `    menuItem(() => ..., "With formatting"),\n` +
      `  ],\n` +
      `  {},\n` +
      `  "Paste special",\n` +
      `)` } } },
};

/**
 * Menu with a search input that filters items. Useful for long lists.
 */
export const Searchable = {
  render: () => {
    const items = [
      "Alice", "Bob", "Carol", "Dave", "Eve", "Frank",
      "Grace", "Heidi", "Ivan", "Judy",
    ].map(name => ({
      cleanText: name.toLowerCase(),
      label: name,
      action: () => action("menu")(name),
    }));
    return dom("button", "Search menu", menu(() => searchableMenu(items)));
  },
  parameters: { docs: { source: { type: "code",
    transform: () => `const items = names.map(name => ({\n` +
      `  cleanText: name.toLowerCase(),\n` +
      `  label: name,\n` +
      `  action: () => selectUser(name),\n` +
      `}));\n` +
      `dom("button", "Pick user", menu(() => searchableMenu(items)))` } } },
};

/**
 * `menuText()` adds non-interactive explanatory text inside a menu.
 */
export const WithMenuText = {
  render: () =>
    dom("button", "Info menu", menu(() => [
      menuItem(() => action("menu")("Action"), "Do something"),
      menuText("This action cannot be undone."),
    ])),
  parameters: { docs: { source: { type: "code",
    transform: () => `menu(() => [\n` +
      `  menuItem(() => ..., "Do something"),\n` +
      `  menuText("This action cannot be undone."),\n` +
      `])` } } },
};

/**
 * `select()` binds an Observable to a dropdown of string or object options.
 */
export const SelectDropdown = {
  render: (_args: any, { owner }: any) => {
    const choice = Observable.create(owner, "read");
    return cssColumn(
      select(choice, [
        { value: "read", label: "Can view" },
        { value: "write", label: "Can edit" },
        { value: "admin", label: "Is owner" },
      ]),
      dom("div",
        "Selected: ",
        dom.text(use => use(choice)),
      ),
    );
  },
  parameters: { docs: { source: { type: "code",
    transform: () => `const choice = Observable.create(owner, "read");\n` +
      `select(choice, [\n` +
      `  { value: "read", label: "Can view" },\n` +
      `  { value: "write", label: "Can edit" },\n` +
      `  { value: "admin", label: "Is owner" },\n` +
      `])` } } },
};

const cssRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 16px;
`);

const cssColumn = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
`);
