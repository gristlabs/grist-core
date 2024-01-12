import BaseView from 'app/client/components/BaseView';
import * as commands from 'app/client/components/commands';
import {allCommands} from 'app/client/components/commands';
import {Cursor} from 'app/client/components/Cursor';
import * as components from 'app/client/components/Forms/elements';
import {Box, BoxModel, BoxType, LayoutModel, parseBox, Place} from 'app/client/components/Forms/Model';
import * as style from 'app/client/components/Forms/styles';
import {GristDoc} from 'app/client/components/GristDoc';
import {copyToClipboard} from 'app/client/lib/clipboardUtils';
import {Disposable} from 'app/client/lib/dispose';
import {AsyncComputed, makeTestId} from 'app/client/lib/domUtils';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {makeT} from 'app/client/lib/localization';
import {localStorageBoolObs} from 'app/client/lib/localStorageObs';
import DataTableModel from 'app/client/models/DataTableModel';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {ShareRec} from 'app/client/models/entities/ShareRec';
import {InsertColOptions} from 'app/client/models/entities/ViewSectionRec';
import {SortedRowSet} from 'app/client/models/rowset';
import {getColumnTypes as getNewColumnTypes} from 'app/client/ui/GridViewMenus';
import {showTransientTooltip} from 'app/client/ui/tooltips';
import {cssButton} from 'app/client/ui2018/buttons';
import {icon} from 'app/client/ui2018/icons';
import * as menus from 'app/client/ui2018/menus';
import {confirmModal} from 'app/client/ui2018/modals';
import {not} from 'app/common/gutil';
import {Events as BackboneEvents} from 'backbone';
import {Computed, dom, Holder, IDisposableOwner, IDomArgs, MultiHolder, Observable} from 'grainjs';
import defaults from 'lodash/defaults';
import isEqual from 'lodash/isEqual';
import {v4 as uuidv4} from 'uuid';

const t = makeT('FormView');

const testId = makeTestId('test-forms-');

export class FormView extends Disposable {
  public viewPane: HTMLElement;
  public gristDoc: GristDoc;
  public viewSection: ViewSectionRec;
  public isEdit: Observable<boolean>;
  public selectedBox: Observable<BoxModel | null>;

  protected sortedRows: SortedRowSet;
  protected tableModel: DataTableModel;
  protected cursor: Cursor;
  protected menuHolder: Holder<any>;
  protected bundle: (clb: () => Promise<void>) => Promise<void>;

  private _autoLayout: Computed<Box>;
  private _root: BoxModel;
  private _savedLayout: any;
  private _saving: boolean = false;
  private _url: Computed<string>;
  private _copyingLink: Observable<boolean>;
  private _pageShare: Computed<ShareRec | null>;
  private _remoteShare: AsyncComputed<{key: string}|null>;
  private _published: Computed<boolean>;
  private _showPublishedMessage: Observable<boolean>;

