// There are many regex for matching URL, but non seem to be the correct solution.
// Here we will use very fast and simple one.
// Tested most of the regex solutions mentioned in this post
// https://stackoverflow.com/questions/37684/how-to-replace-plain-urls-with-links.
// The best one was http://alexcorvi.github.io/anchorme.js/, which still wasn't perfect.
// The best non regex solution was https://github.com/Hypercontext/linkifyjs, but it feels a little too heavy.
// Some examples why this is better or worse from other solution:
/**

For 'http://www.uk,http://www.uk'
'OurRegex' [ 'http://www.uk', 'http://www.uk' ]
'Anchrome' [ 'http://www.uk,http://www.uk' ]
'linkify' [ 'http://www.uk,http://www.uk' ]
'url-regex' [ 'http://www.uk', 'http://www.uk' ]

For 'might.it be a link'
'OurRegex' []
'Anchrome' [ 'might.it' ]
'linkify' [ 'http://might.it' ]
'url-regex' []

For 'Is this correct.No it is not'
'OurRegex' []
'Anchrome' [ 'correct.No' ]
'linkify' [ 'http://correct.No' ]
'url-regex' []

For 'Link (in http://www.uk?)'
'OurRegex' [ 'http://www.uk' ]
'Anchrome' [ 'http://www.uk' ]
'linkify' [ 'http://www.uk' ]
'url-regex' [ 'http://www.uk?)' ]
*/

// Match http or https then domain name (with optional port) then any text that ends with letter or number.
export const urlRegex = /(https?:\/\/[A-Za-z\d][A-Za-z\d-.]*(?!\.)(?::\d+)?(?:\/[^\s]*)?[\w\d/])/;

/**
 * Detects URLs in a text and returns list of tokens { value, isLink }
 */
export function findLinks(text: string): Array<{value: string, isLink: boolean}> {
  if (!text) {
    return [{ value: text, isLink: false }];
  }
  // urls will be at odd-number indices
  return text.split(urlRegex).map((value, i) => ({ value, isLink : (i % 2) === 1}));
}

/**
 * Based on https://stackoverflow.com/a/22429679/2482744
 * -----------------------------------------------------
 * Calculate a 32 bit FNV-1a hash
 * Found here: https://gist.github.com/vaiorabbit/5657561
 * Ref.: http://isthe.com/chongo/tech/comp/fnv/
 */
export function hashFnv32a(str: string): string {
  let hval = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hval ^= str.charCodeAt(i);
    hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
  }
  // Convert to 8 digit hex string
  return ("0000000" + (hval >>> 0).toString(16)).substr(-8);
}

/**
 * A poor man's hash for when proper crypto isn't worth it.
 */
export function simpleStringHash(str: string) {
  let result = '';
  // Crudely convert 32 bits to 128 bits to reduce collisions
  for (let i = 0; i < 4; i++) {
    result += hashFnv32a(result + str);
  }
  return result;
}
