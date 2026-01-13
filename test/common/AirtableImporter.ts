import {
  AirtableBaseSchema,
  AirtableFieldSchema,
  AirtableTableSchema,
} from "app/common/airtable/AirtableAPI";
import { gristDocSchemaFromAirtableSchema } from "app/common/airtable/AirtableImporter";
import { ColumnImportSchema } from "app/common/DocSchemaImport";
import { RecalcWhen } from "app/common/gristTypes";

import * as crypto from "crypto";

import { assert } from "chai";

describe("AirtableImporter", function() {
  const firstTableName = "A basic table";
  const firstTableId = tableNameToId(firstTableName);

  function createTableSchema(): AirtableTableSchema {
    return {
      id: firstTableId,
      name: firstTableName,
      primaryFieldId: fieldNameToId("Arbitrary column name 1"),
      fields: [{
        type: "singleLineText",
        id: fieldNameToId("Arbitrary column name 1"),
        name: "Arbitrary column name 1",
      }],
    };
  }

  function createBaseSchema(): AirtableBaseSchema {
    return {
      tables: [createTableSchema()],
    };
  }

  function createBasicAirtableField(name: string, type: string) {
    return {
      id: fieldNameToId(name),
      name,
      type,
      options: {},
    };
  }

  describe("gristDocSchemaFromAirtableSchema", () => {
    it("correctly converts a very basic airtable schema", () => {
      const importSchema = gristDocSchemaFromAirtableSchema(createBaseSchema());
      assert.deepEqual(importSchema, {
        tables: [
          {
            originalId: firstTableId,
            desiredGristId: "A basic table",
            columns: [
              {
                originalId: fieldNameToId("Arbitrary column name 1"),
                desiredGristId: "Arbitrary column name 1",
                label: "Arbitrary column name 1",
                type: "Text",
              },
            ],
          },
        ],
      });
    });

    interface ConvertAirtableFieldParams {
      field: AirtableFieldSchema,
      fieldDependenciesByTable?: { [tableId: string]: AirtableFieldSchema[] },
    }

    function convertAirtableField(params: ConvertAirtableFieldParams) {
      const airtableSchema = createBaseSchema();
      airtableSchema.tables[0].fields[0] = params.field;
      const { fieldDependenciesByTable } = params;
      if (fieldDependenciesByTable) {
        Object.keys(fieldDependenciesByTable).forEach((tableId) => {
          const fields = fieldDependenciesByTable[tableId];
          let table = airtableSchema.tables.find(table => table.id === tableId);
          if (!table) {
            table = {
              id: tableId,
              name: tableId,
              primaryFieldId: fields[0].id,
              fields: [],
            };
            airtableSchema.tables.push(table);
          }
          table.fields.push(...fields);
        });
      }
      const importSchema = gristDocSchemaFromAirtableSchema(airtableSchema);
      return {
        airtableSchema,
        importSchema,
        testField: airtableSchema.tables[0].fields[0],
        testColumn: importSchema.tables[0].columns[0],
      };
    }

    function runBasicFieldTest(field: AirtableFieldSchema, column: ColumnImportSchema) {
      assert.equal(field.id, column.originalId);
      assert.equal(field.name, column.desiredGristId);
      assert.equal(field.name, column.label);
    }

    function basicDeepIncludeFieldTest(
      params: { name: string, type: string },
      includes: (testField: AirtableFieldSchema, testColumn: ColumnImportSchema) => any,
    ) {
      const field = createBasicAirtableField(params.name, params.type);
      const { testField, testColumn } = convertAirtableField({ field });
      runBasicFieldTest(testField, testColumn);
      assert.deepInclude(testColumn, includes);
    }

    it("correctly converts an aiText column", () => {
      const field = createBasicAirtableField("An AiText column", "aiText");
      const referencedField = createBasicAirtableField("A referenced field", "Text");
      const fieldDependenciesByTable = {
        [firstTableId]: [referencedField],
      };

      field.options = {
        referencedFieldIds: [referencedField.id],
        prompt: ["This is an example prompt, referencing field: ", {
          field: {
            fieldId: referencedField.id,
          },
        }],
      };

      // No additional options or changes needed for aiText field.
      const { testField, testColumn } = convertAirtableField({ field, fieldDependenciesByTable });

      runBasicFieldTest(testField, testColumn);

      assert.deepInclude(testColumn, {
        type: "Text",
      });
    });

    it("correctly converts an autoNumber column", () => basicDeepIncludeFieldTest(
      { name: "An autonumber column", type: "autoNumber" },
      (testField, testColumn) => ({
        type: "Numeric",
      }),
    ));

    it("correctly converts a checkbox column", () => basicDeepIncludeFieldTest(
      { name: "A checkbox column", type: "checkbox" },
      (testField, testColumn) => ({
        type: "Bool",
      }),
    ));

    it("correctly converts a count column", () => {
      const field = createBasicAirtableField("A bool column", "count");
      const referencedField = createBasicAirtableField("A referenced field", "Text");
      const fieldDependenciesByTable = {
        [firstTableId]: [referencedField],
      };
      field.options = {
        isValid: true,
        recordLinkFieldId: referencedField.id,
      };
      const { testField, testColumn } = convertAirtableField({ field, fieldDependenciesByTable });
      runBasicFieldTest(testField, testColumn);
      assert.deepInclude(testColumn, {
        type: "Numeric",
        isFormula: true,
        formula: {
          formula: "len($[R0])",
          replacements: [{ originalTableId: firstTableId, originalColId: referencedField.id }],
        },
      });
    });

    it("correctly converts a createdBy column", () => basicDeepIncludeFieldTest(
      { name: "A createdBy column", type: "createdBy" },
      (testField, testColumn) => ({
        type: "Text",
      }),
    ));

    it("correctly converts a createdTime column", () => basicDeepIncludeFieldTest(
      { name: "A createdTime column", type: "createdTime" },
      (testField, testColumn) => ({
        type: "DateTime",
        formula: {
          formula: "NOW()",
        },
        recalcWhen: RecalcWhen.DEFAULT,
      }),
    ));
  });
});

