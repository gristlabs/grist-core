import BaseView from 'app/client/components/BaseView';
import * as commands from 'app/client/components/commands';
import {Cursor} from 'app/client/components/Cursor';
import {FormLayoutNode, FormLayoutNodeType, patchLayoutSpec} from 'app/client/components/FormRenderer';
import * as components from 'app/client/components/Forms/elements';
import {NewBox} from 'app/client/components/Forms/Menu';
import {BoxModel, LayoutModel, parseBox, Place} from 'app/client/components/Forms/Model';
import * as style from 'app/client/components/Forms/styles';
import {GristDoc} from 'app/client/components/GristDoc';
import {copyToClipboard} from 'app/client/lib/clipboardUtils';
import {Disposable} from 'app/client/lib/dispose';
import {AsyncComputed, makeTestId, stopEvent} from 'app/client/lib/domUtils';
import {makeT} from 'app/client/lib/localization';
import {localStorageBoolObs} from 'app/client/lib/localStorageObs';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import DataTableModel from 'app/client/models/DataTableModel';
import {ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {ShareRec} from 'app/client/models/entities/ShareRec';
import {InsertColOptions} from 'app/client/models/entities/ViewSectionRec';
import {docUrl, urlState} from 'app/client/models/gristUrlState';
import {SortedRowSet} from 'app/client/models/rowset';
import {hoverTooltip, showTransientTooltip} from 'app/client/ui/tooltips';
import {cssButton} from 'app/client/ui2018/buttons';
import {icon} from 'app/client/ui2018/icons';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {menuCssClass} from 'app/client/ui2018/menus';
import {confirmModal} from 'app/client/ui2018/modals';
import {INITIAL_FIELDS_COUNT} from 'app/common/Forms';
import {isOwner} from 'app/common/roles';
import {Events as BackboneEvents} from 'backbone';
import {Computed, dom, Holder, IDomArgs, MultiHolder, Observable} from 'grainjs';
import defaults from 'lodash/defaults';
import isEqual from 'lodash/isEqual';
import {v4 as uuidv4} from 'uuid';
import * as ko from 'knockout';
import {defaultMenuOptions, IOpenController, setPopupToCreateDom} from 'popweasel';

const t = makeT('FormView');

const testId = makeTestId('test-forms-');

export class FormView extends Disposable {
  public viewPane: HTMLElement;
  public gristDoc: GristDoc;
  public viewSection: ViewSectionRec;
  public selectedBox: Computed<BoxModel | null>;
  public selectedColumns: ko.Computed<ViewFieldRec[]>|null;
  public disableDeleteSection: Computed<boolean>;

  protected sortedRows: SortedRowSet;
  protected tableModel: DataTableModel;
  protected cursor: Cursor;
  protected menuHolder: Holder<any>;
  protected bundle: (clb: () => Promise<void>) => Promise<void>;

  private _formFields: Computed<ViewFieldRec[]>;
  private _autoLayout: Computed<FormLayoutNode>;
  private _root: BoxModel;
  private _savedLayout: any;
  private _saving: boolean = false;
  private _previewUrl: Computed<string>;
  private _pageShare: Computed<ShareRec | null>;
  private _remoteShare: AsyncComputed<{key: string}|null>;
  private _isFork: Computed<boolean>;
  private _published: Computed<boolean>;
  private _showPublishedMessage: Observable<boolean>;
  private _isOwner: boolean;
  private _openingForm: Observable<boolean>;
  private _formElement: HTMLElement;

  public create(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    BaseView.call(this as any, gristDoc, viewSectionModel, {'addNewRow': false});
    this.menuHolder = Holder.create(this);

    // We will store selected box here.
    const selectedBox = Observable.create(this, null as BoxModel|null);

    // But we will guard it with a computed, so that if box is disposed we will clear it.
    this.selectedBox = Computed.create(this, use => use(selectedBox));

    // Prepare scope for the method calls.
    const holder = Holder.create(this);

    this.selectedBox.onWrite((box) => {
      // Create new scope and dispose the previous one (using holder).
      const scope = MultiHolder.create(holder);
      if (!box) {
        selectedBox.set(null);
        return;
      }
      if (box.isDisposed()) {
        throw new Error('Box is disposed');
      }
      selectedBox.set(box);

      // Now subscribe to the new box, if it is disposed, remove it from the selected box.
      // Note that the dispose listener itself is disposed when the box is switched as we don't
      // care anymore for this event if the box is switched.
      scope.autoDispose(box.onDispose(() => {
        if (selectedBox.get() === box) {
          selectedBox.set(null);
        }
      }));
    });

    this.bundle = (clb) => this.gristDoc.docData.bundleActions('Saving form layout', clb, {nestInActiveBundle: true});


    this.selectedBox.addListener((v) => {
      if (!v) { return; }
      const colRef = Number(v.prop('leaf').get());
      if (!colRef || typeof colRef !== 'number') { return; }
      const fieldIndex = this.viewSection.viewFields().all().findIndex(f => f.getRowId() === colRef);
      if (fieldIndex === -1) { return; }
      this.cursor.setCursorPos({fieldIndex});
    });

    this.selectedColumns = this.autoDispose(ko.pureComputed(() => {
      const result = this.viewSection.viewFields().all().filter((field, index) => {
        // During column removal or restoring (with undo), some columns fields
        // might be disposed.
        if (field.isDisposed() || field.column().isDisposed()) { return false; }
        return this.cursor.currentPosition().fieldIndex === index;
      });
      return result;
    }));

    // Wire up selected fields to the cursor.
    this.autoDispose(this.selectedColumns.subscribe((columns) => {
      this.viewSection.selectedFields(columns);
    }));
    this.viewSection.selectedFields(this.selectedColumns.peek());

    this._formFields = Computed.create(this, use => {
      const fields = use(use(this.viewSection.viewFields).getObservable());
      return fields.filter(f => use(use(f.column).isFormCol));
    });

    this._autoLayout = Computed.create(this, use => {
      const fields = use(this._formFields);
      const layout = use(this.viewSection.layoutSpecObj);
      if (!layout || !layout.id) {
        return this._formTemplate(fields);
      } else {
        const patchedLayout = patchLayoutSpec(layout, new Set(fields.map(f => f.id())));
        if (!patchedLayout) { throw new Error('Invalid form layout spec'); }

        return patchedLayout;
      }
    });

    this._root = this.autoDispose(new LayoutModel(this._autoLayout.get(), null, async (clb?: () => Promise<void>) => {
      await this.bundle(async () => {
        // If the box is autogenerated we need to save it first.
        if (!this.viewSection.layoutSpecObj.peek()?.id) {
          await this.save();
        }
        if (clb) {
          await clb();
        }
        await this.save();
      });
    }, this));

    this._autoLayout.addListener((v) => {
      if (this._saving) {
        console.warn('Layout changed while saving');
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
        selected.copySelf().catch(reportError);
      },
      cut: () => {
        const selected = this.selectedBox.get();
        if (!selected) { return; }
        selected.cutSelf().catch(reportError);
      },
      paste: () => {
        const doPaste = async () => {
          const boxInClipboard = parseBox(await navigator.clipboard.readText());
          if (!boxInClipboard) { return; }
          if (!this.selectedBox.get()) {
            this.selectedBox.set(this._root.insert(boxInClipboard, 0));
          } else {
            this.selectedBox.set(this.selectedBox.get()!.insertBefore(boxInClipboard));
          }
          const maybeCutBox = this._root.find(boxInClipboard.id);
          if (maybeCutBox?.cut.get()) {
            maybeCutBox.removeSelf();
          }
          await this._root.save();
          await navigator.clipboard.writeText('');
        };
        doPaste().catch(reportError);
      },
      nextField: () => {
        const current = this.selectedBox.get();
        const all = [...this._root.traverse()];
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
        const all = [...this._root.traverse()];
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
        const all = [...this._root.traverse()];
        if (!all.length) { return; }
        this.selectedBox.set(all[all.length - 1]);
      },
      firstField: () => {
        const all = [...this._root.traverse()];
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
        if (!selected || selected.canRemove?.() === false) { return; }
        keyboardActions.nextField();
        this.bundle(async () => {
          await selected.deleteSelf();
        }).catch(reportError);
      },
      hideFields: (colId: [string]) => {
        // Get the ref from colId.
        const existing: Array<[number, string]> =
          this.viewSection.viewFields().all().map(f => [f.id(), f.column().colId()]);
        const ref = existing.filter(([_, c]) => colId.includes(c)).map(([r, _]) => r);
        if (!ref.length) { return; }
        const box = Array.from(this._root.filter(b => ref.includes(b.prop('leaf')?.get())));
        box.forEach(b => b.removeSelf());
        this._root.save(async () => {
          await this.viewSection.removeField(ref);
        }).catch(reportError);
      },
      insertFieldBefore: (what: NewBox) => {
        const selected = this.selectedBox.get();
        if (!selected) { return; }
        if ('add' in what || 'show' in what) {
          this.addNewQuestion(selected.placeBeforeMe(), what).catch(reportError);
        } else {
          selected.insertBefore(components.defaultElement(what.structure));
          this.save().catch(reportError);
        }
      },
      insertField: (what: NewBox) => {
        const selected = this.selectedBox.get();
        if (!selected) { return; }
        const place = selected.placeAfterListChild();
        if ('add' in what || 'show' in what) {
          this.addNewQuestion(place, what).catch(reportError);
        } else {
          place(components.defaultElement(what.structure));
          this.save().catch(reportError);
        }
      },
      insertFieldAfter: (what: NewBox) => {
        const selected = this.selectedBox.get();
        if (!selected) { return; }
        if ('add' in what || 'show' in what) {
          this.addNewQuestion(selected.placeAfterMe(), what).catch(reportError);
        } else {
          selected.insertAfter(components.defaultElement(what.structure));
          this.save().catch(reportError);
        }
      },
      showColumns: (colIds: string[]) => {
        // Sanity check that type is correct.
        if (!colIds.every(c => typeof c === 'string')) { throw new Error('Invalid column id'); }
        this._root.save(async () => {
          const boxes: FormLayoutNode[] = [];
          for (const colId of colIds) {
            const fieldRef = await this.viewSection.showColumn(colId);
            const field = this.viewSection.viewFields().all().find(f => f.getRowId() === fieldRef);
            if (!field) { continue; }
            const box = {
              id: uuidv4(),
              leaf: fieldRef,
              type: 'Field' as FormLayoutNodeType,
            };
            boxes.push(box);
          }
          // Add to selected or last section, or root.
          const selected = this.selectedBox.get();
          if (selected instanceof components.SectionModel) {
            boxes.forEach(b => selected.append(b));
          } else {
            const topLevel = this._root.kids().reverse().find(b => b instanceof components.SectionModel);
            if (topLevel) {
              boxes.forEach(b => topLevel.append(b));
            } else {
              boxes.forEach(b => this._root.append(b));
            }
          }
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
      hideFields: keyboardActions.hideFields,
    }, this, this.viewSection.hasFocus));

    this._previewUrl = Computed.create(this, use => {
      const doc = use(this.gristDoc.docPageModel.currentDoc);
      if (!doc) { return ''; }
      const url = urlState().makeUrl({
        ...docUrl(doc),
        form: {
          vsId: use(this.viewSection.id),
        },
      });
      return url;
    });

    this._pageShare = Computed.create(this, use => {
      const page = use(use(this.viewSection.view).page);
      if (!page) { return null; }
      return use(page.share);
    });

    this._remoteShare = AsyncComputed.create(this, async (use) => {
      const share = use(this._pageShare);
      if (!share) { return null; }
      try {
        const remoteShare = await this.gristDoc.docComm.getShare(use(share.linkId));
        return remoteShare ?? null;
      } catch(ex) {
        // TODO: for now ignore the error, but the UI should be updated to not show editor
        // for non owners.
        if (ex.code === 'AUTH_NO_OWNER') { return null; }
        throw ex;
      }
    });

    this._isFork = Computed.create(this, use => {
      const {docPageModel} = this.gristDoc;
      return use(docPageModel.isFork) || use(docPageModel.isPrefork);
    });

    this._published = Computed.create(this, use => {
      const isFork = use(this._isFork);
      if (isFork) { return false; }

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

    this._isOwner = isOwner(this.gristDoc.docPageModel.currentDoc.get());

    this._openingForm = Observable.create(this, false);

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
    return style.cssFormView(
      testId('editor'),
      style.cssFormEditBody(
        style.cssFormContainer(
          this._formElement = dom('div', dom.forEach(this._root.children, (child) => {
            if (!child) {
              return dom('div', 'Empty node');
            }
            const element = child.render();
            if (!(element instanceof Node)) {
              throw new Error('Element is not an HTMLElement');
            }
            return element;
          })),
          this._buildPublisher(),
        ),
      ),
      dom.on('click', () => this.selectedBox.set(null)),
      dom.maybe(this.gristDoc.docPageModel.isReadonly, () => style.cssFormDisabledOverlay()),
    );
  }

  public buildOverlay(...args: IDomArgs) {
    return style.cssSelectedOverlay(
      ...args,
    );
  }

  public async addNewQuestion(insert: Place, action: {add: string}|{show: string}) {
    await this.gristDoc.docData.bundleActions(`Saving form layout`, async () => {
      // First save the layout, so that we don't have autogenerated layout.
      await this.save();
      // Now that the layout is saved, we won't be bothered with autogenerated layout,
      // and we can safely insert to column.
      let fieldRef = 0;
      if ('show' in action) {
        fieldRef = await this.showColumn(action.show);
      } else {
        const result = await this.insertColumn(null, {
          colInfo: {
            type: action.add,
          }
        });
        fieldRef = result.fieldRef;
      }
      // And add it into the layout.
      this.selectedBox.set(insert({
        id: uuidv4(),
        leaf: fieldRef,
        type: 'Field'
      }));
      await this._root.save();
    }, {nestInActiveBundle: true});
  }

  public async save() {
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

  private async _handleClickPublish() {
    if (this.gristDoc.appModel.dismissedPopups.get().includes('publishForm')) {
      await this._publishForm();
    } else {
      confirmModal(t('Publish your form?'),
        t('Publish'),
        async (dontShowAgain) => {
          await this._publishForm();
          if (dontShowAgain) {
            this.gristDoc.appModel.dismissPopup('publishForm', true);
          }
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
          hideDontShowAgain: false,
        },
      );
    }
  }

  private async _publishForm() {
    const page = this.viewSection.view().page();
    if (!page) {
      throw new Error('Unable to publish form: undefined page');
    }
    let validShare = page.shareRef() !== 0;
    // If page is shared, make sure home server is aware of it.
    if (validShare) {
      try {
      const pageShare = page.share();
      const serverShare = await this.gristDoc.docComm.getShare(pageShare.linkId());
      validShare = !!serverShare;
      } catch(ex) {
        // TODO: for now ignore the error, but the UI should be updated to not show editor
        if (ex.code === 'AUTH_NO_OWNER') {
          return;
        }
        throw ex;
      }
    }

    logTelemetryEvent('publishedForm', {
      full: {
        docIdDigest: this.gristDoc.docId(),
      },
    });

    await this.gristDoc.docModel.docData.bundleActions('Publish form', async () => {
      if (!validShare) {
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

      await this.save();
      this.viewSection.shareOptionsObj.update({
        form: true,
        publish: true,
      });
      await this.viewSection.shareOptionsObj.save();
    });
  }

  private async _handleClickUnpublish() {
    if (this.gristDoc.appModel.dismissedPopups.get().includes('unpublishForm')) {
      await this._unpublishForm();
    } else {
      confirmModal(t('Unpublish your form?'),
        t('Unpublish'),
        async (dontShowAgain) => {
          await this._unpublishForm();
          if (dontShowAgain) {
            this.gristDoc.appModel.dismissPopup('unpublishForm', true);
          }
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
          hideDontShowAgain: false,
        },
      );
    }
  }

  private async _unpublishForm() {
    logTelemetryEvent('unpublishedForm', {
      full: {
        docIdDigest: this.gristDoc.docId(),
      },
    });

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
  }

  private _buildPublisher() {
    return style.cssSwitcher(
      this._buildNotifications(),
      style.cssButtonGroup(
        style.cssSmallButton(
          style.cssSmallButton.cls('-frameless'),
          icon('Revert'),
          testId('reset'),
          dom('div', t('Reset form')),
          dom.style('visibility', use => use(this._published) ? 'hidden' : 'visible'),
          dom.style('margin-right', 'auto'), // move it to the left
          dom.on('click', () => {
            return confirmModal(t('Are you sure you want to reset your form?'),
              t('Reset'),
              () => this._resetForm(),
            );
          })
        ),
        dom.domComputed(this._published, published => {
          if (published) {
            return style.cssSmallButton(
              testId('view'),
              icon('EyeShow'),
              t('View'),
              dom.boolAttr('disabled', this._openingForm),
              dom.on('click', async (ev) => {
                // If this form is not yet saved, we will save it first.
                if (!this._savedLayout) {
                  await this.save();
                }

                try {
                  this._openingForm.set(true);
                  window.open(await this._getFormUrl());
                } finally {
                  this._openingForm.set(false);
                }
              })
            );
          } else {
            return style.cssSmallLinkButton(
              testId('preview'),
              icon('EyeShow'),
              t('Preview'),
              dom.attr('href', this._previewUrl),
              dom.prop('target', '_blank'),
              dom.on('click', async (ev) => {
                // If this form is not yet saved, we will save it first.
                if (!this._savedLayout) {
                  stopEvent(ev);
                  await this.save();
                  window.open(this._previewUrl.get());
                }
              })
            );
          }
        }),
        style.cssSmallButton(
          icon('Share'),
          testId('share'),
          dom('div', t('Share')),
          dom.show(use => this._isOwner && use(this._published)),
          elem => {
            setPopupToCreateDom(elem, ctl => this._buildShareMenu(ctl), {
              ...defaultMenuOptions,
              placement: 'top-end',
            });
          },
        ),
        dom.domComputed(use => {
          const isFork = use(this._isFork);
          const published = use(this._published);
          return published
            ? style.cssSmallButton(
              dom('div', t('Unpublish')),
              dom.show(this._isOwner),
              style.cssSmallButton.cls('-warning'),
              dom.on('click', () => this._handleClickUnpublish()),
              testId('unpublish'),
            )
            : style.cssSmallButton(
              dom('div', t('Publish')),
              dom.boolAttr('disabled', isFork),
              !isFork ? null : hoverTooltip(t('Save your document to publish this form.'), {
                placement: 'top',
              }),
              dom.show(this._isOwner),
              cssButton.cls('-primary'),
              dom.on('click', () => this._handleClickPublish()),
              testId('publish'),
            );
        }),
      ),
    );
  }

  private async _getFormUrl() {
    const share = this._pageShare.get();
    if (!share) {
      throw new Error('Unable to get form link: form is not published');
    }

    const remoteShare = await this.gristDoc.docComm.getShare(share.linkId());
    if (!remoteShare) {
      throw new Error('Unable to get form link: form is not published');
    }

    return urlState().makeUrl({
      doc: undefined,
      form: {
        shareKey: remoteShare.key,
        vsId: this.viewSection.id(),
      },
    });
  }

  private _buildShareMenu(ctl: IOpenController) {
    const formUrl = Observable.create<string | null>(ctl, null);
    const showEmbedCode = Observable.create(this, false);
    const embedCode = Computed.create(ctl, formUrl, (_use, url) => {
      if (!url) { return null; }

      return '<iframe style="border: none; width: 640px; ' +
        `height: ${this._getEstimatedFormHeightPx()}px" src="${url}"></iframe>`;
    });

    // Reposition the popup when its height changes.
    ctl.autoDispose(formUrl.addListener(() => ctl.update()));
    ctl.autoDispose(showEmbedCode.addListener(() => ctl.update()));

    this._getFormUrl()
    .then((url) => {
      if (ctl.isDisposed()) { return; }

      formUrl.set(url);
    })
    .catch((e) => {
      ctl.close();
      reportError(e);
    });

    return style.cssShareMenu(
      dom.cls(menuCssClass),
        style.cssShareMenuHeader(
          style.cssShareMenuCloseButton(
            icon('CrossBig'),
            dom.on('click', () => ctl.close()),
          ),
        ),
        style.cssShareMenuBody(
        dom.domComputed(use => {
          const url = use(formUrl);
          const code = use(embedCode);
          if (!url || !code) {
            return style.cssShareMenuSpinner(loadingSpinner());
          }

          return [
            dom('div',
              style.cssShareMenuSectionHeading(
                t('Share this form'),
              ),
              dom('div',
                style.cssShareMenuHintText(
                  t('Anyone with the link below can see the empty form and submit a response.'),
                ),
                style.cssShareMenuUrlBlock(
                  style.cssShareMenuUrl(
                    {readonly: true, value: url},
                    dom.on('click', (_ev, el) => { setTimeout(() => el.select(), 0); }),
                  ),
                  style.cssShareMenuCopyButton(
                    testId('link'),
                    t('Copy link'),
                    dom.on('click', async (_ev, el) => {
                      await copyToClipboard(url);
                      showTransientTooltip(
                        el,
                        t('Link copied to clipboard'),
                        {key: 'share-form-menu'}
                      );
                    })
                  ),
                ),
              ),
            ),
            dom.domComputed(showEmbedCode, (showCode) => {
              if (!showCode) {
                return dom('div',
                  style.cssShareMenuEmbedFormButton(
                    t('Embed this form'),
                    dom.on('click', () => showEmbedCode.set(true)),
                  )
                );
              } else {
                return dom('div',
                  style.cssShareMenuSectionHeading(t('Embed this form')),
                  dom.maybe(showEmbedCode, () => style.cssShareMenuCodeBlock(
                    style.cssShareMenuCode(
                      code,
                      {readonly: true, rows: '3'},
                      dom.on('click', (_ev, el) => { setTimeout(() => el.select(), 0); }),
                    ),
                    style.cssShareMenuCodeBlockButtons(
                      style.cssShareMenuCopyButton(
                        testId('code'),
                        t('Copy code'),
                        dom.on('click', async (_ev, el) => {
                          await copyToClipboard(code);
                          showTransientTooltip(
                            el,
                            t('Code copied to clipboard'),
                            {key: 'share-form-menu'}
                          );
                        }),
                      ),
                    ),
                  )),
                );
              }
            }),
          ];
        }),
      ),
    );
  }

  private _getEstimatedFormHeightPx() {
    return (
      // Form content height.
      this._formElement.scrollHeight +
      // Plus top/bottom page padding.
      (2 * 52) +
      // Plus top/bottom form padding.
      (2 * 20) +
      // Plus minimum form error height.
      38 +
      // Plus form footer height.
      64
    );
  }

  private _buildNotifications() {
    return [
      this._buildFormPublishedNotification(),
    ];
  }

  private _buildFormPublishedNotification() {
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
        dom.show(this._isOwner),
      );
    });
  }

  /**
   * Generates a form template based on the fields in the view section.
   */
  private _formTemplate(fields: ViewFieldRec[]): FormLayoutNode {
    const boxes: FormLayoutNode[] = fields.map(f => {
      return {
        id: uuidv4(),
        type: 'Field',
        leaf: f.id(),
      };
    });
    const section = components.Section(...boxes);
    return {
      id: uuidv4(),
      type: 'Layout',
      children: [
        {id: uuidv4(), type: 'Paragraph', text: FORM_TITLE, alignment: 'center', },
        {id: uuidv4(), type: 'Paragraph', text: FORM_DESC, alignment: 'center', },
        section,
        {id: uuidv4(), type: 'Submit'},
      ],
    };
  }

  private async _resetForm() {
    this.selectedBox.set(null);
    await this.gristDoc.docData.bundleActions('Reset form', async () => {
      // First we will remove all fields from this section, and add top 9 back.
      const toDelete = this.viewSection.viewFields().all().map(f => f.getRowId());

      const toAdd = this.viewSection.table().columns().peek()
        .filter(c => c.isFormCol())
        .sort((a, b) => a.parentPos() - b.parentPos());

      const colRef = toAdd.slice(0, INITIAL_FIELDS_COUNT).map(c => c.id());
      const parentId = colRef.map(() => this.viewSection.id());
      const parentPos = colRef.map((_, i) => i + 1);
      const ids = colRef.map(() => null);

      await this.gristDoc.docData.sendActions([
        ['BulkRemoveRecord', '_grist_Views_section_field', toDelete],
        ['BulkAddRecord', '_grist_Views_section_field', ids, {
          colRef,
          parentId,
          parentPos,
        }],
      ]);

      const fields = this.viewSection.viewFields().all().slice(0, 9);
      await this.viewSection.layoutSpecObj.setAndSave(this._formTemplate(fields));
    });
  }
}

// Getting an ES6 class to work with old-style multiple base classes takes a little hacking. Credits: ./ChartView.ts
defaults(FormView.prototype, BaseView.prototype);
Object.assign(FormView.prototype, BackboneEvents);

// Default values when form is reset.
const FORM_TITLE = "## **Form Title**";
const FORM_DESC = "Your form description goes here.";
