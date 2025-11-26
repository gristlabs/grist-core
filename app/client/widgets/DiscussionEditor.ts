import {allCommands} from 'app/client/components/commands';
import {showUndoDiscardNotification} from 'app/client/components/Drafts';
import {GristDoc} from 'app/client/components/GristDoc';
import {domDispatch, domOnCustom, makeTestId} from 'app/client/lib/domUtils';
import {createObsArray} from 'app/client/lib/koArrayWrap';
import {makeT} from 'app/client/lib/localization';
import {localStorageBoolObs} from 'app/client/lib/localStorageObs';
import {CellRec, ViewSectionRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {INotification} from 'app/client/models/NotifyModel';
import {RowSource, RowWatcher} from 'app/client/models/rowset';
import {renderCellMarkdown} from 'app/client/ui/MarkdownCellRenderer';
import {createUserImage} from 'app/client/ui/UserImage';
import {basicButton, primaryButton, textButton} from 'app/client/ui2018/buttons';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuItem} from 'app/client/ui2018/menus';
import {cssMarkdown} from 'app/client/widgets/MarkdownTextBox';
import {buildMentionTextBox, CommentWithMentions} from 'app/client/widgets/MentionTextBox';
import {CommentContent} from 'app/common/DocComments';
import {CellInfoType} from 'app/common/gristTypes';
import {FullUser, PermissionData} from 'app/common/UserAPI';
import {CursorPos} from 'app/plugin/GristAPI';
import {
  bundleChanges,
  Computed,
  Disposable,
  dom,
  DomArg,
  DomContents,
  DomElementArg,
  Holder,
  IDomComponent,
  MultiHolder,
  ObsArray,
  Observable,
  styled
} from 'grainjs';
import * as ko from 'knockout';
import flatMap from 'lodash/flatMap';
import moment from 'moment';
import {PopupControl, popupOpen} from 'popweasel';

const testId = makeTestId('test-discussion-');
const t = makeT('DiscussionEditor');
const COMMENTS_LIMIT = 200;

export interface DiscardedComment extends CursorPos {
  text: CommentWithMentions;
}

interface DiscussionModel {
  /**
   * List of comments to show. In popup comments are only shown for the current cell. In panel comments are
   * filtered manually by user.
   */
  comments: Observable<CellRec[]>,
  /**
   * If there are no active comments in the list.
   */
  isEmpty: Computed<boolean>,
  /**
   * Saves a comment that creates a new discussion in the given cell.
   * Assumes that the cell has no comments yet.
   */
  startIn(pos: CursorPos, text: CommentWithMentions): Promise<void>;
  /**
   * Replies to a comment with the provided text.
   */
  reply(discussion: CellRec, text: CommentWithMentions): Promise<void>;
  /**
   * Resolves one discussion thread. There should be only one unresolved discussion per cell.
   */
  resolve(discussion: CellRec): Promise<void>;
  /**
   * Updates a comment with the provided text.
   */
  update(comment: CellRec, text: CommentWithMentions): Promise<void>;
  /**
   * Opens a resolved discussion thread. There should be only one unresolved discussion thread at a time. Popup will
   * show only the last unresolved discussion thread, but all threads are available in the discussion panel.
   */
  open(discussion: CellRec): Promise<void>;
  /**
   * Removes a comment or a whole discussion thread depending on the comment itself (if it is a root of discussion or
   * just a reply).
   */
  remove(comment: CellRec): Promise<void>;
}

export class DiscussionModelImpl extends Disposable implements DiscussionModel {
  public static fromCursor(owner: MultiHolder, gristDoc: GristDoc, cursorPos: CursorPos): DiscussionModelImpl {
    if (!cursorPos.sectionId || cursorPos.fieldIndex === undefined || typeof cursorPos.rowId !== 'number') {
      throw new Error("Cannot create CellImpl without sectionId, fieldIndex and rowId in cursor position");
    }
    const section = gristDoc.docModel.viewSections.getRowModel(cursorPos.sectionId);
    const column = section.viewFields.peek().peek()[cursorPos.fieldIndex].column.peek();
    const rowId = Number(cursorPos.rowId);
     const comments = Computed.create(null, use => {
      const fromColumn = use(use(column.cells).getObservable());
      const forRow = fromColumn.filter(d => use(d.rowId) === rowId && use(d.root) && !use(d.hidden));
      return forRow;
    });
    const model = DiscussionModelImpl.create(owner, gristDoc, comments);
    model.autoDispose(comments);
    return model;
  }