// Field ids seem to be randomly generated, but always 17 characters prefixed with "fld".
// Approximate that by hashing the field name and using the first 14 characters.
function fieldNameToId(name: string) {
  return `fld${crypto.createHash("md5").update(name).digest("base64").substring(0, 14)}`;
}

function tableNameToId(name: string) {
  return `tbl${crypto.createHash("md5").update(name).digest("base64").substring(0, 14)}`;
}

/*
{
  "tables": [
  {
    "id": "tblLmV4L8BRrsDXl4",
    "name": "Minions",
    "primaryFieldId": "fldwpHA5QvxBmPqxA",
    "fields": [
      {
        "type": "singleLineText",
        "id": "fldwpHA5QvxBmPqxA",
        "name": "Name"
      },
      {
        "type": "multipleAttachments",
        "options": {
          "isReversed": true
        },
        "id": "fldpKP3P3h3Z6MD3Q",
        "name": "Minion Photo"
      },
      {
        "type": "singleSelect",
        "options": {
          "choices": [
            {
              "id": "selnwWOnHwdVTBfUU",
              "name": "Skeleton",
              "color": "blueLight2"
            },
            {
              "id": "selDjfvKuCIV2olfD",
              "name": "Zombie",
              "color": "cyanLight2"
            },
            {
              "id": "selmoA5PXK29JDCvQ",
              "name": "Ghost",
              "color": "tealLight2"
            },
            {
              "id": "selkYNkbnj8VTO2Ph",
              "name": "Ghoul",
              "color": "greenLight2"
            },
            {
              "id": "sel0KnE8FF7f9lEVx",
              "name": "Wraith",
              "color": "yellowLight2"
            },
            {
              "id": "selMVxhHeRUTcbflg",
              "name": "Other",
              "color": "orangeLight2"
            }
          ]
        },
        "id": "fld1eD6pnwnxeBZNM",
        "name": "Type"
      },
      {
        "type": "multipleSelects",
        "options": {
          "choices": [
            {
              "id": "seloxlvpY8aGNsReN",
              "name": "Flight",
              "color": "blueLight2"
            },
            {
              "id": "selEyEygqrUqaCyRp",
              "name": "Regeneration",
              "color": "cyanLight2"
            },
            {
              "id": "sel1hAxJDIn7UsPWG",
              "name": "Invisibility",
              "color": "tealLight2"
            },
            {
              "id": "seltgOnWtf3T9i8H0",
              "name": "Strength",
              "color": "greenLight2"
            },
            {
              "id": "selF4XHoJGvxuYYYc",
              "name": "Necrotic Touch",
              "color": "yellowLight2"
            },
            {
              "id": "selHUdjwWOuUC90tU",
              "name": "Shape-shifting",
              "color": "orangeLight2"
            },
            {
              "id": "sel3tt1sLxyMJ4l6v",
              "name": "Other",
              "color": "redLight2"
            }
          ]
        },
        "id": "fldkdoFR7pCEWwr1T",
        "name": "Abilities"
      },
      {
        "type": "number",
        "options": {
          "precision": 3
        },
        "id": "fldIcJdSx3f2yTSk4",
        "name": "Loyalty Level"
      },
      {
        "type": "singleSelect",
        "options": {
          "choices": [
            {
              "id": "selowFPcnoDQ2yNFR",
              "name": "Idle",
              "color": "blueLight2"
            },
            {
              "id": "selUvBLFLJPNMcyXG",
              "name": "On Task",
              "color": "cyanLight2"
            },
            {
              "id": "seluaAd1KoCLd6jbd",
              "name": "Wounded",
              "color": "tealLight2"
            },
            {
              "id": "selI8PMzhc1bs2MQi",
              "name": "Destroyed",
              "color": "greenLight2"
            },
            {
              "id": "selld286BgMOaQJWH",
              "name": "Rebelling",
              "color": "yellowLight2"
            }
          ]
        },
        "id": "fld7eSGFt3kriw8EC",
        "name": "Status"
      },
      {
        "type": "multipleRecordLinks",
        "options": {
          "linkedTableId": "tblTr4RHYreyHdCV3",
          "isReversed": false,
          "prefersSingleRecordLink": false,
          "inverseLinkFieldId": "fldKxO6qNpw1o8uw0"
        },
        "id": "fld7UeI9f5OQRqZTw",
        "name": "Assigned Tasks"
      },
      {
        "type": "count",
        "options": {
          "isValid": true,
          "recordLinkFieldId": "fld7UeI9f5OQRqZTw"
        },
        "id": "fldsfpZnPvtMJaPcB",
        "name": "Number of Assigned Tasks"
      },
      {
        "type": "rollup",
        "options": {
          "isValid": true,
          "recordLinkFieldId": "fld7UeI9f5OQRqZTw",
          "fieldIdInLinkedTable": "fldKORwI0Sk9KVESW",
          "referencedFieldIds": [],
          "result": {
            "type": "number",
            "options": {
              "precision": 0
            }
          }
        },
        "id": "fldYo5v4T6zE3gzpk",
        "name": "Active Task Count"
      },
      {
        "type": "rollup",
        "options": {
          "isValid": true,
          "recordLinkFieldId": "fld7UeI9f5OQRqZTw",
          "fieldIdInLinkedTable": "fldKORwI0Sk9KVESW",
          "referencedFieldIds": [],
          "result": {
            "type": "number",
            "options": {
              "precision": 0
            }
          }
        },
        "id": "fldFqEoWDD04wFlxK",
        "name": "Completed Task Count"
      },
      {
        "type": "rollup",
        "options": {
          "isValid": true,
          "recordLinkFieldId": "fld7UeI9f5OQRqZTw",
          "fieldIdInLinkedTable": "fldKORwI0Sk9KVESW",
          "referencedFieldIds": [],
          "result": {
            "type": "singleLineText"
          }
        },
        "id": "fldiMWFlFLpKHfK3e",
        "name": "Current Task Statuses"
      },
      {
        "type": "aiText",
        "options": {
          "referencedFieldIds": [
            "fld7eSGFt3kriw8EC",
            "fldIcJdSx3f2yTSk4",
            "fld1eD6pnwnxeBZNM",
            "fldiMWFlFLpKHfK3e"
          ],
          "prompt": [
            "You are an expert undead strategist and minion handler for a powerful necromancer,
            specializing in optimizing minion efficiency and loyalty within a castle environment.
            Maintain a tone that is decisive, strategic, and authoritative, suitable for
            advising a ruler of undead forces.\n\nTask description:\n
            Analyze the provided information about the minion's current status, loyalty level,
            minion type, and the statuses of their current tasks. Based on this analysis,
            determine the most effective and appropriate next action for the minion to maximize their
            usefulness and maintain order. Consider their abilities and any risks implied by their loyalty
            or current status. Provide only one clear recommendation.\n\nOutput format:\n
            Output a single sentence recommending the next action for the minion, written in plain text.
            Do not include any introductory or explanatory text, and do not reference the minion by name.
            If you cannot determine a suitable action, output
            \"No recommendation possible with the provided information.\"
            Example: \"Assign to patrol the eastern corridors for intruders.\"
            (Real examples should be tailored to the minion's status and context.)\n\nContext and Data:\n
            Status: ",
            {
              "field": {
                "fieldId": "fld7eSGFt3kriw8EC"
              }
            },
            "\nLoyalty Level: ",
            {
              "field": {
                "fieldId": "fldIcJdSx3f2yTSk4"
              }
            },
            "\nType: ",
            {
              "field": {
                "fieldId": "fld1eD6pnwnxeBZNM"
              }
            },
            "\nCurrent Task Statuses: ",
            {
              "field": {
                "fieldId": "fldiMWFlFLpKHfK3e"
              }
            },
            "\nOutput:\n"
          ]
        },
        "id": "fldsLfeMEq5ZN7SnD",
        "name": "Next Recommended Action"
      },
      {
        "type": "aiText",
        "options": {
          "referencedFieldIds": [
            "fldIcJdSx3f2yTSk4",
            "fld7eSGFt3kriw8EC",
            "fldFqEoWDD04wFlxK"
          ],
          "prompt": [
            "You are an expert loyalty assessor for undead minions, advising a necromancer on the risks
            of rebellion or defection within their ranks. Use a formal, analytical tone appropriate for
            strategic decision-making in a castle setting.\n\nTask description:\nEvaluate the minion's
            loyalty level, current status, and number of completed tasks. Assess the likelihood that the
            minion may rebel or defect, considering factors such as low loyalty, negative status, or
            lack of engagement. Summarize the risk in one or two sentences and assign a risk level:
            Low, Medium, or High. Be concise and specific.\n\nOutput format:\n
            Output a brief risk summary followed by the risk level in parentheses, written in plain text.
            Do not include any additional commentary, headings, or explanations.
            If risk cannot be assessed, output \"Insufficient data to assess risk.\"
            Example: \"Loyalty is high and status is stable; risk of rebellion is low. (Low)\"
            (Real examples should reflect the actual data provided.)\n\nContext and Data:\nLoyalty Level: ",
            {
              "field": {
                "fieldId": "fldIcJdSx3f2yTSk4"
              }
            },
            "\nStatus: ",
            {
              "field": {
                "fieldId": "fld7eSGFt3kriw8EC"
              }
            },
            "\nCompleted Task Count: ",
            {
              "field": {
                "fieldId": "fldFqEoWDD04wFlxK"
              }
            },
            "\nOutput:\n"
          ]
        },
        "id": "fld0TFK3zr6Aa9dTb",
        "name": "Loyalty Risk Assessment"
      },
      {
        "type": "multipleRecordLinks",
        "options": {
          "linkedTableId": "tblkLLznYMr6h3L1n",
          "isReversed": false,
          "prefersSingleRecordLink": false,
          "inverseLinkFieldId": "fld0uI6ARafOl1iCm"
        },
        "id": "fldwW9ouHt64A1Nty",
        "name": "Demo - All Column Types"
      },
      {
        "type": "multipleRecordLinks",
        "options": {
          "linkedTableId": "tblkLLznYMr6h3L1n",
          "isReversed": false,
          "prefersSingleRecordLink": false,
          "inverseLinkFieldId": "fldlwtBXeG74Djqai"
        },
        "id": "fldwHpwU4cX6pqwb3",
        "name": "Test"
      }
    ],
    "views": [
      {
        "id": "viwP3lINsYI7iofqH",
        "name": "Grid view",
        "type": "grid"
      }
    ]
  },
  {
    "id": "tblTr4RHYreyHdCV3",
    "name": "Tasks",
    "primaryFieldId": "fldsDgfhK8DSP5fo6",
    "fields": [
      {
        "type": "singleLineText",
        "id": "fldsDgfhK8DSP5fo6",
        "name": "Task Name"
      },
      {
        "type": "multilineText",
        "id": "fldj39FpKEIl0Ra6i",
        "name": "Objective",
        "description": "Test"
      },
      {
        "type": "multipleRecordLinks",
        "options": {
          "linkedTableId": "tblLmV4L8BRrsDXl4",
          "isReversed": false,
          "prefersSingleRecordLink": false,
          "inverseLinkFieldId": "fld7UeI9f5OQRqZTw"
        },
        "id": "fldKxO6qNpw1o8uw0",
        "name": "Assigned Minions"
      },
      {
        "type": "singleSelect",
        "options": {
          "choices": [
            {
              "id": "selJElha0zGONzb9d",
              "name": "Not Started",
              "color": "blueLight2"
            },
            {
              "id": "selPHNlxb2qknA0pG",
              "name": "In Progress",
              "color": "cyanLight2"
            },
            {
              "id": "seldnO6Wjo7Y4hfZy",
              "name": "Completed",
              "color": "tealLight2"
            },
            {
              "id": "selkeRJZQAM4BjgBy",
              "name": "Failed",
              "color": "greenLight2"
            }
          ]
        },
        "id": "fldKORwI0Sk9KVESW",
        "name": "Progress Status"
      },
      {
        "type": "date",
        "options": {
          "dateFormat": {
            "name": "local",
            "format": "l"
          }
        },
        "id": "fld6XyQrbrbRooVi4",
        "name": "Start Date"
      },
      {
        "type": "date",
        "options": {
          "dateFormat": {
            "name": "local",
            "format": "l"
          }
        },
        "id": "fldBSBtZ30nsLogpl",
        "name": "Due Date"
      },
      {
        "type": "singleSelect",
        "options": {
          "choices": [
            {
              "id": "selgE7F0lo6RqKiHg",
              "name": "Low",
              "color": "blueLight2"
            },
            {
              "id": "seleDznkJSJObPYhE",
              "name": "Medium",
              "color": "cyanLight2"
            },
            {
              "id": "selAhkTaMAxghOGet",
              "name": "High",
              "color": "tealLight2"
            },
            {
              "id": "selItZbpMC4HU4FPx",
              "name": "Critical",
              "color": "greenLight2"
            }
          ]
        },
        "id": "fldCicD8iqyNWXgIU",
        "name": "Priority Level"
      },
      {
        "type": "multipleAttachments",
        "options": {
          "isReversed": true
        },
        "id": "fldIKyceWPtZCxa5J",
        "name": "Task Photo"
      },
      {
        "type": "singleLineText",
        "id": "fldHdjGVe36oe7XSF",
        "name": "Reward"
      },
      {
        "type": "multilineText",
        "id": "fldPP0XoPwbv3C24d",
        "name": "Notes"
      },
      {
        "type": "formula",
        "options": {
          "isValid": true,
          "formula": "DATETIME_DIFF({fldBSBtZ30nsLogpl}, TODAY(), 'days')",
          "referencedFieldIds": [
            "fldBSBtZ30nsLogpl"
          ],
          "result": {
            "type": "number",
            "options": {
              "precision": 0
            }
          }
        },
        "id": "fldNI7hjRy6k6MVVW",
        "name": "Days Until Due"
      },
      {
        "type": "count",
        "options": {
          "isValid": true,
          "recordLinkFieldId": "fldKxO6qNpw1o8uw0"
        },
        "id": "flda6wvlVO1MCeuIO",
        "name": "Assigned Minion Count"
      },
      {
        "type": "rollup",
        "options": {
          "isValid": true,
          "recordLinkFieldId": "fldKxO6qNpw1o8uw0",
          "fieldIdInLinkedTable": "fldIcJdSx3f2yTSk4",
          "referencedFieldIds": [],
          "result": {
            "type": "number",
            "options": {
              "precision": 0
            }
          }
        },
        "id": "fld9JzsSvUK5HKdB8",
        "name": "Average Loyalty of Assigned Minions"
      },
      {
        "type": "rollup",
        "options": {
          "isValid": true,
          "recordLinkFieldId": "fldKxO6qNpw1o8uw0",
          "fieldIdInLinkedTable": "fld1eD6pnwnxeBZNM",
          "referencedFieldIds": [],
          "result": {
            "type": "singleLineText"
          }
        },
        "id": "fldLrlHZzV4YXNne3",
        "name": "Assigned Minion Types"
      },
      {
        "type": "aiText",
        "options": {
          "referencedFieldIds": [
            "fldsDgfhK8DSP5fo6",
            "fldj39FpKEIl0Ra6i",
            "fldCicD8iqyNWXgIU",
            "fldLrlHZzV4YXNne3"
          ],
          "prompt": [
            // eslint-disable-next-line @stylistic/max-len
            "You are a strategic advisor to a necromancer overseeing operations in a mysterious castle.
            Your expertise is in providing concise, high-level summaries for task management and undead
            minion coordination. Maintain a formal and analytical tone suitable for evil rulership.
            \n\nTask description:\nAnalyze the provided information to generate a brief summary of the task.
            Focus on the task's objective, its priority level, and the types of minions assigned.
            Present the summary in a way that supports quick strategic decision-making.\n\n
            Output format:\nA single sentence summarizing the task's objective, priority, and assigned
            minion types, written in plain text with no headings or extra commentary.
            Do not include any additional text or explanations. If you cannot generate a summary,
            output \"Unable to summarize this task based on the provided information.\"
            Example: \"Retrieve the lost artifact (High priority) with assigned minion types: Skeletons, Ghouls.
            \"\n\nContext and Data:\nTask Name: ",
            {
              "field": {
                "fieldId": "fldsDgfhK8DSP5fo6"
              }
            },
            "\nObjective: ",
            {
              "field": {
                "fieldId": "fldj39FpKEIl0Ra6i"
              }
            },
            "\nPriority Level: ",
            {
              "field": {
                "fieldId": "fldCicD8iqyNWXgIU"
              }
            },
            "\nAssigned Minion Types: ",
            {
              "field": {
                "fieldId": "fldLrlHZzV4YXNne3"
              }
            },
            "\nOutput:\n"
          ]
        },
        "id": "fldJbZbD7ge1Jarbw",
        "name": "Task Summary (AI)"
      },
      {
        "type": "aiText",
        "options": {
          "referencedFieldIds": [
            "fldj39FpKEIl0Ra6i",
            "fldKORwI0Sk9KVESW",
            "fld9JzsSvUK5HKdB8"
          ],
          "prompt": [
            "You are an expert tactical consultant for a necromancer managing undead minions in a mysterious castle.
             Your role is to recommend the most effective next action for each task, considering progress status
             and minion loyalty. Use a direct and strategic tone.\n\nTask description:\nEvaluate the task's objective,
             current progress, and the average loyalty of assigned minions to determine the optimal next step.
             Base your suggestion on maximizing task success and maintaining minion efficiency.
             Consider if the task is stalled, at risk, or progressing well, and tailor your recommendation accordingly.
             \n\nOutput format:\nA single, actionable sentence describing the next recommended step,
             written in plain text with no headings or extra commentary. Do not include any additional text or
             rationale. If you cannot suggest an action, output \"No suitable next action can be determined from
             the provided information.
             \" Example: \"Reinforce minion morale before proceeding to the next phase.\"\n\n
             Context and Data:\nObjective: ",
            {
              "field": {
                "fieldId": "fldj39FpKEIl0Ra6i"
              }
            },
            "\nProgress Status: ",
            {
              "field": {
                "fieldId": "fldKORwI0Sk9KVESW"
              }
            },
            "\nAverage Loyalty of Assigned Minions: ",
            {
              "field": {
                "fieldId": "fld9JzsSvUK5HKdB8"
              }
            },
            "\nOutput:\n"
          ]
        },
        "id": "fldlP69XK9GPBlkpK",
        "name": "Suggested Next Action (AI)"
      },
      {
        "type": "multipleRecordLinks",
        "options": {
          "linkedTableId": "tblkLLznYMr6h3L1n",
          "isReversed": false,
          "prefersSingleRecordLink": false,
          "inverseLinkFieldId": "fldiEJquFCNivBRo2"
        },
        "id": "fld2DX6p1k0m6YfGs",
        "name": "Demo - All Column Types"
      }
    ],
    "views": [
      {
        "id": "viwP2msBxgO3o3Fbe",
        "name": "Grid view",
        "type": "grid"
      }
    ]
  },
  {
    "id": "tblkLLznYMr6h3L1n",
    "name": "Demo - All Column Types",
    "primaryFieldId": "fldqJ6w4ufwBLasKs",
    "fields": [
      {
        "type": "singleLineText",
        "id": "fldqJ6w4ufwBLasKs",
        "name": "Name"
      },
      {
        "type": "multilineText",
        "id": "fldmdcg5ta1cu6DW0",
        "name": "Description"
      },
      {
        "type": "dateTime",
        "options": {
          "dateFormat": {
            "name": "iso",
            "format": "YYYY-MM-DD"
          },
          "timeFormat": {
            "name": "24hour",
            "format": "HH:mm"
          },
          "timeZone": "utc"
        },
        "id": "fldwzfk1ZRN0UWvnn",
        "name": "Start Date"
      },
      {
        "type": "date",
        "options": {
          "dateFormat": {
            "name": "iso",
            "format": "YYYY-MM-DD"
          }
        },
        "id": "fldQl29KXGtcc4BsC",
        "name": "Due Date"
      },
      {
        "type": "number",
        "options": {
          "precision": 0
        },
        "id": "fldqq1D0Piym9F6I0",
        "name": "Score"
      },
      {
        "type": "number",
        "options": {
          "precision": 0
        },
        "id": "fldDBg0FgpUY5OaQF",
        "name": "Integer Value"
      },
      {
        "type": "number",
        "options": {
          "precision": 2
        },
        "id": "fldP6oDFQaraukZKp",
        "name": "Decimal Value"
      },
      {
        "type": "currency",
        "options": {
          "precision": 2,
          "symbol": "$"
        },
        "id": "fldfOxLIaZC1JecS8",
        "name": "Cost Estimate"
      },
      {
        "type": "checkbox",
        "options": {
          "icon": "thumbsUp",
          "color": "greenBright"
        },
        "id": "fldC5fWx1oohRZvsr",
        "name": "Active?"
      },
      {
        "type": "phoneNumber",
        "id": "fld6pUyrOwoqrjaXr",
        "name": "Contact Phone"
      },
      {
        "type": "email",
        "id": "fld4ZrZ46fsPB14qW",
        "name": "Contact Email"
      },
      {
        "type": "url",
        "id": "fld2TNDSEq5AZu4j1",
        "name": "Website"
      },
      {
        "type": "percent",
        "options": {
          "precision": 2
        },
        "id": "fldlsrqs3lpp0vmvJ",
        "name": "Progress %"
      },
      {
        "type": "duration",
        "options": {
          "durationFormat": "h:mm"
        },
        "id": "fldyqMOkY8dZ1acl5",
        "name": "Duration (hrs)"
      },
      {
        "type": "multipleAttachments",
        "options": {
          "isReversed": true
        },
        "id": "fld3bOG2iWGobofH7",
        "name": "Photo Upload"
      },
      {
        "type": "multipleAttachments",
        "options": {
          "isReversed": true
        },
        "id": "fldqTVFR6pkSLWHZC",
        "name": "Document Upload"
      },
      {
        "type": "multipleAttachments",
        "options": {
          "isReversed": true
        },
        "id": "fldua9ijGSCLDx2eq",
        "name": "File Upload"
      },
      {
        "type": "singleSelect",
        "options": {
          "choices": [
            {
              "id": "selHiKY5M2hv2evVI",
              "name": "Option A",
              "color": "blueLight2"
            },
            {
              "id": "selDDECz6meF3ldnJ",
              "name": "Option B",
              "color": "cyanLight2"
            },
            {
              "id": "sel9D01n2bB6Hdzsh",
              "name": "Option C",
              "color": "tealLight2"
            }
          ]
        },
        "id": "fld0pQCWdngthJXtb",
        "name": "Select Type"
      },
      {
        "type": "multipleSelects",
        "options": {
          "choices": [
            {
              "id": "selyK3p8gKM4n1gXF",
              "name": "Tag 1",
              "color": "blueLight2"
            },
            {
              "id": "selIcGw9oH8NCd8TA",
              "name": "Tag 2",
              "color": "cyanLight2"
            },
            {
              "id": "self9MQIcLOj4iW9d",
              "name": "Tag 3",
              "color": "tealLight2"
            }
          ]
        },
        "id": "fldK8ekS7ApBJwslM",
        "name": "Tag(s)"
      },
      {
        "type": "multipleRecordLinks",
        "options": {
          "linkedTableId": "tblLmV4L8BRrsDXl4",
          "isReversed": false,
          "prefersSingleRecordLink": true,
          "inverseLinkFieldId": "fldwW9ouHt64A1Nty"
        },
        "id": "fld0uI6ARafOl1iCm",
        "name": "Related Minion"
      },
      {
        "type": "multipleRecordLinks",
        "options": {
          "linkedTableId": "tblTr4RHYreyHdCV3",
          "isReversed": false,
          "prefersSingleRecordLink": false,
          "inverseLinkFieldId": "fld2DX6p1k0m6YfGs"
        },
        "id": "fldiEJquFCNivBRo2",
        "name": "Related Task(s)"
      },
      {
        "type": "count",
        "options": {
          "isValid": true,
          "recordLinkFieldId": "fld0uI6ARafOl1iCm"
        },
        "id": "fldcOiNSHDUL69hWC",
        "name": "Related Minion Count"
      },
      {
        "type": "createdTime",
        "options": {
          "result": {
            "type": "dateTime",
            "options": {
              "dateFormat": {
                "name": "us",
                "format": "M/D/YYYY"
              },
              "timeFormat": {
                "name": "12hour",
                "format": "h:mma"
              },
              "timeZone": "utc"
            }
          }
        },
        "id": "fldhqb9Dw4rn2mkX2",
        "name": "Created Time"
      },
      {
        "type": "lastModifiedTime",
        "options": {
          "isValid": true,
          "referencedFieldIds": [],
          "result": {
            "type": "date",
            "options": {
              "dateFormat": {
                "name": "us",
                "format": "M/D/YYYY"
              }
            }
          }
        },
        "id": "fldV94QE4zcH8APUJ",
        "name": "Last Modified Time"
      },
      {
        "type": "createdBy",
        "id": "fldiWCnQC6PKNNHG6",
        "name": "Created By"
      },
      {
        "type": "lastModifiedBy",
        "id": "fldD7yeN2UxPr5Poz",
        "name": "Last Modified By"
      },
      {
        "type": "singleCollaborator",
        "id": "fldQdRyio0JhgvJzu",
        "name": "Assigned User"
      },
      {
        "type": "multipleCollaborators",
        "id": "fldoyaKp6fNXEXJRK",
        "name": "Reviewers"
      },
      {
        "type": "rating",
        "options": {
          "icon": "star",
          "max": 5,
          "color": "blueBright"
        },
        "id": "fldjjyz8OKqRAehSF",
        "name": "Rating (5 Max)"
      },
      {
        "type": "richText",
        "id": "fld5FyrfUFcC5udig",
        "name": "Rich Text Example"
      },
      {
        "type": "rollup",
        "options": {
          "isValid": true,
          "recordLinkFieldId": "fld0uI6ARafOl1iCm",
          "fieldIdInLinkedTable": "fldwpHA5QvxBmPqxA",
          "referencedFieldIds": [],
          "result": {
            "type": "singleLineText"
          }
        },
        "id": "flddk9AagU2VBz3k1",
        "name": "Name Rollup (from Related Minion)"
      },
      {
        "type": "autoNumber",
        "id": "fld11HR5kjwVPJZ4Y",
        "name": "ID"
      },
      {
        "type": "multipleRecordLinks",
        "options": {
          "linkedTableId": "tblLmV4L8BRrsDXl4",
          "isReversed": false,
          "prefersSingleRecordLink": false,
          "inverseLinkFieldId": "fldwHpwU4cX6pqwb3"
        },
        "id": "fldlwtBXeG74Djqai",
        "name": "Minions"
      }
    ],
    "views": [
      {
        "id": "viwxGdI1uArnthfzl",
        "name": "Grid view",
        "type": "grid"
      }
    ]
  }
]
}
*/
