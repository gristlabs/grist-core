var assert = require('chai').assert;
var clientUtil = require('../clientUtil');
var dom = require('app/client/lib/dom');
var Layout = require('app/client/components/Layout');

describe('Layout', function() {

  clientUtil.setTmpMochaGlobals();

  var layout;

  var sampleData = {
    children: [{
      children: [{
        children: [{
          leaf: 1
        }, {
          leaf: 2
        }]
      }, {
        children: [{
          children: [{
            leaf: 3
          }, {
            leaf: 4
          }]
        }, {
          leaf: 5
        }]
      }]
    }, {
      leaf: 6
    }]
  };

  function createLeaf(leafId) {
    return dom('div.layout_leaf_test', "#" + leafId);
  }

  beforeEach(function() {
    layout = Layout.Layout.create(sampleData, createLeaf);
  });

  afterEach(function() {
    layout.dispose();
    layout = null;
  });

  function getClasses(node) {
    return Array.prototype.slice.call(node.classList, 0).sort();
  }

  it("should generate same layout spec as it was built with", function() {
    assert.deepEqual(layout.getLayoutSpec(), sampleData);
    assert.deepEqual(layout.getAllLeafIds().sort(), [1, 2, 3, 4, 5, 6]);
  });

  it("should generate nested DOM structure", function() {
    var rootBox = layout.rootElem.querySelector('.layout_box');
    assert(rootBox);
    assert.strictEqual(rootBox, layout.rootBox().dom);
    assert.deepEqual(getClasses(rootBox), ["layout_box", "layout_last_child",
      "layout_vbox"]);

    var rows = rootBox.children;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].children.length, 2);
    assert.deepEqual(getClasses(rows[0]), ["layout_box", "layout_hbox"]);
    assert.deepEqual(getClasses(rows[0].children[0]), ["layout_box", "layout_vbox"]);
    assert.deepEqual(getClasses(rows[0].children[1]), ["layout_box", "layout_last_child",
      "layout_vbox"]);
    assert.equal(rows[1].children.length, 1);
    assert.includeMembers(getClasses(rows[1]), ["layout_box", "layout_hbox",
      "layout_last_child", "layout_leaf"]);
  });

  it("should correctly handle removing boxes", function() {
    layout.getLeafBox(4).removeFromParent();
    layout.getLeafBox(1).removeFromParent();
    assert.deepEqual(layout.getAllLeafIds().sort(), [2, 3, 5, 6]);

    assert.deepEqual(layout.getLayoutSpec(), {
      children: [{
        children: [{
          leaf: 2
        }, {
          children: [{
            leaf: 3
          }, {
            leaf: 5
          }]
        }]
      }, {
        leaf: 6
      }]
    });

    // Here we get into a rare situation with a single child (to allow root box to be split
    // vertically).
    layout.getLeafBox(6).removeFromParent();
    assert.deepEqual(layout.getLayoutSpec(), {
      children: [{
        children: [{
          leaf: 2
        }, {
          children: [{
            leaf: 3
          }, {
            leaf: 5
          }]
        }]
      }]
    });
    assert.deepEqual(layout.getAllLeafIds().sort(), [2, 3, 5]);

    // Here the special single-child box should collapse
    layout.getLeafBox(2).removeFromParent();
    assert.deepEqual(layout.getLayoutSpec(), {
      children: [{
        leaf: 3
      }, {
        leaf: 5
      }]
    });

    layout.getLeafBox(3).removeFromParent();
    assert.deepEqual(layout.getLayoutSpec(), {
      leaf: 5
    });
    assert.deepEqual(layout.getAllLeafIds().sort(), [5]);
  });

  it("should correctly handle adding child and sibling boxes", function() {
    // In this test, we'll build up the sample layout from scratch, trying to exercise all code
    // paths.
    layout = Layout.Layout.create({ leaf: 1 }, createLeaf);
    assert.deepEqual(layout.getLayoutSpec(), { leaf: 1 });
    assert.deepEqual(layout.getAllLeafIds().sort(), [1]);

    function makeBox(leafId) {
      return layout.buildLayoutBox({leaf: leafId});
    }

    assert.strictEqual(layout.rootBox(), layout.getLeafBox(1));
    layout.getLeafBox(1).addSibling(makeBox(5), true);
    assert.deepEqual(layout.getLayoutSpec(), {children: [{
      children: [{ leaf: 1 }, { leaf: 5 }]
    }]});
    assert.notStrictEqual(layout.rootBox(), layout.getLeafBox(1));

    // An extra little check to add a sibling to a vertically-split root (in which case the split
    // is really a level lower, and that's where the sibling should be added).
    layout.rootBox().addSibling(makeBox("foo"), true);
    assert.deepEqual(layout.getLayoutSpec(), {children: [{
      children: [{ leaf: 1 }, { leaf: 5 }, { leaf: "foo" }]
    }]});
    assert.deepEqual(layout.getAllLeafIds().sort(), [1, 5, "foo"]);
    layout.getLeafBox("foo").dispose();
    assert.deepEqual(layout.getAllLeafIds().sort(), [1, 5]);

    layout.getLeafBox(1).parentBox().addSibling(makeBox(6), true);
    layout.getLeafBox(5).addChild(makeBox(3), false);
    layout.getLeafBox(3).addChild(makeBox(4), true);
    layout.getLeafBox(1).addChild(makeBox(2), true);
    assert.deepEqual(layout.getLayoutSpec(), sampleData);
    assert.deepEqual(layout.getAllLeafIds().sort(), [1, 2, 3, 4, 5, 6]);
  });
});
