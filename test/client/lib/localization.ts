import {domT, t} from 'app/client/lib/localization';
import {assert} from 'chai';
import i18next, {i18n} from 'i18next';
import {dom} from "grainjs";
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
          }
        }
      }
    });
  });

  it('supports basic operation', function() {
    assert.equal(t('Text', null, instance), 'TranslatedText');
    assert.equal(t('Argument', {arg1: '1', arg2: '2'}, instance), 'Translated 1 2.');
  });

  it('supports dom content interpolation', function() {
    const result = domT('Argument', {
      arg1: dom('span', 'First'),
      arg2: dom.domComputed("test", (value) => dom('span', value))
    }, instance) as any;
    assert.isTrue(Array.isArray(result));
    assert.equal(result.length, 5);
    assert.equal(result[0], 'Translated ');
    assert.equal(result[1]?.tagName, 'SPAN');
    assert.equal(result[1]?.textContent, 'First');
    assert.equal(result[2], ' ');
    // Element 3 is the domComputed [Comment, Comment, function()]
    assert.isTrue(Array.isArray(result[3]));
    assert.isTrue(result[3][0] instanceof G.Node);
    assert.equal(result[4], '.');
  });
});
