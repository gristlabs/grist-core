import GridView from "app/client/components/GridView";
import { makeT } from "app/client/lib/localization";
import { ColumnRec } from "app/client/models/entities/ColumnRec";
import { testId, theme } from "app/client/ui2018/cssVars";
import {
  cssMenuItemCmd,
  ISubMenuOptions,
  menuDivider,
  menuItem,
  menuItemSubmenu,
  menuSubHeader,
} from "app/client/ui2018/menus";
import { RecalcWhen } from "app/common/gristTypes";
import { removePrefix } from "app/common/gutil";
import { tokens } from "app/common/ThemePrefs";
import { dom, styled } from "grainjs";
import moment from "moment-timezone";
import * as weasel from "popweasel";

const t = makeT("GridViewMenus");

// Formula constants - uses $Column as placeholder for column ID
const FORMULAS = {
  // Year formulas
  YEAR: "YEAR($Column) if $Column else None",

  // Month formulas
  MONTH_FULL_WITH_YEAR: '$Column.strftime("%B %Y") if $Column else None',
  MONTH_SORTABLE: '$Column.strftime("%Y-%m") if $Column else None',
  MONTH_SHORT_WITH_YEAR: '$Column.strftime("%b %Y") if $Column else None',
  MONTH_NAME_ONLY: '$Column.strftime("%B") if $Column else None',
  MONTH_NUMBER_ONLY: "MONTH($Column) if $Column else None",

  // Quarter formulas

  // Q1 2024
  QUARTER_DEFAULT: '"Q{}".format((MONTH($Column) - 1) // 3 + 1) + " " + str(YEAR($Column)) if $Column else None',
  // 2024-Q1
  QUARTER_SORTABLE: '"{}-Q{}".format(YEAR($Column), (MONTH($Column) - 1) // 3 + 1) if $Column else None',

  // Week formulas

  // Week 1
  WEEK_DEFAULT: '"Week {}".format(WEEKNUM($Column)) if $Column else None',
  // 2024-W01
  WEEK_SORTABLE: '"{}-W{:02d}".format(YEAR($Column), WEEKNUM($Column)) if $Column else None',

  // Day formulas
  DAY_OF_MONTH: "DAY($Column) if $Column else None",
  FULL_DATE: "DATE(YEAR($Column), MONTH($Column), DAY($Column)) if $Column else None",
  DAY_OF_WEEK_FULL: '$Column.strftime("%A") if $Column else None',
  DAY_OF_WEEK_ABBREVIATED: '$Column.strftime("%a") if $Column else None',
  DAY_OF_WEEK_NUMERIC: "WEEKDAY($Column, 2) if $Column else None",

  // Boundary formulas - Start of
  START_OF_YEAR: "DATE(YEAR($Column), 1, 1) if $Column else None",
  START_OF_QUARTER: "DATE(YEAR($Column), ((MONTH($Column)-1)//3)*3 + 1, 1) if $Column else None",
  START_OF_MONTH: "DATE(YEAR($Column), MONTH($Column), 1) if $Column else None",
  START_OF_WEEK: "DATEADD($Column, days=-WEEKDAY($Column, 3)) if $Column else None",
  START_OF_DAY: "DATE(YEAR($Column), MONTH($Column), DAY($Column)) if $Column else None",
  START_OF_HOUR: "$Column.replace(minute=0, second=0, microsecond=0) if $Column else None",

  // Boundary formulas - End of
  END_OF_YEAR: "DATE(YEAR($Column), 12, 31) if $Column else None",
  END_OF_QUARTER: "EOMONTH(DATE(YEAR($Column), ((MONTH($Column)-1)//3)*3 + 3, 1), 0) if $Column else None",
  END_OF_MONTH: "EOMONTH($Column, 0) if $Column else None",
  END_OF_WEEK: "DATEADD($Column, days=7-WEEKDAY($Column, 3)-1) if $Column else None",
  END_OF_DAY: "DATETIME(YEAR($Column), MONTH($Column), DAY($Column), 23, 59, 59) if $Column else None",
  END_OF_HOUR: "$Column.replace(minute=59, second=59, microsecond=999999) if $Column else None",

  // Time formulas
  HOUR_24: '$Column.strftime("%H") if $Column else None',
  // lstrip to remove leading zero (-I doesn't work on windows)
  HOUR_12: '$Column.strftime("%I %p").lstrip("0") if $Column else None',
  TIME_BUCKET: "if not $Column:\n  return None\n" +
    "hour = HOUR($Column)\n" +
    'if hour < 12:\n  return "Morning"\n' +
    'if hour < 18:\n  return "Afternoon"\n' +
    'return "Evening"',
  MINUTE: "MINUTE($Column) if $Column else None",
  AM_PM: '$Column.strftime("%p") if $Column else None',

  // Relative formulas
  DAYS_UNTIL: 'DATEDIF(TODAY(), $Column, "D") if $Column else None',
  DAYS_SINCE: 'DATEDIF($Column, TODAY(), "D") if $Column else None',
  MONTHS_UNTIL: 'DATEDIF(TODAY(), $Column, "M") if $Column else None',
  MONTHS_SINCE: 'DATEDIF($Column, TODAY(), "M") if $Column else None',
  YEARS_UNTIL: 'DATEDIF(TODAY(), $Column, "Y") if $Column else None',
  YEARS_SINCE: 'DATEDIF($Column, TODAY(), "Y") if $Column else None',
  IS_WEEKEND: "WEEKDAY($Column, 2) >= 6 if $Column else None",
} as const;

