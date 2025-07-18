import {ACIndexImpl, ACItem, buildHighlightedDom, HighlightFunc} from 'app/client/lib/ACIndex';
import {Autocomplete} from 'app/client/lib/autocomplete';
import {makeTestId, onClickOutsideElem} from 'app/client/lib/domUtils';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {makeT} from 'app/client/lib/localization';
import {autoGrow} from 'app/client/ui/forms';
import {renderCellMarkdown} from 'app/client/ui/MarkdownCellRenderer';
import {createUserImage} from 'app/client/ui/UserImage';
import {theme} from 'app/client/ui2018/cssVars';
import {cssLink} from 'app/client/ui2018/links';
import {gristFloatingMenuClass, menuCssClass} from 'app/client/ui2018/menus';
import {canView} from 'app/common/roles';
import {orderBy} from 'app/common/SortFunc';
import {tokens} from 'app/common/ThemePrefs';
import {getRealAccess, PermissionData, UserAccessData, UserProfile} from 'app/common/UserAPI';
import {
  Disposable,
  dom,
  IDomArgs,
  MultiHolder,
  Observable,
  styled
} from 'grainjs';

const testId = makeTestId('test-mention-textbox-');
const t = makeT('MentionTextBox');

export class CommentText {
  public static fromHtml(elem: HTMLElement): CommentText {
    const cloned = elem.cloneNode(true) as HTMLElement;
    const mentions: Set<string> = new Set();
    const mentionElements = cloned.querySelectorAll('.grist-mention');

    for (const mention of mentionElements) {
      const userRef = mention.getAttribute('data-userref');
      if (userRef) {
        mentions.add(userRef);
        const name = mention.textContent?.trim() || '';
        // Replace the mention with markdown syntax.
        const markdown = `[${name}](user:${userRef})`;
        mention.replaceWith(markdown);
      }
    }

    const text = (cloned.textContent || '').trim();
    return new CommentText(text, Array.from(mentions));
  }

  public text: string;
  public mentions: string[];

  constructor(text: string = '', mentions: string[] = []) {
    this.text = text;
    this.mentions = mentions;
  }

  public isEmpty(): boolean {
    return !this.text.trim();
  }

  /**
   * Checks if the comment text is long enough to be preserved locally and restored later by the user.
   */
  public shouldBeRestored(): boolean {
    return this.text.length >= 20;
  }
}

export function buildMentionTextBox(
  content: Observable<CommentText>,
  access: PermissionData,
  ...args: IDomArgs<HTMLSpanElement>
) {
  const owner = new MultiHolder();

  const setHtml = (html: HTMLElement) => content.set(CommentText.fromHtml(html));

  function getTextBeforeCaret(node: Node, offset: number) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent?.slice(0, offset) || '';
    }
    return "";
  }

  let mentionPicker: MentionPicker | undefined;

  // Detects when user types '@' and builds a mention span with a picker.
  function buildMentions() {
    return (div: HTMLElement) => {
      dom.onElem(div, 'keydown', (e: KeyboardEvent) => {
        if (e.key === '@' && (!mentionPicker || mentionPicker.isDisposed())) {
          const selection = window.getSelection();
          if (!selection?.rangeCount) { return; }
          const range = selection.getRangeAt(0);
          const caretNode = range.startContainer;
          const caretOffset = range.startOffset;
          const textBeforeCaret = getTextBeforeCaret(caretNode, caretOffset);

          const match = /(?:^|\s)$/.exec(textBeforeCaret);
          if (match) {
            div.contentEditable = 'false';

            // Build the mention element and insert it at the caret position.
            const mentionEl = buildMentionElement();
            range.deleteContents();
            range.insertNode(mentionEl);
            range.setStartAfter(mentionEl);
            selection.removeAllRanges();
            selection.addRange(range);
            e.preventDefault();

            // Show the picker for mentions.
            mentionPicker = new MentionPicker({
              parent: div,
              access,
              mentionEl: mentionEl,
              setHtml,
            });
            dom.autoDisposeElem(mentionEl, mentionPicker);

            mentionEl.focus();

            setHtml(div);
          }
        }
      });
    };
  }


  const element = cssContentEditable(
    dom.autoDispose(owner),
    dom.on('input', (_: Event, el: HTMLElement) => setHtml(el)),
    autoGrow(content),
    dom.attr('contentEditable', 'plaintext-only'),
    buildMentions(),
    renderCellMarkdown(content.get().text || '', {inline: true}),
    // Since markdown is rendered asynchronously, we need to ensure that the mentions render by it, have
    // contentEditable set to false, so that they don't get edited.
    enforceNotEditableChildren,
    (el) => {
      FocusLayer.create(owner, {
        defaultFocusElem: el,
        allowFocus: (e) => (e !== document.body),
        pauseMousetrap: true
      });
    },
    ...args,
  );

  return element;
}

