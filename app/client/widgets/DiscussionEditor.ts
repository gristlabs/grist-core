import {GristDoc} from 'app/client/components/GristDoc';
import {makeT} from 'app/client/lib/localization';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {createObsArray} from 'app/client/lib/koArrayWrap';
import {localStorageBoolObs} from 'app/client/lib/localStorageObs';
import {CellRec, ColumnRec, ViewSectionRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {RowSource, RowWatcher} from 'app/client/models/rowset';
import {createUserImage} from 'app/client/ui/UserImage';
import {basicButton, primaryButton, textButton} from 'app/client/ui2018/buttons';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuItem} from 'app/client/ui2018/menus';
import {CellInfoType} from 'app/common/gristTypes';
import {FullUser} from 'app/common/UserAPI';
import {
  bundleChanges,
  Computed,
  Disposable,
  dom,
  DomArg,
  DomContents,
  DomElementArg,
  IDomComponent,
  makeTestId,
  MultiHolder,
  ObsArray,
  Observable,
  styled
} from 'grainjs';
import {createPopper, Options as PopperOptions} from '@popperjs/core';
import * as ko from 'knockout';
import moment from 'moment';
import maxSize from 'popper-max-size-modifier';
import flatMap = require('lodash/flatMap');
import {autoGrow} from 'app/client/ui/forms';
import {autoFocus} from 'app/client/lib/domUtils';

const testId = makeTestId('test-discussion-');
const t = makeT('DiscussionEditor');
const COMMENTS_LIMIT = 200;

interface DiscussionPopupProps {
  domEl: Element,
  topic: ICellView,
  discussionId?: number,
  gristDoc: GristDoc,
  closeClicked: () => void;
}

interface ICellView {
  comments: Observable<CellRec[]>,
  comment(text: string): Promise<void>;
  reply(discussion: CellRec, text: string): Promise<void>;
  resolve(discussion: CellRec): Promise<void>;
  update(comment: CellRec, text: string): Promise<void>;
  open(discussion: CellRec): Promise<void>;
  remove(comment: CellRec): Promise<void>;
}

export class CellWithComments extends Disposable implements ICellView {
  public comments: Observable<CellRec[]>;

  constructor(protected gristDoc: GristDoc) {
    super();
  }

  public async comment(text: string): Promise<void> {
    // To override
  }

  public async reply(comment: CellRec, text: string): Promise<void> {
    const author = commentAuthor(this.gristDoc);
    await this.gristDoc.docData.bundleActions(t("Reply to a comment"), () => Promise.all([
      this.gristDoc.docModel.cells.sendTableAction([
        "AddRecord",
        null,
        {
          parentId: comment.id.peek(),
          root: false,
          type: CellInfoType.COMMENT,
          userRef: author?.ref ?? '',
          content: JSON.stringify({
            userName: author?.name ?? '',
            timeCreated: Date.now(),
            timeUpdated: null,
            text
          }),
          tableRef: comment.tableRef.peek(),
          colRef: comment.colRef.peek(),
          rowId: comment.rowId.peek(),
        }
      ])
    ]));
  }
  public resolve(comment: CellRec): Promise<void> {
    const author = commentAuthor(this.gristDoc);
    comment.resolved(true);
    comment.resolvedBy(author?.email ?? '');
    return comment.timeUpdated.setAndSave((Date.now()));
  }

  public async update(comment: CellRec, text: string): Promise<void> {
    const timeUpdated = Date.now();
    comment.text(text.trim());
    return comment.timeUpdated.setAndSave(timeUpdated);
  }
  public async open(comment: CellRec): Promise<void> {
    comment.resolved(false);
    comment.resolvedBy('');
    return comment.timeUpdated.setAndSave((Date.now()));
  }

  public async remove(comment: CellRec): Promise<void> {
    await comment._table.sendTableAction(["RemoveRecord", comment.id.peek()]);
  }
}

export class EmptyCell extends CellWithComments implements ICellView {
  constructor(public props: {
    gristDoc: GristDoc,
    column: ColumnRec,
    rowId: number,
    tableRef: number,
  }) {
    super(props.gristDoc);
    const {column, rowId} = props;
    this.comments = Computed.create(this, use => {
      const fromColumn = use(use(column.cells).getObservable());
      const forRow = fromColumn.filter(d => use(d.rowId) === rowId && use(d.root) && !use(d.hidden));
      return forRow;
    });
  }
  public async comment(text: string): Promise<void> {
    const props = this.props;
    const author = commentAuthor(props.gristDoc);
    const now = Date.now();
    const addComment = [
      "AddRecord",
      "_grist_Cells",
      null,
      {
        tableRef: props.tableRef,
        colRef: props.column.id.peek(),
        rowId: props.rowId,
        type: CellInfoType.COMMENT,
        root: true,
        userRef: author?.ref ?? '',
        content: JSON.stringify({
          timeCreated: now,
          text: text,
          userName: author?.name ?? '',
        })
      }
    ];
    await props.gristDoc.docData.sendActions([addComment], t('Started discussion'));
  }
}

/**
 * Discussion popup that is attached to a cell.
 */