  public create(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    BaseView.call(this as any, gristDoc, viewSectionModel, {'addNewRow': false});
    this.isEdit = Observable.create(this, true);
    this.menuHolder = Holder.create(this);

    this.bundle = (clb) => this.gristDoc.docData.bundleActions('Saving form layout', clb, {nestInActiveBundle: true});

    this.selectedBox = Observable.create(this, null);

    this.selectedBox.addListener((v) => {
      if (!v) { return; }
      const colRef = Number(v.prop('leaf').get());
      if (!colRef || typeof colRef !== 'number') { return; }
      const fieldIndex = this.viewSection.viewFields().all().findIndex(f => f.getRowId() === colRef);
      if (fieldIndex === -1) { return; }
      this.cursor.setCursorPos({fieldIndex});
    });

    this._autoLayout = Computed.create(this, use => {
      // If the layout is already there, don't do anything.
      const existing = use(this.viewSection.layoutSpecObj);
      if (!existing || !existing.id) {
        // Else create a temporary one.
        const fields = use(use(this.viewSection.viewFields).getObservable());
        const children: Box[] = fields.map(f => {
          return {
            type: 'Field',
            leaf: use(f.id),
          };
        });
        children.push({type: 'Submit'});
        return {
          type: 'Layout',
          children,
        };
      }
      return existing;
    });

    this._root = this.autoDispose(new LayoutModel(this._autoLayout.get(), null, async () => {
      await this._saveNow();
    }, this));

    this._autoLayout.addListener((v) => {
      if (this._saving) {
        console.error('Layout changed while saving');
        return;
      }
      // When the layout has changed, we will update the root, but only when it is not the same
      // as the one we just saved.
      if (isEqual(v, this._savedLayout)) { return; }
      if (this._savedLayout) {
        this._savedLayout = v;
      }
      this._root.update(v);
    });

    const keyboardActions = {
      copy: () => {
        const selected = this.selectedBox.get();
        if (!selected) { return; }
        // Add this box as a json to clipboard.
        const json = selected.toJSON();
        navigator.clipboard.writeText(JSON.stringify({
          ...json,
          id: uuidv4(),
        })).catch(reportError);
      },
      cut: () => {
        const selected = this.selectedBox.get();
        if (!selected) { return; }
        selected.cutSelf().catch(reportError);
      },
      paste: () => {
        const doPast = async () => {
          const boxInClipboard = parseBox(await navigator.clipboard.readText());
          if (!boxInClipboard) { return; }
          if (!this.selectedBox.get()) {
            this.selectedBox.set(this._root.insert(boxInClipboard, 0));
          } else {
            this.selectedBox.set(this.selectedBox.get()!.insertBefore(boxInClipboard));
          }

          // Remove the orginal box from the clipboard.
          const cutted = this._root.find(boxInClipboard.id);
          cutted?.removeSelf();

          await this._root.save();

          await navigator.clipboard.writeText('');
        };
        doPast().catch(reportError);
      },
      nextField: () => {
        const current = this.selectedBox.get();
        const all = [...this._root.list()];
        if (!all.length) { return; }
        if (!current) {
          this.selectedBox.set(all[0]);
        } else {
          const next = all[all.indexOf(current) + 1];
          if (next) {
            this.selectedBox.set(next);
          } else {
            this.selectedBox.set(all[0]);
          }
        }
      },
      prevField: () => {
        const current = this.selectedBox.get();
        const all = [...this._root.list()];
        if (!all.length) { return; }
        if (!current) {
          this.selectedBox.set(all[all.length - 1]);
        } else {
          const next = all[all.indexOf(current) - 1];
          if (next) {
            this.selectedBox.set(next);
          } else {
            this.selectedBox.set(all[all.length - 1]);
          }
        }
      },
      lastField: () => {
        const all = [...this._root.list()];
        if (!all.length) { return; }
        this.selectedBox.set(all[all.length - 1]);
      },
      firstField: () => {
        const all = [...this._root.list()];
        if (!all.length) { return; }
        this.selectedBox.set(all[0]);
      },
      edit: () => {
        const selected = this.selectedBox.get();
        if (!selected) { return; }
        (selected as any)?.edit?.set(true); // TODO: hacky way
      },
      clearValues: () => {
        const selected = this.selectedBox.get();
        if (!selected) { return; }
        keyboardActions.nextField();
        this.bundle(async () => {
          await selected.deleteSelf();
        }).catch(reportError);
      },
      insertFieldBefore: (type: {field: BoxType} | {structure: BoxType}) => {
        const selected = this.selectedBox.get();
        if (!selected) { return; }
        if ('field' in type) {
          this.addNewQuestion(selected.placeBeforeMe(), type.field).catch(reportError);
        } else {
          selected.insertBefore(components.defaultElement(type.structure));
        }
      },
      insertFieldAfter: (type: {field: BoxType} | {structure: BoxType}) => {
        const selected = this.selectedBox.get();
        if (!selected) { return; }
        if ('field' in type) {
          this.addNewQuestion(selected.placeAfterMe(), type.field).catch(reportError);
        } else {
          selected.insertAfter(components.defaultElement(type.structure));
        }
      },
      showColumns: (colIds: string[]) => {
        this.bundle(async () => {
          const boxes: Box[] = [];
          for (const colId of colIds) {
            const fieldRef = await this.viewSection.showColumn(colId);
            const field = this.viewSection.viewFields().all().find(f => f.getRowId() === fieldRef);
            if (!field) { continue; }
            const box = {
              type: field.pureType.peek() as BoxType,
              leaf: fieldRef,
            };
            boxes.push(box);
          }
          boxes.forEach(b => this._root.append(b));
          await this._saveNow();
        }).catch(reportError);
      },
    };
    this.autoDispose(commands.createGroup({
      ...keyboardActions,
      cursorDown: keyboardActions.nextField,
      cursorUp: keyboardActions.prevField,
      cursorLeft: keyboardActions.prevField,
      cursorRight: keyboardActions.nextField,
      shiftDown: keyboardActions.lastField,
      shiftUp: keyboardActions.firstField,
      editField: keyboardActions.edit,
      deleteFields: keyboardActions.clearValues,
    }, this, this.viewSection.hasFocus));

    this._url = Computed.create(this, use => {
      const doc = use(this.gristDoc.docPageModel.currentDoc);
      if (!doc) { return ''; }
      const url = this.gristDoc.app.topAppModel.api.formUrl({
        urlId: doc.id,
        vsId: use(this.viewSection.id),
      });
      return url;
    });

    this._copyingLink = Observable.create(this, false);

    this._pageShare = Computed.create(this, use => {
      const page = use(use(this.viewSection.view).page);
      if (!page) { return null; }
      return use(page.share);
    });

    this._remoteShare = AsyncComputed.create(this, async (use) => {
      const share = use(this._pageShare);
      if (!share) { return null; }
      const remoteShare = await this.gristDoc.docComm.getShare(use(share.linkId));
      return remoteShare ?? null;
    });

    this._published = Computed.create(this, use => {
      const pageShare = use(this._pageShare);
      const remoteShare = use(this._remoteShare) || use(this._remoteShare.dirty);
      const validShare = pageShare && remoteShare;
      if (!validShare) { return false; }

      return use(pageShare.optionsObj.prop('publish')) &&
        use(this.viewSection.shareOptionsObj.prop('publish'));
    });

    const userId = this.gristDoc.app.topAppModel.appObs.get()?.currentUser?.id || 0;
    this._showPublishedMessage = this.autoDispose(localStorageBoolObs(
      `u:${userId};d:${this.gristDoc.docId()};vs:${this.viewSection.id()};formShowPublishedMessage`,
      true
    ));

    // Last line, build the dom.
    this.viewPane = this.autoDispose(this.buildDom());
  }

