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


// Match http or https then domain name or capture markdown link text and URL separately 
const urlRegex = /(?:\[(.*?)\]\()?https?:\/\/[A-Za-z\d][A-Za-z\d-.]*\.[A-Za-z]{2,}(?::\d+)?(?:\/[^\s\)]*)?(?:\))?/;

/**
 * Detects URLs in a text and returns list of tokens { value, link, isLink }
 */
export function findLinks(text: string):  Array<{value: string, link: string, isLink: boolean}>  {
  if (!text) {
    return [{ value: text, link: text, isLink: false }];
  }

  let tokens = [];
  let lastIndex = 0;
  text.replace(urlRegex, (match: string, markdownText: string, offset: number) => {
    // Add text before the URL
    if (offset > lastIndex) {
      const currentValue = text.substring(lastIndex, offset)
      tokens.push({ value: currentValue, link: currentValue, isLink: false });
    }

    // Extracting the actual URL and link text
    let actualUrl, displayText;
    if (markdownText) {
      const markdownMatch = match.match(/\[(.*?)\]\((.*?)\)/);
      if (markdownMatch && markdownMatch.length === 3) {
        displayText = markdownMatch[1];
        actualUrl = markdownMatch[2];
      }
    } else {
      displayText = actualUrl = match;
    }

    // Add the URL
    tokens.push({
      value: displayText,
      link: actualUrl,
      isLink: true
    });

    lastIndex = offset + match.length;
  });

  // Add any remaining text after the last URL
  if (lastIndex < text.length) {
    const currentValue = text.substring(lastIndex)
    tokens.push({ value: currentValue, link: currentValue, isLink: false });
  }

  return tokens;
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