export class CellDiscussionPopup extends Disposable {
  private _isEmpty: Computed<boolean>;

  constructor(public props: DiscussionPopupProps) {
    super();
    this._isEmpty = Computed.create(this, use => {
      const discussions = use(props.topic.comments);
      const notResolved = discussions.filter(d => !use(d.resolved));
      const visible = notResolved.filter(d => !use(d.hidden));
      return visible.length === 0;
    });
    const content = dom('div',
      testId('popup'),
      dom.domComputed(use => use(this._isEmpty), empty => {
        if (!empty) {
          return dom.create(CellWithCommentsView, {
            topic: props.topic,
            readonly: props.gristDoc.isReadonly,
            gristDoc: props.gristDoc,
            panel: false,
            closeClicked: props.closeClicked,
          });
        } else {
          return dom.create(EmptyCellView, {
            closeClicked: props.closeClicked,
            onSave: (text) => this.props.topic.comment(text),
          });
        }
      })
    );
    buildPopup(this, props.domEl, content, cellPopperOptions, this.props.closeClicked);
  }
}

/**
 * Component for starting discussion on a cell. Displays simple textbox and a button to start discussion.
 */
class EmptyCellView extends Disposable {
  private _newText = Observable.create(this, '');

  constructor(public props: {
    closeClicked: () => void,
    onSave: (text: string) => any
  }) {
    super();
  }

  public buildDom() {
    return cssTopic(
      testId('topic-empty'),
      testId('topic'),
      this._createCommentEntry(),
      dom.onKeyDown({
        Escape: () => this.props.closeClicked?.(),
      })
    );
  }

  private _createCommentEntry() {
    return cssCommonPadding(dom.create(CommentEntry, {
      mode: 'start',
      text: this._newText,
      onSave: () => this.props.onSave(this._newText.get()),
      onCancel: () => this.props.closeClicked?.(),
      editorArgs: [{placeholder: t('Write a comment')}],
      mainButton: t('Comment'),
      buttons: [t('Cancel')],
      args: [testId('editor-start')]
    }));
  }
}

/**
 * Main component for displaying discussion on a popup.
 */
class CellWithCommentsView extends Disposable implements IDomComponent {
  // Holder for a new comment text.
  private _newText = Observable.create(this, '');
  // CommentList dom - used for scrolling.
  private _discussionList!: HTMLDivElement;
  // Currently edited comment.
  private _commentInEdit = Observable.create<CommentView | null>(this, null);
  // Helper variable to mitigate some flickering when closing editor.
  // We hide the editor before resolving discussion or clearing discussion, as
  // actions that create discussions and comments are asynchronous, so user can see
  // that comments elements are removed.
  private _closing = Observable.create(this, false);
  private _comments: Observable<CellRec[]>;
  private _commentsToRender: Observable<CellRec[]>;
  private _truncated: Observable<boolean>;

  constructor(public props: {
    topic: ICellView,
    readonly: Observable<boolean>,
    gristDoc: GristDoc,
    panel?: boolean,
    closeClicked?: () => void
  }) {
    super();
    if (props.panel) {
      this._comments = Computed.create(this, use =>
        use(props.topic.comments).filter(ds => !use(ds.hidden) && use(ds.root)));
    } else {
      // Don't show resolved comments on a popup.
      this._comments = Computed.create(this,
        use => use(props.topic.comments).filter(ds => !use(ds.resolved) && !use(ds.hidden) && use(ds.root)));
    }
    this._commentsToRender = Computed.create(this, use => {
      const sorted = use(this._comments).sort((a, b) => (use(a.timeCreated) ?? 0) - (use(b.timeCreated) ?? 0));
      const start = Math.max(0, sorted.length - COMMENTS_LIMIT);
      return sorted.slice(start);
    });
    this._truncated = Computed.create(this, use => use(this._comments).length > COMMENTS_LIMIT);
  }

  public buildDom() {
    return cssTopic(
      dom.maybe(this._truncated, () => cssTruncate(t("Showing last {{nb}} comments", {nb: COMMENTS_LIMIT}))),
      cssTopic.cls('-panel', this.props.panel),
      domOnCustom(CommentView.EDIT, (s: CommentView) => this._onEditComment(s)),
      domOnCustom(CommentView.CANCEL, (s: CommentView) => this._onCancelEdit()),
      dom.hide(this._closing),
      testId('topic'),
      testId('topic-filled'),
      dom.maybe(!this.props.panel, () =>
        cssHeaderBox(
          testId('topic-header'),
          // NOT IMPLEMENTED YET
          // cssHoverButton(cssRotate('Expand'), dom.on('click', () => this._remove()), {title: 'Previous discussion'}),
          // cssHoverButton(icon('Expand'), dom.on('click', () => this._remove()), {title: 'Next discussion'}),
          dom('div', dom.style('align-self', 'center'), "Comments"),
          cssSpacer(),
          // NOT IMPLEMENTED YET
          // cssIconButton(
          //   icon('Dots'),
          //   menu(() => [], {placement: 'bottom-start'}),
          //   dom.on('click', stopPropagation)
          // ),
          cssHoverButton(
            icon('Popup'),
            testId('topic-button-panel'),
            dom.on('click', () => this.props.gristDoc.showTool('discussion')),
            {title: 'Open panel'}
          ),
          cssHeaderBox.cls("-border")
        )),
      this._discussionList = cssCommentList(
        testId('topic-comments'),
        dom.forEach(this._commentsToRender, comment => {
          return cssDiscussionWrapper(
            cssDiscussion(
              cssDiscussion.cls("-resolved", use => Boolean(use(comment.resolved))),
              dom.create(CommentView, {
                ...this.props,
                comment
              })
            )
          );
        }
        )
      ),
      !this.props.panel ? this._createCommentEntry() : null,
      dom.onKeyDown({
        Escape: () => this.props.closeClicked?.(),
      })
    );
  }