  public insertColumn(colId?: string | null, options?: InsertColOptions) {
    return this.viewSection.insertColumn(colId, {...options, nestInActiveBundle: true});
  }

  public showColumn(colRef: number|string, index?: number) {
    return this.viewSection.showColumn(colRef, index);
  }

  public buildDom() {
    return dom('div.flexauto.flexvbox',
      style.cssFormEdit.cls('-preview', not(this.isEdit)),
      style.cssFormEdit.cls('', this.isEdit),
      testId('preview', not(this.isEdit)),
      testId('editor', this.isEdit),

      dom.maybe(this.isEdit, () => style.cssFormEditBody(
        style.cssFormContainer(
          dom.forEach(this._root.children, (child) => {
            if (!child) {
              // This shouldn't happen, and it is bad design, as columns allow nulls, where other container
              // don't. But for now, just ignore it.
              return dom('div', 'Empty node');
            }
            const element = this.renderBox(this._root.children, child);
            if (Array.isArray(element)) {
              throw new Error('Element is an array');
            }
            if (!(element instanceof HTMLElement)) {
              throw new Error('Element is not an HTMLElement');
            }
            return element;
          }),
          this.buildDropzone(this, this._root.placeAfterListChild()),
        ),
      )),
      dom.maybe(not(this.isEdit), () => [
        style.cssPreview(
          dom.prop('src', this._url),
        )
      ]),
      this._buildSwitcher(),
      dom.on('click', () => this.selectedBox.set(null))
    );
  }

  public renderBox(owner: IDisposableOwner, box: BoxModel, ...args: IDomArgs<HTMLElement>): HTMLElement {
    const overlay = Observable.create(owner, true);

    return this.buildEditor(owner, {box, overlay},
      dom.domComputedOwned(box.type, (scope, type) => {
        const renderedElement = box.render({overlay});
        const element = renderedElement;
        return dom.update(
          element,
          testId('element'),
          testId(box.type),
          ...args,
        );
      })
    );
  }

