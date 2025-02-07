import {hoverTooltip} from 'app/client/ui/tooltips';
import {transition} from 'app/client/ui/transitions';
import {toggle} from 'app/client/ui2018/checkbox';
import {mediaSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {dom, DomContents, DomElementArg, IDisposableOwner, Observable, styled} from 'grainjs';

export function HidableToggle(owner: IDisposableOwner, value: Observable<boolean|null>) {
  return toggle(value, dom.hide((use) => use(value) === null));
}

export function AdminSection(owner: IDisposableOwner, title: DomContents, items: DomElementArg[]) {
  return cssSection(
    cssSectionTitle(title),
    ...items,
  );
}

export function AdminSectionItem(owner: IDisposableOwner, options: {
  id: string,
  name?: DomContents,
  description?: DomContents,
  value?: DomContents,
  expandedContent?: DomContents,
  disabled?: false|string,
}) {
  const itemContent = (...prefix: DomContents[]) => [
    cssItemName(
      ...prefix,
      options.name,
      testId(`admin-panel-item-name-${options.id}`),
      prefix.length ? cssItemName.cls('-prefixed') : null,
      cssItemName.cls('-full', options.description === undefined),
    ),
    cssItemDescription(options.description),
    cssItemValue(options.value,
      testId(`admin-panel-item-value-${options.id}`),
      dom.on('click', ev => ev.stopPropagation())),
  ];
  if (options.expandedContent && !options.disabled) {
    const isCollapsed = Observable.create(owner, true);
    return cssItem(
      cssItemShort(
        itemContent(dom.domComputed(isCollapsed, (c) => cssCollapseIcon(c ? 'Expand' : 'Collapse'))),
        cssItemShort.cls('-expandable'),
        dom.on('click', () => isCollapsed.set(!isCollapsed.get())),
      ),
      cssExpandedContentWrap(
        transition(isCollapsed, {
          prepare(elem, close) { elem.style.maxHeight = close ? elem.scrollHeight + 'px' : '0'; },
          run(elem, close) { elem.style.maxHeight = close ? '0' : elem.scrollHeight + 'px'; },
          finish(elem, close) { elem.style.maxHeight = close ? '0' : 'unset'; },
        }),
        cssExpandedContent(
          options.expandedContent,
        ),
      ),
      testId(`admin-panel-item-${options.id}`),
    );
  } else {
    return cssItem(
      cssItemShort(itemContent(),
        cssItemShort.cls('-disabled', Boolean(options.disabled)),
        options.disabled ? hoverTooltip(options.disabled, {
          placement: 'bottom-end',
          modifiers: {offset: {offset: '0, -10'}},
        }) : null,
      ),
      testId(`admin-panel-item-${options.id}`),
    );
  }
}

const cssSection = styled('div', `
  padding: 24px;
  max-width: 600px;
  width: 100%;
  margin: 16px auto;
  border: 1px solid ${theme.widgetBorder};
  border-radius: 4px;
  & > div + div {
    margin-top: 8px;
  }

  @media ${mediaSmall} {
    & {
      width: auto;
      padding: 12px;
      margin: 8px;
    }
  }
`);

const cssSectionTitle = styled('div', `
  height: 32px;
  line-height: 32px;
  margin-bottom: 8px;
  font-size: ${vars.headerControlFontSize};
  font-weight: ${vars.headerControlTextWeight};
`);

const cssItem = styled('div', `
  margin-top: 8px;
  container-type: inline-size;
  container-name: line;
`);

const cssItemShort = styled('div', `
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  padding: 8px;
  margin: 0 -8px;
  border-radius: 4px;
  &-expandable {
    cursor: pointer;
  }
  &-expandable:hover {
    background-color: ${theme.lightHover};
  }
  &-disabled {
    opacity: .5;
  }

  @container line (max-width: 500px) {
    & {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }
  }
`);

const cssItemName = styled('div', `
  width: 150px;
  font-weight: bold;
  display: flex;
  align-items: center;
  margin-right: 14px;
  font-size: ${vars.largeFontSize};
  padding-left: 24px;
  &-prefixed {
    padding-left: 0;
  }
  &-full {
    padding-left: 0;
    width: unset;
  }
  @container line (max-width: 500px) {
    & {
      padding-left: 0;
    }
  }
  @media ${mediaSmall} {
    & {
      width: calc(100% - 28px);
      padding-left: 0;
    }
    &:first-child {
      margin-left: 0;
    }
  }
`);

const cssItemDescription = styled('div', `
  margin-right: auto;
  margin-bottom: -1px; /* aligns with the value */
`);

const cssItemValue = styled('div', `
  flex: none;
  margin: -16px;
  padding: 16px;
  cursor: auto;

  .${cssItemShort.className}-disabled & {
    pointer-events: none;
  }
`);

const cssCollapseIcon = styled(icon, `
  width: 24px;
  height: 24px;
  margin-right: 4px;
  margin-left: -4px;
  --icon-color: ${theme.lightText};
`);

const cssExpandedContentWrap = styled('div', `
  transition: max-height 0.3s ease-in-out;
  overflow: hidden;
  max-height: 0;
`);

const cssExpandedContent = styled('div', `
  margin-left: 24px;
  padding: 18px 0;
  border-bottom: 1px solid ${theme.widgetBorder};
  .${cssItem.className}:last-child & {
    padding-bottom: 0;
    border-bottom: none;
  }
  @container line (max-width: 500px) {
    & {
      margin-left: 0px;
    }
  }
`);

export const cssValueLabel = styled('div', `
  padding: 4px 8px;
  color: ${theme.text};
  border: 1px solid ${theme.inputBorder};
  border-radius: ${vars.controlBorderRadius};
`);
