var _ = require('underscore');
var sinon = require('sinon');
var assert = require('chai').assert;
var ko = require('knockout');
var Mousetrap = require('app/client/lib/Mousetrap');
var commands = require('app/client/components/commands');
var clientUtil = require('../clientUtil');

describe('commands', function() {

  clientUtil.setTmpMochaGlobals();

  before(function() {
    sinon.stub(Mousetrap, "bind");
    sinon.stub(Mousetrap, "unbind");
  });

  after(function() {
    Mousetrap.bind.restore();
    Mousetrap.unbind.restore();
  });

  beforeEach(function() {
    commands.init([{
      group: "Foo",
      commands: [{
        name: "cmd1",
        keys: ["Ctrl+a", "Ctrl+b"],
        desc: "Command 1"
      }, {
        name: "cmd2",
        keys: ["Ctrl+c"],
        desc: "Command 2"
      }, {
        name: "cmd3",
        keys: ["Ctrl+a"],
        desc: "Command 1B"
      }]
    }]);
  });

  describe("activate", function() {
    it("should invoke Mousetrap.bind/unbind", function() {
      var obj = {};
      var spy = sinon.spy();
      var cmdGroup = commands.createGroup({ cmd1: spy }, obj, true);
      sinon.assert.callCount(Mousetrap.bind, 2);
      sinon.assert.calledWith(Mousetrap.bind, "ctrl+a");
      sinon.assert.calledWith(Mousetrap.bind, "ctrl+b");
      Mousetrap.bind.reset();
      Mousetrap.unbind.reset();

      commands.allCommands.cmd1.run();
      sinon.assert.callCount(spy, 1);
      sinon.assert.calledOn(spy, obj);

      cmdGroup.activate(false);
      sinon.assert.callCount(Mousetrap.bind, 0);
      sinon.assert.callCount(Mousetrap.unbind, 2);
      sinon.assert.calledWith(Mousetrap.unbind, "ctrl+a");
      sinon.assert.calledWith(Mousetrap.unbind, "ctrl+b");
      Mousetrap.bind.reset();
      Mousetrap.unbind.reset();

      commands.allCommands.cmd1.run();
      sinon.assert.callCount(spy, 1);

      cmdGroup.activate(true);
      sinon.assert.callCount(Mousetrap.bind, 2);
      sinon.assert.calledWith(Mousetrap.bind, "ctrl+a");
      sinon.assert.calledWith(Mousetrap.bind, "ctrl+b");
      sinon.assert.callCount(Mousetrap.unbind, 0);

      commands.allCommands.cmd1.run();
      sinon.assert.callCount(spy, 2);

      cmdGroup.dispose();
      sinon.assert.callCount(Mousetrap.unbind, 2);
      sinon.assert.calledWith(Mousetrap.unbind, "ctrl+a");
      sinon.assert.calledWith(Mousetrap.unbind, "ctrl+b");

      commands.allCommands.cmd1.run();
      sinon.assert.callCount(spy, 2);
    });

    /**
     * For an object of the form { group1: { cmd1: sinon.spy() } }, goes through all spys, and
     * returns a mapping of call counts: {'group1:cmd1': spyCallCount}.
     */
    function getCallCounts(groups) {
      var counts = {};
      _.each(groups, function(group, grpName) {
        _.each(group, function(cmdSpy, cmdName) {
          counts[grpName + ":" + cmdName] = cmdSpy.callCount;
        });
      });
      return counts;
    }

    /**
     * Diffs two sets of call counts as produced by getCallCounts and returns the difference.
     */
    function diffCallCounts(callCounts1, callCounts2) {
      return _.chain(callCounts2).mapObject(function(count, name) {
        return count - callCounts1[name];
      })
      .pick(function(count, name) {
        return count > 0;
      })
      .value();
    }

    /**
     * Invokes the given command, and makes sure the difference of call counts before and after is
     * as expected.
     */
    function assertCallCounts(groups, cmdOrFunc, expectedCounts) {
      var before = getCallCounts(groups);
      if (typeof cmdOrFunc === 'string') {
        commands.allCommands[cmdOrFunc].run();
      } else if (cmdOrFunc === null) {
        // nothing
      } else {
        cmdOrFunc();
      }
      var after = getCallCounts(groups);
      assert.deepEqual(diffCallCounts(before, after), expectedCounts);
    }

    it("should respect order of CommandGroups", function() {
      var groups = {
        group1: { cmd1: sinon.spy(), cmd3: sinon.spy() },
        group2: { cmd1: sinon.spy(), cmd2: sinon.spy() },
        group3: { cmd3: sinon.spy() },
      };
      var cmdGroup1 = commands.createGroup(groups.group1, null, true);
      var cmdGroup2 = commands.createGroup(groups.group2, null, true);
      var cmdGroup3 = commands.createGroup(groups.group3, null, false);

      assertCallCounts(groups, 'cmd1', {'group2:cmd1': 1});
      assertCallCounts(groups, 'cmd2', {'group2:cmd2': 1});
      assertCallCounts(groups, 'cmd3', {'group1:cmd3': 1});

      cmdGroup2.activate(false);
      assertCallCounts(groups, 'cmd1', {'group1:cmd1': 1});
      assertCallCounts(groups, 'cmd2', {});
      assertCallCounts(groups, 'cmd3', {'group1:cmd3': 1});

      cmdGroup3.activate(true);
      cmdGroup1.activate(false);
      assertCallCounts(groups, 'cmd1', {});
      assertCallCounts(groups, 'cmd2', {});
      assertCallCounts(groups, 'cmd3', {'group3:cmd3': 1});

      cmdGroup2.activate(true);
      assertCallCounts(groups, 'cmd1', {'group2:cmd1': 1});
      assertCallCounts(groups, 'cmd2', {'group2:cmd2': 1});
      assertCallCounts(groups, 'cmd3', {'group3:cmd3': 1});
    });

    it("should allow use of observable for activation flag", function() {
      var groups = {
        groupFoo: { cmd1: sinon.spy() },
      };
      var isActive = ko.observable(false);
      commands.createGroup(groups.groupFoo, null, isActive);
      assertCallCounts(groups, 'cmd1', {});
      isActive(true);
      assertCallCounts(groups, 'cmd1', {'groupFoo:cmd1': 1});
      // Check that subsequent calls continue working.
      assertCallCounts(groups, 'cmd1', {'groupFoo:cmd1': 1});
      isActive(false);
      assertCallCounts(groups, 'cmd1', {});
    });

    function getFuncForShortcut(shortcut) {
      function argsIncludeShortcut(args) {
        return Array.isArray(args[0]) ? _.contains(args[0], shortcut) : (args[0] === shortcut);
      }
      var b = _.findLastIndex(Mousetrap.bind.args, argsIncludeShortcut);
      var u = _.findLastIndex(Mousetrap.unbind.args, argsIncludeShortcut);
      if (b < 0) {
        return null;
      } else if (u < 0) {
        return Mousetrap.bind.args[b][1];
      } else if (Mousetrap.bind.getCall(b).calledBefore(Mousetrap.unbind.getCall(u))) {
        return null;
      } else {
        return Mousetrap.bind.args[b][1];
      }
    }

    it("should allow same keys used for different commands", function() {
      // Both cmd1 and cmd3 use "Ctrl+a" shortcut, so cmd3 should win when group3 is active.
      Mousetrap.bind.reset();
      Mousetrap.unbind.reset();
      var groups = {
        group1: { cmd1: sinon.spy() },
        group3: { cmd3: sinon.spy() },
      };
      var cmdGroup1 = commands.createGroup(groups.group1, null, true);
      var cmdGroup3 = commands.createGroup(groups.group3, null, true);
      assertCallCounts(groups, getFuncForShortcut('ctrl+a'), {'group3:cmd3': 1});
      assertCallCounts(groups, getFuncForShortcut('ctrl+b'), {'group1:cmd1': 1});
      cmdGroup3.activate(false);
      assertCallCounts(groups, getFuncForShortcut('ctrl+a'), {'group1:cmd1': 1});
      assertCallCounts(groups, getFuncForShortcut('ctrl+b'), {'group1:cmd1': 1});
      cmdGroup1.activate(false);
      assertCallCounts(groups, getFuncForShortcut('ctrl+a'), {});
      assertCallCounts(groups, getFuncForShortcut('ctrl+b'), {});
      cmdGroup3.activate(true);
      assertCallCounts(groups, getFuncForShortcut('ctrl+a'), {'group3:cmd3': 1});
      assertCallCounts(groups, getFuncForShortcut('ctrl+b'), {});
    });
  });
});