// Menu configuration, later on the menu is built out of it.
const CONFIGURATION: Record<string, Section> = {
  quickPicks: {
    header: () => t("Quick Picks"),
    items: [
      {
        label: () => t("Year"),
        example: (date: moment.Moment) => date.year().toString(),
        columnLabel: (col: ColumnRec) => `${col.label()} ${t("Year")}`,
        formula: FORMULAS.YEAR,
        type: "Int",
      },
      {
        label: () => t("Month"),
        example: (date: moment.Moment) => date.format("YYYY-MM"),
        columnLabel: (col: ColumnRec) => `${col.label()} ${t("Month")}`,
        formula: FORMULAS.MONTH_SORTABLE,
        type: "Text",
      },
      {
        label: () => t("Quarter"),
        example: (date: moment.Moment) => `${date.year()}-Q${Math.floor((date.month() - 1) / 3) + 1}`,
        columnLabel: (col: ColumnRec) => `${col.label()} ${t("Quarter")}`,
        formula: FORMULAS.QUARTER_SORTABLE,
        type: "Text",
      },
      {
        label: () => t("Day of week"),
        example: (date: moment.Moment) => date.format("dddd"),
        columnLabel: (col: ColumnRec) => `${col.label()} ${t("Day of week")}`,
        formula: FORMULAS.DAY_OF_WEEK_FULL,
        type: "Text",
      },
    ],
  },
  calendar: {
    header: () => t("Calendar"),
    items: [
      {
        label: () => t("Year"),
        example: (date: moment.Moment) => date.year().toString(),
        columnLabel: (col: ColumnRec) => `${col.label()} ${t("Year")}`,
        formula: FORMULAS.YEAR,
        type: "Int",
      } as PlainItem,
      {
        label: () => t("Quarter"),
        items: [
          {
            label: () => t("Default"),
            example: (date: moment.Moment) => `Q${Math.floor((date.month() - 1) / 3) + 1} ${date.year()}`,
            columnLabel: (col: ColumnRec) => `${col.label()} ${t("Quarter")}`,
            formula: FORMULAS.QUARTER_DEFAULT,
            type: "Text",
            default: true,
          },
          {
            label: () => t("Sortable"),
            example: (date: moment.Moment) => `${date.year()}-Q${Math.floor((date.month() - 1) / 3) + 1}`,
            columnLabel: (col: ColumnRec) => `${col.label()} ${t("Quarter")}`,
            formula: FORMULAS.QUARTER_SORTABLE,
            type: "Text",
          },
        ],
      } as SubmenuItem,
      {
        label: () => t("Month"),
        items: [
          {
            label: () => t("Full name with year"),
            example: (date: moment.Moment) => date.format("MMMM YYYY"),
            columnLabel: (col: ColumnRec) => `${col.label()} ${t("Month")}`,
            formula: FORMULAS.MONTH_FULL_WITH_YEAR,
            default: true,
            type: "Text",
          },
          {
            label: () => t("Sortable"),
            example: (date: moment.Moment) => date.format("YYYY-MM"),
            columnLabel: (col: ColumnRec) => `${col.label()} ${t("Month")}`,
            formula: FORMULAS.MONTH_SORTABLE,
            type: "Text",
          },
          {
            label: () => t("Short with year"),
            example: (date: moment.Moment) => date.format("MMM YYYY"),
            columnLabel: (col: ColumnRec) => `${col.label()} ${t("Month")}`,
            formula: FORMULAS.MONTH_SHORT_WITH_YEAR,
            type: "Text",
          },
          {
            label: () => t("Name only"),
            example: (date: moment.Moment) => date.format("MMMM"),
            columnLabel: (col: ColumnRec) => `${col.label()} ${t("Month")}`,
            formula: FORMULAS.MONTH_NAME_ONLY,
            type: "Text",
          },
          {
            label: () => t("Number only"),
            example: (date: moment.Moment) => date.format("MM"),
            columnLabel: (col: ColumnRec) => `${col.label()} ${t("Month")}`,
            formula: FORMULAS.MONTH_NUMBER_ONLY,
            type: "Int",
          },
        ],
      },
      {
        label: () => t("Week of year"),
        items: [
          {
            label: () => t("Default"),
            example: (date: moment.Moment) => `Week ${date.isoWeek()}`,
            columnLabel: (col: ColumnRec) => `${col.label()} ${t("Week")}`,
            formula: FORMULAS.WEEK_DEFAULT,
            default: true,
            type: "Text",
          },
          {
            label: () => t("Sortable"),
            example: (date: moment.Moment) => `${date.format("YYYY")}-W${date.format("WW")}`,
            columnLabel: (col: ColumnRec) => `${col.label()} ${t("Week")}`,
            formula: FORMULAS.WEEK_SORTABLE,
            type: "Text",
          },
        ],
      },
      {
        label: () => t("Day"),
        items: [
          {
            label: () => t("Day of month"),
            example: (date: moment.Moment) => date.format("DD"),
            columnLabel: (col: ColumnRec) => `${col.label()} Day of month`,
            formula: FORMULAS.DAY_OF_MONTH,
            type: "Int",
          },
          {
            label: () => t("Full date"),
            example: (date: moment.Moment) => date.format("YYYY-MM-DD"),
            columnLabel: (col: ColumnRec) => `${col.label()} Full date`,
            formula: FORMULAS.FULL_DATE,
            type: "Date",
          },
          {
            label: () => t("Day of week (full)"),
            example: (date: moment.Moment) => date.format("dddd"),
            columnLabel: (col: ColumnRec) => `${col.label()} ${t("Day of week")}`,
            formula: FORMULAS.DAY_OF_WEEK_FULL,
            type: "Text",
            default: true,
          },
          {
            label: () => t("Day of week (abbrev)"),
            example: (date: moment.Moment) => date.format("ddd"),
            columnLabel: (col: ColumnRec) => `${col.label()} ${t("Day of week")}`,
            formula: FORMULAS.DAY_OF_WEEK_ABBREVIATED,
            type: "Text",
          },
          {
            label: () => t("Day of week (numeric)"),
            example: (date: moment.Moment) => date.isoWeekday().toString(),
            columnLabel: (col: ColumnRec) => `${col.label()} ${t("Day of week")}`,
            formula: FORMULAS.DAY_OF_WEEK_NUMERIC,
            type: "Int",
          },
          {
            label: () => t("Is weekend?"),
            example: (date: moment.Moment) => date.day() === 0 || date.day() === 6 ? "Yes" : "No",
            columnLabel: (col: ColumnRec) => `${col.label()} Is weekend?`,
            formula: FORMULAS.IS_WEEKEND,
            type: "Bool",
          },
        ],
      },
    ],
  },
  intervals: {
    header: () => t("Intervals"),
    items: [
      {
        label: () => t("Start of"),
        items: [
          {
            label: () => t("Year"),
            example: (date: moment.Moment) => date.clone().startOf("year").format("YYYY-MM-DD"),
            columnLabel: (col: ColumnRec) => `${col.label()} Start of Year`,
            formula: FORMULAS.START_OF_YEAR,
            type: "Date",
          },
          {
            label: () => t("Quarter"),
            example: (date: moment.Moment) => date.clone().startOf("quarter").format("YYYY-MM-DD"),
            columnLabel: (col: ColumnRec) => `${col.label()} Start of Quarter`,
            formula: FORMULAS.START_OF_QUARTER,
            type: "Date",
          },
          {
            label: () => t("Month"),
            example: (date: moment.Moment) => date.clone().startOf("month").format("YYYY-MM-DD"),
            columnLabel: (col: ColumnRec) => `${col.label()} Start of Month`,
            formula: FORMULAS.START_OF_MONTH,
            type: "Date",
          },
          {
            label: () => t("Week"),
            example: (date: moment.Moment) => date.clone().startOf("isoWeek").format("YYYY-MM-DD"),
            columnLabel: (col: ColumnRec) => `${col.label()} Start of Week`,
            formula: FORMULAS.START_OF_WEEK,
            type: "Date",
          },
          {
            label: () => t("Day"),
            example: (date: moment.Moment) => date.clone().startOf("day").format("YYYY-MM-DD HH:mm:ss"),
            columnLabel: (col: ColumnRec) => `${col.label()} Start of Day`,
            formula: FORMULAS.START_OF_DAY,
            type: "DateTime",
          },
          {
            label: () => t("Hour"),
            example: (date: moment.Moment) => date.clone().startOf("hour").format("YYYY-MM-DD HH:mm:ss"),
            columnLabel: (col: ColumnRec) => `${col.label()} Start of Hour`,
            formula: FORMULAS.START_OF_HOUR,
            type: "DateTime",
          },
        ],
      },
      {
        label: () => t("End of"),
        items: [
          {
            label: () => t("Year"),
            example: (date: moment.Moment) => date.clone().endOf("year").format("YYYY-MM-DD"),
            columnLabel: (col: ColumnRec) => `${col.label()} End of Year`,
            formula: FORMULAS.END_OF_YEAR,
            type: "Date",
          },
          {
            label: () => t("Quarter"),
            example: (date: moment.Moment) => date.clone().endOf("quarter").format("YYYY-MM-DD"),
            columnLabel: (col: ColumnRec) => `${col.label()} End of Quarter`,
            formula: FORMULAS.END_OF_QUARTER,
            type: "Date",
          },
          {
            label: () => t("Month"),
            example: (date: moment.Moment) => date.clone().endOf("month").format("YYYY-MM-DD"),
            columnLabel: (col: ColumnRec) => `${col.label()} End of Month`,
            formula: FORMULAS.END_OF_MONTH,
            type: "Date",
          },
          {
            label: () => t("Week"),
            example: (date: moment.Moment) => date.clone().endOf("isoWeek").format("YYYY-MM-DD"),
            columnLabel: (col: ColumnRec) => `${col.label()} End of Week`,
            formula: FORMULAS.END_OF_WEEK,
            type: "Date",
          },
          {
            label: () => t("Day"),
            example: (date: moment.Moment) => date.clone().endOf("day").format("YYYY-MM-DD HH:mm:ss"),
            columnLabel: (col: ColumnRec) => `${col.label()} End of Day`,
            formula: FORMULAS.END_OF_DAY,
            type: "DateTime",
          },
          {
            label: () => t("Hour"),
            example: (date: moment.Moment) => date.clone().endOf("hour").format("YYYY-MM-DD HH:mm:ss"),
            columnLabel: (col: ColumnRec) => `${col.label()} End of Hour`,
            formula: FORMULAS.END_OF_HOUR,
            type: "DateTime",
          },
        ],
      },
      {
        label: () => t("Relative"),
        items: [
          {
            label: () => t("Days since"),
            example: (date: moment.Moment) => moment().diff(date, "days").toString(),
            columnLabel: (col: ColumnRec) => `${col.label()} Days since`,
            formula: FORMULAS.DAYS_SINCE,
            type: "Int",
          },
          {
            label: () => t("Days until"),
            example: (date: moment.Moment) => moment(date).diff(moment(), "days").toString(),
            columnLabel: (col: ColumnRec) => `${col.label()} Days until`,
            formula: FORMULAS.DAYS_UNTIL,
            type: "Int",
          },
          {
            label: () => t("Months since"),
            example: (date: moment.Moment) => moment().diff(date, "months").toString(),
            columnLabel: (col: ColumnRec) => `${col.label()} Months since`,
            formula: FORMULAS.MONTHS_SINCE,
            type: "Int",
          },
          {
            label: () => t("Months until"),
            example: (date: moment.Moment) => moment(date).diff(moment(), "months").toString(),
            columnLabel: (col: ColumnRec) => `${col.label()} Months until`,
            formula: FORMULAS.MONTHS_UNTIL,
            type: "Int",
          },
          {
            label: () => t("Years since"),
            example: (date: moment.Moment) => moment().diff(date, "years").toString(),
            columnLabel: (col: ColumnRec) => `${col.label()} Years since`,
            formula: FORMULAS.YEARS_SINCE,
            type: "Int",
          },
          {
            label: () => t("Years until"),
            example: (date: moment.Moment) => moment(date).diff(moment(), "years").toString(),
            columnLabel: (col: ColumnRec) => `${col.label()} Years until`,
            formula: FORMULAS.YEARS_UNTIL,
            type: "Int",
          },
        ],
      },
    ],
  },
  time: {
    header: () => t("Time"),
    items: [
      {
        label: () => t("Hour"),
        items: [
          {
            label: () => t("24-hour format"),
            example: (date: moment.Moment) => date.format("HH"),
            columnLabel: (col: ColumnRec) => `${col.label()} Hour`,
            formula: FORMULAS.HOUR_24,
            type: "Text",
            default: true,
          },
          {
            label: () => t("12-hour format"),
            example: (date: moment.Moment) => date.format("h A"),
            columnLabel: (col: ColumnRec) => `${col.label()} Hour`,
            formula: FORMULAS.HOUR_12,
            type: "Text",
          },
          {
            label: () => t("Time bucket"),
            example: (date: moment.Moment) =>
              date.hour() < 12 ? "Morning" : date.hour() < 18 ? "Afternoon" : "Evening",
            columnLabel: (col: ColumnRec) => `${col.label()} Hour`,
            formula: FORMULAS.TIME_BUCKET,
            type: "Text",
          },
        ],
      },
      {
        label: () => t("Minute"),
        example: (date: moment.Moment) => date.format("mm"),
        columnLabel: (col: ColumnRec) => `${col.label()} Minute`,
        formula: FORMULAS.MINUTE,
        type: "Int",
      },
      {
        label: () => t("AM/PM"),
        example: (date: moment.Moment) => date.format("A"),
        columnLabel: (col: ColumnRec) => `${col.label()} AM/PM`,
        formula: FORMULAS.AM_PM,
        type: "Text",
      },
    ],
  },
};

