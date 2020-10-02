// External dependencies
const _                     = require('underscore');
const ko                    = require('knockout');
const BackboneEvents        = require('backbone').Events;

// Grist client libs
const dispose               = require('../lib/dispose');
const dom                   = require('../lib/dom');
const kd                    = require('../lib/koDom');
const kf                    = require('../lib/koForm');
const ModalDialog           = require('./ModalDialog');
const gutil                 = require('app/common/gutil');

const BASE_URL = 'https://syvvdfor2a.execute-api.us-east-1.amazonaws.com/test';

/**
 * EmbedForm - Handles logic and dom for the modal embedding instruction box.
 */
function EmbedForm(gristDoc) {
  this._docComm = gristDoc.docComm;
  this._login = gristDoc.app.login;
  this._basketId = gristDoc.docInfo.basketId;
  this._tableIds = gristDoc.docModel.allTableIds.peek().sort();

  // Arrays of published and unpublished tables, initialized in this._refreshTables()
  this._published = ko.observable([]);
  this._unpublished = ko.observable([]);

  // Notify strings which are displayed to the user when set
  this._errorNotify = ko.observable();
  this._updateNotify = ko.observable();

  // The state of initialization, either 'connecting', 'failed', or 'done'.
  this._initState = ko.observable('connecting');

  this._embedDialog = this.autoDispose(ModalDialog.create({
    title: 'Upload for External Embedding',
    body: this._buildEmbedDom(),
    width: '420px'
  }));
  this._embedDialog.show();

  this.listenTo(this._embedDialog, 'close', () => this.dispose());

  // Perform the initial fetch to see which tables are published.
  this._initFetch();
}
_.extend(EmbedForm.prototype, BackboneEvents);
dispose.makeDisposable(EmbedForm);

/**
 * Performs the initial fetch to see which tables are published.
 * Times out after 4 seconds, giving the user the option to retry.
 */
EmbedForm.prototype._initFetch = function() {
  this._initState('connecting');
  return this._refreshTables()
  .timeout(4000)
  .then(() => {
    this._initState('done');
  })
  .catch(err => {
    console.error("EmbedForm._initFetch failed", err);
    this._initState('failed');
  });
};

/**
 * Calls on basket to see which tables are published, then updates the published
 * and unpublished local observables.
 */
EmbedForm.prototype._refreshTables = function() {
  // Fetch the tables from the basket
  return this._login.getBasketTables(this._docComm)
  .then(basketTableIds => {
    let published = [];
    let unpublished = [];
    gutil.sortedScan(this._tableIds, basketTableIds.sort(), (local, cloud) => {
      let item = {
        tableId: local || cloud,
        local: Boolean(local),
        cloud: Boolean(cloud)
      };
      if (cloud) {
        published.push(item);
      } else {
        unpublished.push(item);
      }
    });
    this._published(published);
    this._unpublished(unpublished);
  });
};

/**
 * Builds the part of the form showing the table names and their status, and
 * the buttons to change their status.
 */
EmbedForm.prototype._buildTablesDom = function() {
  return dom('div.embed-form-tables',
    kd.scope(this._published, published => {
      return published.length > 0 ? dom('div.embed-form-published',
        dom('div.embed-form-desc', `Published to Basket (basketId: ${this._basketId()})`),
        published.map(t => {
          return kf.row(
            16, dom('a.embed-form-table-id', { href: this._getUrl(t.tableId), target: "_blank" },
              t.tableId),
            8, t.local ? this._makeButton('Update', t.tableId, 'update') : 'Only in Basket',
            1, dom('div'),
            2, this._makeButton('x', t.tableId, 'delete')
          );
        })
      ) : null;
    }),
    dom('div.embed-form-unpublished',
      kd.scope(this._unpublished, unpublished => {
        return unpublished.map(t => {
          return kf.row(
            16, dom('span.embed-form-table-id', t.tableId),
            8, this._makeButton('Publish', t.tableId, 'add'),
            3, dom('div')
          );
        });
      })
    )
  );
};

/**
 * Builds the body of the table publishing modal form.
 */
EmbedForm.prototype._buildEmbedDom = function() {
  // TODO: Include links to the npm page and to download basket-api.js.
  return dom('div.embed-form',
    kd.scope(this._initState, state => {
      switch (state) {
        case 'connecting':
          return dom('div.embed-form-connect', 'Connecting...');
        case 'failed':
          return dom('div',
            dom('div.embed-form-connect', 'Connection to Basket failed'),
            kf.buttonGroup(
              kf.button(() => {
                this._initFetch();
              }, 'Retry')
            )
          );
        case 'done':
          return dom('div',
            dom('div.embed-form-desc', 'Manage tables published to the cloud via Grist Basket.'),
            dom('div.embed-form-desc', 'Note that by default, published tables are public.'),
            this._buildTablesDom(),
            dom('div.embed-form-desc', 'Basket is used to provide easy access to cloud-synced data:'),
            dom('div.embed-form-link',
              dom('a', { href: 'https://github.com/gristlabs/basket-api', target: "_blank" },
                'Basket API on GitHub')
            )
          );
      }
    }),
    kd.maybe(this._updateNotify, update => {
      return dom('div.login-success-notify',
        dom('div.login-success-text', update)
      );
    }),
    kd.maybe(this._errorNotify, err => {
      return dom('div.login-error-notify',
        dom('div.login-error-text', err)
      );
    })
  );
};

// Helper to perform embedAction ('add' | 'update' | 'delete') on tableId.
EmbedForm.prototype._embedTable = function(tableId, embedAction) {
  this._errorNotify('');
  this._updateNotify('');
  return this._docComm.embedTable(tableId, embedAction)
  .then(() => {
    return this._refreshTables();
  })
  .then(() => {
    if (embedAction === 'update') {
      this._updateNotify(`Updated table ${tableId}`);
    }
  })
  .catch(err => {
    this._errorNotify(err.message);
  });
};

// Helper to make a button with text, that when pressed performs embedAction
//  ('add' | 'update' | 'delete') on tableId.
EmbedForm.prototype._makeButton = function(text, tableId, embedAction) {
  return kf.buttonGroup(
    kf.button(() => this._embedTable(tableId, embedAction), text)
  );
};

// Returns the URL to see the hosted data for tableId.
EmbedForm.prototype._getUrl = function(tableId) {
  return `${BASE_URL}/${this._basketId()}/tables/${tableId}`;
};

module.exports = EmbedForm;