function enforceNotEditableChildren(element: HTMLElement) {
  const fillAttribute = () => {
    const mentions = element.querySelectorAll(`.${MENTION_CLASS}`);
    for (const mention of mentions) {
      if (!mention.getAttribute('contentEditable')) {
        mention.setAttribute('contentEditable', 'false');
      }
    }
  };
  const observer = new MutationObserver(fillAttribute);
  observer.observe(element, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  dom.onDisposeElem(element, () => {
    observer.disconnect();
  });
  fillAttribute();
}


interface MentionPickerProps {
  parent: HTMLElement;
  access: PermissionData;
  mentionEl: HTMLElement;
  setHtml: (html: HTMLElement) => void;
}

const MENTION_CLASS = 'grist-mention';
function buildMentionElement() {
  return cssLink(dom.cls(MENTION_CLASS), '@', dom.attr('contentEditable', 'plaintext-only'));
}

/**
 * Component with autocomplete popup for mentioning users.
 */
class MentionPicker extends Disposable {
  private _acindex: ACIndexImpl<UserItem>;
  private _ac: Autocomplete<UserItem>;
  private _mentionEl: HTMLElement;

  constructor(private _props: MentionPickerProps) {
    super();
    this._mentionEl = _props.mentionEl;
    this._acindex = new ACIndexImpl<UserItem>(
      _props.access.users.sort(orderBy(n => n.name || n.email)).map(x => new UserItem(x, _props.access)),
    );

    // Focus layer.
    FocusLayer.create(this, {defaultFocusElem: this._mentionEl, pauseMousetrap: true});

    // Outside click handler.
    this.autoDispose(onClickOutsideElem(this._mentionEl, () => this._convertToPlainText()));

    // Focus on the mention element, and set the cursor after the '@' character.
    const focusRange = document.createRange();
    this._mentionEl.focus();
    focusRange.setStart(this._mentionEl, 1);
    focusRange.collapse();
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(focusRange);

    // Autocomplete popup.
    this.autoDispose(this._ac = new Autocomplete<UserItem>(this._mentionEl, {
      search: term => this._acindex.search(term),
      renderItem: this._renderItem.bind(this),
      getItemText: item => `@${item.name}`,
      menuCssClass: `${gristFloatingMenuClass} ${menuCssClass}`,
      onClick: this._acceptSelected.bind(this),
      liveUpdate: false,
    }));

    // Keyboard handlers.
    this.autoDispose(dom.onKeyElem(this._mentionEl, 'keydown', {
      // Backspace will remove the mention element if it only contains '@'.
      Backspace$: (ev) => {
        if (this._mentionEl.textContent !== '@') {
          return;
        }
        this._removeMention();
        ev.preventDefault();
        ev.stopPropagation();
      },
      // Escape converts the mention to plain text.
      Escape: () => {
        this._convertToPlainText();
      },
      // Enter without selected item converts to plain text.
      // Enter with selected item accepts the mention.
      Enter: () => {
        if (!this._ac.getSelectedItem()) {
          this._convertToPlainText();
          return;
        }
        this._acceptSelected();
      },
      // Same as tab.
      Tab: () => {
        if (!this._ac.getSelectedItem()) {
          this._convertToPlainText();
          return;
        }
        this._acceptSelected();
      },
    }));
  }

  public dispose() {
    // We expect multiple dispose calls based on various elements (like div, popup, row, view, etc).
    if (this.isDisposed()) { return; }
    super.dispose();
  }

  private get _parent() {
    return this._props.parent;
  }

  private _updateTarget() {
    this._parent.contentEditable = 'plaintext-only';
    this._parent.focus();
    this._props.setHtml(this._parent);
  }

  private _removeMention() {
    this._parent?.removeChild(this._mentionEl);
    this._updateTarget();
    this.dispose();
  }

  private _convertToPlainText() {
    const mentionText = this._mentionEl.textContent || '';
    const textNode = document.createTextNode(mentionText);
    this._parent?.insertBefore(textNode, this._mentionEl.nextSibling);
    this._parent?.removeChild(this._mentionEl);
    this._cursorAfter(textNode);
    this._updateTarget();
    this.dispose();
  }

  private _acceptSelected() {
    const selected = this._ac.getSelectedItem();
    if (!selected) { return; }

    this._mentionEl.textContent = `@${selected.name}`;
    this._mentionEl.contentEditable = 'false';
    this._mentionEl.setAttribute('data-userref', selected.ref);

    const blankText = document.createTextNode(' ');
    this._mentionEl.after(blankText);

    this._cursorAfter(blankText);
    this._updateTarget();
    this.dispose();
  }

  private _renderItem(item: UserItem, highlightFunc: HighlightFunc) {
    return cssAcItem(
      cssMentionAvatar(item.profile, 'small'),
      cssAcItem.cls('-disabled', !item.hasAccess),
      testId('disabled', !item.hasAccess),
      testId('acitem'),
      dom('span',
        buildHighlightedDom(item.name, highlightFunc, cssMatchText),
        testId('acitem-text'),
      ),
      dom.maybe(!item.hasAccess, () => dom('span',
        '(', t('no access'), ')')
      ),
    );
  }

  private _cursorAfter(node: Node) {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse();
    const selection = window.getSelection();
    if (!selection) { return; }
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

class UserItem implements ACItem {
  public readonly cleanText: string;
  public get hasAccess() {
    return canView(getRealAccess(this._user, this._access));
  }
  public get ref() {
    return this._user.ref || '';
  }
  public get profile(): Partial<UserProfile> {
    return this._user;
  }
  public get name() {
    return this._user.name || this._user.email;
  }

  constructor(
    private _user: UserAccessData,
    private _access: PermissionData,
  ) {
    this.cleanText = (_user.name || _user.email).toLowerCase().trim();
  }
}



const cssAcItem = styled('li', `
  padding: 4px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  min-width: 120px;
  padding: var(--weaseljs-menu-item-padding, 8px 24px);
  display: flex;
  gap: 4px;
  align-items: center;
  padding-left: 12px;
  color: ${theme.menuItemFg};
  background-color: ${theme.menuBg};
  &.selected {
    background-color: ${theme.menuItemSelectedBg};
    color:            ${theme.menuItemSelectedFg};
  }
  &-disabled {
    color: ${theme.disabledText};
    background: ${tokens.bgSecondary};
    font-style: italic;
  }
`);

const cssMatchText = styled('span', `
  color: ${theme.autocompleteMatchText};
  .${cssAcItem.className}.selected & {
    color: ${theme.autocompleteSelectedMatchText};
  }
`);

const cssMentionAvatar = styled(createUserImage, `
  margin-top: 0px;
  margin-right: 4px;
`);

const cssContentEditable = styled('div', `
  min-height: 5em;
  border-radius: 3px;
  padding: 4px 6px;
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  border: 1px solid ${theme.inputBorder};
  outline: none;
  width: 100%;
  max-height: 10em;
  overflow: auto;
  white-space: pre-line;
  &-comment, &-reply {
    min-height: 28px;
    height: 28px;
  }
  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
  & a {
    outline: none !important;
  }
  & a[contenteditable="plaintext-only"] {
    text-decoration: none !important;
  }
`);
