import datetime
import enum
import marshal
import unittest

import objtypes

class TestObjTypes(unittest.TestCase):
  class Int(int):
    pass
  class Float(float):
    pass
  class Text(str):
    pass
  class MyEnum(enum.IntEnum):
    ONE = 1
  class FussyFloat(float):
    def __float__(self):
      raise TypeError("Cannot cast FussyFloat to float")


  # (value, expected encoded value, expected decoded value)
  values = [
      (17, 17),
      (-17, -17),
      (0, 0),
      # The following is an unmarshallable value.
      (12345678901234567890, ['U', '12345678901234567890']),
      (0.0, 0.0),
      (1e-20, 1e-20),
      (1e20, 1e20),
      (1e40, 1e40),
      (float('infinity'), float('infinity')),
      (True, True),
      (Int(5), 5),
      (MyEnum.ONE, 1),
      (Float(3.3), 3.3),
      (Text("Hello"), u"Hello"),
      (datetime.date(2024, 9, 2), ['d', 1725235200.0]),
      (datetime.datetime(2024, 9, 2, 3, 8, 21), ['D', 1725246501, 'UTC']),
      # This is also unmarshallable.
      (FussyFloat(17.0), ['U', '17.0']),
      # Various other values are unmarshallable too.
      (len, ['U', '<built-in function len>']),
      # List, and list with an unmarshallable value.
      ([Float(6), "", MyEnum.ONE], ['L', 6, "", 1]),
      ([Text("foo"), FussyFloat(-0.5)], ['L', "foo", ['U', '-0.5']]),
  ]

  def test_encode_object(self):
    for (value, expected_encoded) in self.values:
      encoded = objtypes.encode_object(value)

      # Check that encoding is as expected.
      self.assertStrictEqual(encoded, expected_encoded, 'encoding of %r' % value)

      # Check it can be round-tripped through marshalling.
      marshaled = marshal.dumps(encoded)
      self.assertStrictEqual(marshal.loads(marshaled), encoded, 'de-marshalling of %r' % value)

      # Check that the decoded value, though it may not be identical, encodes identically.
      decoded = objtypes.decode_object(encoded)
      re_encoded = objtypes.encode_object(decoded)
      self.assertStrictEqual(re_encoded, encoded, 're-encoding of %r' % value)

  def assertStrictEqual(self, a, b, msg=None):
    self.assertEqual(a, b, '%s: %r != %r' % (msg, a, b))
    self.assertEqual(type(a), type(b), '%s: %r != %r' % (msg, type(a), type(b)))


if __name__ == "__main__":
  unittest.main()
