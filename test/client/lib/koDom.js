var assert = require('assert');
var ko = require('knockout');
var sinon = require('sinon');

var dom = require('app/client/lib/dom');
var kd = require('app/client/lib/koDom');
var koArray = require('app/client/lib/koArray');
var clientUtil = require('../clientUtil');

describe('koDom', function() {

  clientUtil.setTmpMochaGlobals();

  describe("simple properties", function() {
    it("should update dynamically", function() {
      var obs = ko.observable('bar');
      var width = ko.observable(17);
      var elem = dom('div',
                     kd.attr('a1', 'foo'),
                     kd.attr('a2', obs),
                     kd.attr('a3', function() { return "a3" + obs(); }),
                     kd.text(obs),
                     kd.style('width', function() { return width() + 'px'; }),
                     kd.toggleClass('isbar', function() { return obs() === 'bar'; }),
                     kd.cssClass(function() { return 'class' + obs(); }));

      assert.equal(elem.getAttribute('a1'), 'foo');
      assert.equal(elem.getAttribute('a2'), 'bar');
      assert.equal(elem.getAttribute('a3'), 'a3bar');
      assert.equal(elem.textContent, 'bar');
      assert.equal(elem.style.width, '17px');
      assert.equal(elem.className, 'isbar classbar');
      obs('BAZ');
      width('34');
      assert.equal(elem.getAttribute('a1'), 'foo');
      assert.equal(elem.getAttribute('a2'), 'BAZ');
      assert.equal(elem.getAttribute('a3'), 'a3BAZ');
      assert.equal(elem.textContent, 'BAZ');
      assert.equal(elem.style.width, '34px');
      assert.equal(elem.className, 'classBAZ');
      obs('bar');
      assert.equal(elem.className, 'isbar classbar');
    });
  });

  describe("domData", function() {
    it("should set domData and reflect observables", function() {
      var foo = ko.observable(null);
      var elem = dom('div',
        kd.domData('foo', foo),
        kd.domData('bar', 'BAR')
      );
      assert.equal(ko.utils.domData.get(elem, 'foo'), null);
      assert.equal(ko.utils.domData.get(elem, 'bar'), 'BAR');
      foo(123);
      assert.equal(ko.utils.domData.get(elem, 'foo'), 123);
    });
  });

  describe("scope", function() {
    it("should handle any number of children", function() {
      var obs = ko.observable();
      var elem = dom('div', 'Hello',
                     kd.scope(obs, function(value) {
                       return value;
                     }),
                     'World');
      assert.equal(elem.textContent, "HelloWorld");
      obs("Foo");
      assert.equal(elem.textContent, "HelloFooWorld");
      obs([]);
      assert.equal(elem.textContent, "HelloWorld");
      obs(["Foo", "Bar"]);
      assert.equal(elem.textContent, "HelloFooBarWorld");
      obs(null);
      assert.equal(elem.textContent, "HelloWorld");
      obs([dom.frag("Foo", dom("span", "Bar")), dom("div", "Baz")]);
      assert.equal(elem.textContent, "HelloFooBarBazWorld");
    });

    it("should cope with children getting removed outside", function() {
      var obs = ko.observable();
      var elem = dom('div', 'Hello', kd.scope(obs, function(v) { return v; }), 'World');
      assert.equal(elem.innerHTML, 'Hello<!---->World');

      obs(dom.frag(dom('div', 'Foo'), dom('div', 'Bar')));
      assert.equal(elem.innerHTML, 'Hello<!----><div>Foo</div><div>Bar</div>World');
      elem.removeChild(elem.childNodes[2]);
      assert.equal(elem.innerHTML, 'Hello<!----><div>Bar</div>World');
      obs(null);
      assert.equal(elem.innerHTML, 'Hello<!---->World');

      obs(dom.frag(dom('div', 'Foo'), dom('div', 'Bar')));
      elem.removeChild(elem.childNodes[3]);
      assert.equal(elem.innerHTML, 'Hello<!----><div>Foo</div>World');
      obs(dom.frag(dom('div', 'Foo'), dom('div', 'Bar')));
      assert.equal(elem.innerHTML, 'Hello<!----><div>Foo</div><div>Bar</div>World');
    });

  });

  describe("maybe", function() {
    it("should handle any number of children", function() {
      var obs = ko.observable(0);
      var elem = dom('div', 'Hello',
                     kd.maybe(function() { return obs() > 0; }, function() {
                       return dom("span", "Foo");
                     }),
                     kd.maybe(function() { return obs() > 1; }, function() {
                       return [dom("span", "Foo"), dom("span", "Bar")];
                     }),
                     "World");
      assert.equal(elem.textContent, "HelloWorld");
      obs(1);
      assert.equal(elem.textContent, "HelloFooWorld");
      obs(2);
      assert.equal(elem.textContent, "HelloFooFooBarWorld");
      obs(0);
      assert.equal(elem.textContent, "HelloWorld");
    });

    it("should pass truthy value to content function", function() {
      var obs = ko.observable(null);
      var elem = dom('div', 'Hello', kd.maybe(obs, function(x) { return x; }), 'World');
      assert.equal(elem.innerHTML, 'Hello<!---->World');
      obs(dom('span', 'Foo'));
      assert.equal(elem.innerHTML, 'Hello<!----><span>Foo</span>World');
      obs(0);   // Falsy values should destroy the content
      assert.equal(elem.innerHTML, 'Hello<!---->World');
    });
  });

  describe("foreach", function() {
    it("should work with koArray", function() {
      var model = koArray();

      // Make sure the loop notices elements already in the model.
      model.assign(["a", "b", "c"]);
      var elem = dom('div', "[",
                     kd.foreach(model, function(item) {
                       return dom('span', ":", dom('span', kd.text(item)));
                     }),
                     "]"
                    );

      assert.equal(elem.textContent, "[:a:b:c]");

      // Delete all elements.
      model.splice(0);
      assert.equal(elem.textContent, "[]");

      // Test push.
      model.push("hello");
      assert.equal(elem.textContent, "[:hello]");
      model.push("world");
      assert.equal(elem.textContent, "[:hello:world]");

      // Test splice that replaces some elements with more.
      model.splice(0, 1, "foo", "bar", "baz");
      assert.equal(elem.textContent, "[:foo:bar:baz:world]");

      // Test splice which removes some elements.
      model.splice(-3, 2);
      assert.equal(elem.textContent, "[:foo:world]");

      // Test splice which adds some elements in the middle.
      model.splice(1, 0, "test2", "test3");
      assert.equal(elem.textContent, "[:foo:test2:test3:world]");
    });

    it("should work when items disappear from under it", function() {
      var elements = [dom('span', 'a'), dom('span', 'b'), dom('span', 'c')];
      var model = koArray();
      model.assign(elements);
      var elem = dom('div', '[', kd.foreach(model, function(item) { return item; }), ']');
      assert.equal(elem.textContent, "[abc]");

      // Plain splice out.
      var removed = model.splice(1, 1);
      assert.deepEqual(removed, [elements[1]]);
      assert.deepEqual(model.peek(), [elements[0], elements[2]]);
      assert.equal(elem.textContent, "[ac]");

      // Splice it back in.
      model.splice(1, 0, elements[1]);
      assert.equal(elem.textContent, "[abc]");

      // Now remove the element from DOM manually.
      elem.removeChild(elements[1]);
      assert.equal(elem.textContent, "[ac]");
      assert.deepEqual(model.peek(), elements);

      // Use splice again, and make sure it still does the right thing.
      removed = model.splice(2, 1);
      assert.deepEqual(removed, [elements[2]]);
      assert.deepEqual(model.peek(), [elements[0], elements[1]]);
      assert.equal(elem.textContent, "[a]");

      removed = model.splice(0, 2);
      assert.deepEqual(removed, [elements[0], elements[1]]);
      assert.deepEqual(model.peek(), []);
      assert.equal(elem.textContent, "[]");
    });

    it("should work when items are null", function() {
      var model = koArray();
      var elem = dom('div', '[',
        kd.foreach(model, function(item) { return item && dom('span', item); }),
        ']');
      assert.equal(elem.textContent, "[]");

      model.splice(0, 0, "a", "b", "c");
      assert.equal(elem.textContent, "[abc]");

      var childCount = elem.childNodes.length;
      model.splice(1, 1, null);
      assert.equal(elem.childNodes.length, childCount - 1);   // One child removed, non added.
      assert.equal(elem.textContent, "[ac]");

      model.splice(1, 0, "x");
      assert.equal(elem.textContent, "[axc]");

      model.splice(3, 0, "y");
      assert.equal(elem.textContent, "[axyc]");

      model.splice(1, 2);
      assert.equal(elem.textContent, "[ayc]");

      model.splice(0, 3);
      assert.equal(elem.textContent, "[]");
    });

    it("should dispose subscribables for detached nodes", function() {
      var obs = ko.observable("AAA");
      var cb = sinon.spy(function(x) { return x; });
      var data = koArray([ko.observable("foo"), ko.observable("bar")]);

      var elem = dom('div', kd.foreach(data, function(item) {
        return dom('div', kd.text(function() { return cb(item() + ":" + obs()); }));
      }));

      assert.equal(elem.innerHTML, '<!----><div>foo:AAA</div><div>bar:AAA</div>');
      obs("BBB");
      assert.equal(elem.innerHTML, '<!----><div>foo:BBB</div><div>bar:BBB</div>');
      data.splice(1, 1);
      assert.equal(elem.innerHTML, '<!----><div>foo:BBB</div>');
      cb.resetHistory();
      // Below is the core of the test: we are checking that the computed observable created for
      // the second item of the array ("bar") does NOT trigger a call to cb.
      obs("CCC");
      assert.equal(elem.innerHTML, '<!----><div>foo:CCC</div>');
      sinon.assert.calledOnce(cb);
      sinon.assert.calledWith(cb, "foo:CCC");
    });
  });
});
