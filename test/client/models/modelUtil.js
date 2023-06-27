var assert = require('assert');
var ko = require('knockout');

var modelUtil = require('app/client/models/modelUtil');
var sinon = require('sinon');

describe('modelUtil', function() {

  describe("fieldWithDefault", function() {
    it("should be an observable with a default", function() {
      var foo = modelUtil.createField('foo');
      var bar = modelUtil.fieldWithDefault(foo, 'defaultValue');
      assert.equal(bar(), 'defaultValue');
      foo('test');
      assert.equal(bar(), 'test');
      bar('hello');
      assert.equal(bar(), 'hello');
      assert.equal(foo(), 'hello');
      foo('');
      assert.equal(bar(), 'defaultValue');
      assert.equal(foo(), '');
    });
    it("should exhibit specific behavior when used as a jsonObservable", function() {
      var custom = modelUtil.createField('custom');
      var common = ko.observable('{"foo": 2, "bar": 3}');
      var combined = modelUtil.fieldWithDefault(custom, function() { return common(); });
      combined = modelUtil.jsonObservable(combined);
      assert.deepEqual(combined(), {"foo": 2, "bar": 3});

      // Once the custom object is defined, the common object is not read.
      combined({"foo": 20});
      assert.deepEqual(combined(), {"foo": 20});
      // Setting the custom object to be undefined should make read return the common object again.
      combined(undefined);
      assert.deepEqual(combined(), {"foo": 2, "bar": 3});
      // Setting a property with an undefined custom object should initially copy all defaults from common.
      combined(undefined);
      combined.prop('foo')(50);
      assert.deepEqual(combined(), {"foo": 50, "bar": 3});
      // Once the custom object is defined, changes to common should not affect the combined read value.
      common('{"bar": 60}');
      combined.prop('foo')(70);
      assert.deepEqual(combined(), {"foo": 70, "bar": 3});
    });
  });

  describe("jsonObservable", function() {
    it("should auto parse and stringify", function() {
      var str = ko.observable();
      var obj = modelUtil.jsonObservable(str);
      assert.deepEqual(obj(), {});

      str('{"foo": 1, "bar": "baz"}');
      assert.deepEqual(obj(), {foo: 1, bar: "baz"});

      obj({foo: 2, baz: "bar"});
      assert.equal(str(), '{"foo":2,"baz":"bar"}');

      obj.update({foo: 17, bar: null});
      assert.equal(str(), '{"foo":17,"baz":"bar","bar":null}');
    });

    it("should support saving", function() {
      var str = ko.observable('{"foo": 1, "bar": "baz"}');
      var saved = null;
      str.saveOnly = function(value) { saved = value; };
      var obj = modelUtil.jsonObservable(str);

      obj.saveOnly({foo: 2});
      assert.equal(saved, '{"foo":2}');
      assert.equal(str(), '{"foo": 1, "bar": "baz"}');
      assert.deepEqual(obj(), {"foo": 1, "bar": "baz"});

      obj.update({"hello": "world"});
      obj.save();
      assert.equal(saved, '{"foo":1,"bar":"baz","hello":"world"}');
      assert.equal(str(), '{"foo":1,"bar":"baz","hello":"world"}');
      assert.deepEqual(obj(), {"foo":1, "bar":"baz", "hello":"world"});

      obj.setAndSave({"hello": "world"});
      assert.equal(saved, '{"hello":"world"}');
      assert.equal(str(), '{"hello":"world"}');
      assert.deepEqual(obj(), {"hello":"world"});
    });

    it("should support property observables", function() {
      var str = ko.observable('{"foo": 1, "bar": "baz"}');
      var saved = null;
      str.saveOnly = function(value) { saved = value; };
      var obj = modelUtil.jsonObservable(str);

      var foo = obj.prop("foo"), hello = obj.prop("hello");
      assert.equal(foo(), 1);
      assert.equal(hello(), undefined);

      obj.update({"foo": 17});
      assert.equal(foo(), 17);
      assert.equal(hello(), undefined);

      foo(18);
      assert.equal(str(), '{"foo":18,"bar":"baz"}');
      hello("world");
      assert.equal(saved, null);
      assert.equal(str(), '{"foo":18,"bar":"baz","hello":"world"}');
      assert.deepEqual(obj(), {"foo":18, "bar":"baz", "hello":"world"});

      foo.setAndSave(20);
      assert.equal(saved, '{"foo":20,"bar":"baz","hello":"world"}');
      assert.equal(str(), '{"foo":20,"bar":"baz","hello":"world"}');
      assert.deepEqual(obj(), {"foo":20, "bar":"baz", "hello":"world"});
    });
  });

  describe("objObservable", function() {
    it("should support property observables", function() {
      var objObs = ko.observable({"foo": 1, "bar": "baz"});
      var obj = modelUtil.objObservable(objObs);

      var foo = obj.prop("foo"), hello = obj.prop("hello");
      assert.equal(foo(), 1);
      assert.equal(hello(), undefined);

      obj.update({"foo": 17});
      assert.equal(foo(), 17);
      assert.equal(hello(), undefined);

      foo(18);
      hello("world");
      assert.deepEqual(obj(), {"foo":18, "bar":"baz", "hello":"world"});
    });
  });


  it("should support customComputed", function() {
    var obs = ko.observable("hello");
    var spy = sinon.spy();
    var cs = modelUtil.customComputed({
      read: () => obs(),
      save: (val) => spy(val)
    });

    // Check that customComputed auto-updates when the underlying value changes.
    assert.equal(cs(), "hello");
    assert.equal(cs.isSaved(), true);

    obs("world2");
    assert.equal(cs(), "world2");
    assert.equal(cs.isSaved(), true);

    // Check that it can be set to something else, and will stop auto-updating.
    cs("foo");
    assert.equal(cs(), "foo");
    assert.equal(cs.isSaved(), false);
    obs("world");
    assert.equal(cs(), "foo");
    assert.equal(cs.isSaved(), false);

    // Check that revert works.
    cs.revert();
    assert.equal(cs(), "world");
    assert.equal(cs.isSaved(), true);

    // Check that setting to the underlying value is same as revert.
    cs("foo");
    assert.equal(cs.isSaved(), false);
    cs("world");
    assert.equal(cs.isSaved(), true);

    // Check that save calls the save function.
    cs("foo");
    assert.equal(cs(), "foo");
    assert.equal(cs.isSaved(), false);
    return cs.save()
    .then(() => {
      sinon.assert.calledOnce(spy);
      sinon.assert.calledWithExactly(spy, "foo");
      // Once saved, the observable should revert.
      assert.equal(cs(), "world");
      assert.equal(cs.isSaved(), true);
      spy.resetHistory();

      // Check that saveOnly works similarly to save().
      return cs.saveOnly("foo2");
    })
    .then(() => {
      sinon.assert.calledOnce(spy);
      sinon.assert.calledWithExactly(spy, "foo2");
      assert.equal(cs(), "world");
      assert.equal(cs.isSaved(), true);
      spy.resetHistory();

      // Check that saving the underlying value does NOT call save().
      return cs.saveOnly("world");
    })
    .then(() => {
      sinon.assert.notCalled(spy);
      assert.equal(cs(), "world");
      assert.equal(cs.isSaved(), true);
      spy.resetHistory();

      return cs.saveOnly("bar");
    })
    .then(() => {
      assert.equal(cs(), "world");
      assert.equal(cs.isSaved(), true);
      sinon.assert.calledOnce(spy);
      sinon.assert.calledWithExactly(spy, "bar");
      // If save() updated the underlying value, the customComputed should see it.
      obs("bar");
      assert.equal(cs(), "bar");
      assert.equal(cs.isSaved(), true);
    });
  });
});