  public isEmpty: Computed<boolean>;

  constructor(
    protected gristDoc: GristDoc,
    public comments: Observable<CellRec[]>
  ) {
    super();

    this.isEmpty = Computed.create(this, use => {
      const discussions = use(comments);
      const notResolved = discussions.filter(d => !use(d.resolved));
      const visible = notResolved.filter(d => !use(d.hidden));
      return visible.length === 0;
    });
  }

  public async startIn(pos: CursorPos, commentText: CommentWithMentions): Promise<void> {
    this.gristDoc.commentMonitor?.clear();
    if (!pos.sectionId || pos.fieldIndex === undefined || typeof pos.rowId !== 'number') {
      throw new Error("Cannot start discussion without sectionId, fieldIndex and rowId in cursor position");
    }
    const section = this.gristDoc.docModel.viewSections.getRowModel(pos.sectionId);
    const column = section.viewFields.peek().peek()[pos.fieldIndex].column.peek();
    const colRef = column.id.peek();
    const rowId = Number(pos.rowId);
    const tableRef = section.table.peek().id.peek();
    const author = commentAuthor(this.gristDoc);
    await this.gristDoc.docData.sendActions([[
      "AddRecord",
      "_grist_Cells",
      null,
      {
        tableRef,
        colRef,
        rowId,
        type: CellInfoType.COMMENT,
        root: true,
        userRef: author?.ref ?? '',
        content: JSON.stringify({
          timeCreated: Date.now(),
          userName: author?.name ?? '',
          sectionId: pos.sectionId,
          ...commentText,
        } as CommentContent)
      }
    ]], t('Started discussion'));
  }

  public async reply(comment: CellRec, commentText: CommentWithMentions): Promise<void> {
    this.gristDoc.commentMonitor?.clear();
    const author = commentAuthor(this.gristDoc);
    await this.gristDoc.docData.bundleActions(t("Reply to a comment"), () =>
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
            sectionId: comment.sectionId.peek(),
            ...commentText,
          } as CommentContent),
          tableRef: comment.tableRef.peek(),
          colRef: comment.colRef.peek(),
          rowId: comment.rowId.peek(),
        }
      ])
    );
  }

  public resolve(comment: CellRec): Promise<void> {
    const author = commentAuthor(this.gristDoc);
    comment.resolved(true);
    comment.resolvedBy(author?.email ?? '');
    return comment.timeUpdated.saveOnly(Date.now());
  }

  public async update(comment: CellRec, commentText: CommentWithMentions): Promise<void> {
    this.gristDoc.commentMonitor?.clear();
    comment.text(commentText.text);
    comment.mentions(commentText.mentions);
    return comment.timeUpdated.setAndSave(Date.now());
  }

  public async open(comment: CellRec): Promise<void> {
    comment.resolved(false);
    comment.resolvedBy('');
    return comment.timeUpdated.setAndSave(Date.now());
  }

  public async remove(comment: CellRec): Promise<void> {
    await comment._table.sendTableAction(["RemoveRecord", comment.id.peek()]);
  }
}

/**
 * Discussion popup that is attached to a cell.
 */
export class CommentPopup extends Disposable {
  private _newText: Observable<CommentWithMentions> = Observable.create(this,
    this._props.initialText ?? new CommentWithMentions());
  private _menuInstance: PopupControl;

  constructor(private _props: {
    domEl: Element,
    cell: DiscussionModel,
    gristDoc: GristDoc,
    cursorPos: CursorPos,
    initialText?: CommentWithMentions|null,
    closeClicked: () => void;
  }) {
    super();
    this._props.gristDoc.docPageModel.refreshDocumentAccess().catch(reportError);
    const access = this._props.gristDoc.docPageModel.docUsers;

    this._menuInstance = popupOpen(this._props.domEl, (ctl) => {
      // When the popup is being disposed (after closing).
      ctl.onDispose(() => {
        // Make sure we are not disposed already. TODO: popupMenu should have some hooks exposed like beforeClose.
        if (this.isDisposed() || this._newText.isDisposed()) { return; }
        // If there is some text, store it in the comment monitor to allow restoring it.
        const text = this._newText.get();
        if (text.shouldBeRestored()) {
          this._props.gristDoc.commentMonitor?.setDiscardedComment({
            text,
            ...this._props.cursorPos,
          });
        }
      });
      return cssCommentPopup(
        testId('popup'),
        dom.domComputed(this._props.cell.isEmpty, empty => {
          if (!empty) {
            return dom.create(SingleThread, {
              text: this._newText,
              cell: _props.cell,
              gristDoc: _props.gristDoc,
              access,
              closeClicked: _props.closeClicked,
              cursorPos: _props.cursorPos,
            });
          } else {
            return dom.create(EmptyThread, {
              access,
              text: this._newText,
              currentUserId: _props.gristDoc.currentUser.get()?.id ?? 0,
              closeClicked: _props.closeClicked,
              onSave: (text) => this._onSave(text).catch(reportError),
            });
          }
        })
      );
    }, {
      placement: 'bottom',
      attach: 'body',
      boundaries: 'window',
    });

    this.onDispose(() => {
      if (this._menuInstance && !this._menuInstance.isDisposed()) {
        this._menuInstance.dispose();
      }
    });
  }

