import {makeT, t} from 'app/client/lib/localization';
import {assert} from 'chai';
import i18next, {i18n} from 'i18next';
import {Disposable, dom, DomContents, observable} from "grainjs";
import {G, popGlobals, pushGlobals} from 'grainjs/dist/cjs/lib/browserGlobals';
import {JSDOM} from 'jsdom';

describe('localization', function() {
  let instance: i18n;
  before(async () => {
    instance = i18next.createInstance();
    await instance.init({
      lng: 'en',
      resources: {
        en: {
          translation: {
            'Text': 'TranslatedText',
            'Argument': 'Translated {{arg1}} {{arg2}}{{end}}',
            'Argument_variant': 'Variant {{arg1}} {{arg2}}{{end}}',
            'Parent': {
              'Child': 'Translated child {{arg}}',
              'Not.Valid:Characters': 'Works',
            }
          }
        }
      }
    });
  });

  beforeEach(function() {
    // These grainjs browserGlobals are needed for using dom() in tests.
    const jsdomDoc = new JSDOM("<!doctype html><html><body></body></html>");
    pushGlobals(jsdomDoc.window);
  });

  afterEach(function() {
    popGlobals();
  });

  it('supports basic operation for strings', function() {
    assert.equal(t('Argument', {arg1: '1', arg2: '2', end: '.'}, instance), 'Translated 1 2.');
    assert.equal(t('Argument', {arg1: '1', arg2: '2', end: '.', context: 'variant'}, instance), 'Variant 1 2.');
    assert.equal(t('Text', null, instance), 'TranslatedText');
  });

  it('supports dom content interpolation', function() {
    class Component extends Disposable {
      public buildDom() {
        return dom('span', '.');
      }
    }
    const obs = observable("Second");
    const result = t('Argument', {
      arg1: dom('span', 'First'),
      arg2: dom.domComputed(obs, (value) => dom('span', value)),
      end: dom.create(Component)
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
    // As last we have "." as grainjs component.
    assert.isTrue(Array.isArray(result[4]));
    assert.isTrue(result[4][0] instanceof G.Node);
    assert.isTrue(result[4][1] instanceof G.Node);
    assert.isTrue(typeof result[4][2] === 'function');

    // Make sure that computed works.
    const span = dom('span', result);
    assert.equal(span.textContent, "Translated First Second.");
    obs.set("Third");
    assert.equal(span.textContent, "Translated First Third.");

    // Test that context variable works.
    const variantSpan = dom('span', t('Argument', {
      arg1: dom('span', 'First'),
      arg2: dom.domComputed(obs, (value) => dom('span', value)),
      end: dom.create(Component),
      context: 'variant'
    }, instance));
    assert.equal(variantSpan.textContent, "Variant First Third.");
    obs.set("Fourth");
    assert.equal(variantSpan.textContent, "Variant First Fourth.");
  });

  it('supports scoping through makeT', function() {
    const scoped = makeT('Parent', instance);
    assert.equal(scoped('Child', { arg : 'Arg'}), 'Translated child Arg');
  });

  it('infers result from parameters', function() {
    class Component extends Disposable {
      public buildDom() {
        return dom('span', '.');
      }
    }
    // Here we only test that this "compiles" without errors and types are correct.
    let typeString: string = ''; void typeString;
    typeString = t('Argument', {arg1: 'argument 1', arg2: 'argument 2'}, instance);
    typeString = t('Argument', {arg1: 1, arg2: true}, instance);
    typeString = t('Argument', undefined,  instance);
    const scoped = makeT('Parent', instance);
    typeString = scoped('Child', {arg: 'argument 1'});
    typeString = scoped('Child', {arg: 1});
    typeString = scoped('Child', undefined);

    let domContent: DomContents = null; void domContent;

    domContent = t('Argument', {arg1: 'argument 1', arg2: dom('span')}, instance);
    domContent = t('Argument', {arg1: 1, arg2: dom.domComputed(observable('test'))}, instance);
    domContent = t('Argument', undefined, instance);
    domContent = scoped('Child', {arg: dom.create(Component)});
    domContent = scoped('Child', {arg: dom.maybe(observable(true), () => dom('span'))});
  });

  it('supports : and . characters in scoped function', function() {
    const scoped = makeT('Parent', instance);
    assert.equal(scoped('Not.Valid:Characters'), 'Works');
  });

  it('makeT helper fallbacks to an argument', function() {
    const scoped = makeT('Parent', instance);
    assert.equal(scoped("I'm not there"), "I'm not there");
  });
});
