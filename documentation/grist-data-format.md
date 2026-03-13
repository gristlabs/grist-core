# Grist Data Format

This document describes the data format used in the Grist REST API and Custom
Widget API. It covers how column types map to cell values, and the encoding of
special types.

For API endpoint details, see the [Grist API reference](https://support.getgrist.com/api/).

## Cell Values

Each cell in a Grist table holds a `CellValue`. In JSON, a CellValue is one of:

- `number` — used for Numeric, Int, Date, DateTime, Ref, and similar types
- `string` — used for Text, Choice, and for mismatched values (e.g. `"N/A"` in a Numeric column)
- `boolean` — used for Bool (`true` / `false`)
- `null` — represents an empty cell
- `[code, args...]` — a typed cell value, for lists, errors, and other special values (see below)

The interpretation of a raw `number` or `string` depends on the column's type. For
example, `86400` in a Date column means one day after the Unix epoch (1970-01-02),
while in a Numeric column it is simply the number 86400.

## Column Types and Their Values

A column's type is a string. Some types include a parameter after a colon, for
example `Ref:People` or `DateTime:America/New_York`.

The base types (the part before any colon) are:

| Column Type   | Cell Value Format                      | Default Value | Notes |
|---------------|----------------------------------------|---------------|-------|
| `Text`        | `string`                               | `""`          | |
| `Numeric`     | `number`                               | `0`           | Double-precision float |
| `Int`         | `number`                               | `0`           | Integer |
| `Bool`        | `boolean`                              | `false`       | |
| `Date`        | `number` (seconds since Unix epoch)    | `null`        | Seconds to midnight UTC of that date |
| `DateTime`    | `number` (seconds since Unix epoch)    | `null`        | Full type is `DateTime:<timezone>`, e.g. `DateTime:America/New_York`. May be fractional for sub-second precision |
| `Choice`      | `string`                               | `""`          | One of a configured set of options |
| `ChoiceList`  | `["L", string, ...]`                   | `null`        | List of chosen options |
| `Ref`         | `number` (row ID)                      | `0`           | Full type is `Ref:<TableId>`, e.g. `Ref:People`. A value of `0` means empty |
| `RefList`     | `["L", number, ...]`                   | `null`        | Full type is `RefList:<TableId>`. List of row IDs |
| `Attachments` | `["L", number, ...]`                   | `null`        | List of attachment IDs (a RefList to `_grist_Attachments`) |
| `Any`         | any CellValue                          | `null`        | No type constraint |

Internal types (used by Grist internally, not available to create via the UI):

| Column Type      | Cell Value Format | Default Value |
|------------------|-------------------|---------------|
| `Id`             | `number`          | `0`           |
| `ManualSortPos`  | `number`          | `Infinity`    |
| `PositionNumber` | `number`          | `Infinity`    |

### Date and DateTime

Date and DateTime values are stored as **seconds since the Unix epoch** (1970-01-01
00:00:00 UTC). This is _not_ milliseconds — divide by 1000 if converting from
JavaScript `Date.getTime()`.

- **Date** columns store whole-day values. The number represents seconds to midnight
  UTC on that date. For example, `86400` = 1970-01-02.
- **DateTime** columns store full timestamps as floating-point numbers, supporting
  sub-second precision (e.g. `1704945919.123`). The column type includes a timezone,
  e.g. `DateTime:Europe/London`. The stored number is always in UTC; the timezone
  controls display formatting.

### References

- **Ref** columns store the `id` (row ID) of the referenced record as a plain
  number. A value of `0` means the reference is empty.
- **RefList** columns store a list of row IDs as `["L", id1, id2, ...]`, or `null`
  when empty.

### ChoiceList

A ChoiceList cell contains `null` (no choices selected) or a list encoded as
`["L", "option1", "option2", ...]`.

## Typed Cell Values

When a cell value is an array, its first element is a single-character type code.
These are called "typed cell values" and represent lists, errors, and other
structured data.

| Code | Name           | Format                              | Description |
|------|----------------|-------------------------------------|-------------|
| `L`  | List           | `["L", item, ...]`                  | A list of values. Used for ChoiceList, RefList, and Attachments |
| `l`  | LookUp         | `["l", value, options]`             | An instruction to set a Ref/RefList by looking up the given value rather than specifying a row ID directly. Used when sending values via the API, not in responses |
| `O`  | Dict           | `["O", {key: value}]`              | A dictionary/object |
| `D`  | DateTime       | `["D", timestamp, timezone]`        | DateTime value, e.g. `["D", 1704945919, "UTC"]` |
| `d`  | Date           | `["d", timestamp]`                  | Date value, e.g. `["d", 1704844800]` |
| `R`  | Reference      | `["R", tableId, rowId]`             | Reference, e.g. `["R", "People", 17]` |
| `r`  | ReferenceList  | `["r", tableId, [rowId, ...]]`      | Reference list, e.g. `["r", "People", [1, 2]]` |
| `E`  | Exception      | `["E", name, message?, details?]`   | A formula error |
| `P`  | Pending        | `["P"]`                             | Value is not yet computed |
| `C`  | Censored       | `["C"]`                             | Value hidden by access rules |
| `U`  | Unmarshallable | `["U", repr]`                       | Value that could not be serialized |
| `V`  | Versions       | `["V", versionObj]`                 | Used in document comparisons |
| `S`  | Skip           | `["S"]`                             | Placeholder used in diffs to indicate unchanged rows |

### When Typed Cell Values Appear

By default, most API responses use compact representations: a Date is just a
`number`, a Ref is just a `number`, Text is just a `string`. The typed forms
(`["d", ...]`, `["R", ...]`, etc.) appear in responses in these cases:

- **List types** (ChoiceList, RefList, Attachments) — always `["L", ...]`.
- **Errors** — appear as `["E", ...]`.
- **Type mismatches** — in formula columns, when a cell holds a typed value that
  doesn't match the column's type (e.g. `["d", 1704844800]` appearing in a
  Numeric column).
- **`Any` columns** — where values carry their own type information.

### `cellFormat=typed`

Both the REST API (`/records` and `/data` endpoints) and the Custom Widget API
support an option to return all values using typed cell values. With
`?cellFormat=typed`, every cell value carries its type explicitly:

- Date values become `["d", timestamp]` instead of bare numbers
- DateTime values become `["D", timestamp, timezone]`
- Ref values become `["R", tableId, rowId]`
- RefList values become `["r", tableId, [rowIds...]]` instead of `["L", ...]`
- Attachments become `["r", "_grist_Attachments", [ids...]]`
- ChoiceList stays `["L", ...]`
- Errors remain as `["E", ...]` (in `/records`, they are no longer separated into
  the `errors` field)
- Primitives (Text, Numeric, Int, Bool) remain as primitives

This is useful when reading data from a table without knowing the column types
in advance, since every value is self-describing.

### Errors

When a formula produces an error, the cell value is encoded as
`["E", exceptionName, message?, details?]`.

In the default `/records` response format, errors are extracted into a separate
`errors` field on the record, and the cell value is returned as `null`. With
`?cellFormat=typed`, errors remain inline as `["E", ...]` values.

Common exception names:

| Exception Name       | Displayed As   | Meaning |
|----------------------|----------------|---------|
| `ZeroDivisionError`  | `#DIV/0!`      | Division by zero |
| `TypeError`          | `#TypeError`   | Wrong type in formula |
| `ValueError`         | `#ValueError`  | Invalid value |
| `InvalidTypedValue`  | `#Invalid ...` | Value doesn't match column type |

## Naming Rules

Table and column identifiers must match `[A-Za-z][A-Za-z0-9_]*` — they start with a
letter, followed by letters, digits, or underscores. Names are case-sensitive but
must be unique case-insensitively (i.e. you cannot have both `Name` and `name` in
the same table).

Some identifiers are reserved for internal use, such as `id`, `manualSort`, and
columns starting with `gristHelper_`.

## SQL Endpoint

`POST /api/docs/{docId}/sql` accepts a SQL query against the document's SQLite
database. See the [Grist API reference](https://support.getgrist.com/api/) for
details.

The SQL endpoint queries the SQLite database directly, so values appear in their
storage representation rather than the API's JSON format. The storage details
below reflect current implementation and may change in future versions.

- **Bool** values are stored as `0`/`1`, not `true`/`false`.
- **ChoiceList** values are stored as JSON arrays of strings, e.g.
  `'["red","blue"]'` rather than the API's `["L", "red", "blue"]`.
- **RefList** and **Attachments** values are stored as JSON arrays of row IDs,
  e.g. `'[1,2,3]'` rather than the API's `["L", 1, 2, 3]`.
- Some non-primitive values (errors, complex objects) are stored as binary
  [Python marshal](https://docs.python.org/3/library/marshal.html) blobs.