  private async _onSave(text: CommentWithMentions) {
    if (!this._menuInstance.isDisposed()) {
      this._menuInstance.update();
    }
    await this._props.cell.startIn(this._props.cursorPos, text);
  }
}


/**
 * Monitor for discarded comments. It will show a popup with an undo button for 10 seconds to
 * restore the discarded comment and move the cursor to the cell.
 */
export class CommentMonitor extends Disposable {
  private _currentNotification: Holder<INotification> = Holder.create(this);

  constructor(private _doc: GristDoc) {
    super();
    // If the cursor is changed in anyway, remove the popup.
    this.autoDispose(this._doc.cursorPosition.addListener(() => {
      this.clear();
    }));
  }

  public clear() {
    if (this.isDisposed()) { return; }
    this._currentNotification.clear();
  }

  public setDiscardedComment(discarded: DiscardedComment) {
    this._currentNotification.autoDispose(
      showUndoDiscardNotification(this._doc, () => {
        this._doc.moveToCursorPos(discarded)
          .then(() => this.isDisposed() || allCommands.openDiscussion.run(null, discarded.text))
          .then(() => this.clear())
          .catch(reportError);
      })
    );
  }
}


/**
 * Component for starting discussion on a cell. Displays simple textbox and a button to start discussion.
 */
class EmptyThread extends Disposable {
  private _entry: CommentEntry;

  constructor(public props: {
    text: Observable<CommentWithMentions>,
    access: Observable<PermissionData|null>,
    currentUserId: number,
    closeClicked: () => void,
    onSave: (text: CommentWithMentions) => void
  }) {
    super();
    this._entry = CommentEntry.create(this, {
      currentUserId: this.props.currentUserId,
      access: this.props.access,
      mode: 'start',
      text: this.props.text,
      editorArgs: [{placeholder: t('Write a comment')}],
      mainButton: t('Comment'),
      buttons: [t('Cancel')],
      args: [testId('editor-start')],
      onSave: this._onSave.bind(this),
      onCancel: this._onCancel.bind(this),
    });
  }

  public buildDom() {
    return cssTopic(
      testId('topic-empty'),
      testId('topic'),
      cssCommonPadding(
        this._entry.buildDom()
      ),
      dom.onKeyDown({
        Escape: () => this.props.closeClicked?.(),
      })
    );
  }

  private _onSave(md: CommentWithMentions) {
    this.props.text.set(new CommentWithMentions());
    this.props.onSave(md);
    this._entry.clear();
  }

  private _onCancel() {
    this.props.text.set(new CommentWithMentions());
    this.props.closeClicked?.();
  }
}


/**
 * Main component for displaying discussion on a popup.
 * Shows only comments that are not resolved. UI tries best to keep only one unresolved comment at a time.
 * But if there are multiple unresolved comments, it will show all of them in a list.
 */
class SingleThread extends Disposable implements IDomComponent {
  // Holder for a new comment text.
  private _newText = this.props.text;
  // CommentList dom - used for scrolling.
  private _commentList!: HTMLDivElement;
  // Currently edited comment.
  private _commentInEdit = Observable.create<Comment | null>(this, null);
  // Helper variable to mitigate some flickering when closing editor.
  // We hide the editor before resolving discussion or clearing discussion, as
  // actions that create discussions and comments are asynchronous, so user can see
  // that comments elements are removed.
  private _closing = Observable.create(this, false);
  private _comments: Observable<CellRec[]>;
  private _commentsToRender: Observable<CellRec[]>;
  private _truncated: Observable<boolean>;
  private _entry: CommentEntry;

