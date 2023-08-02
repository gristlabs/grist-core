# coding=utf-8
import unittest

import test_engine
import testutil
from functions import CaseInsensitiveDict, Response, HTTPError
from functions.info import _replicate_requests_body_args


class TestCaseInsensitiveDict(unittest.TestCase):
  def test_case_insensitive_dict(self):
    d = CaseInsensitiveDict({"FOO": 1})
    for key in ["foo", "FOO", "Foo"]:
      self.assertEqual(d, {"foo": 1})
      self.assertEqual(list(d), ["foo"])
      self.assertEqual(d, CaseInsensitiveDict({key: 1}))
      self.assertIn(key, d)
      self.assertEqual(d[key], 1)
      self.assertEqual(d.get(key), 1)
      self.assertEqual(d.get(key, 2), 1)
      self.assertEqual(d.get(key + "2", 2), 2)
      self.assertEqual(d.pop(key), 1)
      self.assertEqual(d, {})
      self.assertEqual(d.setdefault(key, 3), 3)
      self.assertEqual(d, {"foo": 3})
      self.assertEqual(d.setdefault(key, 4), 3)
      self.assertEqual(d, {"foo": 3})
      del d[key]
      self.assertEqual(d, {})
      d[key] = 1


class TestResponse(unittest.TestCase):
  def test_ok_response(self):
    r = Response(b"foo", 200, "OK", {"X-header": "hi"}, None)
    self.assertEqual(r.content, b"foo")
    self.assertEqual(r.text, u"foo")
    self.assertEqual(r.status_code, 200)
    self.assertEqual(r.ok, True)
    self.assertEqual(r.reason, "OK")
    self.assertEqual(r.headers, {"x-header": "hi"})
    self.assertEqual(r.encoding, "ascii")
    self.assertEqual(r.apparent_encoding, "ascii")
    r.raise_for_status()
    r.close()

  def test_error_response(self):
    r = Response(b"foo", 500, "Server error", {}, None)
    self.assertEqual(r.status_code, 500)
    self.assertEqual(r.ok, False)
    self.assertEqual(r.reason, "Server error")
    with self.assertRaises(HTTPError) as cm:
      r.raise_for_status()
    self.assertEqual(str(cm.exception), "Request failed with status 500")

  def test_json(self):
    r = Response(b'{"foo": "bar"}', 200, "OK", {}, None)
    self.assertEqual(r.json(), {"foo": "bar"})

  def test_encoding_direct(self):
    r = Response(b"foo", 200, "OK", {}, "some encoding")
    self.assertEqual(r.encoding, "some encoding")
    self.assertEqual(r.apparent_encoding, "ascii")

  def test_apparent_encoding(self):
    text = u"编程"
    encoding = "utf-8"
    content = text.encode(encoding)
    self.assertEqual(content.decode(encoding), text)
    r = Response(content, 200, "OK", {}, "")
    self.assertEqual(r.encoding, encoding)
    self.assertEqual(r.apparent_encoding, encoding)
    self.assertEqual(r.content, content)
    self.assertEqual(r.text, text)

  def test_unknown_undetectable_encoding(self):
    content = b''
    r = Response(content, 200, "OK", {}, encoding=None)

    # Not knowing the encoding should not break text
    self.assertEqual(r.text, "")


class TestRequestsPostInterface(unittest.TestCase):
    def test_no_post_args(self):
        body, headers = _replicate_requests_body_args()

        assert body is None
        assert headers == {}

    def test_data_as_dict(self):
        body, headers = _replicate_requests_body_args(data={"foo": "bar"})

        assert body == "foo=bar"
        assert headers == {"Content-Type": "application/x-www-form-urlencoded"}

    def test_data_as_string(self):
        body, headers = _replicate_requests_body_args(data="some_content")

        assert body == "some_content"
        assert headers == {}

    def test_json_as_dict(self):
        body, headers = _replicate_requests_body_args(json={"foo": "bar"})

        assert body == '{"foo": "bar"}'
        assert headers == {"Content-Type": "application/json"}

    def test_json_as_string(self):
        body, headers = _replicate_requests_body_args(json="invalid_but_ignored")

        assert body == "invalid_but_ignored"
        assert headers == {"Content-Type": "application/json"}

    def test_data_and_json_together(self):
        with self.assertRaises(ValueError):
            body, headers = _replicate_requests_body_args(
                json={"foo": "bar"},
                data={"quux": "jazz"}
            )


class TestRequestFunction(test_engine.EngineTestCase):
  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Table1", [
        [2, "Request", "Any", True, "$id", "", ""],
        [3, "Other", "Any", True, "", "", ""],
      ]],
    ],
    "DATA": {
      "Table1": [
        ["id"],
        [1],
        [2],
      ],
    }
  })

  def test_request_function(self):
    self.load_sample(self.sample)

    formula = """
r = REQUEST('my_url', headers={'foo': 'bar'}, params={'b': 1, 'a': 2})
r.__dict__
"""
    out_actions = self.modify_column("Table1", "Request", formula=formula)
    key = 'd7f8cedf177ab538bf7dadf66e77a525486a29a41ce4520b2c89a33e39095fed'
    deps = {'Table1': {'Request': [1, 2]}}
    args = {
      'url': 'my_url',
      'headers': {'foo': 'bar'},
      'params': {'a': 2, 'b': 1},
      'method': 'GET',
      'body': None,
      'deps': deps,
    }
    self.assertEqual(out_actions.requests, {key: args})
    self.assertTableData("Table1", cols="subset", data=[
      ["id", "Request"],
      [1, 1],
      [2, 2],
    ])

    response = {
      'status': 200,
      'statusText': 'OK',
      'content': b'body',
      'headers': {'h1': 'h2'},
      'encoding': 'utf16',
      'deps': deps,
    }
    self.apply_user_action(["RespondToRequests", {key: response.copy()}, [key]])

    # Translate names from JS `fetch` API to Python `requests`-style API
    response["status_code"] = response.pop("status")
    response["reason"] = response.pop("statusText")
    # This is sent in the user action but not kept for the response object
    del response["deps"]

    self.assertTableData("Table1", cols="subset", data=[
      ["id", "Request"],
      [1, response],
      [2, response],
    ])
