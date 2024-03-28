/**
 * A search index for auto-complete suggestions.
 *
 * This implementation indexes words, and suggests items based on a best-match score, including
 * amount of overlap and position of words. It searches case-insensitively and only at the start
 * of words. E.g. searching for "Blue" would match "Blu" in "Lavender Blush", but searching for
 * "lush" would only match the "L" in "Lavender".
 */

import {localeCompare, nativeCompare, sortedIndex} from 'app/common/gutil';
import {DomContents} from 'grainjs';
import escapeRegExp = require("lodash/escapeRegExp");
import deburr = require("lodash/deburr");
import split = require("lodash/split");

export interface ACItem {
  // This should be a trimmed lowercase version of the item's text. It may be an accessor.
  cleanText: string;
}

// Returns a trimmed, lowercase version of a string,
// from which accents and other diacritics have been removed,
// so that autocomplete is case- and accent-insensitive.
export function normalizeText(text: string): string {
  return deburr(text).trim().toLowerCase();
}

// Regexp used to split text into words; includes nearly all punctuation. This means that
// "foo-bar" may be searched by "bar", but it's impossible to search for punctuation itself (e.g.
// "a-b" and "a+b" are not distinguished). (It's easy to exclude unicode punctuation too if the
// need arises, see https://stackoverflow.com/a/25575009/328565).
const wordSepRegexp = /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]+/;

/**
 * An auto-complete index, which simply allows searching for a string.
 */
export interface ACIndex<Item extends ACItem> {
  search(searchText: string): ACResults<Item>;
}

// Splits text into an array of pieces, with odd-indexed pieces being the ones to highlight.
export type HighlightFunc = (text: string) => string[];

export const highlightNone: HighlightFunc = (text) => [text];

/**
 * AutoComplete results include the suggested items, which one to highlight, and a function for
 * highlighting the matched portion of each item.
 */
export interface ACResults<Item extends ACItem> {
  // Matching items in order from best match to worst.
  items: Item[];

  // May be used to highlight matches using buildHighlightedDom().
  highlightFunc: HighlightFunc;

  // index of a good match (normally 0), or -1 if no great match
  selectIndex: number;
}

interface Word {
  word: string;     // The indexed word
  index: number;    // Index into _allItems for the item containing this word.
  pos: number;      // Position of the word within the item where it occurred.
}

export interface ACIndexOptions {
  /** The max number of items to suggest. Defaults to 50. */
  maxResults?: number;
  /**
   * Suggested matches in the same relative order as items, rather than by score.
   *
   * Defaults to false.
   */
  keepOrder?: boolean;
  /** Show items with an empty `cleanText`. Defaults to false. */
  showEmptyItems?: boolean;
}

/**
 * Implements a search index. It doesn't currently support updates; when any values change, the
 * index needs to be rebuilt from scratch.
 */
export class ACIndexImpl<Item extends ACItem> implements ACIndex<Item> {
  private _allItems: Item[];

  // All words from _allItems, sorted.
  private _words: Word[];

  private _maxResults = this._options.maxResults ?? 50;
  private _keepOrder = this._options.keepOrder ?? false;
  private _showEmptyItems = this._options.showEmptyItems ?? false;

  // Creates an index for the given list of items.
  constructor(items: Item[], private _options: ACIndexOptions = {}) {
    this._allItems = items.slice(0);

    // Collects [word, occurrence, position] tuples for all words in _allItems.
    const allWords: Word[] = [];
    for (let index = 0; index < this._allItems.length; index++) {
      const item = this._allItems[index];
      const words = item.cleanText.split(wordSepRegexp).filter(w => w);
      for (let pos = 0; pos < words.length; pos++) {
        allWords.push({word: words[pos], index, pos});
      }
    }

    allWords.sort((a, b) => localeCompare(a.word, b.word));
    this._words = allWords;
  }


  // The main search function. SearchText will be cleaned (trimmed and lowercased) at the start.
  // Empty search text returns the first N items in the search universe.
  public search(searchText: string): ACResults<Item> {
    const cleanedSearchText = normalizeText(searchText);
    const searchWords = cleanedSearchText.split(wordSepRegexp).filter(w => w);

    // Maps item index in _allItems to its score.
    const myMatches = new Map<number, number>();

    if (searchWords.length > 0) {
      // For each of searchWords, go through items with an overlap, and update their scores.
      for (let k = 0; k < searchWords.length; k++) {
        const searchWord = searchWords[k];
        for (const [itemIndex, score] of this._findOverlaps(searchWord, k)) {
          myMatches.set(itemIndex, (myMatches.get(itemIndex) || 0) + score);
        }
      }

      // Give an extra point to items that start with the searchText.
      for (const [itemIndex, score] of myMatches) {
        if (this._allItems[itemIndex].cleanText.startsWith(cleanedSearchText)) {
          myMatches.set(itemIndex, score + 1);
        }
      }
    }

    // Array of pairs [itemIndex, score], sorted by score (desc) and itemIndex.
    const sortedMatches = Array.from(myMatches)
      .sort((a, b) => nativeCompare(b[1], a[1]) || nativeCompare(a[0], b[0]))
      .slice(0, this._maxResults);

    const itemIndices: number[] = sortedMatches.map(([index, score]) => index);

    // Append enough non-matching indices to reach maxResults.
    for (let i = 0; i < this._allItems.length && itemIndices.length < this._maxResults; i++) {
      if (myMatches.has(i)) { continue; }

      if (this._allItems[i].cleanText || this._showEmptyItems) {
        itemIndices.push(i);
      }
    }

    if (this._keepOrder) {
      itemIndices.sort(nativeCompare);
    }
    const items = itemIndices.map(index => this._allItems[index]);

    if (!cleanedSearchText) {
      // In this case we are just returning the first few items.
      return {items, highlightFunc: highlightNone, selectIndex: -1};
    }

    const highlightFunc = highlightMatches.bind(null, searchWords);

    // If we have a best match, and any word in it actually starts with the search text, report it
    // as a default selection for highlighting. Otherwise, no item will be auto-selected.
    let selectIndex = sortedMatches.length > 0 ? itemIndices.indexOf(sortedMatches[0][0]) : -1;
    if (selectIndex >= 0 && !startsWithText(items[selectIndex], cleanedSearchText, searchWords)) {
      selectIndex = -1;
    }
    return {items, highlightFunc, selectIndex};
  }

