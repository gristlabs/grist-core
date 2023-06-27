import { assert, driver } from 'mocha-webdriver';
import { $, gu, server, test } from 'test/nbrowser/gristUtil-nbrowser';

/**
 * Not much of the fancy list support of webdriverjq has been supported.
 * Luckily not many of the tests needed it, and the parts that did have
 * been rewritten. So most of this test is turned off, and is kept just
 * for reference purposes.
 */

describe("webdriverjq.ntest", function() {
  test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await driver.get(server.getHost() + '/v/gtag/testWebdriverJQuery.html');
  });

  it("should support basic jquery syntax", async function() {
    // toString should work properly.
    assert.equal("" + $("input[type='button']"), "$('input[type=\\'button\\']')");

    assert.equal(await $(".foo").trimmedText(), "Hello world");
    assert.equal((await $(".bar").array()).length, 2);
    assert.lengthOf(await $(".bar").toArray(), 2);
    assert(await $(".foo").hasClass("bar"));
    assert.equal(await $(".foo.bar .baz").parent().getAttribute('className'), "foo bar");
    // Can't quite match old property-over-list behavior.
    // assert.equal(await $(".foo.bar").find(".baz").parent().prop('className'), "foo bar");
    // Parent behavior is not the same as it was.
    // assert.equal(await $(".baz").parent().length, 2);
    assert.equal(await $(".baz input").val(), "Go");
    // There are two bazs, in new style need to specify which.
    assert.equal(await $(".baz").eq(1).find('input[type="button"]').val(), "Go");
    await $("input[type='button']").click();
    assert.equal(await $(".baz input").val(), "Goo");
    await $(".baz input").val("Go").resolve();  // Revert the value to avoid affecting other test cases.
    // toggleClass not supported anymore.
    // assert.notInclude(await $(".foo").toggleClass("bar").classList(), "bar");
    // assert.include(await $(".foo").toggleClass("bar").classList(), "bar");
  });

  it("should support .array()", async function() {
    assert.deepEqual(await $(".bar").getAttribute('className'), 'foo bar');
    assert.deepEqual(await $(".bar").array().getAttribute('className'), ['foo bar', 'bar']);
    assert.deepEqual(await $(".bar").array().trimmedText(), ["Hello world", "Good bye"]);
    assert.deepEqual(await $(".bar").eq(0).trimmedText(), "Hello world");
    assert.deepEqual(await $(".bar").eq(1).trimmedText(), "Good bye");
  });

  it("should support WebElement methods and chaining", async function() {
    assert.equal(await $(".baz").getText(), "Hello world");
    assert.equal(await $(".baz").getAttribute("class"), "baz");
    await $(".baz").click();

    // Cannot chain with clicks anymore
    // assert.equal($(".baz").click().getText(), "Hello world");
    // assert.equal($(".baz").click().trimmedText(), "Hello world");
    // assert.equal($(".baz").click().parent().prop("className"), "foo bar");
    // assert.equal($(".baz").click().parent().isDisplayed(), true);

    // Errors are different.
    // assert.equal(await $(".nonexistent1").text(), "");
    await assert.isRejected($(".nonexistent2").getText(), /no such element/);
    await assert.isRejected($(".nonexistent3").click(), /no such element/);
    await assert.isRejected($(".nonexistent4").isDisplayed(), /no such element/);
    await assert.isRejected($(".nonexistent5").click().parent().isDisplayed(), /no such element/);

    await assert.isRejected($(".foo").click().find(".bar").elem(), /no such element/);

    // cannot chain click anymore
    // assert($(".foo").click().find(".baz").elem());
    // assert.lengthOf($(".foo").click().find(".baz"), 1);
    // assert.lengthOf($(".foo").click().find(".bar"), 0);
    assert.lengthOf(await $(".bar").array(), 2);
    await $(".bar").array().resolve().then(function(elems) { assert.lengthOf(elems, 2); });
  });

  function expectFailure(promise, regexp) {
    throw new Error('not ported');
    /*
    var stack = stacktrace.captureStackTrace("", expectFailure);
    return stacktrace.resolveWithStack(stack, promise.then(function(value) {
      throw new Error("Expected failure but got " + value);
    }, function(err) {
      assert.match(err.message, regexp);
      // Also make sure that our filename is present in the stack trace.
      assert.match(err.stack, /webdriverjq.test.js:\d+/);
    }));
    */
  }

  // Custom asserts work, but error messages are different and not
  // very interesting to maintain.
  it.skip("should work with our custom asserts", async function() {
    await assert.hasClass($(".foo"), "bar");
    await expectFailure(assert.hasClass($(".foo"), "bar", false), /hasClass/);

    await assert.hasClass($(".foo"), "xbar", false);
    await expectFailure(assert.hasClass($(".foo"), "xbar"), /hasClass/);

    assert.isEnabled($("#btn"));
    expectFailure(assert.isEnabled($("#btn"), false), /isEnabled/);

    assert.isEnabled($("#btn").prop("disabled", true), false);
    expectFailure(assert.isEnabled($("#btn"), true), /isEnabled/);

    assert.isEnabled($("#btn").prop("disabled", false), true);

    assert.isPresent($("#btn"));
    expectFailure(assert.isPresent($("#btnx")), /isPresent/);

    assert.isPresent($("#btnx"), false);
    expectFailure(assert.isPresent($("#btn"), false), /isPresent/);

    assert.isDisplayed($("#btn"));
    expectFailure(assert.isDisplayed($("#btn"), false), /isDisplayed/);

    assert.isDisplayed($(".baz").css('display', 'none').find("#btn"), false);
    expectFailure(assert.isDisplayed($("#btn")), /isDisplayed/);
    expectFailure(assert.ok($("#btn").click()), /not interactable/);

    assert.isDisplayed($(".baz").css('display', '').find("#btn"), true);
    expectFailure(assert.isDisplayed($("#btn"), false), /isDisplayed/);
  });

  it.skip("should report good errors", async function() {
    await $(".baz").css('display', 'none').resolve();
    expectFailure(assert.ok($("#btn").click()), /not interactable/);
    await $(".baz").css('display', '').resolve();
    assert.ok($("#btn").click());
    assert.equal($("#btn").val(), "Goo");
    await $("#btn").val("Go").resolve();  // Revert the value to avoid affecting other test cases.

    expectFailure($(".nonexistent1").click(), /nonexistent1.* matched no element/);
    expectFailure(assert.ok($(".nonexistent2").click()), /matched no element/);
    expectFailure($(".nonexistent3").getText(), /matched no element/);
    expectFailure(assert.ok($(".nonexistent5").elem()), /matched no element/);
  });

  // addClass not supported anymore.
  it.skip("should wait for various conditions", async function() {
    assert.equal(await $(".foo").wait().trimmedText(), "Hello world");

    // Test waits for functions of an existing element.
    await driver.executeScript(function() {
      setTimeout(function() { $(".foo .baz").addClass("later1"); }, 300);
      setTimeout(function() { $(".foo .baz").addClass("later2"); }, 700);
    });
    assert.deepEqual(await $(".foo .baz").classList(), ["baz"]);
    await assert.hasClass($(".foo .baz"), "later2", false);
    assert.deepEqual(await $(".foo .baz").wait(assert.hasClass, "later1").classList(),
      ["baz", "later1"]);
    assert.deepEqual(await $(".foo .baz").wait("hasClass", "later2").classList(),
      ["baz", "later1", "later2"]);
    assert.throws($(".foo .baz").wait(0.05, "hasClass", "never").classList(),
      /Wait timed out/);

    // Test waits for the presence of an element.
    $.driver.executeScript(async function() {
      await $(".foo .baz").removeClass("later1 later2");
      setTimeout(function() { $(".foo .baz").addClass("later1"); }, 200);
      setTimeout(function() { $(".foo .baz").addClass("later2"); }, 500);
      setTimeout(function() { $(".foo .baz").removeClass("later1 later2"); }, 1000);
    });
    assert.lengthOf($(".later1, .later2"), 0);
    assert.throws($(".later1").wait(0.05, "isPresent").classList(), /Wait timed out/);
    assert.deepEqual($(".later1").wait().classList(), ["baz", "later1"]);
    assert.deepEqual($(".later2").wait(1, assert.isPresent).classList(),
      ["baz", "later1", "later2"]);

    // The element is already present, so this should be true.
    assert.equal($(".later1").wait(0.01, assert.isPresent, true).isPresent(), true);
    // The following is equivalent to WebDrivers's until.stalenessOf.
    assert.equal($(".later1").wait(1, assert.isPresent, false).isPresent(), false);

    // Absent argument, or null, are OK, and mean "isPresent", but 'undefined' as an argument is a
    // liability, since it would be silent and wrong on misspellings. So we catch it.
    assert.equal($(".foo").wait(null).isPresent(), true);
    assert.throws($(".foo").wait(assert.misspelled).isPresent(),
      /called with undefined condition/);

    // We should be able to chain beyond .wait() with actions and more.
    $.driver.executeScript(function() {
      setTimeout(function() { $("#btn").addClass("later1"); }, 200);
      setTimeout(function() { $("#btn").removeClass("later1"); }, 800);
    });
    await $("#btn.later1").wait().click();
    assert.equal($("#btn").val(), "Goo");
    await $("#btn").wait(assert.hasClass, "later1", false).click();
    assert.equal($("#btn").val(), "Gooo");
    await $("#btn").val("Go").resolve();  // Revert the value to avoid affecting other test cases.
  });

  // behavior around lists changed.
  it.skip("should support complicated promises", async function() {
    var elemA = $(".foo .baz").resolve().then(function(elem) {
      return $(elem).parent();
    }).then(function(elem) {
      assert.deepEqual($(elem).classList(), ["foo", "bar"]);
      return elem;
    });

    assert.deepEqual($(elemA).classList(), ["foo", "bar"]);
    assert.isDisplayed($(elemA));
    assert.isDisplayed($(elemA).find(".baz"));
    assert.throws($(elemA).find(".nonexistent").click(), /<div\.foo\.bar.*matched no element/);

    assert.deepEqual($(
      await $(".foo .baz").resolve().then(function(elem) {
        return $(elem).parent();
      })
    ).classList(), ["foo", "bar"]);
  });
});
