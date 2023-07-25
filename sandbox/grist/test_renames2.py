import textwrap
import unittest

import logging
import six
import test_engine

log = logging.getLogger(__name__)


def _replace_col_name(data, old_name, new_name):
  """For verifying data, renames a column in the header in-place."""
  data[0] = [(new_name if c == old_name else c) for c in data[0]]


class TestRenames2(test_engine.EngineTestCase):
  # Another test for column renames, which tests crazier interconnected formulas.
  # This one includes a bunch of cases where renames fail, marked as TODOs.

  def setUp(self):
    super(TestRenames2, self).setUp()

    # Create a schema with several tables including some references and lookups.
    self.apply_user_action(["AddTable", "People", [
      {"id": "name", "type": "Text"}
    ]])
    self.apply_user_action(["AddTable", "Games", [
      {"id": "name", "type": "Text"},
      {"id": "winner", "type": "Ref:People", "isFormula": True,
       "formula": "Entries.lookupOne(game=$id, rank=1).person"},
      {"id": "second", "type": "Ref:People", "isFormula": True,
       "formula": "Entries.lookupOne(game=$id, rank=2).person"},
    ]])
    self.apply_user_action(["AddTable", "Entries", [
      {"id": "game", "type": "Ref:Games"},
      {"id": "person", "type": "Ref:People"},
      {"id": "rank", "type": "Int"},
    ]])

    # Fill it with some sample data.
    self.add_records("People", ["name"], [
      ["Bob"], ["Alice"], ["Carol"], ["Doug"], ["Eve"]])
    self.add_records("Games", ["name"], [
      ["ChessA"], ["GoA"], ["ChessB"], ["CheckersA"]])
    self.add_records("Entries", ["game", "person", "rank"], [
      [ 1,  2,  1],
      [ 1,  4,  2],
      [ 2,  1,  2],
      [ 2,  2,  1],
      [ 3,  4,  1],
      [ 3,  3,  2],
      [ 4,  5,  1],
      [ 4,  1,  2],
    ])

    # Check the data, to see it, and confirm that lookups work.
    self.assertTableData("People", cols="subset", data=[
      [ "id",   "name"  ],
      [ 1,      "Bob"   ],
      [ 2,      "Alice" ],
      [ 3,      "Carol" ],
      [ 4,      "Doug"  ],
      [ 5,      "Eve"   ],
    ])
    self.assertTableData("Games", cols="subset", data=[
      [ "id",   "name"      , "winner",   "second"  ],
      [ 1,      "ChessA"    , 2,          4,        ],
      [ 2,      "GoA"       , 2,          1,        ],
      [ 3,      "ChessB"    , 4,          3,        ],
      [ 4,      "CheckersA" , 5,          1         ],
    ])

    # This was just setpu. Now create some crazy formulas that overuse references in crazy ways.
    self.partner_names = textwrap.dedent(
      """
      games = Entries.lookupRecords(person=$id).game
      partners = [e.person for g in games for e in Entries.lookupRecords(game=g)]
      return ' '.join(p.name for p in partners if p.id != $id)
      """)
    self.partner = textwrap.dedent(
      """
      game = Entries.lookupOne(person=$id).game
      next(e.person for e in Entries.lookupRecords(game=game) if e.person != rec)
      """).strip()

    self.add_column("People", "N", formula="$name.upper()")
    self.add_column("People", "Games_Won", formula=(
      "' '.join(e.game.name for e in Entries.lookupRecords(person=$id, rank=1))"))
    self.add_column("People", "PartnerNames", formula=self.partner_names)
    self.add_column("People", "partner", type="Ref:People", formula=self.partner)
    self.add_column("People", "partner4", type="Ref:People", formula=(
      "$partner.partner.partner.partner"))

    # Make it hard to follow references by using the same names in different tables.
    self.add_column("People", "win", type="Ref:Games",
                    formula="Entries.lookupOne(person=$id, rank=1).game")
    self.add_column("Games", "win", type="Ref:People", formula="$winner")
    self.add_column("Games", "win3_person_name", formula="$win.win.win.name")
    self.add_column("Games", "win4_game_name", formula="$win.win.win.win.name")

    # This is just for help us know which columns have which rowIds.
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId" ],
      [   1,    1,            "manualSort"       ],
      [   2,    1,            "name"             ],
      [   3,    2,            "manualSort"       ],
      [   4,    2,            "name"             ],
      [   5,    2,            "winner"           ],
      [   6,    2,            "second"           ],
      [   7,    3,            "manualSort"       ],
      [   8,    3,            "game"             ],
      [   9,    3,            "person"           ],
      [   10,   3,            "rank"             ],
      [   11,   1,            "N"                ],
      [   12,   1,            "Games_Won"        ],
      [   13,   1,            "PartnerNames"     ],
      [   14,   1,            "partner"          ],
      [   15,   1,            "partner4"         ],
      [   16,   1,            "win"              ],
      [   17,   2,            "win"              ],
      [   18,   2,            "win3_person_name" ],
      [   19,   2,            "win4_game_name"   ],
    ])

    # Check the data before we start on the renaming.
    self.people_data = [
      [ "id",   "name" , "N",     "Games_Won",  "PartnerNames", "partner",  "partner4", "win" ],
      [ 1,      "Bob"  , "BOB",   "",           "Alice Eve"   , 2,          4         , 0     ],
      [ 2,      "Alice", "ALICE", "ChessA GoA", "Doug Bob"    , 4,          2         , 1     ],
      [ 3,      "Carol", "CAROL", "",           "Doug"        , 4,          2         , 0     ],
      [ 4,      "Doug" , "DOUG",  "ChessB",     "Alice Carol" , 2,          4         , 3     ],
      [ 5,      "Eve"  , "EVE",   "CheckersA",  "Bob"         , 1,          2         , 4     ],
    ]
    self.games_data = [
      [ "id",   "name"      , "winner",   "second", "win",  "win3_person_name", "win4_game_name" ],
      [ 1,      "ChessA"    , 2,          4       , 2     , "Alice"           , "ChessA"         ],
      [ 2,      "GoA"       , 2,          1       , 2     , "Alice"           , "ChessA"         ],
      [ 3,      "ChessB"    , 4,          3       , 4     , "Doug"            , "ChessB"         ],
      [ 4,      "CheckersA" , 5,          1       , 5     , "Eve"             , "CheckersA"      ],
    ]
    self.assertTableData("People", cols="subset", data=self.people_data)
    self.assertTableData("Games", cols="subset", data=self.games_data)

  def test_renames_a(self):
    # Rename Entries.game: affects Games.winner, Games.second, People.Games_Won,
    # People.PartnerNames, People.partner.
    out_actions = self.apply_user_action(["RenameColumn", "Entries", "game", "juego"])
    self.partner_names = textwrap.dedent(
      """
      games = Entries.lookupRecords(person=$id).juego
      partners = [e.person for g in games for e in Entries.lookupRecords(juego=g)]
      return ' '.join(p.name for p in partners if p.id != $id)
      """)
    self.partner = textwrap.dedent(
      """
      game = Entries.lookupOne(person=$id).juego
      next(e.person for e in Entries.lookupRecords(juego=game) if e.person != rec)
      """).strip()

    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Entries", "game", "juego"],
      ["ModifyColumn", "Games", "winner",
       {"formula": "Entries.lookupOne(juego=$id, rank=1).person"}],
      ["ModifyColumn", "Games", "second",
       {"formula": "Entries.lookupOne(juego=$id, rank=2).person"}],
      ["ModifyColumn", "People", "Games_Won", {
        "formula": "' '.join(e.juego.name for e in Entries.lookupRecords(person=$id, rank=1))"
      }],
      ["ModifyColumn", "People", "PartnerNames", { "formula": self.partner_names }],
      ["ModifyColumn", "People", "partner", {"formula": self.partner}],
      ["ModifyColumn", "People", "win",
       {"formula": "Entries.lookupOne(person=$id, rank=1).juego"}],

      ["BulkUpdateRecord", "_grist_Tables_column", [8, 5, 6, 12, 13, 14, 16], {
        "colId": ["juego", "winner", "second", "Games_Won", "PartnerNames", "partner", "win"],
        "formula": ["",
                    "Entries.lookupOne(juego=$id, rank=1).person",
                    "Entries.lookupOne(juego=$id, rank=2).person",
                    "' '.join(e.juego.name for e in Entries.lookupRecords(person=$id, rank=1))",
                    self.partner_names,
                    self.partner,
                    "Entries.lookupOne(person=$id, rank=1).juego"
                   ]
      }],
    ]})

    # Verify data to ensure there are no AttributeErrors.
    self.assertTableData("People", cols="subset", data=self.people_data)
    self.assertTableData("Games", cols="subset", data=self.games_data)


  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_renames_b(self):
    # Rename Games.name: affects People.Games_Won, Games.win4_game_name
    out_actions = self.apply_user_action(["RenameColumn", "Games", "name", "nombre"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Games", "name", "nombre"],
      ["ModifyColumn", "People", "Games_Won", {
        "formula": "' '.join(e.game.nombre for e in Entries.lookupRecords(person=$id, rank=1))"
      }],
      ["ModifyColumn", "Games", "win4_game_name", {"formula": "$win.win.win.win.nombre"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [4, 12, 19], {
        "colId": ["nombre", "Games_Won", "win4_game_name"],
        "formula": [
          "",
          "' '.join(e.game.nombre for e in Entries.lookupRecords(person=$id, rank=1))",
          "$win.win.win.win.nombre"
        ]
      }]
    ]})

    # Fix up things missed due to the TODOs above.
    self.modify_column("Games", "win4_game_name", formula="$win.win.win.win.nombre")

    # Verify data to ensure there are no AttributeErrors.
    _replace_col_name(self.games_data, "name", "nombre")
    self.assertTableData("People", cols="subset", data=self.people_data)
    self.assertTableData("Games", cols="subset", data=self.games_data)


  def test_renames_c(self):
    # Rename Entries.person: affects People.ParnerNames
    out_actions = self.apply_user_action(["RenameColumn", "Entries", "person", "persona"])
    self.partner_names = textwrap.dedent(
      """
      games = Entries.lookupRecords(persona=$id).game
      partners = [e.persona for g in games for e in Entries.lookupRecords(game=g)]
      return ' '.join(p.name for p in partners if p.id != $id)
      """)
    self.partner = textwrap.dedent(
      """
      game = Entries.lookupOne(persona=$id).game
      next(e.persona for e in Entries.lookupRecords(game=game) if e.persona != rec)
      """).strip()

    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Entries", "person", "persona"],
      ["ModifyColumn", "Games", "winner",
       {"formula": "Entries.lookupOne(game=$id, rank=1).persona"}],
      ["ModifyColumn", "Games", "second",
       {"formula": "Entries.lookupOne(game=$id, rank=2).persona"}],
      ["ModifyColumn", "People", "Games_Won", {
        "formula": "' '.join(e.game.name for e in Entries.lookupRecords(persona=$id, rank=1))"
      }],
      ["ModifyColumn", "People", "PartnerNames", { "formula": self.partner_names }],
      ["ModifyColumn", "People", "partner", {"formula": self.partner}],
      ["ModifyColumn", "People", "win",
       {"formula": "Entries.lookupOne(persona=$id, rank=1).game"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [9, 5, 6, 12, 13, 14, 16], {
        "colId": ["persona", "winner", "second", "Games_Won", "PartnerNames", "partner", "win"],
        "formula": ["",
                    "Entries.lookupOne(game=$id, rank=1).persona",
                    "Entries.lookupOne(game=$id, rank=2).persona",
                    "' '.join(e.game.name for e in Entries.lookupRecords(persona=$id, rank=1))",
                    self.partner_names,
                    self.partner,
                    "Entries.lookupOne(persona=$id, rank=1).game"
                   ]
      }],
    ]})

    self.assertTableData("People", cols="subset", data=self.people_data)
    self.assertTableData("Games", cols="subset", data=self.games_data)


  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_renames_d(self):
    # Rename People.name: affects People.N, People.ParnerNames
    # TODO: PartnerNames does NOT get updated correctly because astroid doesn't infer meanings of
    # lists very well.
    out_actions = self.apply_user_action(["RenameColumn", "People", "name", "nombre"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "People", "name", "nombre"],
      ["ModifyColumn", "People", "N", {"formula": "$nombre.upper()"}],
      ["ModifyColumn", "Games", "win3_person_name", {"formula": "$win.win.win.nombre"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [2, 11, 18], {
        "colId": ["nombre", "N", "win3_person_name"],
        "formula": ["", "$nombre.upper()", "$win.win.win.nombre"]
      }],
      ["BulkUpdateRecord", "People", [1, 2, 3, 4, 5], {
        "PartnerNames": [["E", "AttributeError"], ["E", "AttributeError"],
          ["E", "AttributeError"], ["E", "AttributeError"], ["E", "AttributeError"]]
      }],
    ]})

    # Fix up things missed due to the TODO above.
    self.modify_column("People", "PartnerNames",
                       formula=self.partner_names.replace("name", "nombre"))

    _replace_col_name(self.people_data, "name", "nombre")
    self.assertTableData("People", cols="subset", data=self.people_data)
    self.assertTableData("Games", cols="subset", data=self.games_data)


  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_renames_e(self):
    # Rename People.partner: affects People.partner4
    # TODO: partner4 ($partner.partner.partner.partner) only gets updated partly because of
    # astroid's avoidance of looking up the same attr on the same class during inference.
    out_actions = self.apply_user_action(["RenameColumn", "People", "partner", "companero"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "People", "partner", "companero"],
      ["ModifyColumn", "People", "partner4", {
        "formula": "$companero.companero.companero.companero"
      }],
      ["BulkUpdateRecord", "_grist_Tables_column", [14, 15], {
        "colId": ["companero", "partner4"],
        "formula": [self.partner, "$companero.companero.companero.companero"]
      }]
    ]})

    _replace_col_name(self.people_data, "partner", "companero")
    self.assertTableData("People", cols="subset", data=self.people_data)
    self.assertTableData("Games", cols="subset", data=self.games_data)


  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_renames_f(self):
    # Rename People.win -> People.pwin. Make sure only Game.win is not affected.
    out_actions = self.apply_user_action(["RenameColumn", "People", "win", "pwin"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "People", "win", "pwin"],
      ["ModifyColumn", "Games", "win3_person_name", {"formula": "$win.pwin.win.name"}],
      ["ModifyColumn", "Games", "win4_game_name", {"formula": "$win.pwin.win.pwin.name"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [16, 18, 19], {
        "colId": ["pwin", "win3_person_name", "win4_game_name"],
        "formula": ["Entries.lookupOne(person=$id, rank=1).game",
                    "$win.pwin.win.name", "$win.pwin.win.pwin.name"]}],
    ]})

    _replace_col_name(self.people_data, "win", "pwin")
    self.assertTableData("People", cols="subset", data=self.people_data)
    self.assertTableData("Games", cols="subset", data=self.games_data)


  def test_renames_g(self):
    # Rename Games.win -> Games.gwin.
    out_actions = self.apply_user_action(["RenameColumn", "Games", "win", "gwin"])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Games", "win", "gwin"],
      ["ModifyColumn", "Games", "win3_person_name", {"formula": "$gwin.win.gwin.name"}],
      ["ModifyColumn", "Games", "win4_game_name", {"formula": "$gwin.win.gwin.win.name"}],
      ["BulkUpdateRecord", "_grist_Tables_column", [17, 18, 19], {
        "colId": ["gwin", "win3_person_name", "win4_game_name"],
        "formula": ["$winner", "$gwin.win.gwin.name", "$gwin.win.gwin.win.name"]}],

    ]})

    _replace_col_name(self.games_data, "win", "gwin")
    self.assertTableData("People", cols="subset", data=self.people_data)
    self.assertTableData("Games", cols="subset", data=self.games_data)


  def test_renames_h(self):
    # Rename Entries -> Entradas. Affects Games.winner, Games.second, People.Games_Won,
    # People.PartnerNames, People.partner, People.win.
    out_actions = self.apply_user_action(["RenameTable", "Entries", "Entradas"])
    self.partner_names = textwrap.dedent(
      """
      games = Entradas.lookupRecords(person=$id).game
      partners = [e.person for g in games for e in Entradas.lookupRecords(game=g)]
      return ' '.join(p.name for p in partners if p.id != $id)
      """)
    self.partner = textwrap.dedent(
      """
      game = Entradas.lookupOne(person=$id).game
      next(e.person for e in Entradas.lookupRecords(game=game) if e.person != rec)
      """).strip()

    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameTable", "Entries", "Entradas"],
      ["UpdateRecord", "_grist_Tables", 3, {"tableId": "Entradas"}],
      ["ModifyColumn", "Games", "winner",
       {"formula": "Entradas.lookupOne(game=$id, rank=1).person"}],
      ["ModifyColumn", "Games", "second",
       {"formula": "Entradas.lookupOne(game=$id, rank=2).person"}],
      ["ModifyColumn", "People", "Games_Won", {
        "formula": "' '.join(e.game.name for e in Entradas.lookupRecords(person=$id, rank=1))"
      }],
      ["ModifyColumn", "People", "PartnerNames", { "formula": self.partner_names }],
      ["ModifyColumn", "People", "partner", {"formula": self.partner}],
      ["ModifyColumn", "People", "win",
       {"formula": "Entradas.lookupOne(person=$id, rank=1).game"}],

      ["BulkUpdateRecord", "_grist_Tables_column", [5, 6, 12, 13, 14, 16], {
        "formula": [
          "Entradas.lookupOne(game=$id, rank=1).person",
          "Entradas.lookupOne(game=$id, rank=2).person",
          "' '.join(e.game.name for e in Entradas.lookupRecords(person=$id, rank=1))",
          self.partner_names,
          self.partner,
          "Entradas.lookupOne(person=$id, rank=1).game"
        ]}],
    ]})

    self.assertTableData("People", cols="subset", data=self.people_data)
    self.assertTableData("Games", cols="subset", data=self.games_data)

  def test_renames_i(self):
    # Rename when using a local variable referring to a user table.
    # Test also that a local variable that happens to match a global name is unaffected by renames.
    self.modify_column("Games", "winner", formula=(
      "myvar = Entries\n"
      "People = Entries\n"
      "myvar.lookupOne(game=$id, rank=1).person\n"
      "People.lookupOne(game=$id, rank=1).person\n"
    ))
    self.apply_user_action(["RenameColumn", "Entries", "game", "juego"])
    self.apply_user_action(["RenameTable", "People", "Persons"])

    # Check that renames worked.
    new_col = self.engine.docmodel.columns.lookupOne(tableId='Games', colId='winner')
    self.assertEqual(new_col.formula, (
      "myvar = Entries\n"
      "People = Entries\n"
      "myvar.lookupOne(juego=$id, rank=1).person\n"
      "People.lookupOne(juego=$id, rank=1).person\n"
    ))

    self.assertTableData("Persons", cols="subset", data=self.people_data)
    self.assertTableData("Games", cols="subset", data=self.games_data)
