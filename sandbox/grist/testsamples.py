import testutil

# pylint: disable=line-too-long
sample_students = testutil.parse_test_sample({
  "SCHEMA": [
    [1, "Students", [
      [1, "firstName",   "Text",        False, "", "", ""],
      [2, "lastName",    "Text",        False, "", "", ""],
      [4, "schoolName",  "Text",        False, "", "", ""],
      [5, "schoolIds",   "Text",        True, "':'.join(str(id) for id in Schools.lookupRecords(name=$schoolName).id)", "", ""],
      [6, "schoolCities","Text",        True, "':'.join(r.address.city for r in Schools.lookupRecords(name=$schoolName))", "", ""],
    ]],
    [2, "Schools", [
      [10, "name",        "Text",       False, "", "", ""],
      [12, "address",     "Ref:Address",False, "", "", ""]
    ]],
    [3, "Address", [
      [21, "city",        "Text",       False, "", "", ""],
    ]]
  ],
  "DATA": {
    "Students": [
      ["id","firstName","lastName", "schoolName" ],
      [1,   "Barack",   "Obama",    "Columbia"   ],
      [2,   "George W", "Bush",     "Yale"       ],
      [3,   "Bill",     "Clinton",  "Columbia"   ],
      [4,   "George H", "Bush",     "Yale"       ],
      [5,   "Ronald",   "Reagan",   "Eureka"     ],
      [6,   "Gerald",   "Ford",     "Yale"       ]],
    "Schools": [
      ["id",  "name",     "address"],
      [1,     "Columbia", 11],
      [2,     "Columbia", 12],
      [3,     "Yale",     13],
      [4,     "Yale",     14]],
    "Address": [
      ["id",  "city"       ],
      [11,    "New York"   ],
      [12,    "Colombia"   ],
      [13,    "New Haven"  ],
      [14,    "West Haven" ]],
  }
})