  constructor(public props: {
    text: Observable<CommentWithMentions>,
    cell: DiscussionModel,
    access: Observable<PermissionData|null>,
    gristDoc: GristDoc,
    cursorPos: CursorPos,
    closeClicked?: () => void,
    listChanged?: () => void,
  }) {
    super();
    // On popup we will only show last non resolved comment.
    this._comments = Computed.create(this,
      use => use(props.cell.comments)
        .filter(ds => !use(ds.resolved) && !use(ds.hidden) && use(ds.root))
        .sort((a, b) => (use(a.timeCreated) ?? 0) - (use(b.timeCreated) ?? 0)));
    this._commentsToRender = Computed.create(this, use => {
      const sorted = use(this._comments).sort((a, b) => (use(a.timeCreated) ?? 0) - (use(b.timeCreated) ?? 0));
      const start = Math.max(0, sorted.length - COMMENTS_LIMIT);
      return sorted.slice(start);
    });

    if (this.props.listChanged) {
      const sizeObs = Computed.create(this, use => use(this._commentsToRender).length);
      this.autoDispose(sizeObs.addListener(() => {
        this.props.listChanged?.();
      }));
    }

    this._truncated = Computed.create(this, use => use(this._comments).length > COMMENTS_LIMIT);
    this._entry = CommentEntry.create(this, {
      access: this.props.access,
      mode: 'comment',
      text: this._newText,
      currentUserId: this.props.gristDoc.currentUser.get()?.id ?? 0,
      mainButton: 'Reply',
      editorArgs: [{placeholder: t('Reply')}],
      args: [testId('editor-add')],
      onSave: () => this._save(),
      onCancel: () => this.props.closeClicked?.(),
    });
  }

  public buildDom() {
    return cssTopic(
      dom.maybe(this._truncated, () => cssTruncate(t("Showing last {{nb}} comments", {nb: COMMENTS_LIMIT}))),
      domOnCustom(Comment.EDIT, (s: Comment) => this._onEditComment(s)),
      domOnCustom(Comment.CANCEL, () => this._onCancelEdit()),
      dom.hide(this._closing),
      testId('topic'),
      testId('topic-filled'),
      this._commentList = cssCommentList(
        testId('topic-comments'),
        dom.forEach(this._commentsToRender, comment => {
          return cssDiscussion(
            cssDiscussion.cls("-resolved", use => Boolean(use(comment.resolved))),
            dom.create(Comment, {
              ...this.props,
              comment
            })
          );
        })
      ),
      dom.maybe(use => !use(this.props.gristDoc.isReadonly), () => this._createCommentEntry()),
      dom.onKeyDown({
        Escape: () => this.props.closeClicked?.(),
      })
    );
  }


  private _onCancelEdit() {
    if (this._commentInEdit.get()) {
      this._commentInEdit.get()?.setEditing(false);
    }
    this._commentInEdit.set(null);
  }

  private _onEditComment(el: Comment) {
    if (this._commentInEdit.get()) {
      this._commentInEdit.get()?.setEditing(false);
    }
    el.setEditing(true);
    this._commentInEdit.set(el);
  }

  private async _save() {
    try {
      const list = this._commentsToRender.get();
      const md = this._newText.get();
      this._newText.set(new CommentWithMentions());
      this._entry.clear();
      if (!list.length) {
        throw new Error("There should be only one comment in edit mode");
      }
      await this.props.cell.reply(list[list.length - 1], md);
      this._entry.clear();
    } catch (err) {
      return reportError(err);
    } finally {
      this._commentList.scrollTo(0, 10000);
    }
  }

  private _createCommentEntry() {
    return cssReplyBox(this._entry.buildDom());
  }
}


/**
 * List of comments (each can have multiple replies), used in discussion panel.
 */
class MultiThreads extends Disposable implements IDomComponent {
  // Currently edited comment.
  private _commentInEdit = Observable.create<Comment | null>(this, null);
  // Helper variable to mitigate some flickering when closing editor.
  // We hide the editor before resolving discussion or clearing discussion, as
  // actions that create discussions and comments are asynchronous, so user can see
  // that comments elements are removed.
  private _closing = Observable.create(this, false);
  private _comments: Observable<CellRec[]>;
  private _commentsToRender: Observable<CellRec[]>;
  private _truncated: Observable<boolean>;
  private _access: Observable<PermissionData|null>;

