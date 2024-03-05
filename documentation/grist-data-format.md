# Grist Data Format

Grist Data Format is used to send and receive data from a Grist document. For example, an implementer of an import module would need to translate data to Grist Data Format. A user of Grist Basket APIs would fetch and upload data in Grist Data Format.

The format is optimized for tabular data. A table consists of rows and columns, containing a single value for each row for each column. Various types are supported for the values.

Each column has a name and a type. The type is not strict: a column may contain values of other types. However, the type is the intended type of the value for that column, and allows those values to be represented more efficiently.

Grist Data Format is readily serialized to JSON. Other serializations are possible, for example, see below for a .proto file that allows to serialize Grist Data Format as a protocol buffer.

## Format Specification

### Document

At the top, Grist Data Format is a Document object with a single key “tables” mapping to an array of Tables:

```javascript
    {
       tables: [Tables…]
    }
```

### Table

```javascript
   {
      name: "TableName",
      colinfo: [ColInfo…],
      columns: ColData
   }
```

The `name` is the name of the table. The `colinfo` array has an item to describe each column, and `columns` is the actual table data in column-oriented layout.

### ColInfo

```javascript
   {
      name: "ColName",
      type: "ColType",
      options: <arbitrary options>
   }
```

The `name` is the name of the column, and `type` is its type. The field `options` optionally specifies type-specific options that affect the column (e.g. the number of decimal places to display for a floating-point number).

### ColData
```javascript
   {
          <colName1>: ColValues,
          <colName2>: ColValues,
          ...
   }
```

The data in the table is represented as an object mapping a column name to an array of values for the column. This column-oriented representation allows for the representation of data to be more concise. 

### ColValues
```javascript
   [CellValue, CellValue, ...]
```
ColValues is an array of all values for the column. We'll refer to the type of each value as `CellValue`. ColValues has an entry for each row in the table. In particular, each ColValues array in a ColData object has the same number of entries.

### CellValue
CellValue represents the value in one cell. We support various types of values, documented below. When represented as JSON, CellValue is one  of the following JSON types:
  - string
  - number
  - bool
  - null
  - array of the form `[typeCode, args...]`

The interpretation of CellValue is affected by the column’s type, and described in more detail below.

## JSON Schema

The description above can be summarized by this JSON Schema:
```json
{
  "definitions": {
    "Table": {
      "type": "object",
      "properties": {
        "name":    { "type": "string" },
        "colinfo": { "type": "array", "items": { "$ref": "#/definitions/ColInfo" } }
        "columns": { "$ref": "#/definitions/ColData" }
      }
    },
    "ColInfo": {
      "type": "object",
      "properties": {
        "name":     { "type": "string" },
        "type":     { "type": "string" },
        "options":  { "type": "object" }
      }
    },
    "ColData": {
      "type": "object",
      "additionalProperties": { "$ref": "#/definitions/ColValues" }
    },
    "ColValues": {
      "type": "array",
      "items": { "type": "CellValue" }
    }
  },

  "type": "object",
  "properties": {
    "tables": { "type": "array", "items": { "$ref": "#/definitions/Table" } }
  }
}
```

## Record identifiers

Each table should have a column named `id`, whose values should be unique across the table. It is used to identify records in queries and actions. Its details, including its type, are left for now outside the scope of this specification, because the format isn't affected by them.

## Naming

Names for tables and columns must consist of alphanumeric ASCII characters or underscore (i.e. `[0-9a-zA-Z_]`). They may not start with an underscore or a digit. Different tables and different columns within a table must have unique names case-insensitively (i.e. they cannot differ in case only).

Certain names (`id` being one of them) may be reserved, e.g. by Grist, for internal purposes, and would not be usable for user data. Such restrictions are outside the scope of this specification.

Note that this combination of rules allows tables and column names to be valid identifiers in pretty much every programming language (including Python and Javascript), as well as valid names of columns in databases.

## Value Types

The format supports a number of data types. Some types have a short representation (e.g. `Numeric` as a JSON `number`, and `Text` as a JSON `string`), but all types have an explicit representation as well.

