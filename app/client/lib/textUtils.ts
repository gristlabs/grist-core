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