  private _onCancelEdit() {
    if (this._commentInEdit.get()) {
      this._commentInEdit.get()?.isEditing.set(false);
    }
    this._commentInEdit.set(null);
  }

  private _onEditComment(el: CommentView) {
    if (this._commentInEdit.get()) {
      this._commentInEdit.get()?.isEditing.set(false);
    }
    el.isEditing.set(true);
    this._commentInEdit.set(el);
  }

  private async _save() {
    try {
      return await this.props.topic.comment(this._newText.get().trim());
    } catch (err) {
      return reportError(err);
    } finally {
      this._newText.set('');
      this._discussionList.scrollTo(0, 10000);
    }
  }

  private _createCommentEntry() {
    return cssReplyBox(dom.create(CommentEntry, {
      mode: 'comment',
      text: this._newText,
      onSave: () => this._save(),
      onCancel: () => this.props.closeClicked?.(),
      mainButton: 'Send',
      editorArgs: [{placeholder: t('Comment')}],
      args: [testId('editor-add')]
    }));
  }
}

interface CommentProps {
  comment: CellRec,
  topic: ICellView,
  gristDoc: GristDoc,
  isReply?: boolean,
  panel?: boolean,
  args?: DomArg<HTMLDivElement>[]
}

/**
 * Component for displaying a single comment, either in popup or discussion panel.
 */
