var assert = require('chai').assert;
var RecentItems = require('app/common/RecentItems');

describe('RecentItems', function() {
  let simpleList = ['foo', 'bar', 'baz'];

  let objList = [
    { name: 'foo', path: '/foo' },
    { name: 'bar', path: '/bar' },
    { name: 'baz', path: '/baz' },
  ];

  describe("listItems", function() {
    it("should return a valid list", function() {
      let recentItems = new RecentItems({
         intialItems: simpleList
      });
      assert.deepEqual(recentItems.listItems(), ['foo', 'bar', 'baz']);
    });

    it("should return a valid list given a keyFunc", function() {
      let recentItems = new RecentItems({
         intialItems: objList,
         keyFunc: item => item.path
      });
      assert.deepEqual(recentItems.listItems(), [
        { name: 'foo', path: '/foo' },
        { name: 'bar', path: '/bar' },
        { name: 'baz', path: '/baz' },
      ]);
    });

    it("should produce a list of objects with unique keys", function() {
      let recentItems = new RecentItems({
         intialItems: [
           { name: 'foo', path: '/foo' },
           { name: 'bar', path: '/bar' },
           { name: 'foo', path: '/foo' },
           { name: 'baz', path: '/baz' },
           { name: 'foobar', path: '/foo' },
         ],
         keyFunc: item => item.path
      });
      assert.deepEqual(recentItems.listItems(), [
        { name: 'bar', path: '/bar' },
        { name: 'baz', path: '/baz' },
        { name: 'foobar', path: '/foo' }
      ]);
      let recentItems2 = new RecentItems({
         intialItems: simpleList,
      });
      assert.deepEqual(recentItems2.listItems(), ['foo', 'bar', 'baz']);
      for(let i = 0; i < 30; i++) {
        recentItems2.addItems(simpleList);
      }
      assert.deepEqual(recentItems2.listItems(), ['foo', 'bar', 'baz']);
    });

    it("should produce a list with the correct max length", function() {
      let recentItems = new RecentItems({
         intialItems: objList,
         maxCount: 2,
         keyFunc: item => item.path
      });
      assert.deepEqual(recentItems.listItems(), [
        { name: 'bar', path: '/bar' },
        { name: 'baz', path: '/baz' }
      ]);
      recentItems.addItem({ name: 'foo', path: '/foo' });
      assert.deepEqual(recentItems.listItems(), [
        { name: 'baz', path: '/baz' },
        { name: 'foo', path: '/foo' }
      ]);
      recentItems.addItem({name: 'BAZ', path: '/baz'});
      assert.deepEqual(recentItems.listItems(), [
        { name: 'foo', path: '/foo' },
        { name: 'BAZ', path: '/baz' }
      ]);
      let recentItems2 = new RecentItems({
         intialItems: simpleList,
         maxCount: 10
      });
      let alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
      recentItems2.addItems(alphabet);
      assert.deepEqual(recentItems2.listItems(), 'qrstuvwxyz'.split(""));
      recentItems2.addItem('a');
      assert.deepEqual(recentItems2.listItems(), 'rstuvwxyza'.split(""));
      recentItems2.addItem('r');
      assert.deepEqual(recentItems2.listItems(), 'stuvwxyzar'.split(""));
    });
  });
});
