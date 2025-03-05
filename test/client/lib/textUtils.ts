import {stripLinks} from 'app/client/lib/markdown';
import {hashFnv32a, simpleStringHash} from 'app/client/lib/textUtils';
import {assert} from 'chai';


describe('textUtils', function() {
  it('hashFnv32a should produce correct hashes', function() {
    // Test 32-bit for various strings
    function check(s: string, expected: number) {
      assert.equal(hashFnv32a(s), expected.toString(16).padStart(8, '0'));
    }

    // Based on https://github.com/sindresorhus/fnv1a/blob/053a8cb5a0f99212e71acb73a47823f26081b6e9/test.js
    check((''), 2_166_136_261);
    check(('h'), 3_977_000_791);
    check(('he'), 1_547_363_254);
    check(('hel'), 179_613_742);
    check(('hell'), 477_198_310);
    check(('hello'), 1_335_831_723);
    check(('hello '), 3_801_292_497);
    check(('hello w'), 1_402_552_146);
    check(('hello wo'), 3_611_200_775);
    check(('hello wor'), 1_282_977_583);
    check(('hello worl'), 2_767_971_961);
    check(('hello world'), 3_582_672_807);
    check('Lorem ipsum dolor sit amet, consectetuer adipiscing elit. ' +
      'Aenean commodo ligula eget dolor. Aenean massa. ' +
      'Cum sociis natoque penatibus et magnis dis parturient montes, ' +
      'nascetur ridiculus mus. Donec quam felis, ultricies nec, ' +
      'pellentesque eu, pretium quis, sem. Nulla consequat massa quis enim. ' +
      'Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. ' +
      'In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. ' +
      'Nullam dictum felis eu pede mollis pretium. ' +
      'Lorem ipsum dolor sit amet, consectetuer adipiscing elit. ' +
      'Aenean commodo ligula eget dolor. Aenean massa. ' +
      'Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. ' +
      'Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. ' +
      'Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, ' +
      'vulputate eget, arcu. In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. ' +
      'Nullam dictum felis eu pede mollis pretium. Lorem ipsum dolor sit amet, consectetuer adipiscing elit. ' +
      'Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient ' +
      'montes, nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. ' +
      'Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. ' +
      'In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium.',
      2_964_896_417);
  });

  it('simpleStringHash should produce correct hashes', function() {
    // Not based on anything, just need to know if it changes
    assert.equal(simpleStringHash("hello"), "4f9f2cab3cfabf04ee7da04597168630");
  });

  it('removes links from markdown text', function() {
    // This test checks if the function stripLinks can successfully remove links from markdown text leaving any
    // other text intact.

    // Test data, markdown text and expected result
    const testData: [string, string][] = [
      ['[link](https://example.com)', 'link'],
      // In bold
      ['**[link](https://example.com)**', '**link**'],
      // Itallic
      ['*[link](https://example.com)*', '*link*'],
      // In bold and itallic
      ['***[link](https://example.com)***', '***link***'],
      // Line breaks
      ['[link](https://example.com)\n[link](https://example.com/page?arg=%20&)', 'link\nlink'],
      // Line breaks in brakcets
      ['[first\nsecond](https://example.com)', 'first\nsecond'],
      // Multiple line in brackets
      ['[first\n\nsecond](https://example.com)', 'first\n\nsecond'],
      // Tables with links in headers
      [`
| [link](https://example.com) | [link](https://example.com) |
| --- | --- |
| [link](https://example.com) | [link](https://example.com) |`.trim(),
       `
| link | link |
| --- | --- |
| link | link |`.trim()],
    ];

    testData.forEach(([markdownText, expected]) => assert.equal(
      stripLinks(markdownText),
      expected,
      `failed for ${markdownText}`,
    ));
  });

});