class CommentView extends Disposable {
  // Public custom events. Those are propagated to the parent component (TopicView) to make
  // sure only one comment is in edit mode at a time.
  public static EDIT = 'comment-edit'; // comment is in edit mode
  public static CANCEL = 'comment-cancel'; // edit mode was cancelled or turned off
  public static SELECT = 'comment-select'; // comment was clicked
  // Public modes that are modified by topic view.
  public isEditing = Observable.create(this, false);
  public replying = Observable.create(this, false);
  private _replies: ObsArray<CellRec>;
  private _hasReplies: Computed<boolean>;
  private _expanded = Observable.create(this, false);
  private _resolved: Computed<boolean>;
  private _showReplies: Computed<boolean>;
  private _bodyDom: Element;
  constructor(
    public props: CommentProps) {
    super();
    this._replies = createObsArray(this, props.comment.children());
    this._hasReplies = Computed.create(this, use => use(this._replies).length > 0);
    this._resolved = Computed.create(this, use => Boolean(use(props.comment.resolved)));
    this._showReplies = Computed.create(this, use => {
      return !this.props.isReply && use(this._replies).length > 0 &&
        (use(this._expanded) || !use(this.props.comment.resolved));
    });
  }
  public buildDom() {
    const comment = this.props.comment;
    const topic = this.props.topic;
    const user = (c: CellRec) =>
      comment.hidden() ? null : commentAuthor(this.props.gristDoc, c.userRef(), c.userName());
    this._bodyDom = cssComment(
      ...(this.props.args ?? []),
      this.props.isReply ? testId('reply') : testId('comment'),
      dom.on('click', () => {
        if (this.props.isReply) { return; }
        trigger(this._bodyDom, CommentView.SELECT, comment);
        if (!this._resolved.get()) { return; }
        this._expanded.set(!this._expanded.get());
      }),
      dom.maybe(use => !use(comment.hidden), () => [
        cssColumns(
          // 1. Column with avatar only
          buildAvatar(user(comment), testId('comment-avatar')),
          // 2. Column with nickname/date, menu and text
          cssCommentHeader(
            // User name date and buttons
            cssCommentBodyHeader(
              dom('div',
                buildNick(user(comment), testId('comment-nick')),
                dom.domComputed(use => cssTime(
                  formatTime(use(comment.timeUpdated) ?? use(comment.timeCreated) ?? 0),
                  testId('comment-time'),
                )),
              ),
              cssSpacer(),
              cssIconButton(
                icon('Dots'),
                testId('comment-menu'),
                dom.style('margin-left', `3px`),
                menu(() => this._menuItems(), {placement: 'bottom-start'}),
                dom.on('click', stopPropagation)
              )
            ),
          ),
        ),
        // Comment text
        dom.maybe(use => !use(this.isEditing),
          () => dom.domComputed(comment.hidden, (hidden) => {
            if (hidden) {
              return cssCommentCensored(
                "CENSORED",
                testId('comment-text'),
              );
            }
            return cssCommentPre(
              dom.text(use => use(comment.text) ?? ''),
              {style: 'margin-top: 4px'},
              testId('comment-text'),
            );
          })
        ),
        // Comment editor
        dom.maybeOwned(this.isEditing,
          (owner) => {
            const text = Observable.create(owner, comment.text.peek() ?? '');
            return dom.create(CommentEntry, {
              text,
              mainButton: t('Save'),
              buttons: [t('Cancel')],
              onSave: async () => {
                const value = text.get();
                text.set("");
                await topic.update(comment, value);
                trigger(this._bodyDom, CommentView.CANCEL, this);
                this.isEditing.set(false);
              },
              onCancel: () => {
                trigger(this._bodyDom, CommentView.CANCEL, this);
                this.isEditing.set(false);
              },
              mode: 'start',
              args: [testId('editor-edit')]
            });
          }
        ),
        dom.maybe(this._showReplies, () =>
          cssCommentReplyWrapper(
            testId('replies'),
            cssReplyList(
              dom.forEach(this._replies, (commentReply) => {
                return dom('div',
                  dom.create(CommentView, {
                    ...this.props,
                    comment: commentReply,
                    isReply: true,
                    args: [dom.style('padding-left', '0px'), dom.style('padding-right', '0px')],
                  })
                );
              }),
            )
          )
        ),
        // Reply editor or button
        dom.maybe(use => !use(this.isEditing) && !this.props.isReply && !use(comment.resolved),
          () => dom.domComputed(use => {
            if (!use(this.replying)) {
              return cssReplyButton(icon('Message'), t('Reply'),
                testId('comment-reply-button'),
                dom.on('click', withStop(() => this.replying.set(true))),
                dom.style('margin-left', use2 => use2(this._hasReplies) ? '16px' : '0px'),
              );
            } else {
              const text = Observable.create(null, '');
              return dom.create(CommentEntry, {
                text,
                args: [dom.style('margin-top', '8px'), testId('editor-reply')],
                mainButton: t('Reply'),
                buttons: [t('Cancel')],
                onSave: async () => {
                  const value = text.get();
                  this.replying.set(false);
                  await topic.reply(comment, value);
                },
                onCancel: () => this.replying.set(false),
                onClick: (button) => {
                  if (button === t('Cancel')) {
                    this.replying.set(false);
                  }
                },
                mode: 'reply'
              });
            }
          })
        ),
        // Resolved marker
        dom.domComputed((use) => {
          if (!use(comment.resolved) || this.props.isReply) { return null; }
          return cssResolvedBlock(
            testId('comment-resolved'),
            icon('FieldChoice'),
            cssResolvedText(dom.text(
              t(`Marked as resolved`)
            )));
        }),
      ]),
    );

    return this._bodyDom;
  }
  private _menuItems() {
    const currentUser = this.props.gristDoc.app.topAppModel.appObs.get()?.currentUser?.ref;
    const canResolve = !this.props.comment.resolved() && !this.props.isReply;
    const comment = this.props.comment;
    return [
      !canResolve ? null :
        menuItem(
          () => this.props.topic.resolve(this.props.comment),
          t('Resolve')
        ),
      !comment.resolved() ? null :
        menuItem(
          () => this.props.topic.open(comment),
          t('Open')
        ),
      menuItem(
        () => this.props.topic.remove(comment),
        t('Remove'),
        dom.cls('disabled', use => {
          return currentUser !== use(comment.userRef);
        })
      ),
      menuItem(
        () => this._edit(),
        t('Edit'),
        dom.cls('disabled', use => {
          return currentUser !== use(comment.userRef);
        })
      ),
    ];
  }

  private _edit() {
    trigger(this._bodyDom, CommentView.EDIT, this);
    this.isEditing.set(true);
  }
}

/**
 * Component for displaying input element for a comment (either for replying or starting a new discussion).
 */
class CommentEntry extends Disposable {
  constructor(public props: {
    text: Observable<string>,
    mode?: 'comment' | 'start' | 'reply', // inline for reply, full for new discussion
    onClick?: (button: string) => void,
    onSave?: () => Promise<void>|void,
    onCancel?: () => void, // On Escape
    mainButton?: string, // Text for the main button (defaults to Send)
    buttons?: string[], // Additional buttons to show.
    editorArgs?: DomArg<HTMLTextAreaElement>[]
    args?: DomArg<HTMLDivElement>[]
  }) {
    super();
  }

