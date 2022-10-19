import {t} from 'app/client/lib/localization';
import {assert} from 'chai';
import i18next, {i18n} from 'i18next';
import {dom, observable} from "grainjs";
import {popGlobals, pushGlobals, G} from 'grainjs/dist/cjs/lib/browserGlobals';
import {JSDOM} from 'jsdom';

describe('localization', function() {
  beforeEach(function() {
    // These grainjs browserGlobals are needed for using dom() in tests.
    const jsdomDoc = new JSDOM("<!doctype html><html><body></body></html>");
    pushGlobals(jsdomDoc.window);
  });

  afterEach(function() {
    popGlobals();
  });

  let instance: i18n;
  before(() => {
    instance = i18next.createInstance();
    instance.init({
      lng: 'en',
      resources: {
        en: {
          translation: {
            'Text': 'TranslatedText',
            'Argument': 'Translated {{arg1}} {{arg2}}.',
            'Argument_variant': 'Variant {{arg1}} {{arg2}}.',
          }
        }
      }
    });
  });

  it('supports basic operation for strings', function() {
    assert.equal(t('Argument', {arg1: '1', arg2: '2'}, instance), 'Translated 1 2.');
    assert.equal(t('Argument', {arg1: '1', arg2: '2', context: 'variant'}, instance), 'Variant 1 2.');
    assert.equal(t('Text', null, instance), 'TranslatedText');
  });

  it('supports dom content interpolation', function() {
    const obs = observable("Second");
    const result = t('Argument', {
      arg1: dom('span', 'First'),
      arg2: dom.domComputed(obs, (value) => dom('span', value))
    }, instance) as any;
    assert.isTrue(Array.isArray(result));
    assert.equal(result.length, 5);
    // First we have a plain string.
    assert.equal(result[0], 'Translated ');
    // Next we have a span element.
    assert.equal(result[1]?.tagName, 'SPAN');
    assert.equal(result[1]?.textContent, 'First');
    // Empty space
    assert.equal(result[2], ' ');
    // Element 3 is the domComputed [Comment, Comment, function()]
    assert.isTrue(Array.isArray(result[3]));
    assert.isTrue(result[3][0] instanceof G.Node);
    assert.isTrue(result[3][1] instanceof G.Node);
    assert.isTrue(typeof result[3][2] === 'function');
    // As last we have "."
    assert.equal(result[4], '.');

    // Make sure that computed works.
    const span = dom('span', result);
    assert.equal(span.textContent, "Translated First Second.");
    obs.set("Third");
    assert.equal(span.textContent, "Translated First Third.");

    // Test that context variable works.
    const variantSpan = dom('span', t('Argument', {
      arg1: dom('span', 'First'),
      arg2: dom.domComputed(obs, (value) => dom('span', value)),
      context: 'variant'
    }, instance));
    assert.equal(variantSpan.textContent, "Variant First Third.");
    obs.set("Fourth");
    assert.equal(variantSpan.textContent, "Variant First Fourth.");
  });
});