  /**
   * Given one of the search words, looks it up in the indexed list of words and searches up and
   * down the list for all words that share a prefix with it. Each such word contributes something
   * to the score of the index entry it is a part of.
   *
   * Returns a Map from the index entry (index into _allItems) to the score which this searchWord
   * contributes to it.
   *
   * The searchWordPos argument is the position of searchWord in the overall search text (e.g. 0
   * if it's the first word). It is used for the position bonus, to give higher scores to entries
   * whose words occur in the same order as in the search text.
   */
  private _findOverlaps(searchWord: string, searchWordPos: number): Map<number, number> {
    const insertIndex = sortedIndex<{word: string}>(this._words, {word: searchWord},
      (a, b) => localeCompare(a.word, b.word));

    // Maps index of item to its score.
    const scored = new Map<number, number>();

    // Search up and down the list, accepting smaller and smaller overlap.
    for (const step of [1, -1]) {
      let prefix = searchWord;
      let index = insertIndex + (step > 0 ? 0 : -1);
      while (prefix && index >= 0 && index < this._words.length) {
        for ( ; index >= 0 && index < this._words.length; index += step) {
          const wordEntry = this._words[index];
          // Once we reach a word that doesn't start with our prefix, break this loop, so we can
          // reduce the length of the prefix and keep scanning.
          if (!wordEntry.word.startsWith(prefix)) { break; }

          // The contribution of this word's to the score consists primarily of the length of
          // overlap (i.e. length for the current prefix).
          const baseScore = prefix.length;

          // To this we add 1 if the word matches exactly.
          const fullWordBonus = (wordEntry.word === searchWord ? 1 : 0);

          // To prefer matches where words occur in the same order as searched (e.g. searching for
          // "Foo B" should prefer "Foo Bar" over "Bar Foo"), we give a bonus based on the
          // position of the word in the search text and the entry text. (If positions match as
          // 0:0 and 1:1, the total position bonus is 2^0+2^(-2)=1.25; while the bonus from 0:1
          // and 1:0 would be 2^(-1) + 2^(-1)=1.0.)
          const positionBonus = Math.pow(2, -(searchWordPos + wordEntry.pos));

          const itemScore = baseScore + fullWordBonus + positionBonus;
          // Each search word contributes only one score (e.g. a search for "Foo" will partially
          // match both words in "forty five", but only the higher of the matches will count).
          if (itemScore >= (scored.get(wordEntry.index) || 0)) {
            scored.set(wordEntry.index, itemScore);
          }
        }
        prefix = prefix.slice(0, -1);
      }
    }
    return scored;
  }
}


export type BuildHighlightFunc = (match: string) => DomContents;

/**
 * Converts text to DOM with matching bits of text rendered using highlight(match) function.
 */
export function buildHighlightedDom(
  text: string, highlightFunc: HighlightFunc, highlight: BuildHighlightFunc
): DomContents {
  if (!text) { return text; }
  const parts = highlightFunc(text);
  return parts.map((part, k) => k % 2 ? highlight(part) : part);
}


// Same as wordSepRegexp, but with capturing parentheses.
const wordSepRegexpParen = new RegExp(`(${wordSepRegexp.source})`);

/**
 * Splits text into pieces, with odd-numbered pieces the ones matching a prefix of some
 * searchWord, i.e. the ones to highlight.
 */
function highlightMatches(searchWords: string[], text: string): string[] {
  const textParts = text.split(wordSepRegexpParen);
  const outputs = [''];
  for (let i = 0; i < textParts.length; i += 2) {
    const word = textParts[i];
    const separator = textParts[i + 1] || '';
    // deburr (remove diacritics) was used to produce searchWords, so `word` needs to match that.
    const prefixLen = findLongestPrefixLen(deburr(word).toLowerCase(), searchWords);
    if (prefixLen === 0) {
      outputs[outputs.length - 1] += word + separator;
    } else {
      // Split into unicode 'characters' that keep diacritics combined
      const chars = split(word, '');
      outputs.push(
        chars.slice(0, prefixLen).join(''),
        chars.slice(prefixLen).join('') + separator
      );
    }
  }
  return outputs;
}

function findLongestPrefixLen(text: string, choices: string[]): number {
  return choices.reduce((max, choice) => Math.max(max, findCommonPrefixLength(text, choice)), 0);
}

function findCommonPrefixLength(text1: string, text2: string): number {
  let i = 0;
  while (i < text1.length && text1[i] === text2[i]) { ++i; }
  return i;
}

/**
 * Checks whether `item` starts with `text`, or whether all words of text are prefixes of the
 * words of `item`. (E.g. it would return true if item is "New York", and text is "ne yo".)
 */
function startsWithText(item: ACItem, text: string, searchWords: string[]): boolean {
  if (item.cleanText.startsWith(text)) { return true; }

  const regexp = new RegExp(searchWords.map(w => `\\b` + escapeRegExp(w)).join('.*'));
  const cleanText = item.cleanText.split(wordSepRegexp).join(' ');
  return regexp.test(cleanText);
}