  constructor(private _props: {
    cell: DiscussionModel,
    readonly: Observable<boolean>,
    gristDoc: GristDoc,
    closeClicked?: () => void
  }) {
    super();
    this._comments = Computed.create(this, use =>
      use(_props.cell.comments).filter(ds => !use(ds.hidden) && use(ds.root)));

    this._commentsToRender = Computed.create(this, use => {
      const sorted = use(this._comments).sort((a, b) => (use(a.timeCreated) ?? 0) - (use(b.timeCreated) ?? 0));
      const start = Math.max(0, sorted.length - COMMENTS_LIMIT);
      return sorted.slice(start);
    });
    this._truncated = Computed.create(this, use => use(this._comments).length > COMMENTS_LIMIT);
    this._props.gristDoc.docPageModel.refreshDocumentAccess().catch(reportError);
    this._access = this._props.gristDoc.docPageModel.docUsers;
  }

  public buildDom() {
    return cssTopic(
      dom.maybe(this._truncated, () => cssTruncate(t("Showing last {{nb}} comments", {nb: COMMENTS_LIMIT}))),
      cssTopic.cls('-panel'),
      domOnCustom(Comment.EDIT, (s: Comment) => this._onEditComment(s)),
      domOnCustom(Comment.CANCEL, () => this._onCancelEdit()),
      dom.hide(this._closing),
      testId('topic'),
      testId('topic-filled'),
      cssCommentList(
        testId('topic-comments'),
        dom.forEach(this._commentsToRender, comment => {
          return cssDiscussionWrapper(
            cssDiscussion(
              cssDiscussion.cls("-resolved", use => Boolean(use(comment.resolved))),
              dom.create(Comment, {
                ...this._props,
                access: this._access,
                panel: true,
                comment
              })
            )
          );
        })
      ),
      dom.onKeyDown({
        Escape: () => this._props.closeClicked?.(),
      })
    );
  }

  private _onCancelEdit() {
    if (this._commentInEdit.get()) {
      this._commentInEdit.get()?.setEditing(false);
    }
    this._commentInEdit.set(null);
  }

  private _onEditComment(el: Comment) {
    if (this._commentInEdit.get()) {
      this._commentInEdit.get()?.setEditing(false);
    }
    el.setEditing(true);
    this._commentInEdit.set(el);
  }
}

/**
 * Component for displaying a single comment, either in popup or discussion panel.
 */
