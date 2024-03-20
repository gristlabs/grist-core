import {ACIndex, ACIndexImpl, ACItem, ACResults, highlightNone} from 'app/client/lib/ACIndex';
import {nativeCompare} from 'app/common/gutil';
import {assert} from 'chai';
import * as fse from 'fs-extra';
import * as path from 'path';
import {fixturesRoot} from 'test/server/testUtils';

/**
 * Set env ENABLE_TIMING_TESTS=1 to run the timing "tests". These don't assert anything but let
 * you compare the performance of different implementations.
 */
const ENABLE_TIMING_TESTS = Boolean(process.env.ENABLE_TIMING_TESTS);


interface TestACItem extends ACItem {
  text: string;
}

function makeItem(text: string): TestACItem {
  return {text, cleanText: text.trim().toLowerCase()};
}

const colors: TestACItem[] = [
  "Blue", "Dark Red", "Reddish", "Red", "Orange", "Yellow", "Radical Deep Green", "Bright Red"
].map(makeItem);

const rounds: TestACItem[] = [
  "Round 1", "Round 2", "Round 3", "Round 4"
].map(makeItem);

const messy: TestACItem[] = [
  "", " \t", "  RED  ", "123", "-5.6", "red", "read ", "Bread", "#red", "\nred\n#red\nred", "\n\n", "REDIS/1"
].map(makeItem);


