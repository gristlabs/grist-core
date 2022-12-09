import {GristDoc} from 'app/client/components/GristDoc';
import {reportError} from 'app/client/models/errors';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {dom, Observable} from 'grainjs';
import {makeT} from 'app/client/lib/localization';

// Rather than require the whole of highlight.js, require just the core with the one language we
// need, to keep our bundle smaller and the build faster.
const hljs           = require('highlight.js/lib/core');
hljs.registerLanguage('python', require('highlight.js/lib/languages/python'));

const t = makeT('CodeEditorPanel');

export class CodeEditorPanel extends DisposableWithEvents {
  private _schema = Observable.create(this, '');
  private _denied = Observable.create(this, false);
  constructor(private _gristDoc: GristDoc) {
    super();
    this.listenTo(_gristDoc, 'schemaUpdateAction', this._onSchemaAction.bind(this));
    this._onSchemaAction().catch(reportError); // Fetch the schema to initialize
  }

  public buildDom() {
    // The tabIndex enables the element to gain focus, and the .clipboard class prevents the
    // Clipboard module from re-grabbing it. This is a quick fix for the issue where clipboard
    // interferes with text selection. TODO it should be possible for the Clipboard to never
    // interfere with text selection even for un-focusable elements.
    return dom('div.g-code-panel.clipboard',
      {tabIndex: "-1"},
      dom.maybe(this._denied, () => dom('div.g-code-panel-denied',
        dom('h2', dom.text(t("Access denied"))),
        dom('div', dom.text(t("Code View is available only when you have full document access."))),
      )),
      dom.maybe(this._schema, (schema) => {
        // The reason to scope and rebuild instead of using `kd.text(schema)` is because
        // hljs.highlightBlock(elem) replaces `elem` with a whole new dom tree.
        const elem = dom('code.g-code-viewer',
          dom.text(schema),
          dom.hide(true)
        );
        setTimeout(() => {
          hljs.highlightBlock(elem);
          dom.showElem(elem, true);
        });
        return elem;
      })
    );
  }

  private async _onSchemaAction() {
    try {
      const schema = await this._gristDoc.docComm.fetchTableSchema();
      if (!this.isDisposed()) {
        this._schema.set(schema);
        this._denied.set(false);
      }
    } catch (err) {
      if (!String(err).match(/Cannot view code/)) {
        throw err;
      }
      if (!this.isDisposed()) {
        this._schema.set('');
        this._denied.set(true);
      }
    }
  }
}
