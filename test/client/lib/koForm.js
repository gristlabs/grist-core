var assert = require('chai').assert;
var ko = require('knockout');

var kf = require('app/client/lib/koForm');
var koArray = require('app/client/lib/koArray');
var clientUtil = require('../clientUtil');

var G = require('app/client/lib/browserGlobals').get('$');

describe('koForm', function() {

  clientUtil.setTmpMochaGlobals();

  function triggerInput(input, property, value) {
    input[property] = value;
    G.$(input).trigger('input');
  }

  function triggerChange(input, property, value) {
    input[property] = value;
    G.$(input).trigger('change');
  }

  function triggerClick(elem) {
    G.$(elem).trigger('click');
  }

  describe("button", function() {
    it("should call a function", function() {
      var calls = 0;
      var btn = kf.button(function() { calls++; }, 'Test');
      triggerClick(btn);
      triggerClick(btn);
      triggerClick(btn);
      assert.equal(calls, 3);
    });
  });

  describe("checkButton", function() {
    it("should bind an observable", function() {
      var obs = ko.observable(false);

      // Test observable->widget binding.
      var btn = kf.checkButton(obs, "Test");
      assert(!btn.classList.contains('active'));
      obs(true);
      assert(btn.classList.contains('active'));

      btn = kf.checkButton(obs, "Test2");
      assert(btn.classList.contains('active'));
      obs(false);
      assert(!btn.classList.contains('active'));

      // Test widget->observable binding.
      assert.equal(obs(), false);
      triggerClick(btn);
      assert.equal(obs(), true);
      triggerClick(btn);
      assert.equal(obs(), false);
    });
  });

  describe("buttonSelect", function() {
    it("should bind an observable", function() {
      var obs = ko.observable('b');
      var a, b, c;

      kf.buttonSelect(obs,
        a = kf.optionButton('a', 'Test A'),
        b = kf.optionButton('b', 'Test B'),
        c = kf.optionButton('c', 'Test C')
      );

      // Test observable->widget binding.
      assert(!a.classList.contains('active'));
      assert(b.classList.contains('active'));
      assert(!c.classList.contains('active'));
      obs('a');
      assert(a.classList.contains('active'));
      assert(!b.classList.contains('active'));
      obs('c');
      assert(!a.classList.contains('active'));
      assert(!b.classList.contains('active'));
      assert(c.classList.contains('active'));

      // Test widget->observable binding.
      assert.equal(obs(), 'c');
      triggerClick(b);
      assert.equal(obs(), 'b');
    });
  });

  describe("checkbox", function() {
    it("should bind an observable", function() {
      var obs = ko.observable(false);
      var check = kf.checkbox(obs, "Foo").querySelector('input');

      // Test observable->widget binding.
      assert.equal(check.checked, false);
      obs(true);
      assert.equal(check.checked, true);

      check = kf.checkbox(obs, "Foo").querySelector('input');
      assert.equal(check.checked, true);
      obs(false);
      assert.equal(check.checked, false);

      // Test widget->observable binding.
      triggerChange(check, 'checked', true);
      assert.equal(obs(), true);
      assert.equal(check.checked, true);

      triggerChange(check, 'checked', false);
      assert.equal(obs(), false);
      assert.equal(check.checked, false);
    });
  });

  describe("text", function() {
    it("should bind an observable", function() {
      var obs = ko.observable('hello');
      var input = kf.text(obs).querySelector('input');

      // Test observable->widget binding.
      assert.equal(input.value, 'hello');
      obs('world');
      assert.equal(input.value, 'world');

      // Test widget->observable binding.
      triggerChange(input, 'value', 'foo');
      assert.equal(obs(), 'foo');
    });
  });

  describe("text debounce", function() {
    it("should bind an observable", function() {
      var obs = ko.observable('hello');
      var input = kf.text(obs, {delay: 300}).querySelector('input');

      // Test observable->widget binding.
      assert.equal(input.value, 'hello');
      obs('world');
      assert.equal(input.value, 'world');

      // Test widget->observable binding using interrupted by 'Enter' or loosing focus debounce.
      triggerInput(input, 'value', 'bar');
      assert.equal(input.value, 'bar');
      // Ensure that observable value wasn't changed immediately
      assert.equal(obs(), 'world');
      // Simulate 'change' event (hitting 'Enter' or loosing focus)
      triggerChange(input, 'value', 'bar');
      // Ensure that observable value was changed on 'change' event
      assert.equal(obs(), 'bar');

      // Test widget->observable binding using debounce.
      triggerInput(input, 'value', 'helloworld');
      input.selectionStart = 3;
      input.selectionEnd = 7;
      assert.equal(input.value.substring(input.selectionStart, input.selectionEnd), 'lowo');
      assert.equal(input.value, 'helloworld');

      // Ensure that observable value wasn't changed immediately, needs to wait 300 ms
      assert.equal(obs(), 'bar');

      // Ensure that after delay value were changed
      return clientUtil.waitForChange(obs, 350)
      .then(() => {
        assert.equal(obs(), 'helloworld');
        assert.equal(input.value, 'helloworld');
        // Ensure that selection is the same and cursor didn't jump to the end
        assert.equal(input.value.substring(input.selectionStart, input.selectionEnd), 'lowo');
      });
    });
  });

  describe("numText", function() {
    it("should bind an observable", function() {
      var obs = ko.observable(1234);
      var input = kf.numText(obs).querySelector('input');

      // Test observable->widget binding.
      assert.equal(input.value, '1234');
      obs('-987.654');
      assert.equal(input.value, '-987.654');

      // Test widget->observable binding.
      triggerInput(input, 'value', '-1.2');
      assert.strictEqual(obs(), -1.2);
    });
  });

  describe("select", function() {
    it("should bind an observable", function() {
      var obs = ko.observable("b");
      var input = kf.select(obs, ["a", "b", "c"]).querySelector('select');
      var options = Array.prototype.slice.call(input.querySelectorAll('option'), 0);
      function selected() {
        return options.map(function(option) { return option.selected; });
      }

      // Test observable->widget binding.
      assert.deepEqual(selected(), [false, true, false]);
      obs("a");
      assert.deepEqual(selected(), [true, false, false]);
      obs("c");
      assert.deepEqual(selected(), [false, false, true]);

      // Test widget->observable binding.
      triggerChange(options[0], 'selected', true);
      assert.deepEqual(selected(), [true, false, false]);
      assert.equal(obs(), "a");

      triggerChange(options[1], 'selected', true);
      assert.deepEqual(selected(), [false, true, false]);
      assert.equal(obs(), "b");
    });

    it("should work with option array of objects", function() {
      var obs = ko.observable();
      var foo = ko.observable('foo');
      var bar = ko.observable('bar');
      var values = koArray([
        { label: foo, value: 'a1' },
        { label: bar, value: 'b1' },
      ]);

      var select = kf.select(obs, values);
      var options = Array.from(select.querySelectorAll('option'));
      assert.deepEqual(options.map(el => el.textContent), ['foo', 'bar']);

      triggerChange(options[0], 'selected', true);
      assert.equal(obs(), 'a1');

      foo('foo2');
      bar('bar2');

      options = Array.from(select.querySelectorAll('option'));
      assert.deepEqual(options.map(el => el.textContent), ['foo2', 'bar2']);

      triggerChange(options[1], 'selected', true);
      assert.equal(obs(), 'b1');
    });

    it("should store actual, non-stringified values", function() {
      let obs = ko.observable();
      let values = [
        { label: 'a', value: 1 },
        { label: 'b', value: '2' },
        { label: 'c', value: true },
        { label: 'd', value: { hello: 'world' } },
        { label: 'e', value: new Date() },
      ];
      let options = Array.from(kf.select(obs, values).querySelectorAll('option'));

      for (let i = 0; i < values.length; i++) {
        triggerChange(options[i], 'selected', true);
        assert.strictEqual(obs(), values[i].value);
      }
    });

    it("should allow multi-select and save sorted values", function() {
      let obs = ko.observable();
      let foo = { foo: 'bar' };
      let values = [{ label: 'a', value: foo }, 'd', { label: 'c', value: 1 }, 'b'];
      let options = Array.from(
        kf.select(obs, values, { multiple: true}).querySelectorAll('option'));

      triggerChange(options[0], 'selected', true);
      triggerChange(options[2], 'selected', true);
      triggerChange(options[3], 'selected', true);

      assert.deepEqual(obs(), [1, foo, 'b']);
    });
  });
});
