import logging
import actions

import testutil
import test_engine

log = logging.getLogger(__name__)

def _bulk_update(table_name, col_names, row_data):
  return actions.BulkUpdateRecord(
    *testutil.table_data_from_rows(table_name, col_names, row_data))

class TestDerived(test_engine.EngineTestCase):
  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Customers", [
        [1, "firstName",   "Text",        False, "", "", ""],
        [2, "lastName",    "Text",        False, "", "", ""],
        [3, "state",       "Text",        False, "", "", ""],
      ]],
      [2, "Orders", [
        [10, "year",       "Int",            False, "", "", ""],
        [11, "customer",   "Ref:Customers",  False, "", "", ""],
        [12, "product",    "Text",           False, "", "", ""],
        [13, "amount",     "Numeric",        False, "", "", ""],
      ]],
    ],
    "DATA": {
      "Customers": [
        ["id", "firstName", "lastName", "state"],
        [1,   "Lois",     "Long",     "NY"],
        [2,   "Felix",    "Myers",    "NY"],
        [3,   "Grace",    "Hawkins",  "CT"],
        [4,   "Bessie",   "Green",    "NJ"],
        [5,   "Jerome",   "Daniel",   "CT"],
      ],
      "Orders": [
        ["id",  "year", "customer", "product", "amount" ],
        [1,     2012,   3,          "A",        15  ],
        [2,     2013,   2,          "A",        15  ],
        [3,     2013,   3,          "A",        15  ],
        [4,     2014,   1,          "B",        35  ],
        [5,     2014,   5,          "B",        35  ],
        [6,     2014,   3,          "A",        16  ],
        [7,     2015,   1,          "A",        17  ],
        [8,     2015,   2,          "B",        36  ],
        [9,     2015,   3,          "B",        36  ],
        [10,    2015,   5,          "A",        17  ],
      ]
    }
  })

  def test_group_by_one(self):
    """
    Test basic summary table operation, for a table grouped by one columns.
    """
    self.load_sample(self.sample)

    # Create a derived table summarizing count and total of orders by year.
    self.apply_user_action(["CreateViewSection", 2, 0, 'record', [10], None])

    # Check the results.
    self.assertPartialData("Orders_summary_year", ["id", "year", "count", "amount", "group" ], [
      [1,   2012,   1,  15,   [1]],
      [2,   2013,   2,  30,   [2,3]],
      [3,   2014,   3,  86,   [4,5,6]],
      [4,   2015,   4,  106,  [7,8,9,10]],
    ])

    # Updating amounts should cause totals to be updated in the summary.
    out_actions = self.update_records("Orders", ["id", "amount"], [
      [1, 14],
      [2, 14]
    ])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.BulkUpdateRecord("Orders", [1,2], {'amount': [14, 14]}),
        actions.BulkUpdateRecord("Orders_summary_year", [1,2], {'amount': [14, 29]})
      ],
      "calls": {"Orders_summary_year": {"amount": 2}}
    })

    # Changing a record from one product to another should cause the two affected lines to change.
    out_actions = self.update_record("Orders", 10, year=2012)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Orders", 10, {"year": 2012}),
        actions.BulkUpdateRecord("Orders_summary_year", [1,4], {"amount": [31.0, 89.0]}),
        actions.BulkUpdateRecord("Orders_summary_year", [1,4], {"count": [2,3]}),
        actions.BulkUpdateRecord("Orders_summary_year", [1,4], {"group": [[1,10], [7,8,9]]}),
      ],
      "calls": {"Orders_summary_year": {"group": 2, "amount": 2, "count": 2},
                "Orders": {"#lookup##summary#Orders_summary_year": 1,
                           "#summary#Orders_summary_year": 1}}
    })

    self.assertPartialData("Orders_summary_year", ["id", "year", "count", "amount", "group" ], [
      [1,   2012,   2,  31.0,   [1,10]],
      [2,   2013,   2,  29.0,   [2,3]],
      [3,   2014,   3,  86.0,   [4,5,6]],
      [4,   2015,   3,  89.0,   [7,8,9]],
    ])

    # Changing a record to a new year that wasn't in the summary should cause an add-record.
    out_actions = self.update_record("Orders", 10, year=1999)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Orders", 10, {"year": 1999}),
        actions.AddRecord("Orders_summary_year", 5, {'year': 1999}),
        actions.BulkUpdateRecord("Orders_summary_year", [1,5], {"amount": [14.0, 17.0]}),
        actions.BulkUpdateRecord("Orders_summary_year", [1,5], {"count": [1,1]}),
        actions.BulkUpdateRecord("Orders_summary_year", [1,5], {"group": [[1], [10]]}),
      ],
      "calls": {
        "Orders_summary_year": {
          '#lookup#year': 1, "group": 2, "amount": 2, "count": 2, "#lookup#": 1
        },
        "Orders": {"#lookup##summary#Orders_summary_year": 1,
                   "#summary#Orders_summary_year": 1}}
    })

    self.assertPartialData("Orders_summary_year", ["id", "year", "count", "amount", "group" ], [
      [1,   2012,   1,  14.0,   [1]],
      [2,   2013,   2,  29.0,   [2,3]],
      [3,   2014,   3,  86.0,   [4,5,6]],
      [4,   2015,   3,  89.0,   [7,8,9]],
      [5,   1999,   1,  17.0,   [10]],
    ])


  def test_group_by_two(self):
    """
    Test a summary table created by grouping on two columns.
    """
    self.load_sample(self.sample)

    self.apply_user_action(["CreateViewSection", 2, 0, 'record', [10, 12], None])
    self.assertPartialData("Orders_summary_product_year", [
      "id", "year", "product", "count", "amount", "group"
    ], [
      [1,   2012,   "A",  1,  15.0,   [1]],
      [2,   2013,   "A",  2,  30.0,   [2,3]],
      [3,   2014,   "B",  2,  70.0,   [4,5]],
      [4,   2014,   "A",  1,  16.0,   [6]],
      [5,   2015,   "A",  2,  34.0,   [7,10]],
      [6,   2015,   "B",  2,  72.0,   [8,9]],
    ])

    # Changing a record from one product to another should cause the two affected lines to change,
    # or new lines to be created as needed.
    out_actions = self.update_records("Orders", ["id", "product"], [
      [2, "B"],
      [6, "B"],
      [7, "C"],
    ])
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.BulkUpdateRecord("Orders", [2, 6, 7], {"product": ["B", "B", "C"]}),
        actions.AddRecord("Orders_summary_product_year", 7, {'year': 2013, 'product': 'B'}),
        actions.AddRecord("Orders_summary_product_year", 8, {'year': 2015, 'product': 'C'}),
        actions.RemoveRecord("Orders_summary_product_year", 4),
        actions.BulkUpdateRecord("Orders_summary_product_year", [2,3,5,7,8], {
          "amount": [15.0, 86.0, 17.0, 15.0, 17.0]
        }),
        actions.BulkUpdateRecord("Orders_summary_product_year", [2,3,5,7,8], {
          "count": [1, 3, 1, 1, 1]
        }),
        actions.BulkUpdateRecord("Orders_summary_product_year", [2,3,5,7,8], {
          "group": [[3], [4,5,6], [10], [2], [7]]
        }),
      ],
    })

    # Verify the results.
    self.assertPartialData("Orders_summary_product_year", [
      "id", "year", "product", "count", "amount", "group"
    ], [
      [1,   2012,   "A",  1,  15.0,   [1]],
      [2,   2013,   "A",  1,  15.0,   [3]],
      [3,   2014,   "B",  3,  86.0,   [4,5,6]],
      [5,   2015,   "A",  1,  17.0,   [10]],
      [6,   2015,   "B",  2,  72.0,   [8,9]],
      [7,   2013,   "B",  1,  15.0,   [2]],
      [8,   2015,   "C",  1,  17.0,   [7]],
    ])

  def test_group_with_references(self):
    """
    Test summary tables grouped on indirect values. In this example we want for each
    customer.state, the number of customers and the total of their orders, which we can do either
    as a summary on the Customers table, or a summary on the Orders table.
    """
    self.load_sample(self.sample)

    # Create a summary on the Customers table. Adding orders involves a lookup for each customer.
    self.apply_user_action(["CreateViewSection", 1, 0, 'record', [3], None])
    self.add_column("Customers_summary_state", "totalAmount",
      formula="sum(sum(Orders.lookupRecords(customer=c).amount) for c in $group)")

    self.assertPartialData("Customers_summary_state", ["id", "state", "count", "totalAmount"], [
      [1,   "NY",   2,  103.0 ],
      [2,   "CT",   2,  134.0 ],
      [3,   "NJ",   1,    0.0 ],
    ])

    # # Create the same summary on the Orders table, looking up 'state' via the Customer reference.
    # self.apply_user_action(["AddDerivedTableSource", "Summary4", "Orders",
    #                         {"state": "$customer.state"}])
    # self.add_column("Summary4", "numCustomers", formula="len(set($source_Orders.customer))")
    # self.add_column("Summary4", "totalAmount", formula="sum($source_Orders.amount)")

    # self.assertPartialData("Summary4", ["id", "state", "numCustomers", "totalAmount"], [
    #   [1,   "CT",   2,  134.0 ],
    #   [2,   "NY",   2,  103.0 ],
    # ])

    # In either case, changing an amount (from 36->37 for a CT customer) should update summaries.
    out_actions = self.update_record('Orders', 9, amount=37)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Orders", 9, {"amount": 37}),
        actions.UpdateRecord("Customers_summary_state", 2, {"totalAmount": 135.0}),
      ]
    })

    # In either case, changing a customer's state should trigger recomputation too.
    # We are changing a NY customer with $51 in orders to MA.
    self.update_record('Customers', 2, state="MA")
    self.assertPartialData("Customers_summary_state", ["id", "state", "count", "totalAmount"], [
      [1,   "NY",   1,   52.0 ],
      [2,   "CT",   2,  135.0 ],
      [3,   "NJ",   1,    0.0 ],
      [4,   "MA",   1,   51.0 ],
    ])
    # self.assertPartialData("Summary4", ["id", "state", "numCustomers", "totalAmount"], [
    #   [1,   "CT",   2,  135.0 ],
    #   [2,   "NY",   1,   52.0 ],
    #   [3,   "MA",   1,   51.0 ],
    # ])

    # Similarly, changing an Order to refer to a different customer should update both tables.
    # Here we are changing a $17 order (#7) for a NY customer (#1) to a NJ customer (#4).
    out_actions = self.update_record("Orders", 7, customer=4)
    # self.assertPartialOutActions(out_actions, {
    #   "stored": [actions.UpdateRecord("Orders", 7, {"customer": 4}),
    #              actions.AddRecord("Summary4", 4, {"state": "NJ"}),
    #              actions.UpdateRecord("Summary4", 4, {"manualSort": 4.0})]
    # })
    self.assertPartialData("Customers_summary_state", ["id", "state", "count", "totalAmount"], [
      [1,   "NY",   1,   35.0 ],
      [2,   "CT",   2,  135.0 ],
      [3,   "NJ",   1,   17.0 ],
      [4,   "MA",   1,   51.0 ],
    ])
    # self.assertPartialData("Summary4", ["id", "state", "numCustomers", "totalAmount"], [
    #   [1,   "CT",   2,  135.0 ],
    #   [2,   "NY",   1,   35.0 ],
    #   [3,   "MA",   1,   51.0 ],
    #   [4,   "NJ",   1,   17.0 ],
    # ])

  def test_deletions(self):
    self.load_sample(self.sample)

    # Create a summary table summarizing count and total of orders by year.
    self.apply_user_action(["CreateViewSection", 2, 0, 'record', [10], None])
    self.assertPartialData("Orders_summary_year", ["id", "year", "count", "amount", "group" ], [
      [1,   2012,   1,  15.0,   [1]],
      [2,   2013,   2,  30.0,   [2,3]],
      [3,   2014,   3,  86.0,   [4,5,6]],
      [4,   2015,   4,  106.0,  [7,8,9,10]],
    ])

    # Update a record so that a new line appears in the summary table.
    out_actions_update = self.update_record("Orders", 1, year=2007)
    self.assertPartialData("Orders_summary_year", ["id", "year", "count", "amount", "group" ], [
      [2,   2013,   2,  30.0,   [2,3]],
      [3,   2014,   3,  86.0,   [4,5,6]],
      [4,   2015,   4,  106.0,  [7,8,9,10]],
      [5,   2007,   1,  15.0,   [1]],
    ])

    self.assertPartialOutActions(out_actions_update, {
      'stored': [
        ['UpdateRecord', 'Orders', 1, {'year': 2007}],
        ['AddRecord', 'Orders_summary_year', 5, {'year': 2007}],
        ['RemoveRecord', 'Orders_summary_year', 1],
        ['UpdateRecord', 'Orders_summary_year', 5, {'amount': 15.0}],
        ['UpdateRecord', 'Orders_summary_year', 5, {'count': 1}],
        ['UpdateRecord', 'Orders_summary_year', 5, {'group': ['L', 1]}],
      ],
      'undo': [
        ['UpdateRecord', 'Orders_summary_year', 1, {'group': ['L', 1]}],
        ['UpdateRecord', 'Orders_summary_year', 1, {'count': 1}],
        ['UpdateRecord', 'Orders_summary_year', 1, {'amount': 15.0}],
        ['UpdateRecord', 'Orders', 1, {'year': 2012}],
        ['RemoveRecord', 'Orders_summary_year', 5],
        ['AddRecord', 'Orders_summary_year', 1, {'group': ['L'], 'year': 2012}],
      ]})

    # Undo and ensure that the new line is gone from the summary table.
    out_actions_undo = self.apply_undo_actions(out_actions_update.undo)
    self.assertPartialData("Orders_summary_year", ["id", "year", "count", "amount", "group" ], [
      [1,   2012,   1,  15.0,   [1]],
      [2,   2013,   2,  30.0,   [2,3]],
      [3,   2014,   3,  86.0,   [4,5,6]],
      [4,   2015,   4,  106.0,  [7,8,9,10]],
    ])
    self.assertPartialOutActions(out_actions_undo, {
      "stored": out_actions_update.undo[::-1],
      "calls": {
        "Orders_summary_year": {
          "#lookup#": 1, "#lookup#year": 1, "group": 1, "amount": 1, "count": 1
        },
        "Orders": {
          "#lookup##summary#Orders_summary_year": 1, "#summary#Orders_summary_year": 1,
        },
      },
    })