The explicit representation of a value is an array `[typeCode, args...]`. The first member of the array is a string code that defines the type of the value. The rest of the elements are arguments used to construct the actual value.

The following table lists currently supported types and their short and explicit representations.

| **Type Name** | **Short Repr** | **[Type Code, Args...]** | **Description** |
| `Numeric` | `number`* | `['n',number]` | double-precision floating point number |
| `Text` | `string`* | `['s',string]` | Unicode string |
| `Bool` | `bool`* | `['b',bool]` | Boolean value (true or false) |
| `Null` | `null`* | `null` | Null value (no special explicit representation) |
| `Int` | `number` | `['i',number]` | 32-bit integer |
| `Date` | `number` | `['d',number]` | Calendar date, represented as seconds since Epoch to 00:00 UTC on that date. |
| `DateTime` | `number` | `['D',number]` | Instance in time, represented as seconds since Epoch |
| `Reference` | `number` | `['R',number]`  | Identifier of a record in a table. |
| `ReferenceList` | | `['L',number,...]` | List of record identifiers |
| `Choice` | `string` | `['C',string]` | Unicode string selected from a list of choices. |
| `PositionNumber` | `number` | `['P',number]` | a double used to order records relative to each other. |
| `Image` | | `['I',string]` | Binary data representing an image, encoded as base64 |
| `List` | | `['l',values,...]` | List of values of any type. |
| `JSON` | | `['J',object]` | JSON-serializable object |
| `Error` | | `['E',string,string?,value?]` | Exception, with first argument exception type, second an optional message, and optionally a third containing additional info. |

An important goal is to represent data efficiently in the common case. When a value matches the column's type, the short representation is used. For example, in a Numeric column, a Numeric value is represented as a `number`, and in a Date column, a Date value is represented as a `number`.

If a value does not match the column's type, then the short representation is used when it's one of the starred types in the table AND the short type is different from the column's short type.

For example:
- In a Numeric column, Numeric is `number`, Text is `string` (being a starred type), but a Date is `['d',number]`.
- In a Date column, Date is `number`, and Numeric value is `['n',number]`, because even though it's starred, it conflicts with Date's own short type.
- In a Text column, Text is `string`, Numeric is `number` (starred), and Date is `['d',number]` (not starred).

Note how for the common case of a value matching the column's type, we can always use the short representation. But the format still allows values to have an explicit type that's different from the specified one.

Note also that columns of any of the starred types use the same interpretation for contained values.

The primary use case is to allow, for example, storing a value like "N/A" or "TBD" or "Ask Bob" in a column of type Numeric or Date. Another important case is to store errors produced by a computation.

Other complex types may be added in the future.

## Column Types

Any of the types listed in the table above may be specified as a column type.

In addition, a column type may specify type `Any`. For the purpose of type interpretations, it works the same as any of the starred types, but it does not convey anything about the expected type of value for the column.

## Other serializations

Grist Data Format is naturally serialized to JSON, which is fast and convenient to use in Javascript code. It is also possible to serialize it in other ways, e.g. as a Google protobuf.

Here is a `.proto` definition file that allows for efficient protobuf representation of data in Grist Data Format.

```proto
message Document {
   repeated Table tables = 1;
}
message Table {
   string name = 1;
   repeated ColInfo colinfo = 2;
   repeated ColData columns = 3;
}
message ColInfo {
   string name = 1;
   string type = 2;
   string options = 3;
}
message ColData {
  repeated Value value = 1;
}
message Value {
  oneof value {
    double vNumeric = 1;
    string vText = 2;
    bool vBool = 3;
    // Absence of a set field represents a null
    int32 vInt = 5;
    double vDate = 6;
    double vDateTime = 7;
    int32 vReference = 8;
    List vReferenceList = 9;
    string vChoice = 10;
    double vPositionNumber = 11;
    bytes vImage = 12;
    List vList = 13;
    string vJSON = 14;
    List vError = 15;
  }
}
message ValueList {
   repeated Value value = 1;
}
```