  public buildDom() {
    const text = this.props.text;
    const clickBuilder = (button: string) => dom.on('click', () => {
      if (button === t("Cancel")) {
        this.props.onCancel?.();
      } else {
        this.props.onClick?.(button);
      }
    });
    const onSave = async () => text.get() ? await this.props.onSave?.() : {};
    let textArea!: HTMLElement;
    return cssCommentEntry(
      ...(this.props.args ?? []),
      cssCommentEntry.cls(`-${this.props.mode ?? 'comment'}`),
      testId('comment-input'),
      dom.on('click', stopPropagation),
      textArea = buildTextEditor(
        text,
        cssCommentEntryText.cls(""),
        cssTextArea.cls(`-${this.props.mode}`),
        dom.onKeyDown({
          Enter$: async (e) => {
            // Save on ctrl+enter
            if ((e.ctrlKey || e.metaKey) && text.get().trim()) {
              await onSave?.();
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          },
          Escape: (e) => {
            this.props.onCancel?.();
            e.preventDefault();
            e.stopPropagation();
          },
        }),
        ...(this.props.editorArgs || []),
        testId('textarea'),
      ),
      elem => {
        FocusLayer.create(this, {
          defaultFocusElem: textArea,
          allowFocus: (e) => (e !== document.body),
          pauseMousetrap: true
        });
      },
      cssCommentEntryButtons(
        primaryButton(
          this.props.mainButton ?? 'Send',
          dom.prop('disabled', use => !use(text).trim()),
          dom.on('click', withStop(onSave)),
          testId('button-send'),
        ),
        dom.forEach(this.props.buttons || [], button => basicButton(
          button, clickBuilder(button), testId(`button-${button}`)
        )),
      )
    );
  }
}

/**
 * Component that is rendered on the right drawer. It shows all discussions in the document or on the
 * current page. By current page, we mean comments in all currently visible rows (that are not filtered out).
 */
export class DiscussionPanel extends Disposable implements IDomComponent {
  // View mode - current page or whole document.
  private _currentPage: Observable<boolean>;
  private _currentPageKo: ko.Observable<boolean>;
  private _onlyMine: Observable<boolean>;
  // Toggle to switch whether to show active discussions or all discussions (including resolved ones).
  private _resolved: Observable<boolean>;
  private _length = Observable.create<number>(this, 0);

  constructor(private _grist: GristDoc) {
    super();
    const userId = _grist.app.topAppModel.appObs.get()?.currentUser?.id || 0;
    // We store options in session storage, so that they are preserved across page reloads.
    this._resolved = this.autoDispose(localStorageBoolObs(`u:${userId};showResolvedDiscussions`, false));
    this._onlyMine = this.autoDispose(localStorageBoolObs(`u:${userId};showMyDiscussions`, false));
    this._currentPage = this.autoDispose(localStorageBoolObs(`u:${userId};showCurrentPage`, true));
    this._currentPageKo = ko.observable(this._currentPage.get());
    this._currentPage.addListener(val => this._currentPageKo(val));
  }

  public buildDom(): DomContents {
    const owner = new MultiHolder();

    // Computed for all sections visible on the page.
    const viewSections = Computed.create(owner, use => {
      return use(use(this._grist.viewModel.viewSections).getObservable());
    });

    // Based on the view, we get all tables or only visible ones.
    const tables = Computed.create(owner, use => {
      // Filter out those tables that are not available by ACL.
      if (use(this._currentPageKo)) {
        return [...new Set(use(viewSections).map(vs => use(vs.table)).filter(tb => use(tb.tableId)))];
      } else {
        return use(this._grist.docModel.visibleTables.getObservable()).filter(tb => use(tb.tableId));
      }
    });

    // Column filter - only show discussions in this column (depending on the mode).
    const columnFilter = Computed.create(owner, use => {
      if (use(this._currentPageKo)) {
        const fieldSet = new Set<number>();
        use(viewSections).forEach(vs => {
          use(use(vs.viewFields).getObservable()).forEach(vf => fieldSet.add(use(vf.colRef)));
        });
        return (ds: CellRec) => {
          return fieldSet.has(use(ds.colRef));
        };
      } else {
        return () => true;
      }
    });

    // Create a row filter based on user filters (rows that user actually see).
    const watcher = RowWatcher.create(owner);
    watcher.rowFilter.set(() => true);
    // Now watch for viewSections (when they are changed, and then update watcher instance).
    // Unfortunately, we can't use _viewSections here because GrainJS has a different
    // behavior than ko when one observable changes during the evaluation. Here viewInstance
    // will probably be set during computations. To fix this we need a ko.observable here.
    const sources = owner.autoDispose(ko.computed(() => {
      if (this._currentPageKo()) {
        const list: RowSource[] = [];
        for (const vs of this._grist.viewModel.viewSections().all()) {
          const viewInstance = vs.viewInstance();
          if (viewInstance) {
            list.push(viewInstance.rowSource);
          }
        }
        return list;
      }
      return null;
    }));
    sources.peek()?.forEach(source => watcher.subscribeTo(source));
    owner.autoDispose(sources.subscribe(list => {
      bundleChanges(() => {
        watcher.clear();
        if (list) {
          list.forEach(source => watcher.subscribeTo(source));
        } else {
          // Page
          watcher.rowFilter.set(() => true);
        }
      });
    }));

    const rowFilter = watcher.rowFilter;

    const discussionFilter = Computed.create(owner, use => {
      const filterRow = use(rowFilter);
      const filterCol = use(columnFilter);
      const showAll = use(this._resolved);
      const showAnyone = !use(this._onlyMine);
      const currentUser = use(this._grist.app.topAppModel.appObs)?.currentUser?.email ?? '';
      const userFilter = (d: CellRec) => {
        const replies = use(use(d.children).getObservable());
        return use(d.userRef) === currentUser || replies.some(c => use(c.userRef) === currentUser);
      };
      return (ds: CellRec) =>
        !use(ds.hidden) // filter by ACL
        && filterRow(use(ds.rowId))
        && filterCol(ds)
        && (showAnyone || userFilter(ds))
        && (showAll || !use(ds.resolved))
      ;
    });
    const allDiscussions = Computed.create(owner, use => {
      const list = flatMap(flatMap(use(tables).map(tb => {
        const columns = use(use(tb.columns).getObservable());
        const dList = columns.map(col => use(use(col.cells).getObservable())
          .filter(c => use(c.root) && use(c.type) === CellInfoType.COMMENT));
        return dList;
      })));
      return list;
    });
    const discussions = Computed.create(owner, use => {
      const all = use(allDiscussions);
      const filter = use(discussionFilter);
      return all.filter(filter);
    });
    const topic = CellWithComments.create(owner, this._grist);
    topic.comments = discussions;
    owner.autoDispose(discussions.addListener((d) => this._length.set(d.length)));
    this._length.set(discussions.get().length);
    // Selector for page all whole document.
    return cssDiscussionPanel(
      dom.autoDispose(owner),
      testId('panel'),
      // Discussion list - actually we are showing first comment of each discussion.
      cssDiscussionPanelList(
        dom.create(CellWithCommentsView, {
          readonly: this._grist.isReadonly,
          gristDoc: this._grist,
          topic: topic,
          panel: true
        })
      ),
      domOnCustom(CommentView.SELECT, (ds: CellRec) => {
        this._navigate(ds).catch(() => {});
      })
    );
  }