describe('ACIndex', function() {
  it('should find items with matching words', function() {
    const items: ACItem[] = ["blue", "dark red", "reddish", "red", "orange", "yellow", "radical green"].map(
      c => ({cleanText: c}));
    const acIndex = new ACIndexImpl(items, {maxResults: 5});
    assert.deepEqual(acIndex.search("red").items.map((item) => item.cleanText),
      ["red", "reddish", "dark red", "radical green", "blue"]);
  });


  it('should return first few items when search text is empty', function() {
    let acResult = new ACIndexImpl(colors).search("");
    assert.deepEqual(acResult.items, colors);
    assert.deepEqual(acResult.selectIndex, -1);

    acResult = new ACIndexImpl(colors, {maxResults: 3}).search("");
    assert.deepEqual(acResult.items, colors.slice(0, 3));
    assert.deepEqual(acResult.selectIndex, -1);

    acResult = new ACIndexImpl(rounds).search("");
    assert.deepEqual(acResult.items, rounds);
    assert.deepEqual(acResult.selectIndex, -1);
  });

  it('should ignore items with empty text', function() {
    const acIndex = new ACIndexImpl(messy);
    let acResult = acIndex.search("");

    assert.deepEqual(acResult.items, messy.filter(t => t.cleanText));
    assert.lengthOf(acResult.items, 9);
    assert.deepEqual(acResult.selectIndex, -1);

    acResult = acIndex.search("bread");
    assert.deepEqual(acResult.items.map(i => i.text),
      ["Bread", "  RED  ", "123", "-5.6", "red", "read ", "#red", "\nred\n#red\nred", "REDIS/1"]);
    assert.deepEqual(acResult.selectIndex, 0);
  });

  it('should find items with the most matching words, and order by best match', function() {
    const acIndex = new ACIndexImpl(colors);
    let acResult: ACResults<TestACItem>;

    // Try a few cases with a single word.
    acResult = acIndex.search("red");
    assert.deepEqual(acResult.items.map(i => i.text),
      ["Red", "Reddish", "Dark Red", "Bright Red", "Radical Deep Green", "Blue", "Orange", "Yellow"]);
    assert.deepEqual(acResult.selectIndex, 0);

    acResult = acIndex.search("rex");
    // In this case "Reddish" is as good as "Red", so comes first according to original order.
    assert.deepEqual(acResult.items.map(i => i.text),
      ["Reddish", "Red", "Dark Red", "Bright Red", "Radical Deep Green", "Blue", "Orange", "Yellow"]);
    assert.deepEqual(acResult.selectIndex, -1);   // No great match.

    acResult = acIndex.search("REDD");
    // In this case "Reddish" is strictly better than "Red".
    assert.deepEqual(acResult.items.map(i => i.text),
      ["Reddish", "Red", "Dark Red", "Bright Red", "Radical Deep Green", "Blue", "Orange", "Yellow"]);
    assert.deepEqual(acResult.selectIndex, 0);    // It's a good match.

    // Try a few cases with multiple words.
    acResult = acIndex.search("dark red");
    assert.deepEqual(acResult.items.map(i => i.text),
      ["Dark Red", "Red", "Bright Red", "Reddish", "Radical Deep Green", "Blue", "Orange", "Yellow"]);
    assert.deepEqual(acResult.selectIndex, 0);

    acResult = acIndex.search("da re");
    assert.deepEqual(acResult.items.map(i => i.text),
      ["Dark Red", "Radical Deep Green", "Reddish", "Red", "Bright Red", "Blue", "Orange", "Yellow"]);
    assert.deepEqual(acResult.selectIndex, 0);

    acResult = acIndex.search("red d");
    assert.deepEqual(acResult.items.map(i => i.text),
      ["Dark Red", "Red", "Bright Red", "Reddish", "Radical Deep Green", "Blue", "Orange", "Yellow"]);
    assert.deepEqual(acResult.selectIndex, -1);

    acResult = acIndex.search("EXTRA DARK RED WORDS DON'T HURT");
    assert.deepEqual(acResult.items.map(i => i.text),
      ["Dark Red", "Red", "Bright Red", "Radical Deep Green", "Reddish", "Blue", "Orange", "Yellow"]);
    assert.deepEqual(acResult.selectIndex, -1);

    // Try a few poor matches.
    acResult = acIndex.search("a");
    assert.deepEqual(acResult.items, colors);
    acResult = acIndex.search("z");
    assert.deepEqual(acResult.items, colors);
    acResult = acIndex.search("RA");
    assert.deepEqual(acResult.items.map(i => i.text),
      ["Radical Deep Green", "Reddish", "Red", "Dark Red",  "Bright Red", "Blue", "Orange", "Yellow"]);
    acResult = acIndex.search("RZ");
    assert.deepEqual(acResult.items.map(i => i.text),
      ["Reddish", "Red", "Radical Deep Green", "Dark Red",  "Bright Red", "Blue", "Orange", "Yellow"]);

  });

  it('should maintain order of equally good matches', function() {
    const acIndex = new ACIndexImpl(rounds);
    let acResult: ACResults<TestACItem>;

    // Try a few cases with a single word.
    acResult = acIndex.search("r");
    assert.deepEqual(acResult.items, rounds);

    acResult = acIndex.search("round 1");
    assert.deepEqual(acResult.items, rounds);

    acResult = acIndex.search("round 3");
    // Round 3 is moved to the front; the rest are unchanged.
    assert.deepEqual(acResult.items.map(i => i.text), ["Round 3", "Round 1", "Round 2", "Round 4"]);
  });

  it('should prefer items with words in a similar order to search text', function() {
    const acIndex = new ACIndexImpl(colors);
    let acResult: ACResults<TestACItem>;

    // "r d" and "d r" prefer choices whose words are in the entered order.
    acResult = acIndex.search("r d");
    assert.deepEqual(acResult.items.slice(0, 2).map(i => i.text), ["Radical Deep Green", "Dark Red"]);

    acResult = acIndex.search("d r");
    assert.deepEqual(acResult.items.slice(0, 2).map(i => i.text), ["Dark Red", "Radical Deep Green"]);

    // But a better match wins.
    acResult = acIndex.search("de r");
    assert.deepEqual(acResult.items.slice(0, 2).map(i => i.text), ["Radical Deep Green", "Dark Red"]);
  });

  it('should limit results to maxResults', function() {
    const acIndex = new ACIndexImpl(colors, {maxResults: 3});
    let acResult: ACResults<TestACItem>;

    acResult = acIndex.search("red");
    assert.deepEqual(acResult.items.map(i => i.text), ["Red", "Reddish", "Dark Red"]);
    assert.deepEqual(acResult.selectIndex, 0);

    acResult = acIndex.search("red d");
    assert.deepEqual(acResult.items.map(i => i.text), ["Dark Red", "Red", "Bright Red"]);
    assert.deepEqual(acResult.selectIndex, -1);

    acResult = acIndex.search("g");
    assert.deepEqual(acResult.items.map(i => i.text), ["Radical Deep Green", "Blue", "Dark Red"]);
    assert.deepEqual(acResult.selectIndex, 0);
  });

  it('should split words on punctuation', function() {
    // Same as `colors` but with extra punctuation
    const punctColors: TestACItem[] = [
      "$Blue$", "--Dark@#$%^&Red--", "(Reddish)", "]Red{", "**Orange", "-Yellow?!",
      "_Radical ``Deep'' !!Green!!", "<Bright>=\"Red\""
    ].map(makeItem);

    const acIndex = new ACIndexImpl(punctColors);
    let acResult: ACResults<TestACItem>;

    // Try a few cases with a single word.
    acResult = acIndex.search("~red-");
    assert.deepEqual(acResult.items.map(i => i.text), [
      "]Red{", "--Dark@#$%^&Red--", "<Bright>=\"Red\"", "(Reddish)", "_Radical ``Deep'' !!Green!!",
      "$Blue$", "**Orange", "-Yellow?!"]);
    assert.deepEqual(acResult.selectIndex, 0);

    acResult = acIndex.search("rex");
    // In this case "Reddish" is as good as "Red", so comes first according to original order.
    assert.deepEqual(acResult.items.map(i => i.text), [
      "(Reddish)", "]Red{", "--Dark@#$%^&Red--", "<Bright>=\"Red\"", "_Radical ``Deep'' !!Green!!",
      "$Blue$", "**Orange", "-Yellow?!"]);
    assert.deepEqual(acResult.selectIndex, -1);   // No great match.

    acResult = acIndex.search("da-re");
    assert.deepEqual(acResult.items.map(i => i.text), [
      "--Dark@#$%^&Red--", "_Radical ``Deep'' !!Green!!", "(Reddish)", "]Red{", "<Bright>=\"Red\"",
      "$Blue$", "**Orange", "-Yellow?!",
    ]);
    assert.deepEqual(acResult.selectIndex, 0);

    // Try a few poor matches.
    acResult = acIndex.search("a");
    assert.deepEqual(acResult.items, punctColors);
    acResult = acIndex.search("z");
    assert.deepEqual(acResult.items, punctColors);
  });

  it('should return an item to select when the match is good', function() {
    const acIndex = new ACIndexImpl(rounds);
    let acResult: ACResults<TestACItem>;

    // Try a few cases with a single word.
    acResult = acIndex.search("r");
    assert.equal(acResult.selectIndex, 0);
    assert.equal(acResult.items[0].text, "Round 1");

    acResult = acIndex.search("round 2");
    assert.equal(acResult.selectIndex, 0);
    assert.equal(acResult.items[0].text, "Round 2");

    acResult = acIndex.search("round X");
    assert.equal(acResult.selectIndex, -1);

    // We only suggest a selection when an item (or one of its words) starts with the search text.
    acResult = acIndex.search("1");
    assert.equal(acResult.selectIndex, 0);

    const acIndex2 = new ACIndexImpl(messy);
    acResult = acIndex2.search("#r");
    assert.equal(acResult.selectIndex, 0);
    assert.equal(acResult.items[0].text, "#red");

    // Whitespace and case don't matter.
    acResult = acIndex2.search("Red");
    assert.equal(acResult.selectIndex, 0);
    assert.equal(acResult.items[0].text, "  RED  ");
  });

  it('should return a useful highlight function', function() {
    const acIndex = new ACIndexImpl(colors, {maxResults: 3});
    let acResult: ACResults<TestACItem>;

    // Here we split the items' (uncleaned) text with the returned highlightFunc. The values at
    // odd-numbered indices should be the matching parts.
    acResult = acIndex.search("red");
    assert.deepEqual(acResult.items.map(i => acResult.highlightFunc(i.text)),
      [["", "Red", ""], ["", "Red", "dish"], ["Dark ", "Red", ""]]);

    // Partial matches are highlighted too.
    acResult = acIndex.search("darn");
    assert.deepEqual(acResult.items.map(i => acResult.highlightFunc(i.text)),
      [["", "Dar", "k Red"], ["Radical ", "D", "eep Green"], ["Blue"]]);

    // Empty search highlights nothing.
    acResult = acIndex.search("");
    assert.deepEqual(acResult.items.map(i => acResult.highlightFunc(i.text)),
      [["Blue"], ["Dark Red"], ["Reddish"]]);

    // Try some messier cases.
    const acIndex2 = new ACIndexImpl(messy, {maxResults: 6});
    acResult = acIndex2.search("#r");
    assert.deepEqual(acResult.items.map(i => acResult.highlightFunc(i.text)),
      [["#", "r", "ed"], ["  ", "R", "ED  "], ["", "r", "ed"], ["", "r", "ead "],
        ["\n", "r", "ed\n#", "r", "ed\n", "r", "ed"], ["", "R", "EDIS/1"]]);

    acResult = acIndex2.search("read");
    assert.deepEqual(acResult.items.map(i => acResult.highlightFunc(i.text)), [
      ["", "read", " "], ["  ", "RE", "D  "], ["", "re", "d"], ["#", "re", "d"],
      ["\n", "re", "d\n#", "re", "d\n", "re", "d"], ["", "RE", "DIS/1"]]);
  });

  it('should highlight multi-byte unicode', function() {
    const acIndex = new ACIndexImpl(['Lorem ipsum 𝌆 dolor sit ameͨ͆t.', "mañana", "Москва"].map(makeItem), {
      maxResults: 3,
    });
    let acResult: ACResults<TestACItem> = acIndex.search("mañ моск am");
    assert.deepEqual(acResult.items.map(i => acResult.highlightFunc(i.text)),
      [["", "Моск", "ва"], ["", "mañ", "ana"], ["Lorem ipsum 𝌆 dolor sit ", "am", "eͨ͆t."]]);

    const original = "ameͨ͆";
    assert.equal(original.length, 5);
    for (let end = 3; end <= original.length; end++) {
      const text = original.slice(0, end);  // i.e. test: ame, ameͨ, ameͨ͆ (hard to see the difference in some editors)
      acResult = acIndex.search(text);
      assert.deepEqual(acResult.items.map(i => acResult.highlightFunc(i.text))[0],
        ["Lorem ipsum 𝌆 dolor sit ", original, "t."]);
    }
  });

  it('should match a brute-force scoring implementation', function() {
    const acIndex1 = new ACIndexImpl(colors);
    const acIndex2 = new BruteForceACIndexImpl(colors);
    for (const text of ["RED", "blue", "a", "Z", "rea", "RZ", "da re", "re da", ""]) {
      assert.deepEqual(acIndex1.search(text).items, acIndex2.search(text).items,
        `different results for "${text}"`);
    }
  });

  // See ENABLE_TIMING_TESTS flag on top of this file.
  if (ENABLE_TIMING_TESTS) {
    // Returns a list of many items, for checking performance.
    async function getCities(): Promise<TestACItem[]> {
      // Pick a file we have with 4k+ rows. First two columns are city,country.
      // To create more items, we'll return "city N, country" combinations for N in [0, 25).
      const filePath = path.resolve(fixturesRoot, 'export-csv/many-rows.csv');
      const data = await fse.readFile(filePath, {encoding: 'utf8'});
      const result: TestACItem[] = [];
      for (const line of data.split("\n")) {
        const [city, country] = line.split(",");
        for (let i = 0; i < 25; i++) {
          result.push(makeItem(`${city} ${i}, ${country}`));
        }
      }
      return result;
    }

    // Repeat `func()` call `count` times, returning [msec per call, last return value].
    function repeat<T>(count: number, func: () => T): [number, T] {
      const start = Date.now();
      let ret: T;
      for (let i = 0; i < count; i++) {
        ret = func();
      }
      const msecTaken = Date.now() - start;
      return [msecTaken / count, ret!];
    }

    describe("timing", function() {
      this.timeout(20000);

      let items: TestACItem[];

      before(async function() {
        items = await getCities();
      });

      // tslint:disable:no-console

      it('main algorithm', function() {
        const [buildTime, acIndex] = repeat(10, () => new ACIndexImpl(items, {maxResults: 100}));
        console.log(`Time to build index (${items.length} items): ${buildTime} ms`);

        const [searchTime, result] = repeat(10, () => acIndex.search("YORK"));
        console.log(`Time to search index (${items.length} items): ${searchTime} ms`);
        assert.equal(result.items[0].text, "York 0, United Kingdom");
        assert.equal(result.items[75].text, "New York 0, United States");
      });

      it('brute-force algorithm', function() {
        const [buildTime, acIndex] = repeat(10, () => new BruteForceACIndexImpl(items, 100));
        console.log(`Time to build index (${items.length} items): ${buildTime} ms`);

        const [searchTime, result] = repeat(10, () => acIndex.search("YORK"));
        console.log(`Time to search index (${items.length} items): ${searchTime} ms`);
        assert.equal(result.items[0].text, "York 0, United Kingdom");
        assert.equal(result.items[75].text, "New York 0, United States");
      });
    });
  }
});