class Comment extends Disposable {
  // Public custom events. Those are propagated to the parent component (TopicView) to make
  // sure only one comment is in edit mode at a time.
  public static EDIT = 'comment-edit'; // comment is in edit mode
  public static CANCEL = 'comment-cancel'; // edit mode was cancelled or turned off
  public static SELECT = 'comment-select'; // comment was clicked
  // Public modes that are modified by topic view.
  public replying = Observable.create(this, false);
  private _isEditing = Observable.create(this, false);
  private _replies: ObsArray<CellRec>;
  private _hasReplies: Computed<boolean>;
  private _expanded = Observable.create(this, false);
  private _resolved: Computed<boolean>;
  private _showReplies: Computed<boolean>;
  private _bodyDom: Element;
  private get _isReply() {
    return !!this.props.parent;
  }
  private get _start() {
    return this.props.parent ? this.props.parent : this.props.comment;
  }
  constructor(
    public props: {
      comment: CellRec,
      access: Observable<PermissionData|null>,
      cell: DiscussionModel,
      gristDoc: GristDoc,
      cursorPos?: CursorPos,
      parent?: CellRec|null,
      panel?: boolean,
      args?: DomArg<HTMLDivElement>[]
  }) {
    super();
    this._replies = createObsArray(this, props.comment.children());
    this._hasReplies = Computed.create(this, use => use(this._replies).length > 0);
    this._resolved = Computed.create(this, use =>
      this._isReply && this.props.parent
        ? Boolean(use(this.props.parent.resolved))
        : Boolean(use(this.props.comment.resolved))
    );
    this._showReplies = Computed.create(this, use => {
      // We don't show replies if we are reply.
      if (this._isReply) {
        return false;
      }
      // Or we are resolved root comment on panel that is collapsed.
      if (use(this.props.comment.resolved) && this.props.panel && !use(this._expanded)) {
        return false;
      }
      return true;
    });
  }
  public buildDom() {
    const comment = this.props.comment;
    const topic = this.props.cell;

    const containerClass = () => this.props.panel ? cssDiscussionPanel.className : cssCommentPopup.className;

    const user = (c: CellRec) =>
      comment.hidden() ? null : commentAuthor(this.props.gristDoc, c.userRef(), c.userName());
    this._bodyDom = cssComment(
      ...(this.props.args ?? []),
      this._isReply  ? testId('reply') : testId('comment'),
      dom.on('click', () => {
        if (this._isReply) { return; }
        domDispatch(this._bodyDom, Comment.SELECT, comment);
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
              cssCommentBodyText(
                buildNick(user(comment), testId('comment-nick')),
                dom.domComputed(use => cssTime(
                  formatTime(use(comment.timeUpdated) ?? use(comment.timeCreated) ?? 0),
                  testId('comment-time'),
                  use(comment.timeUpdated) ? dom('span', ' (' + t('updated') + ')') : null,
                )),
              ),
              // if this is reply in a resolved comment, don't show menu
              dom.maybe(use => !(this._isReply && use(this._resolved)), () => [
                cssIconButton(
                  icon('Dots'),
                  testId('comment-menu'),
                  dom.style('margin-left', `3px`),
                  menu(() => this._menuItems(), {
                    placement: 'bottom-start',
                    attach: `.${containerClass()}`,
                  }),
                  dom.on('click', stopPropagation)
                )
              ]),
            ),
          ),
        ),
        // Comment text
        dom.maybe(use => !use(this._isEditing),
          () => dom.domComputed(comment.hidden, (hidden) => {
            if (hidden) {
              return cssCommentCensored(
                "CENSORED",
                testId('comment-text'),
              );
            }
            return cssRenderedCommentMarkdown(
              dom.domComputed(comment.text, (text?: string) => text && renderCellMarkdown(text)),
              testId('comment-text'),
            );
          })
        ),
        // Comment editor
        dom.maybeOwned(this._isEditing,
          (owner) => {
            const text = Observable.create(owner, new CommentWithMentions(comment.text.peek() ?? ''));
            return dom.create(CommentEntry, {
              text,
              mainButton: t('Save'),
              buttons: [t('Cancel')],
              currentUserId: this.props.gristDoc.currentUser.get()?.id ?? 0,
              onSave: async () => {
                const value = text.get();
                await topic.update(comment, value);
                this.setEditing(false);
              },
              onCancel: () => {
                this.setEditing(false);
              },
              mode: 'start',
              args: [testId('editor-edit')],
              access: this.props.access,
            });
          }
        ),
        dom.maybe(this._showReplies, () =>
          cssCommentReplyWrapper(
            testId('replies'),
            cssReplyList(
              dom.forEach(this._replies, (commentReply) => {
                return dom('div',
                  dom.create(Comment, {
                    ...this.props,
                    access: this.props.access,
                    comment: commentReply,
                    parent: this.props.comment,
                    args: [dom.style('padding-left', '0px'), dom.style('padding-right', '0px')],
                  })
                );
              }),
            )
          )
        ),
        // Reply editor or button
        dom.maybe(use =>
          !use(this._isEditing) &&
          !this._isReply &&
          this.props.panel &&
          !use(this.props.gristDoc.isReadonly) &&
          !use(comment.resolved),
          () => dom.domComputed(use => {
            if (!use(this.replying)) {
              return cssReplyButton(icon('Message'), t('Reply'),
                testId('comment-reply-button'),
                dom.on('click', withStop(() => this.replying.set(true))),
                dom.style('margin-left', use2 => use2(this._hasReplies) ? '16px' : '0px'),
              );
            } else {
              return dom.create(CommentEntry, {
                text: Observable.create(null, new CommentWithMentions()),
                args: [dom.style('margin-top', '8px'), testId('editor-reply')],
                mainButton: t('Reply'),
                buttons: [t('Cancel')],
                currentUserId: this.props.gristDoc.currentUser.get()?.id ?? 0,
                onSave: (value: CommentWithMentions) => {
                  this.replying.set(false);
                  topic.reply(comment, value).catch(reportError);
                },
                onCancel: () => this.replying.set(false),
                onClick: (button) => {
                  if (button === t('Cancel')) {
                    this.replying.set(false);
                  }
                },
                mode: 'reply',
                access: this.props.access,
              });
            }
          })
        ),
        // Resolved marker
        dom.domComputed((use) => {
          if (!use(comment.resolved) || this._isReply) { return null; }
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

  public setEditing(editing: boolean) {
    if (this.props.gristDoc.isReadonly.get()) {
      return;
    }
    if (this._isEditing.get() === editing) {
      return;
    }
    this._isEditing.set(editing);
    if (editing) {
      domDispatch(this._bodyDom, Comment.EDIT, this);
    } else {
      domDispatch(this._bodyDom, Comment.CANCEL, this);
    }
  }

  private _menuItems() {
    const currentUser = this.props.gristDoc.currentUser.get()?.ref;
    const comment = this.props.comment;
    const lastComment = comment.column.peek().cells.peek().peek().at(-1);

    const resolveVisible = !this.props.comment.resolved()
                        && !this._isReply;
    const openVisible =
      this._resolved.get() // if this discussion is resolved
      && !this._isReply // and this is not a reply
      && lastComment === comment; // and this is the last comment
    const editVisible = !this._resolved.get();
    return [
      // Show option for anchor link, except in the side-panel view where we don't have cursorPos.
      // Without it, we don't know the section, and anchor links can't work without it.
      (this.props.cursorPos ?
        menuItem(
          () => this.props.gristDoc.copyAnchorLink({comments: true, ...this.props.cursorPos}).catch(reportError),
          t("Copy link")
        ) :
        null
      ),
      !resolveVisible ? null :
        menuItem(
          () => this.props.cell.resolve(comment),
          t('Resolve'),
          dom.cls('disabled', use => {
            return use(this.props.gristDoc.isReadonly) || use(this._start.userRef) !== currentUser;
          })
        ),
      !openVisible ? null :
        menuItem(
          () => this.props.cell.open(comment),
          t('Open'),
          dom.cls('disabled', use => {
            return use(this.props.gristDoc.isReadonly);
          })
        ),
      menuItem(
        () => {
          return this.props.cell.remove(comment);
        },
        comment.root.peek() ? t('Remove thread') : t('Remove'),
        dom.cls('disabled', use => {
          return currentUser !== use(comment.userRef) || use(this.props.gristDoc.isReadonly);
        })
      ),
      // If comment is resolved, we can't edit it.
      !editVisible ? null : menuItem(
        () => this.setEditing(true),
        t('Edit'),
        dom.cls('disabled', use => {
          return currentUser !== use(comment.userRef) || use(this.props.gristDoc.isReadonly);
        })
      ),
    ];
  }
}

/**
 * Component for displaying input element for a comment (either for replying or starting a new discussion).
 */
class CommentEntry extends Disposable {

  private _editableDiv: HTMLDivElement;

  constructor(public props: {
    text: Observable<CommentWithMentions>,
    mode?: 'comment' | 'start' | 'reply', // inline for reply, full for new discussion
    mainButton?: string, // Text for the main button (defaults to Send)
    buttons?: string[], // Additional buttons to show.
    editorArgs?: DomArg<HTMLElement>[]
    args?: DomArg<HTMLDivElement>[],
    access: Observable<PermissionData|null>,
    currentUserId: number,
    onClick?: (button: string) => void,
    onSave?: (m: CommentWithMentions) => void,
    onCancel?: () => void, // On Escape
  }) {
    super();
  }

  public buildDom() {
    const clickBuilder = (button: string) => dom.on('click', () => {
      if (button === t("Cancel")) {
        this.props.onCancel?.();
      } else {
        this.props.onClick?.(button);
      }
    });
    const onEnter = () => {
      const value = this.props.text.get();
      if (!value.isEmpty()) {
        this.props.onSave?.(value);
      }
    };
    return cssCommentEntry(
      ...(this.props.args ?? []),
      cssCommentEntry.cls(`-${this.props.mode ?? 'comment'}`),
      testId('comment-input'),
      dom.on('click', stopPropagation),
      this._editableDiv = buildMentionTextBox(
        this.props.text,
        this.props.access,
        cssCommentEntryText.cls(""),
        cssContentEditable.cls(`-${this.props.mode}`),
        dom.onKeyDown({
          Enter$: async (e) => {
            if (!e.shiftKey && !this.props.text.get().isEmpty()) {
              e.preventDefault();
              e.stopPropagation();
              onEnter();
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
      cssCommentEntryButtons(
        primaryButton(
          this.props.mainButton ?? 'Send',
          dom.prop('disabled', use => use(this.props.text).isEmpty()),
          dom.on('click', withStop(onEnter)),
          testId('button-send'),
        ),
        dom.forEach(this.props.buttons || [], button => basicButton(
          button, clickBuilder(button), testId(`button-${button}`)
        )),
      )
    );
  }

  public clear() {
    this._editableDiv.innerHTML = '';
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
    const userId = _grist.currentUser.get()?.id || 0;
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
      const showOnlyMine = use(this._onlyMine);
      const currentUser = use(this._grist.currentUser)?.ref ?? '';
      const userFilter = (d: CellRec) => {
        const replies = use(use(d.children).getObservable());
        return use(d.userRef) === currentUser
          || (use(d.mentions) ?? []).includes(currentUser)
          || replies.some(c => use(c.userRef) === currentUser || (use(c.mentions) ?? []).includes(currentUser));
      };
      return (ds: CellRec) =>
        !use(ds.hidden) // filter by ACL
        && filterRow(use(ds.rowId))
        && filterCol(ds)
        && (showOnlyMine ? userFilter(ds) : true)
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
    const topic = DiscussionModelImpl.create(owner, this._grist, discussions);
    owner.autoDispose(discussions.addListener((d) => this._length.set(d.length)));
    this._length.set(discussions.get().length);
    // Selector for page all whole document.
    return cssDiscussionPanel(
      dom.autoDispose(owner),
      testId('panel'),
      // Discussion list - actually we are showing first comment of each discussion.
      cssDiscussionPanelList(
        dom.create(MultiThreads, {
          readonly: this._grist.isReadonly,
          gristDoc: this._grist,
          cell: topic,
        })
      ),
      domOnCustom(Comment.SELECT, (ds: CellRec) => {
        this._navigate(ds).catch(() => {});
      })
    );
  }

  public buildMenu(): DomContents {
    return cssPanelHeader(
      dom('span', dom.text(use => t("{{count}} comments", {count: use(this._length)})), testId('comment-count')),
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



function buildAvatar(user: FullUser | null, ...args: DomElementArg[]) {
  return cssAvatar(user, 'small', ...args);
}

function buildNick(user: {name: string} | null, ...args: DomArg<HTMLElement>[]) {
  return cssNick(user?.name ?? 'Anonymous', ...args);
}



// // Helper binding function to handle click outside an element. Takes into account floating menus.
// function onClickOutside(content: HTMLElement, click: () => void) {
//   const onClick = (evt: MouseEvent) => {
//     const target: Node | null = evt.target as Node;
//     if (target && !content.contains(target)) {
//       // Check if any parent of target has class grist-floating-menu, if so, don't close.
//       if (target.parentElement?.closest(".grist-floating-menu")) {
//         return;
//       }
//       click();
//     }
//   };
//   return dom.onElem(document, 'click', onClick, {useCapture: true});
// }

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

const cssCommentPopup = styled('div', `
  width: 350px;
  max-width: min(350px, calc(100vw - 10px));
  max-height: min(600px, calc(100vh - 10px));
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

const cssContentEditable = styled('div', `
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
  overflow: auto;
  &-comment, &-reply {
    min-height: 28px;
    height: 28px;
  }
  &::placeholder {
    color: ${theme.inputPlaceholderFg};
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
  max-height: inherit;
  &:last-child {
    border-bottom: none;
  }
  .${cssTopic.className}-panel & {
    border: 1px solid ${theme.commentsPanelTopicBorder};
    border-radius: 4px;
    background-color: ${theme.commentsPanelTopicBg};
    margin-bottom: 4px;
    overflow: hidden;
  }
`);

const cssDiscussion = styled('div', `
  display: flex;
  flex-direction: column;
  padding: 16px;
  max-height: inherit;
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

const cssRenderedCommentMarkdown = styled(cssMarkdown, `
  color: ${theme.text};
  margin-top: 4px;
  white-space: normal;
  word-break: break-word;
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
  margin-left: 8px;
  & > div + div {
    margin-top: 20px;
  }
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

const cssCommentBodyText = styled('div', `
  flex: 1;
  min-width: 0px;
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
  border-radius: 4px;
  cursor: pointer;
  --icon-color: ${theme.controlFg};
  &.weasel-popup-open {
    background-color: ${theme.iconButtonPrimaryBg};
    --icon-color: ${theme.iconButtonFg};
  }
  &:hover {
    background-color: ${theme.iconButtonPrimaryHoverBg};
    --icon-color: ${theme.iconButtonFg};
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
  overflow: hidden;
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
