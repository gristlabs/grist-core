var assert = require('chai').assert;
var sinon = require('sinon');
var Promise = require('bluebird');
var ko = require('knockout');

var dom = require('app/client/lib/dom');
var clientUtil = require('../clientUtil');
var G = require('app/client/lib/browserGlobals').get('DocumentFragment');
var utils = require('../../utils');

describe('dom', function() {

  clientUtil.setTmpMochaGlobals();

  describe("dom construction", function() {
    it("should create elements with the right tag name, class and ID", function() {
      var elem = dom('div', "Hello world");
      assert.equal(elem.tagName, "DIV");
      assert(!elem.className);
      assert(!elem.id);
      assert.equal(elem.textContent, "Hello world");

      elem = dom('span#foo.bar.baz', "Hello world");
      assert.equal(elem.tagName, "SPAN");
      assert.equal(elem.className, "bar baz");
      assert.equal(elem.id, "foo");
      assert.equal(elem.textContent, "Hello world");
    });

    it("should set attributes", function() {
      var elem = dom('a', { title: "foo", id: "bar" });
      assert.equal(elem.title, "foo");
      assert.equal(elem.id, "bar");
    });

    it("should set children", function() {
      var elem = dom('div',
                     "foo", dom('a#a'),
                     [dom('a#b'), "bar", dom('a#c')],
                     dom.frag(dom('a#d'), "baz", dom('a#e')));
      assert.equal(elem.childNodes.length, 8);
      assert.equal(elem.childNodes[0].data, "foo");
      assert.equal(elem.childNodes[1].id, "a");
      assert.equal(elem.childNodes[2].id, "b");
      assert.equal(elem.childNodes[3].data, "bar");
      assert.equal(elem.childNodes[4].id, "c");
      assert.equal(elem.childNodes[5].id, "d");
      assert.equal(elem.childNodes[6].data, "baz");
      assert.equal(elem.childNodes[7].id, "e");
    });

    it('should flatten nested arrays and arrays returned from functions', function() {
      var values = ['apple', 'orange', ['banana', 'mango']];
      var elem = dom('ul',
        values.map(function(value, index) {
          return dom('li', value);
        }),
        [
          dom('li', 'pear'),
          [
            dom('li', 'peach'),
            dom('li', 'cranberry'),
          ],
          dom('li', 'date')
        ]
      );

      assert.equal(elem.outerHTML, "<ul><li>apple</li><li>orange</li>" +
        "<li>bananamango</li><li>pear</li><li>peach</li><li>cranberry</li>" +
        "<li>date</li></ul>");

      elem = dom('ul',
        function(innerElem) {
          return [
            dom('li', 'plum'),
            dom('li', 'pomegranate')
          ];
        },
        function(innerElem) {
          return function(moreInnerElem) {
            return [
              dom('li', 'strawberry'),
              dom('li', 'blueberry')
            ];
          };
        }
      );
      assert.equal(elem.outerHTML, "<ul><li>plum</li><li>pomegranate</li>" +
        "<li>strawberry</li><li>blueberry</li></ul>");

    });

    it("should append append values returned from functions except undefined", function() {
      var elem = dom('div',
        function(divElem) {
          divElem.classList.add('yogurt');
          return dom('div', 'sneakers');
        },
        dom('span', 'melon')
      );

      assert.equal(elem.classList[0], 'yogurt',
        'function shold have applied new class to outer div');
      assert.equal(elem.childNodes.length, 2);
      assert.equal(elem.childNodes[0].innerHTML, "sneakers");
      assert.equal(elem.childNodes[1].innerHTML, "melon");

      elem = dom('div',
        function(divElem) {
          return undefined;
        }
      );
      assert.equal(elem.childNodes.length, 0,
        "undefined returned from a function should not be added to the DOM tree");
    });

    it('should not append nulls', function() {
      var elem = dom('div',
        [
          "hello",
          null,
          "world",
          null,
          "jazz"
        ],
        'hands',
        null
      );
      assert.equal(elem.childNodes.length, 4,
        "undefined returned from a function should not be added to the DOM tree");
      assert.equal(elem.childNodes[0].data, "hello");
      assert.equal(elem.childNodes[1].data, "world");
      assert.equal(elem.childNodes[2].data, "jazz");
      assert.equal(elem.childNodes[3].data, "hands");
    });

  });

  utils.timing.describe("dom", function() {
    var built, child;
    before(function() {
      child = dom('bar');
    });
    utils.timing.it(40, "should be fast", function() {
      built = utils.repeat(100, function() {
        return dom('div#id1.class1.class2', {disabled: 'disabled'},
          'foo',
          child,
          ['hello', 'world'],
          function(elem) {
            return 'test';
          }
        );
      });
    });
    utils.timing.it(40, "should be fast", function() {
      utils.repeat(100, function() {
        dom('div#id1.class1.class2.class3');
        dom('div#id1.class1.class2.class3');
        dom('div#id1.class1.class2.class3');
        dom('div#id1.class1.class2.class3');
        dom('div#id1.class1.class2.class3');
      });
    });
    after(function() {
      assert.equal(built.getAttribute('disabled'), 'disabled');
      assert.equal(built.tagName, 'DIV');
      assert.equal(built.className, 'class1 class2');
      assert.equal(built.childNodes.length, 5);
      assert.equal(built.childNodes[0].data, 'foo');
      assert.equal(built.childNodes[1], child);
      assert.equal(built.childNodes[2].data, 'hello');
      assert.equal(built.childNodes[3].data, 'world');
      assert.equal(built.childNodes[4].data, 'test');
    });
  });

  describe("dom.frag", function() {
    it("should create DocumentFragments", function() {
      var elem1 = dom.frag(["hello", "world"]);
      assert(elem1 instanceof G.DocumentFragment);
      assert.equal(elem1.childNodes.length, 2);
      assert.equal(elem1.childNodes[0].data, "hello");
      assert.equal(elem1.childNodes[1].data, "world");

      var elem2 = dom.frag("hello", "world");
      assert(elem2 instanceof G.DocumentFragment);
      assert.equal(elem2.childNodes.length, 2);
      assert.equal(elem2.childNodes[0].data, "hello");
      assert.equal(elem2.childNodes[1].data, "world");

      var elem3 = dom.frag(dom("div"), [dom("span"), "hello"], "world");
      assert.equal(elem3.childNodes.length, 4);
      assert.equal(elem3.childNodes[0].tagName, "DIV");
      assert.equal(elem3.childNodes[1].tagName, "SPAN");
      assert.equal(elem3.childNodes[2].data, "hello");
      assert.equal(elem3.childNodes[3].data, "world");
    });
  });

  describe("inlineable", function() {
    it("should return a function suitable for use as dom argument", function() {
      var ctx = {a:1}, b = dom('span'), c = {c:1};
      var spy = sinon.stub().returns(c);
      var inlinable = dom.inlineable(spy);

      // When the first argument is a Node, then calling inlineable is the same as calling spy.
      inlinable.call(ctx, b, c, 1, "asdf");
      sinon.assert.calledOnce(spy);
      sinon.assert.calledOn(spy, ctx);
      sinon.assert.calledWithExactly(spy, b, c, 1, "asdf");
      assert.strictEqual(spy.returnValues[0], c);
      spy.reset();
      spy.returns(c);

      // When the first Node argument is omitted, then the call is deferred. Check that it works
      // correctly.
      var func = inlinable.call(ctx, c, 1, "asdf");
      sinon.assert.notCalled(spy);
      assert.equal(typeof func, 'function');
      assert.deepEqual(spy.returnValues, []);
      let r = func(b);
      sinon.assert.calledOnce(spy);
      sinon.assert.calledOn(spy, ctx);
      sinon.assert.calledWithExactly(spy, b, c, 1, "asdf");
      assert.deepEqual(r, c);
      assert.strictEqual(spy.returnValues[0], c);
    });
  });

  utils.timing.describe("dom.inlinable", function() {
    var elem, spy, inlinableCounter, inlinableSpy, count = 0;
    before(function() {
      elem = dom('span');
      spy = sinon.stub();
      inlinableCounter = dom.inlinable(function(elem, a, b) {
        count++;
      });
      inlinableSpy = dom.inlinable(spy);
    });

    utils.timing.it(25, "should be fast", function() {
      utils.repeat(10000, function() {
        inlinableCounter(1, "asdf")(elem);
        inlinableCounter(1, "asdf")(elem);
        inlinableCounter(1, "asdf")(elem);
        inlinableCounter(1, "asdf")(elem);
        inlinableCounter(1, "asdf")(elem);
      });
      inlinableSpy()(elem);
      inlinableSpy(1)(elem);
      inlinableSpy(1, "asdf")(elem);
      inlinableSpy(1, "asdf", 56)(elem);
      inlinableSpy(1, "asdf", 56, "hello")(elem);
    });

    after(function() {
      assert.equal(count, 50000);
      sinon.assert.callCount(spy, 5);
      assert.deepEqual(spy.args[0], [elem]);
      assert.deepEqual(spy.args[1], [elem, 1]);
      assert.deepEqual(spy.args[2], [elem, 1, "asdf"]);
      assert.deepEqual(spy.args[3], [elem, 1, "asdf", 56]);
      assert.deepEqual(spy.args[4], [elem, 1, "asdf", 56, "hello"]);
    });
  });

  describe("dom.defer", function() {
    it("should call supplied function after the current call stack", function() {
      var obj = {};
      var spy1 = sinon.spy();
      var spy2 = sinon.spy();
      var div, span;
      dom('div',
        span = dom('span', dom.defer(spy1, obj)),
        div = dom('div', spy2)
      );
      sinon.assert.calledOnce(spy2);
      sinon.assert.calledWithExactly(spy2, div);
      sinon.assert.notCalled(spy1);
      return Promise.delay(0).then(function() {
        sinon.assert.calledOnce(spy2);
        sinon.assert.calledOnce(spy1);
        assert(spy2.calledBefore(spy1));
        sinon.assert.calledOn(spy1, obj);
        sinon.assert.calledWithExactly(spy1, span);
      });
    });
  });

  describe("dom.onDispose", function() {
    it("should call supplied function when an element is cleaned up", function() {
      var obj = {};
      var spy1 = sinon.spy();
      var spy2 = sinon.spy();
      var div, span;
      div = dom('div',
        span = dom('span', dom.onDispose(spy1, obj)),
        dom.onDispose(spy2)
      );
      sinon.assert.notCalled(spy1);
      sinon.assert.notCalled(spy2);
      ko.virtualElements.emptyNode(div);
      sinon.assert.notCalled(spy2);
      sinon.assert.calledOnce(spy1);
      sinon.assert.calledOn(spy1, obj);
      sinon.assert.calledWithExactly(spy1, span);
      ko.removeNode(div);
      sinon.assert.calledOnce(spy1);
      sinon.assert.calledOnce(spy2);
      sinon.assert.calledOn(spy2, undefined);
      sinon.assert.calledWithExactly(spy2, div);
    });
  });

  describe("dom.autoDispose", function() {
    it("should call dispose the supplied value when an element is cleaned up", function() {
      var obj = { dispose: sinon.spy() };
      var div = dom('div', dom.autoDispose(obj));
      ko.cleanNode(div);
      sinon.assert.calledOnce(obj.dispose);
      sinon.assert.calledOn(obj.dispose, obj);
      sinon.assert.calledWithExactly(obj.dispose);
    });
  });

  describe("dom.findLastChild", function() {
    it("should return last matching child", function() {
      var el = dom('div', dom('div.a.b'), dom('div.b.c'), dom('div.c.d'));
      assert.equal(dom.findLastChild(el, '.b').className, 'b c');
      assert.equal(dom.findLastChild(el, '.f'), null);
      assert.equal(dom.findLastChild(el, '.c.d').className, 'c d');
      assert.equal(dom.findLastChild(el, '.b.a').className, 'a b');
      function filter(elem) { return elem.classList.length === 2; }
      assert.equal(dom.findLastChild(el, filter).className, 'c d');
    });
  });

  describe("dom.findAncestor", function() {
    var el1, el2, el3, el4;
    before(function() {
      el1 = dom('div.foo.bar',
        el2 = dom('div.foo',
          el3 = dom('div.baz')
        ),
        el4 = dom('div.foo.bar2')
      );
    });

    function assertSameElem(elem1, elem2) {
      assert(elem1 === elem2, "Expected " + elem1 + " to be " + elem2);
    }

    it("should return the child itself if it matches", function() {
      assertSameElem(dom.findAncestor(el3, null, '.baz'), el3);
      assertSameElem(dom.findAncestor(el3, el3, '.baz'), el3);
    });

    it("should stop at the nearest match", function() {
      assertSameElem(dom.findAncestor(el3, null, '.foo'), el2);
      assertSameElem(dom.findAncestor(el3, el1, '.foo'), el2);
      assertSameElem(dom.findAncestor(el3, el2, '.foo'), el2);
      assertSameElem(dom.findAncestor(el3, el3, '.foo'), null);
    });

    it("should not go past container", function() {
      assertSameElem(dom.findAncestor(el3, null, '.bar'), el1);
      assertSameElem(dom.findAncestor(el3, el1, '.bar'), el1);
      assertSameElem(dom.findAncestor(el3, el2, '.bar'), null);
      assertSameElem(dom.findAncestor(el3, el3, '.bar'), null);
    });

    it("should fail if child is outside of container", function() {
      assertSameElem(dom.findAncestor(el3, el4, '.foo'), null);
      assertSameElem(dom.findAncestor(el2, el3, '.foo'), null);
    });

    it("should return null for no matches", function() {
      assertSameElem(dom.findAncestor(el3, null, '.blah'), null);
      assertSameElem(dom.findAncestor(el3, el1, '.blah'), null);
      assertSameElem(dom.findAncestor(el3, el2, '.blah'), null);
      assertSameElem(dom.findAncestor(el3, el3, '.blah'), null);
    });

    function filter(elem) { return elem.classList.length === 2; }
    it("should handle a custom filter function", function() {
      assertSameElem(dom.findAncestor(el3, null, filter), el1);
      assertSameElem(dom.findAncestor(el3, el1, filter), el1);
      assertSameElem(dom.findAncestor(el3, el2, filter), null);
      assertSameElem(dom.findAncestor(el3, el3, filter), null);
      assertSameElem(dom.findAncestor(el3, el4, filter), null);
    });
  });
});