  public buildDropzone(owner: IDisposableOwner, insert: Place, ...args: IDomArgs) {
    const dragHover = Observable.create(owner, false);
    const forceShow = Observable.create(owner, false);
    return style.cssAddElement(
      testId('dropzone'),
      style.cssDrag(),
      style.cssAddText(),
      this.buildAddMenu(insert, {
        onOpen: () => forceShow.set(true),
        onClose: () => forceShow.set(false),
      }),
      style.cssAddElement.cls('-hover', use => use(dragHover)),
      // And drop zone handlers
      dom.on('drop', async (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        dragHover.set(false);

        // Get the box that was dropped.
        const dropped = parseBox(ev.dataTransfer!.getData('text/plain'));

        // We need to remove it from the parent, so find it first.
        const droppedId = dropped.id;

        const droppedRef = this._root.find(droppedId);

        await this.bundle(async () => {
          // Save the layout if it is not saved yet.
          await this._saveNow();
          // Remove the orginal box from the clipboard.
          droppedRef?.removeSelf();
          await insert(dropped).onDrop();

          // Save the change.
          await this._saveNow();
        });
      }),
      dom.on('dragover', (ev) => {
        ev.preventDefault();
        ev.dataTransfer!.dropEffect = "move";
        dragHover.set(true);
      }),
      dom.on('dragleave', (ev) => {
        ev.preventDefault();
        dragHover.set(false);
      }),
      style.cssAddElement.cls('-hover', dragHover),
      ...args,
    );
  }

  public buildFieldPanel() {
    return dom('div', 'Hello there');
  }

