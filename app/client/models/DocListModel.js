var koArray = require('../lib/koArray');
var dispose = require('../lib/dispose');
var _ = require('underscore');
var BackboneEvents = require('backbone').Events;
var {pageHasDocList} = require('app/common/urlUtils');

/**
 * Constructor for DocListModel
 * @param {Object} comm: A map of server methods availble on this document.
 */
function DocListModel(app) {
  this.app = app;
  this.comm = this.app.comm;
  this.docs = koArray();
  this.docInvites = koArray();

  if (pageHasDocList()) {
    this.listenTo(this.comm, 'docListAction', this.docListActionHandler);
    this.listenTo(this.comm, 'receiveInvites', () => this.refreshDocList());

    // Initialize the DocListModel
    this.refreshDocList();
  } else {
    console.log("Page has no DocList support");
  }
}
dispose.makeDisposable(DocListModel);
_.extend(DocListModel.prototype, BackboneEvents);

/**
 * Rebuilds DocListModel with a direct call to the server.
 */
DocListModel.prototype.refreshDocList = function() {
  return this.comm.getDocList()
    .then(docListObj => {
      this.docs.assign(docListObj.docs);
      this.docInvites.assign(docListObj.docInvites);
    })
    .catch((err) => {
      console.error('Failed to load DocListModel: %s', err);
    });
};

/**
 * Updates the DocListModel docs and docInvites arrays in response to docListAction events
 * @param {Object} message: A docListAction message received from the server.
 */
DocListModel.prototype.docListActionHandler = function(message) {
  console.log('docListActionHandler message', message);
  if (message && message.data) {
    _.each(message.data.addDocs, this.addDoc, this);
    _.each(message.data.removeDocs, this.removeDoc, this);
    _.each(message.data.changeDocs, this.changeDoc, this);
    _.each(message.data.addInvites, this.addInvite, this);
    _.each(message.data.removeInvites, this.removeInvite, this);
    // DocListModel can ignore rename events since renames also broadcast add/remove events.
  } else {
    console.error('Unrecognized message', message);
  }
};

DocListModel.prototype._removeAtIndex = function(collection, index) {
  collection.splice(index, 1);
};

DocListModel.prototype._removeItem = function(collection, name) {
  var index = this._findItem(collection, name);
  if (index !== -1) {
    this._removeAtIndex(collection, index);
  }
};

// Binary search is disabled in _.indexOf because the docs may not be sorted by name.
DocListModel.prototype._findItem = function(collection, name) {
  var matchIndex = _.indexOf(collection.all().map(item => item.name), name, false);
  if (matchIndex === -1) {
    console.error('DocListModel does not contain name:', name);
  }
  return matchIndex;
};

DocListModel.prototype.removeDoc = function(name) {
  this._removeItem(this.docs, name);
};

// TODO: removeInvite is unused
DocListModel.prototype.removeInvite = function(name) {
  this._removeItem(this.docInvites, name);
};

DocListModel.prototype._addItem = function(collection, fileObj) {
  var insertIndex = _.sortedIndex(collection.all(), fileObj, 'name');
  this._addItemAtIndex(collection, insertIndex, fileObj);
};

DocListModel.prototype._addItemAtIndex = function(collection, index, fileObj) {
  collection.splice(index, 0, fileObj);
};

DocListModel.prototype.addDoc = function(fileObj) {
  this._addItem(this.docs, fileObj);
};

// TODO: addInvite is unused
DocListModel.prototype.addInvite = function(fileObj) {
  this._addItem(this.docInvites, fileObj);
};

// Called when the metadata for a doc changes.
DocListModel.prototype.changeDoc = function(fileObj) {
  let idx = this._findItem(this.docs, fileObj.name);
  if (idx !== -1) {
    this._removeAtIndex(this.docs, idx);
    this._addItem(this.docs, fileObj);
  }
};

module.exports = DocListModel;
