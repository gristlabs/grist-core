var ko = require('knockout');
var dom = require('../lib/dom');
var dispose = require('../lib/dispose');
var Layout = require('./Layout');

/**
 * LayoutPreview - Represents a preview for a single layout. Builds an icon that takes
 *  the size of its container showing a version of the layout made from solid blocks.
 *  An optional map between leafId and hex color strings may be used to color the blocks.
 *  The map may be an observable, but it is only consulted on changes to layoutSpecObj.
 */
function LayoutPreview(layoutSpecObj, optColorMap) {
  var self = this;
  this.layoutSpecObj = layoutSpecObj;
  this.colorMap = optColorMap || {};

  this.layout = this.autoDispose(
    Layout.Layout.create(this.layoutSpecObj(),
      function(leafId) {
        var content = dom('div.layout_preview_leaf');
        var colorMap = ko.unwrap(self.colorMap);
        content.style.backgroundColor = colorMap[leafId] || "#000";
        return content;
      }, true)
  );

  // When the layoutSpec changes, rebuild.
  this.autoDispose(this.layoutSpecObj.subscribe(function(spec) {
    this.layout.buildLayout(this.layoutSpecObj(), true);
  }, this));

}
dispose.makeDisposable(LayoutPreview);


LayoutPreview.prototype.buildDom = function() {
  return this.layout.rootElem;
};

module.exports = LayoutPreview;