// Helper function to get formula with actual column ID
const getFormula = (formulaTemplate: string, colId: string): string => {
  return formulaTemplate.replace(/\$Column/g, `$${colId}`);
};

/**
 * Leaf in the menu (item without subitems).
 */
interface PlainItem {
  formula: string;
  type: string;
  columnLabel: (col: ColumnRec) => string;
  label: () => string;
  default?: boolean; // if true, clicking on the parent item will create this item
  example?: (date: moment.Moment) => string;
}

/**
 * Submenu item, it can be clicked (so invoked) if it has a default item.
 */
interface SubmenuItem {
  label: () => string;
  items: PlainItem[];
}

/**
 * Section content, either a plain item or a submenu item.
 */
type SectionItem = PlainItem | SubmenuItem;

/**
 * Section in the menu, with a header and items.
 */
interface Section {
  header: () => string;
  items: SectionItem[];
}

/**
 * Builds a submenu for adding columns with date helpers from existing Date/DateTime columns.
 */
export function buildDateHelpersMenuItems(gridView: GridView, index?: number) {
  const { viewSection } = gridView;

  // We will only show Date and DateTime columns (not fields, so hidden ones are out too).
  const dateColumns = viewSection.columns().filter((col: ColumnRec) =>
    // First filter is just for the types.
    col.pureType() === "Date" || col.pureType() === "DateTime",
  );

  // If there are no available date columns, don't show the menu at all.
  if (dateColumns.length === 0) {
    return null;
  }

  // Helper to get the value of a column in the current row, falling back to current time.
  // This is used to show an example of the formula output.
  // If there is no current row, or no value in the current row, we use current time.
  // We also take care of timezone for DateTime columns, but only for the preview, the final
  // formula might not take this into account (we don't have python support for that).
  const valueInColumn = (colId: string) => {
    try {
      const col = gridView.viewSection.columns().find(c => c.colId() === colId);
      if (!col) {
        return moment();
      }
      const timezone = (col.pureType() === "DateTime" ? removePrefix(col.type(), "DateTime:") : null) || "UTC";
      const rowModel = gridView.viewData.at(gridView.cursor.rowIndex.peek() || 0);
      if (!rowModel || !(colId in rowModel)) {
        // Always use current time as fallback for consistency
        return moment.tz(moment(), timezone);
      }
      const timestamp = (rowModel as any)[colId].peek();
      if (typeof timestamp !== "number") {
        return moment.tz(moment(), timezone);
      }
      // If no value in selected row, use current time for consistency
      const date = timestamp ? moment.tz(timestamp * 1000, timezone) : moment.tz(moment(), timezone);
      return date;
    }
    catch (ex) {
      console.warn(`Can not read current value of column: ${ex}`);
      // Always use current time as fallback for consistency
      return moment();
    }
  };

  /**
   * Menu item handler, creates a formula column based on the option and the column.
   */
  const handler = (option: PlainItem, col: ColumnRec) => async () => {
    const columnLabel = option.columnLabel(col);
    // Copy the column type to preserve timezone if any.
    let type = col.pureType() === "DateTime" && option.type === "DateTime" ? col.type() : option.type;
    if (type === "DateTime") {
      type += `:UTC`; // Default to UTC, user can change it later if needed.
    }
    await gridView.insertColumn(columnLabel, {
      colInfo: {
        label: columnLabel,
        type,
        isFormula: true,
        formula: getFormula(option.formula, col.colId()),
        recalcWhen: RecalcWhen.DEFAULT,
        recalcDeps: null,
      },
      index,
      skipPopup: true,
    });
  };

  // Helper to render the label from the configuration (that is either string or function)
  const renderLabel = (option: SectionItem) => {
    return dom("span",
      typeof option.label === "function" ? option.label() : option.label,
      testId("date-helpers-item-label"),
    );
  };

  // Helper to render the example from the configuration (if any)
  const renderExample = (option: SectionItem, col: ColumnRec, current: moment.Moment) => {
    if ("example" in option && option.example) {
      return [
        cssExample(
          option.example(current),
          testId("date-helpers-item-example"),
        ),
        cssMinWidth.cls(""),
        cssMenuItemCmd.cls(""),
      ];
    }
    return null;
  };

  // Helper function to create a menu item from an option
  const createMenuItem = (option: PlainItem, col: ColumnRec, current: moment.Moment) => {
    return menuItem(
      handler(option, col),
      renderLabel(option),
      renderExample(option, col, current),
    ) as HTMLElement;
  };

  // Helper to create test ID out of menu labels. The idea here is simple, each test id looks like:
  // date-helpers-item-{section}-{first-level}-{second-level} where the last part is optional.
  // Each part is lowercased, spaces replaced with dashes, and all other non-alphanumeric characters
  // removed. This should give us stable and readable test IDs. Those ids are defined statically above, so
  // they are not user/data dependent.
  const makeTestPart = (s: string) => s.replace(/\s+/g, "-").toLowerCase().replace(/[^0-9a-z-]/g, "");
  const itemTestId = (sectionName: string, firstLevel: string, secondLevel?: string) => {
    let result = `date-helpers-item-${makeTestPart(sectionName)}-${makeTestPart(firstLevel)}`;
    if (secondLevel) {
      result += `-${makeTestPart(secondLevel)}`;
    }
    return testId(result);
  };

  // Main renderer of a section from the configuration we have.
  const processSection = (section: Section, col: ColumnRec, needsDivider: boolean, current: moment.Moment) => {
    const items: Element[] = [];

    if (needsDivider) {
      items.push(menuDivider());
    }

    items.push(menuSubHeader(section.header));

    const isDateTime = col.pureType() === "DateTime";

    // Process items - they can be direct items or submenu items
    for (const item of section.items) {
      // Check if this item has sub-items (making it a submenu)
      if ("items" in item) {
        // This is a submenu item
        const submenuLabel = item.label();
        // Filter out DateTime-only items if column is Date
        const filteredItems = isDateTime ?
          item.items :
          item.items.filter(opt => !opt.type.startsWith("DateTime"));

        if (filteredItems.length === 0) {
          continue; // Skip empty submenus
        }

        const defaultItem = filteredItems.find(subItem => subItem.default);
        const options: ISubMenuOptions = {};
        if (defaultItem) {
          options.action = handler(defaultItem, col);
        }
        items.push(
          menuItemSubmenu(
            () => filteredItems.map(option =>
              dom.update(
                createMenuItem(option, col, current),
                itemTestId(section.header(), submenuLabel, option.label()),
              ),
            ),
            options,
            submenuLabel,
            itemTestId(section.header(), submenuLabel),
          ),
        );
      }
      else {
        // This is a direct menu item
        // Skip DateTime-only items if column is Date
        if (!isDateTime && item.type.startsWith("DateTime")) {
          continue;
        }
        items.push(dom.update(
          createMenuItem(item, col, current),
          itemTestId(section.header(), item.label()),
        ));
      }
    }

    return items;
  };

  return menuItemSubmenu(
    () => dateColumns.map((col: ColumnRec) =>
      menuItemSubmenu(
        () => {
          const menuItems: any[] = [];
          // Iterate over all sections in the config
          Object.entries(CONFIGURATION).forEach(([key, section], sectionIndex) => {
            // Skip time section for Date columns
            if (key === "time" && col.pureType.peek() === "Date") {
              return;
            }
            // First section doesn't need a divider
            const needsDivider = sectionIndex > 0;
            menuItems.push(...processSection(section, col, needsDivider, valueInColumn(col.colId.peek())));
          });
          return menuItems;
        },
        {},
        col.label(),
        testId(`date-helpers-column-${col.colId()}`),
      ),
    ),
    {},
    t("Date helpers…"),
    testId("new-columns-menu-date-helpers"),
  );
}

const cssMinWidth = styled("div", `
  min-width: 220px; /* picked by hand to make sure examples are not too close to the label */
`);

const cssExample = styled("div", `
  border: 1px solid ${theme.cardButtonBorder};
  border-radius: 4px;
  color: ${theme.menuItemIconFg};
  display: block;
  font-family: ${tokens.fontFamilyData};
  margin-left: 16px;
  margin-right: -12px;
  padding: 2px 4px;

  .${weasel.cssMenuItem.className}-sel > & {
    border-color: ${theme.menuItemSelectedFg};
    color: ${theme.menuItemIconSelectedFg};
  }
`);