  public buildMenu(): DomContents {
    return cssPanelHeader(
      dom('span', dom.text(use => `${use(this._length)} comments`), testId('comment-count')),
      cssIconButtonMenu(
        icon('Dots'),
        testId('panel-menu'),
        menu(() => {
          return [cssDropdownMenu(
            labeledSquareCheckbox(this._onlyMine, t("Only my threads"), testId('my-threads')),
            labeledSquareCheckbox(this._currentPage, t("Only current page"), testId('only-page')),
            labeledSquareCheckbox(this._resolved, t("Show resolved comments"), testId('show-resolved')),
          )];
        }, {placement: 'bottom-start'}),
        dom.on('click', stopPropagation)
      ),
    );
  }

  /**
   * Navigates to cell on current page or opens discussion next to the panel.
   */
  private async _navigate(discussion: CellRec) {
    // Try to find the cell on the current page.
    const rowId = discussion.rowId.peek();
    function findSection(viewSections: ViewSectionRec[]) {
      const section = viewSections
        .filter(s => s.tableRef.peek() === discussion.tableRef.peek())
        .filter(s => s.viewFields.peek().all().find(f => f.colRef.peek() === discussion.colRef.peek()))[0];
      const sectionId = section?.getRowId();
      const fieldIndex = section?.viewFields.peek().all()
        .findIndex(f => f.colRef.peek() === discussion.colRef.peek()) ?? -1;
      if (fieldIndex !== -1) {
        return {sectionId, fieldIndex};
      }
      return null;
    }
    let sectionId = 0;
    let fieldIndex = -1;
    const section = findSection(this._grist.viewModel.viewSections.peek().all());
    // If we haven't found the cell on the current page, try other pages.
    if (!section) {
      for (const pageId of this._grist.docModel.pages.getAllRows()) {
        const page = this._grist.docModel.pages.getRowModel(pageId);
        const vss = page.view.peek().viewSections.peek().all();
        const result = findSection(vss);
        if (result) {
          sectionId = result.sectionId;
          fieldIndex = result.fieldIndex;
          break;
        }
      }
    } else {
      sectionId = section.sectionId;
      fieldIndex = section.fieldIndex;
    }

    if (!sectionId) {
      return;
    }

    const currentPosition = this._grist.cursorPosition.get();

    if (currentPosition?.sectionId === sectionId &&
      currentPosition.fieldIndex === fieldIndex &&
      currentPosition.rowId === rowId) {
      return;
    }

    // Navigate cursor to the cell.
    const ok = await this._grist.recursiveMoveToCursorPos({
      rowId,
      sectionId,
      fieldIndex
    }, true);
    if (!ok) {
      return;
    }
  }
}

function buildTextEditor(text: Observable<string>, ...args: DomArg<HTMLTextAreaElement>[]) {
  const textArea = cssTextArea(
    bindProp(text),
    autoFocus(),
    autoGrow(text),
    ...args
  );
  return textArea;
}


function buildAvatar(user: FullUser | null, ...args: DomElementArg[]) {
  return cssAvatar(user, 'small', ...args);
}

function buildNick(user: {name: string} | null, ...args: DomArg<HTMLElement>[]) {
  return cssNick(user?.name ?? 'Anonymous', ...args);
}

function bindProp(text: Observable<string>) {
  return [
    dom.prop('value', text),
    dom.on('input', (_, el: HTMLTextAreaElement) => text.set(el.value)),
  ];
}


function buildPopup(
  owner: Disposable,
  cell: Element,
  content: HTMLElement,
  options: Partial<PopperOptions>,
  closeClicked: () => void
) {
  const popper = createPopper(cell, content, options);
  owner.onDispose(() => popper.destroy());
  document.body.appendChild(content);
  owner.onDispose(() => { dom.domDispose(content); content.remove(); });
  owner.autoDispose(onClickOutside(content, () => closeClicked()));
}

// Helper binding function to handle click outside an element. Takes into account floating menus.
function onClickOutside(content: HTMLElement, click: () => void) {
  const onClick = (evt: MouseEvent) => {
    const target: Node | null = evt.target as Node;
    if (target && !content.contains(target)) {
      // Check if any parent of target has class grist-floating-menu, if so, don't close.
      if (target.parentElement?.closest(".grist-floating-menu")) {
        return;
      }
      click();
    }
  };
  return dom.onElem(document, 'click', onClick, {useCapture: true});
}

// Display timestamp as a relative time ago using moment.js
function formatTime(timeStamp: number) {
  const time = moment(timeStamp);
  const now = moment();
  const diff = now.diff(time, 'days');
  if (diff < 1) {
    return time.fromNow();
  }
  return time.format('MMM D, YYYY');
}

function commentAuthor(grist: GristDoc, userRef?: string, userName?: string): FullUser | null {
  if (!userRef) {
    const loggedInUser = grist.app.topAppModel.appObs.get()?.currentValidUser;
    if (!loggedInUser) {
      return {
        name: userName || '',
        ref: userRef || '',
        email: '',
        id: 0
      };
    }
    if (!loggedInUser.ref) {
      throw new Error("User reference is not set");
    }
    return loggedInUser;
  } else {
    if (typeof userName !== 'string') {
      return null;
    }
    return {
      name: userName,
      ref: userRef || '',
      email: '',
      id: 0
    };
  }
}

// Options for popper.js
const calcMaxSize = {
  ...maxSize,
  options: {padding: 4},
};
const applyMaxSize: any = {
  name: 'applyMaxSize',
  enabled: true,
  phase: 'beforeWrite',
  requires: ['maxSize'],
  fn({state}: any) {
    // The `maxSize` modifier provides this data
    const {height} = state.modifiersData.maxSize;
    Object.assign(state.styles.popper, {
      maxHeight: `${Math.min(Math.max(250, height), 600)}px`
    });
  }
};
const cellPopperOptions: Partial<PopperOptions> = {
  placement: 'bottom',
  strategy: 'fixed',
  modifiers: [
    calcMaxSize,
    applyMaxSize,
    {
      name: 'offset',
      options: {
        offset: [0, 4],
      },
    },
    {name: "computeStyles", options: {gpuAcceleration: false}},
    {name: 'eventListeners', enabled: false}
  ],
};


function stopPropagation(ev: Event) {
  ev.stopPropagation();
}

function withStop(handler: () => any) {
  return (ev: Event) => {
    stopPropagation(ev);
    handler();
  };
}

const cssAvatar = styled(createUserImage, `
  flex: none;
  margin-top: 2px;
`);


const cssDiscussionPanel = styled('div', `
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: auto;
  padding: 8px;
`);

const cssDiscussionPanelList = styled('div', `
  margin-bottom: 0px;
`);

const cssCommonPadding = styled('div', `
  padding: 16px;
`);

const cssPanelHeader = styled('div', `
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
`);

const cssDropdownMenu = styled('div', `
  display: flex;
  padding: 12px;
  padding-left: 16px;
  padding-right: 16px;
  gap: 10px;
  flex-direction: column;
`);

const cssReplyBox = styled(cssCommonPadding, `
  border-top: 1px solid ${theme.commentsPopupBorder};
`);

const cssCommentEntry = styled('div', `
  display: grid;
  &-comment {
    grid-template-columns: 1fr auto;
    grid-template-rows: 1fr;
    gap: 8px;
    grid-template-areas: "text buttons";
  }
  &-start, &-reply {
    grid-template-rows: 1fr auto;
    grid-template-columns: 1fr;
    gap: 8px;
    grid-template-areas: "text" "buttons";
  }
`);

const cssCommentEntryText = styled('div', `
  grid-area: text;
`);

const cssCommentEntryButtons = styled('div', `
  grid-area: buttons;
  display: flex;
  align-items: flex-start;

  gap: 8px;
`);

const cssTextArea = styled('textarea', `
  min-height: 5em;
  border-radius: 3px;
  padding: 4px 6px;
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  border: 1px solid ${theme.inputBorder};
  outline: none;
  width: 100%;
  resize: none;
  max-height: 10em;
  &-comment, &-reply {
    min-height: 28px;
    height: 28px;
  }
  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

const cssHeaderBox = styled('div', `
  color: ${theme.text};
  background-color: ${theme.commentsPopupHeaderBg};
  padding: 12px; /* 12px * 2 + 24px (size of the icon) == 48px in height */
  padding-right: 16px;
  display: flex;
  gap: 8px;
  &-border {
    border-bottom: 1px solid ${theme.commentsPopupBorder};
  }
`);

const cssTopic = styled('div', `
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid ${theme.commentsPopupBorder};
  border-radius: 4px;
  background-color: ${theme.commentsPopupBodyBg};
  box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.2);
  z-index: 100;
  width: 325px;
  overflow: hidden;
  outline: none;
  max-height: inherit;
  &-disabled {
    background-color: ${theme.commentsPanelResolvedTopicBg}
  }
  &-panel {
    width: unset;
    box-shadow: none;
    border-radius: 0px;
    background: unset;
    border: 0px;
  }
`);

const cssDiscussionWrapper = styled('div', `
  border-bottom: 1px solid ${theme.commentsPopupBorder};
  &:last-child {
    border-bottom: none;
  }
  .${cssTopic.className}-panel & {
    border: 1px solid ${theme.commentsPanelTopicBorder};
    border-radius: 4px;
    background-color: ${theme.commentsPanelTopicBg};
    margin-bottom: 4px;
  }
`);

const cssDiscussion = styled('div', `
  display: flex;
  flex-direction: column;
  padding: 16px;
  &-resolved {
    background-color: ${theme.commentsPanelResolvedTopicBg};
    cursor: pointer;
  }
  &-resolved * {
    color: ${theme.lightText} !important;
  }
`);

const cssCommentCensored = styled('div', `
  color: ${theme.text};
  margin-top: 4px;
`);

const cssCommentPre = styled('pre', `
  color: ${theme.text};
  padding: 0px;
  font-size: revert;
  border: 0px;
  background: inherit;
  font-family: inherit;
  margin: 0px;
  white-space: break-spaces;
  word-break: break-word;
  word-wrap: break-word;
`);

const cssCommentList = styled('div', `
  display: flex;
  flex-direction: column;
  overflow: auto;
`);

const cssColumns = styled('div', `
  display: flex;
  align-items: flex-start;
  gap: 8px;
`);

const cssCommentReplyWrapper = styled('div', `
  margin-top: 16px;
`);

const cssComment = styled('div', `
  border-bottom: 1px solid ${theme.commentsPopupBorder};
  .${cssCommentList.className} &:last-child {
    border-bottom: 0px;
  }
`);

const cssReplyList = styled('div', `
  margin-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
`);

const cssCommentHeader = styled('div', `
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
`);

const cssCommentBodyHeader = styled('div', `
  display: flex;
  align-items: baseline;
  overflow: hidden;
`);

const cssIconButton = styled('div', `
  flex: none;
  margin: 0 4px 0 auto;
  height: 24px;
  width: 24px;
  padding: 4px;
  line-height: 0px;
  border-radius: 3px;
  cursor: pointer;
  --icon-color: ${theme.controlSecondaryFg};
  &:hover, &.weasel-popup-open {
    background-color: ${theme.controlSecondaryHoverBg};
  }
`);

const cssIconButtonMenu = styled('div', `
  flex: none;
  margin: 0 4px 0 auto;
  height: 24px;
  width: 24px;
  padding: 4px;
  line-height: 0px;
  border-radius: 3px;
  cursor: pointer;
  --icon-color: ${theme.rightPanelTabSelectedFg};
  &:hover, &.weasel-popup-open {
    background-color: ${theme.rightPanelTabButtonHoverBg};
  }
`);

const cssReplyButton = styled(textButton, `
  align-self: flex-start;
  display: flex;
  gap: 4px;
  margin-top: 16px;
`);

const cssTime = styled('div', `
  color: ${theme.lightText};
  font-size: ${vars.smallFontSize};
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.02em;
  line-height: 16px;
`);

const cssNick = styled('div', `
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  color: ${theme.commentsUserNameFg};
  &-small {
    font-size: 12px;
  }
`);

const cssSpacer = styled('div', `
  flex-grow: 1;
`);

const cssCloseButton = styled('div', `
  padding: 4px;
  border-radius: 4px;
  line-height: 1px;
  cursor: pointer;
  --icon-color: ${theme.controlSecondaryFg};
  &:hover {
    background-color: ${theme.hover};
  }
`);

const cssHoverButton = styled(cssCloseButton, `
  &:hover {
    --icon-color: ${theme.controlPrimaryBg};
  }
`);

// NOT IMPLEMENTED YET
// const cssRotate = styled(icon, `
//   transform: rotate(180deg);
// `);

function domOnCustom(name: string, handler: (args: any, event: Event, element: Element) => void) {
  return (el: Element) => {
    dom.onElem(el, name, (ev, target) => {
      const cv = ev as CustomEvent;
      handler(cv.detail.args ?? {}, ev, target);
    });
  };
}

function trigger(element: Element, name: string, args?: any) {
  element.dispatchEvent(new CustomEvent(name, {
    bubbles: true,
    detail: {args}
  }));
}

const cssResolvedBlock = styled('div', `
  margin-top: 5px;
  --icon-color: ${theme.text};
`);

const cssResolvedText = styled('span', `
  color: ${theme.text};
  font-size: ${vars.smallFontSize};
  margin-left: 5px;
`);

const cssTruncate = styled('div', `
  position: absolute;
  background: white;
  inset: 0;
  height: 2rem;
  opacity: 57%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
`);
