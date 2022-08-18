var dom = require('app/client/lib/dom');
var kd = require('app/client/lib/koDom');
var kf = require('app/client/lib/koForm');
var Layout = require('app/client/components/Layout');
var LayoutEditor = require('app/client/components/LayoutEditor');

function createTestTab() {
  return kf.topTab('Layout',
    kf.label("Layout Editor")
  );
}
exports.createTestTab = createTestTab;

var sampleData = {
  children: [{
    children: [{
      children: [{
        leaf: 1
      }, {
        leaf: 2
      }, {
        leaf: 7
      }, {
        leaf: 8
      }]
    }, {
      children: [{
        children: [{
          leaf: 3
        }, {
          leaf: 4
        }, {
          leaf: 9
        }, {
          leaf: 10
        }]
      }, {
        leaf: 5
      }]
    }]
  }, {
    leaf: 6
  }]
};

function getMaxLeaf(spec) {
  var maxChild = spec.children ? Math.max.apply(Math, spec.children.map(getMaxLeaf)) : -Infinity;
  return Math.max(maxChild, spec.leaf || -Infinity);
}

function createLeaf(leafId) {
  return dom('div.layout_leaf_test', "#" + leafId,
    kd.toggleClass('layout_leaf_test_big', leafId % 2 === 0)
  );
}

function createTestPane() {
  var layout = Layout.Layout.create(sampleData, createLeaf);
  var layoutEditor = LayoutEditor.LayoutEditor.create(layout);
  var maxLeaf = getMaxLeaf(sampleData);
  return dom('div',
    dom.autoDispose(layoutEditor),
    dom.autoDispose(layout),
    dom('div',
      dom('div.layout_new.pull-left', '+ Add New',
        dom.on('mousedown', function(event) {
          layoutEditor.dragInNewBox(event, ++maxLeaf);
          return false;
        })
      ),
      dom('div.layout_trash.pull-right',
        dom('span.glyphicon.glyphicon-trash')
      ),
      dom('div.clearfix')
    ),
    layout.rootElem
  );
}

exports.createTestPane = createTestPane;