// This is a brute force implementation of the same score-based search. It makes scoring logic
// easier to understand.
class BruteForceACIndexImpl<Item extends ACItem> implements ACIndex<Item> {
  constructor(private _allItems: Item[], private _maxResults: number = 50) {}

  public search(searchText: string): ACResults<Item> {
    const cleanedSearchText = searchText.trim().toLowerCase();
    if (!cleanedSearchText) {
      return {items: this._allItems.slice(0, this._maxResults), highlightFunc: highlightNone, selectIndex: -1};
    }

    const searchWords = cleanedSearchText.split(/\s+/);

    // Each item consists of the item's score, item's index, and the item itself.
    const matches: Array<[number, number, Item]> = [];

    // Get a score for each item based on the amount of overlap with text.
    for (let i = 0; i < this._allItems.length; i++) {
      const item = this._allItems[i];
      const score: number = getScore(item.cleanText, searchWords);
      matches.push([score, i, item]);
    }

    // Sort the matches by score first, and then by item (searchText).
    matches.sort((a, b) => nativeCompare(b[0], a[0]) || nativeCompare(a[1], b[1]));
    const items = matches.slice(0, this._maxResults).map((m) => m[2]);

    return {items, highlightFunc: highlightNone, selectIndex: -1};
  }
}

// Scores text against an array of search words by adding the lengths of common prefixes between
// the search words and words in the text.
function getScore(text: string, searchWords: string[]) {
  const textWords = text.split(/\s+/);
  let score = 0;
  for (let k = 0; k < searchWords.length; k++) {
    const w = searchWords[k];
    // Power term for bonus disambiguates scores that are otherwise identical, to prioritize
    // earlier words appearing in earlier positions.
    const wordScore = Math.max(...textWords.map((sw, i) => getWordScore(sw, w, Math.pow(2, -(i + k)))));
    score += wordScore;
  }
  if (text.startsWith(searchWords.join(' '))) {
    score += 1;
  }
  return score;
}

function getWordScore(searchedWord: string, word: string, bonus: number) {
  if (searchedWord === word) { return word.length + 1 + bonus; }
  while (word) {
    if (searchedWord.startsWith(word)) { return word.length + bonus; }
    word = word.slice(0, -1);
  }
  return 0;
}
