import {cssRootVars} from 'app/client/ui2018/cssVars';
import {IconList, IconName} from 'app/client/ui2018/IconList';
import {icon} from 'app/client/ui2018/icons';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {dom, styled} from 'grainjs';
import {times} from 'lodash';
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';

const bigBlueIconCss = `
  background-color: blue;
  width: 32px;
  height: 32px;
`;
const bigBlueIcon = styled(icon, bigBlueIconCss);

const searchIconCss = `
  background-color: lightgrey;
  margin: 4px;
`;
const searchIcon = styled('span', searchIconCss);

const searchBox = styled('div', `
  position: relative;
  display: inline-flex;
  align-items: center;
  border: 1px solid lightgrey;
  border-radius: 8px;
`);

const searchInput = styled('input#search', `
  outline: none;
  border: none;
  margin: 4px;
  line-height: 1.4;
`);

const checkbox = styled('input#checkbox', `
  -webkit-appearance: none;
  -moz-appearance: none;
  width: 1rem;
  height: 1rem;
  border: 1px solid blue;
  box-sizing: content-box;

  &:checked::before {
    position: absolute;
    content: var(--icon-Tick);
  }
`);

const allIcons = styled('div', `
  width: 650px;
`);
const iconBlock = styled('div', `
  display: inline-flex;
  align-items: center;
  width: 120px;
  margin: 2px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
`);
const iconBox = styled('div', `
  flex: none;
  border: 1px solid lightgrey;
  padding: 1px;
  margin-right: 4px;
`);
const testPage = styled('div', `
  font-size: 14px;
  font-family: sans-serif;
`);

function setupTest() {
  return testPage(
    dom('h4', 'All icons'),
    dom('div#all_icons',
      allIcons(
        dom.forEach(IconList.sort(), (name: IconName) =>
          iconBlock(iconBox(icon(name)), dom('span', name))
        ),
      )
    ),
    dom('hr'),
    dom('div#search_icon',
      icon('Search'), ` unstyled`
    ),
    dom('div#big_search_icon',
      bigBlueIcon('Search'), ` styled with {${bigBlueIconCss.replace(/\s+/g, ' ')}}`
    ),
    dom('section',
      searchBox(
        icon('Search', dom.cls(searchIcon.className)),
        searchInput({type: 'search'})
      ),
      ` styled with {${searchIconCss.replace(/\s+/g, ' ')}}`
    ),
    dom('hr'),
    dom('div',
      times(100, () => icon('FieldDateTime')),
    ),
    dom('section',
      checkbox({type: 'checkbox', checked: true})
    ),
    dom('hr'),
    thumbPreview(),
    dom('hr'),
    dom('h2', 'Loaders'),
    loadingSpinner()
  );
}

const thumbPreview = styled('div', `
  flex: none;
  height: 48px;
  width: 48px;
  background-image: var(--icon-ThumbPreview);
  background-repeat: no-repeat;
  background-position: center;
  background-color: #262633;
`);

void withLocale(() => {
  // Load icons.css, wait for it to load, then build the page.
  document.head.appendChild(dom('link', {rel: 'stylesheet', href: 'icons.css'},
    dom.on('load', () => {
      dom.update(document.body, dom.cls(cssRootVars), setupTest());
    })
  ));
});