  public buildEditor(
    owner: IDisposableOwner | null,
    options: {
      box: BoxModel,
      overlay: Observable<boolean>
    }
    ,
    ...args: IDomArgs
  ) {
    const {box, overlay} = options;
    const myOwner = new MultiHolder();
    if (owner) {
      owner.autoDispose(myOwner);
    }

    let element: HTMLElement;
    const dragHover = Observable.create(myOwner, false);

    myOwner.autoDispose(this.selectedBox.addListener(v => {
      if (v !== box) { return; }
      if (!element) { return; }
      element.scrollIntoView({behavior: 'smooth', block: 'center', inline: 'center'});
    }));

    const isSelected = Computed.create(myOwner, use => {
      if (!this.viewSection || this.viewSection.isDisposed()) { return false; }
      if (use(this.selectedBox) === box) {
        // We are only selected when the section is also selected.
        return use(this.viewSection.hasFocus);
      }
      return false;
    });

    return style.cssFieldEditor(
      testId('editor'),
      style.cssDrag(),

      dom.maybe(overlay, () => this.buildOverlay(myOwner, box)),

      owner ? null : dom.autoDispose(myOwner),
      (el) => { element = el; },
      // Control panel
      style.cssControls(
        style.cssControlsLabel(dom.text(box.type)),
      ),

      // Turn on active like state when we clicked here.
      style.cssFieldEditor.cls('-selected', isSelected),
      style.cssFieldEditor.cls('-cut', use => use(box.cut)),
      testId('field-editor-selected', isSelected),

      // Select on click.
      (el) => {
        dom.onElem(el, 'click', (ev) => {
          // Only if the click was in this element.
          const target = ev.target as HTMLElement;
          if (!target.closest) { return; }
          // Make sure that the closest editor is this one.
          const closest = target.closest(`.${style.cssFieldEditor.className}`);
          if (closest !== el) { return; }

          // It looks like we clicked somewhere in this editor, and not inside any other inside.
          this.selectedBox.set(box);
          ev.stopPropagation();
          ev.preventDefault();
          ev.stopImmediatePropagation();
        });
      },

      // Attach menu
      menus.menu((ctl) => {
        this.menuHolder.autoDispose(ctl);
        this.selectedBox.set(box);
        const field = (type: string) => ({field: type});
        const struct = (structure: string) => ({structure});
        const above = (el: {field: string} | {structure: string}) => () => allCommands.insertFieldBefore.run(el);
        const below: typeof above = (el) => () => allCommands.insertFieldAfter.run(el);
        const quick = ['Text', 'Numeric', 'Choice', 'Date'];
        const commonTypes = () => getNewColumnTypes(this.gristDoc, this.viewSection.tableId());
        const isQuick = ({colType}: {colType: string}) => quick.includes(colType);
        const notQuick = ({colType}: {colType: string}) => !quick.includes(colType);
        const insertMenu = (where: typeof above) => () => {
          return [
            menus.menuSubHeader('New question'),
            ...commonTypes()
              .filter(isQuick)
              .map(ct => menus.menuItem(where(field(ct.colType)), menus.menuIcon(ct.icon!), ct.displayName))
            ,
            menus.menuItemSubmenu(
              () => commonTypes()
                .filter(notQuick)
                .map(ct => menus.menuItem(where(field(ct.colType)), menus.menuIcon(ct.icon!), ct.displayName)),
              {},
              menus.menuIcon('Dots'),
              dom('span', "More", dom.style('margin-right', '8px'))
            ),
            menus.menuDivider(),
            menus.menuSubHeader('Static element'),
            menus.menuItem(where(struct('Section')), menus.menuIcon('Page'), "Section",),
            menus.menuItem(where(struct('Columns')), menus.menuIcon('TypeCell'), "Columns"),
            menus.menuItem(where(struct('Paragraph')), menus.menuIcon('Page'), "Paragraph",),
            // menus.menuItem(where(struct('Button')),    menus.menuIcon('Tick'), "Button",  ),
          ];
        };


        return [
          menus.menuItemSubmenu(insertMenu(above), {action: above(field('Text'))}, "Insert question above"),
          menus.menuItemSubmenu(insertMenu(below), {action: below(field('Text'))}, "Insert question below"),
          menus.menuDivider(),
          menus.menuItemCmd(allCommands.contextMenuCopy, "Copy"),
          menus.menuItemCmd(allCommands.contextMenuCut, "Cut"),
          menus.menuItemCmd(allCommands.contextMenuPaste, "Paste"),
          menus.menuDivider(),
          menus.menuItemCmd(allCommands.deleteFields, "Hide"),
        ];
      }, {trigger: ['contextmenu']}),

      dom.on('contextmenu', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      }),

      // And now drag and drop support.
      {draggable: "true"},

      // When started, we just put the box into the dataTransfer as a plain text.
      // TODO: this might be very sofisticated in the future.
      dom.on('dragstart', (ev) => {
        // Prevent propagation, as we might be in a nested editor.
        ev.stopPropagation();
        ev.dataTransfer?.setData('text/plain', JSON.stringify(box.toJSON()));
        ev.dataTransfer!.dropEffect = "move";
      }),

      dom.on('dragover', (ev) => {
        // As usual, prevent propagation.
        ev.stopPropagation();
        ev.preventDefault();
        // Here we just change the style of the element.
        ev.dataTransfer!.dropEffect = "move";
        dragHover.set(true);
      }),

      dom.on('dragleave', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        // Just remove the style and stop propagation.
        dragHover.set(false);
      }),

      dom.on('drop', async (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        dragHover.set(false);
        const dropped = parseBox(ev.dataTransfer!.getData('text/plain'));
        // We need to remove it from the parent, so find it first.
        const droppedId = dropped.id;
        if (droppedId === box.id) { return; }
        const droppedRef = this._root.find(droppedId);
        await this.bundle(async () => {
          await this._root.save();
          droppedRef?.removeSelf();
          await box.drop(dropped)?.onDrop();
          await this._saveNow();
        });
      }),

      style.cssFieldEditor.cls('-drag-hover', dragHover),

