
/**
 * CodeEditorPanel.ts
 *
 * Renders the "Code View" panel in Grist for displaying the schema of the current document.
 * Uses highlight.js to provide syntax highlighting for Python-style Grist schema output.
 *
 * 🔧 MOD DMH — May 2025:
 * - Adds alphabetical sorting of @grist.UserTable blocks by class name for improved readability
 * - Replaces `this._schema.set(schema)` with custom sort logic
 * - Marked with `// MOD DMH` and `// end MOD DMH` for traceability
 */

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

        // 🔧 Custom Patch: Alphabetical sorting of @grist.UserTable blocks in schema view.
        // 📅 Applied: 2025-05-05
        // This improves readability by grouping schema definitions and sorting them alphabetically
        // by the class name line within each block.
        // Version: v0.3

        /*
        // 💤 Original line (now replaced):
        this._schema.set(schema);
        */

        // MOD DMH - 🔧 [Custom Patch] Sort @grist.UserTable blocks alphabetically by class name
        const lines = schema.split("\n");
        const blocks: string[][] = [];
        let current: string[] = [];
        for (const line of lines) {
          if (line.startsWith("@grist.UserTable")) {
            if (current.length) {
              blocks.push(current);
            }
            current = [line];
          } else {
            current.push(line);
          }
        }
        if (current.length) { blocks.push(current); }
        const sorted = blocks.sort((a, b) => {
          const nameA = a.find(l => {
            return l.trim().startsWith("class");
          }) ?? "";
          const nameB = b.find(l => {
            return l.trim().startsWith("class");
          }) ?? "";
          return nameA.localeCompare(nameB);
        });
        const pretty = sorted.map(b => b.join("\n")).join("\n\n");
        console.log("[Custom Patch] CodeEditorPanel.ts ✅ Sorted @grist.UserTable blocks by class name (v0.3)");
        this._schema.set(pretty);

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
