var _ = require('underscore');
var dom = require('../lib/dom');
var dispose = require('../lib/dispose');
var kd = require('../lib/koDom');
var TextBox = require('./TextBox');
const G = require('../lib/browserGlobals').get('URL');

const {colors, testId} = require('app/client/ui2018/cssVars');
const {icon}   = require('app/client/ui2018/icons');
const {styled} = require('grainjs');

/**
 * Creates a widget for displaying links.  Links can entered directly or following a title.
 * The last entry following a space is used as the url.
 * ie 'google https://www.google.com' would apears as 'google' to the user but link to the url.
 */
function HyperLinkTextBox(field) {
  TextBox.call(this, field);
}
dispose.makeDisposable(HyperLinkTextBox);
_.extend(HyperLinkTextBox.prototype, TextBox.prototype);

HyperLinkTextBox.prototype.buildDom = function(row) {
  var value = row[this.field.colId()];
  return cssFieldClip(
    kd.style('text-align', this.alignment),
    kd.toggleClass('text_wrapping', this.wrapping),
    kd.maybe(value, () =>
      dom('a',
        kd.attr('href', () => _constructUrl(value())),
        kd.attr('target', '_blank'),
        // As per Google and Mozilla recommendations to prevent opened links
        // from running on the same process as Grist:
        // https://developers.google.com/web/tools/lighthouse/audits/noopener
        kd.attr('rel', 'noopener noreferrer'),
        cssLinkIcon('FieldLink'),
        testId('tb-link')
      )
    ),
    kd.text(() => _formatValue(value()))
  );
};

/**
 * Formats value like `foo bar baz` by discarding `baz` and returning `foo bar`.
 */
function _formatValue(value) {
  // value might be null, at least transiently. Handle it to avoid an exception.
  if (typeof value !== 'string') { return value; }
  const index = value.lastIndexOf(' ');
  return index >= 0 ? value.slice(0, index) : value;
}

/**
 * Given value like `foo bar baz`, constructs URL by checking if `baz` is a valid URL and,
 * if not, prepending `http://`.
 */
function _constructUrl(value) {
  const url = value.slice(value.lastIndexOf(' ') + 1);
  try {
    // Try to construct a valid URL
    return (new G.URL(url)).toString();
  } catch (e) {
    // Not a valid URL, so try to prefix it with http
    return 'http://' + url;
  }
}

const cssFieldClip = styled('div.field_clip', `
  color: ${colors.lightGreen};
`);

const cssLinkIcon = styled(icon, `
  background-color: ${colors.lightGreen};
  margin: -1px 2px 2px 0;
`);

module.exports = HyperLinkTextBox;