      ...args,
    );
  }

  public buildOverlay(owner: IDisposableOwner, box: BoxModel) {
    return style.cssSelectedOverlay(
    );
  }

  public async addNewQuestion(insert: Place, type: string) {
    await this.gristDoc.docData.bundleActions(`Saving form layout`, async () => {
      // First save the layout, so that
      await this._saveNow();
      // Now that the layout is saved, we won't be bottered with autogenerated layout,
      // and we can safely insert to column.
      const {fieldRef} = await this.insertColumn(null, {
        colInfo: {
          type,
        }
      });

      // And add it into the layout.
      this.selectedBox.set(insert({
        leaf: fieldRef,
        type: 'Field'
      }));

      await this._root.save();
    }, {nestInActiveBundle: true});
  }

  public buildAddMenu(insert: Place, {
    onClose: onClose = () => {},
    onOpen: onOpen = () => {},
    customItems = [] as Element[],
  } = {}) {
    return menus.menu(
      (ctl) => {
        onOpen();
        ctl.onDispose(onClose);

        const field = (colType: BoxType) => ({field: colType});
        const struct = (structure: BoxType) => ({structure});
        const where = (el: {field: string} | {structure: BoxType}) => () => {
          if ('field' in el) {
            return this.addNewQuestion(insert, el.field);
          } else {
            insert(components.defaultElement(el.structure));
            return this._root.save();
          }
        };
        const quick = ['Text', 'Numeric', 'Choice', 'Date'];
        const commonTypes = () => getNewColumnTypes(this.gristDoc, this.viewSection.tableId());
        const isQuick = ({colType}: {colType: string}) => quick.includes(colType);
        const notQuick = ({colType}: {colType: string}) => !quick.includes(colType);
        return [
          menus.menuSubHeader('New question'),
          ...commonTypes()
            .filter(isQuick)
            .map(ct => menus.menuItem(where(field(ct.colType as BoxType)), menus.menuIcon(ct.icon!), ct.displayName))
          ,
          menus.menuItemSubmenu(
            () => commonTypes()
              .filter(notQuick)
              .map(ct => menus.menuItem(where(field(ct.colType as BoxType)), menus.menuIcon(ct.icon!), ct.displayName)),
            {},
            menus.menuIcon('Dots'),
            dom('span', "More", dom.style('margin-right', '8px'))
          ),
          menus.menuDivider(),
          menus.menuSubHeader('Static element'),
          menus.menuItem(where(struct('Section')), menus.menuIcon('Page'), "Section",),
          menus.menuItem(where(struct('Columns')), menus.menuIcon('TypeCell'), "Columns"),
          menus.menuItem(where(struct('Paragraph')), menus.menuIcon('Page'), "Paragraph",),
          // menus.menuItem(where(struct('Button')),    menus.menuIcon('Tick'), "Button",  ),
          elem => void FocusLayer.create(ctl, {defaultFocusElem: elem, pauseMousetrap: true}),
          customItems.length ? menus.menuDivider(dom.style('min-width', '200px')) : null,
          ...customItems,
        ];
      },
      {
        selectOnOpen: true,
        trigger: [
          'click',
        ],
      }
    );
  }

  private async _saveNow() {
    try {
      this._saving = true;
      const newVersion = {...this._root.toJSON()};
      // If nothing has changed, don't bother.
      if (isEqual(newVersion, this._savedLayout)) { return; }
      this._savedLayout = newVersion;
      await this.viewSection.layoutSpecObj.setAndSave(newVersion);
    } finally {
      this._saving = false;
    }
  }

  private async _publish() {
    confirmModal(t('Publish your form?'),
      t('Publish'),
      async () => {
        await this.gristDoc.docModel.docData.bundleActions('Publish form', async () => {
          const page = this.viewSection.view().page();
          if (!page) {
            throw new Error('Unable to publish form: undefined page');
          }

          if (page.shareRef() === 0) {
            const shareRef = await this.gristDoc.docModel.docData.sendAction([
              'AddRecord',
              '_grist_Shares',
              null,
              {
                linkId: uuidv4(),
                options: JSON.stringify({
                  publish: true,
                }),
              }
            ]);
            await this.gristDoc.docModel.docData.sendAction(['UpdateRecord', '_grist_Pages', page.id(), {shareRef}]);
          } else {
            const share = page.share();
            share.optionsObj.update({publish: true});
            await share.optionsObj.save();
          }

          this.viewSection.shareOptionsObj.update({
            form: true,
            publish: true,
          });
          await this.viewSection.shareOptionsObj.save();
        });
      },
      {
        explanation: (
          dom('div',
            style.cssParagraph(
              t(
                'Publishing your form will generate a share link. Anyone with the link can ' +
                'see the empty form and submit a response.'
              ),
            ),
            style.cssParagraph(
              t(
                'Users are limited to submitting ' +
                'entries (records in your table) and reading pre-set values in designated ' +
                'fields, such as reference and choice columns.'
              ),
            ),
          )
        ),
      },
    );
  }

  private async _unpublish() {
    confirmModal(t('Unpublish your form?'),
      t('Unpublish'),
      async () => {
        await this.gristDoc.docModel.docData.bundleActions('Unpublish form', async () => {
          this.viewSection.shareOptionsObj.update({
            publish: false,
          });
          await this.viewSection.shareOptionsObj.save();

          const view = this.viewSection.view();
          if (view.viewSections().peek().every(vs => !vs.shareOptionsObj.prop('publish')())) {
            const share = this._pageShare.get();
            if (!share) { return; }

            share.optionsObj.update({
              publish: false,
            });
            await share.optionsObj.save();
          }
        });
      },
      {
        explanation: (
          dom('div',
            style.cssParagraph(
              t(
                'Unpublishing the form will disable the share link so that users accessing ' +
                'your form via that link will see an error.'
              ),
            ),
          )
        ),
      },
    );
  }
  private _buildSwitcher() {

    const toggle = (val: boolean) => () => {
      this.isEdit.set(val);
      this._saveNow().catch(reportError);
    };

    return style.cssSwitcher(
      this._buildSwitcherMessage(),
      style.cssButtonGroup(
        style.cssIconButton(
          icon('Pencil'),
          testId('edit'),
          dom('div', 'Editor'),
          cssButton.cls('-primary', this.isEdit),
          style.cssIconButton.cls('-standard', not(this.isEdit)),
          dom.on('click', toggle(true))
        ),
        style.cssIconButton(
          icon('EyeShow'),
          dom('div', 'Preview'),
          testId('preview'),
          cssButton.cls('-primary', not(this.isEdit)),
          style.cssIconButton.cls('-standard', (this.isEdit)),
          dom.on('click', toggle(false))
        ),
        style.cssIconButton(
          icon('FieldAttachment'),
          testId('link'),
          dom('div', 'Copy Link'),
          dom.prop('disabled', this._copyingLink),
          dom.show(use => this.gristDoc.appModel.isOwner() && use(this._published)),
          dom.on('click', async (_event, element) => {
            try {
              this._copyingLink.set(true);
              const share = this._pageShare.get();
              if (!share) {
                throw new Error('Unable to copy link: form is not published');
              }

              const remoteShare = await this.gristDoc.docComm.getShare(share.linkId());
              if (!remoteShare) {
                throw new Error('Unable to copy link: form is not published');
              }

              const url = this.gristDoc.app.topAppModel.api.formUrl({
                shareKey:remoteShare.key,
                vsId: this.viewSection.id(),
              });
              await copyToClipboard(url);
              showTransientTooltip(element, 'Link copied to clipboard', {key: 'copy-form-link'});
            } finally {
              this._copyingLink.set(false);
            }
          }),
        ),
        dom.domComputed(this._published, published => {
          return published
            ? style.cssIconButton(
              dom('div', 'Unpublish'),
              dom.show(this.gristDoc.appModel.isOwner()),
              style.cssIconButton.cls('-warning'),
              dom.on('click', () => this._unpublish()),
              testId('unpublish'),
            )
            : style.cssIconButton(
              dom('div', 'Publish'),
              dom.show(this.gristDoc.appModel.isOwner()),
              cssButton.cls('-primary'),
              dom.on('click', () => this._publish()),
              testId('publish'),
            );
        }),
      ),
    );
  }

  private _buildSwitcherMessage() {
    return dom.maybe(use => use(this._published) && use(this._showPublishedMessage), () => {
      return style.cssSwitcherMessage(
        style.cssSwitcherMessageBody(
          t(
            'Your form is published. Every change is live and visible to users ' +
            'with access to the form. If you want to make changes in draft, unpublish the form.'
          ),
        ),
        style.cssSwitcherMessageDismissButton(
          icon('CrossSmall'),
          dom.on('click', () => {
            this._showPublishedMessage.set(false);
          }),
        ),
        dom.show(this.gristDoc.appModel.isOwner()),
      );
    });
  }
}

// Getting an ES6 class to work with old-style multiple base classes takes a little hacking. Credits: ./ChartView.ts
defaults(FormView.prototype, BaseView.prototype);
Object.assign(FormView.prototype, BackboneEvents);
