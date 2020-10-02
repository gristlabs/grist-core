/* global window, $ */

const bluebird  = require('bluebird');
const _         = require('underscore');
const ko        = require('knockout');
const BackboneEvents = require('backbone').Events;

const gutil     = require('app/common/gutil');
const version   = require('app/common/version');

const dispose   = require('../lib/dispose');
const dom       = require('../lib/dom');
const kd        = require('../lib/koDom');
const koSession = require('../lib/koSession');
const {IMPORTABLE_EXTENSIONS, selectFiles} = require('../lib/uploads');

const commands  = require('./commands');
const {urlState} = require('app/client/models/gristUrlState');
const {showConfirmDialog} = require('./Confirm');

const sortByFuncs = {
  'name':  (a, b) => a.localeCompare(b),
  'mtime': (a, b) => gutil.nativeCompare(a, b),
  'size':  (a, b) => gutil.nativeCompare(a, b)
};

function DocList(app) {
  this.app = app;
  this.docListModel = app.docListModel;
  this.docs = app.docListModel.docs;
  this._docInvites = app.docListModel.docInvites;

  // Default sort is by modified time in descending order
  // TODO: This would be better yet as a user preference, since this still resets to default for
  // each browser window.
  this.sortBy = koSession.sessionValue('docListSortBy', 'mtime');
  this.sortAsc = koSession.sessionValue('docListSortDir', -1); // 1 for asc, -1 for desc

  let compareFunc = this.autoDispose(ko.computed(() => {
    let attrib = this.sortBy();
    let asc = this.sortAsc();
    let compareFunc = sortByFuncs[attrib];
    return (a, b) => gutil.nativeCompare(a.tag, b.tag) || compareFunc(a[attrib], b[attrib]) * asc;
  }));
  this.sortedDocs = this.autoDispose(ko.computed(() =>
    this.docs.all().sort(compareFunc())).extend({rateLimit: 0}));

  this.docListModel.refreshDocList();

  this.autoDispose(this.app.login.isLoggedIn.subscribe(loggedIn => {
    // Refresh the doc list to show/hide docs and invites belonging to the logged in user.
    this.docListModel.refreshDocList();
  }));
}
dispose.makeDisposable(DocList);
_.extend(DocList.prototype, BackboneEvents);

// TODO: Factor out common code from DocList and NavBar (e.g. status indicator)
DocList.prototype.buildDom = function() {
  let currentStatus = ko.observable('OK');

  this.listenTo(this.app.comm, 'connectionStatus', (message, status) => {
    console.warn('connectionStatus', message, status);
    currentStatus(status);
  });

  return this.autoDispose(
    dom('div.start-doclist.flexhbox',
      dom('section.doclist-section.section-sidepane-wrapper.flexvbox',
        parts.sidepane.header(() => this.docListModel.refreshDocList()),
        parts.sidepane.connection(currentStatus),
        dom('div.section-sidepane.b-actions.flexnone.flexvbox',
          kd.maybe(() => this.app.features().signin, () =>
            dom('div',
              parts.sidepane.loginButton(this.app.login),
              dom('div.mod-doclist__sidepane.el-divider')
            )
          ),
          parts.sidepane.createDocButton(this.createNewDoc.bind(this)),
          window.electronOpenDialog ? parts.sidepane.openDocButton() : null,
          parts.sidepane.uploadDocButton(this.uploadNewDoc.bind(this))
        ),
        dom('div.flexitem'),
        parts.sidepane.footer(commands.allCommands.help.run)),
      dom('section.doclist-section.section-doclist-wrapper.flexitem', this._buildDoclistBody())));
};

DocList.prototype._buildDoclistBody = function() {
  return dom('div.section-doclist',
    dom('div.doclist-header.flexhbox',
      dom('div.doclist-column.doclist-column__name.mod-header.flexitem', 'Name',
        parts.doclist.ascDescArrow(this.sortBy, this.sortAsc, 'name'),
        dom.on('click', () => updateSort(this.sortBy, this.sortAsc, 'name'))),
      dom('div.doclist-column.doclist-column__size', 'Size',
        parts.doclist.ascDescArrow(this.sortBy, this.sortAsc, 'size'),
        dom.on('click', () => updateSort(this.sortBy, this.sortAsc, 'size'))),
      dom('div.doclist-column.doclist-column__modified', 'Modified',
        parts.doclist.ascDescArrow(this.sortBy, this.sortAsc, 'mtime'),
        dom.on('click', () => updateSort(this.sortBy, this.sortAsc, 'mtime'))),
      dom('div.doclist-column.doclist-column__delete')
    ),
    dom('div.doclist-body-wrapper',
      dom('div.doclist-body',
        kd.scope(this.sortedDocs, docs =>
          docs.map(docObj => parts.doclist.listDoc(docObj, this._onClickItem.bind(this),
            this._confirmRemoveDoc.bind(this)))),
        kd.foreach(this._docInvites, inviteObj =>
          parts.doclist.listInvite(inviteObj, this._downloadSharedDoc.bind(this),
            this._confirmDeclineInvite.bind(this))))));
};

const parts = {

  sidepane: {

    connection: (statusObs) =>
      dom('div.section-sidepane.b-status.flexhbox',
        dom('div.gnotifier', kd.cssClass(() => 'g-status-' + statusObs())),
        dom('span', 'Connection: '),
        kd.text(statusObs)),

    header: (headerCommand) =>
      dom('div.header-actions',
        dom('div.header-actions-logo', // Logo set in css
          {title: `Ver ${version.version} (${version.gitcommit})`},
          dom.on('click', headerCommand))),

    footer: (helpCommand) =>
      dom('div.footer-actions.flexvbox',
        dom('a.doclist-link', { href: 'help', target: '_blank' }, 'Help'),
        dom('a.doclist-link', { href: 'help/contact-us', target: '_blank'}, 'Contact'),
        dom('a.doclist-link', { href: 'https://www.getgrist.com', target: '_blank'}, 'About')),

    loginButton: (login) =>
      dom('div.g-btn.mod-doclist__sidepane.el-login',
        dom.testId('DocList_login'),
        kd.toggleClass('fit-text', () => login.isLoggedIn()),
        kd.text(login.buttonText),
        dom.on('click', e => { login.onClick(e); })),

    createDocButton: createNewDoc =>
      dom('div.g-btn.mod-doclist__sidepane.el-createdoc',
        dom.testId('DocList_createDoc'),
        'Create document',
        dom.on('click', createNewDoc)),

    uploadDocButton: uploadNewDoc => {
      let uploadStatusIcons = {
        'uploading': 'glyphicon-upload',
        'success': 'glyphicon-ok-sign',
        'error': 'glyphicon-exclamation-sign'
      };
      let uploadStatus = ko.observable(null);

      let uploadBar;
      let uploadProgress = percentage => uploadBar.style.width = percentage + '%';

      return dom('div.g-btn.mod-doclist__sidepane.el-uploaddoc',
        dom.testId('DocList_uploadBtn'),
        uploadBar = dom('div.el-uploaddoc__bar',
          kd.show(uploadStatus),
          dom('span.glyphicon.glyphicon-upload',
            kd.cssClass(() => uploadStatusIcons[uploadStatus()])
          )
        ),
        dom('span',
          kd.style('visibility', () => uploadStatus() === null ? 'visible' : 'hidden'),
          'Import document'
        ),
        dom.on('click', () => uploadNewDoc(uploadStatus, uploadProgress))
      );
    },

    openDocButton: () => dom('div.g-btn.mod-doclist__sidepane.el-uploaddoc',
      dom('span', 'Open document'),
      dom.on('click', window.electronOpenDialog)
    ),
  },

  doclist: {

    ascDescArrow: (sortBy, sortAsc, attrib) =>
      dom('span', kd.text(() => sortBy() === attrib ? (sortAsc() > 0 ? '▲' : '▼') : '')),

    listDoc: (docObj, onClick, onDelete) => {
      let mtime = new Date(docObj.mtime);
      return dom('div.doclist-row.flexhbox',
        kd.toggleClass('doclist-sample', docObj.tag === 'sample'),
        dom('div.doclist-column.doclist-column__name.flexitem',
          dom('span.glyphicon.glyphicon-file.mod-doclist-column'),
          dom('a', {
              href: urlState().makeUrl({doc: docObj.name})
            },
            kd.toggleClass('doclist-sample', docObj.tag === 'sample'),
            docObj.tag ? `[${gutil.capitalize(docObj.tag)}] ` : null,
            docObj.name,
            dom.on('click', (ev) => onClick(ev, docObj))
          )
        ),
        dom('div.doclist-column.doclist-column__size', gutil.byteString(docObj.size)),
        dom('div.doclist-column.doclist-column__modified',
          mtime.toLocaleDateString() + ' ' + mtime.toLocaleTimeString()),
        // Show a downlink link for each file in the hosted version, but not in the electron version.
        window.isRunningUnderElectron ? null : dom('div.doclist-column.doclist-column__download.glyphicon.glyphicon-download-alt',
          dom('a.doclist-download_link', {
            href: 'download?' + $.param({doc: docObj.name}),
            download: `${docObj.name}.grist`
          })
        ),
        dom('div.doclist-column.doclist-column__delete.glyphicon.glyphicon-trash',
          dom.on('click', () => onDelete(docObj.name))));
    },

    listInvite: (docObj, onDownload, onDecline) => {
      const name = docObj.senderName;
      const email = docObj.senderEmail;
      return dom('div.doclist-row.doclist-invite.flexhbox',
        dom('div.flexhbox.doclist-invite-top-row',
          dom('div.doclist-column.doclist-column__name.flexitem',
            dom('span.glyphicon.glyphicon-download-alt.mod-doclist-column'),
            dom.on('click', () => onDownload(docObj)),
            '[Invite] ',
            docObj.name
          ),
          dom('div.doclist-column.doclist-column__size'),
          dom('div.doclist-column.doclist-column__modified'),
          dom('div.doclist-column.doclist-column__delete.glyphicon.glyphicon-remove',
            dom.on('click', () => onDecline(docObj)))
        ),
        dom('div.flexhbox.doclist-invite-bottom-row', 'Sent by: ' + (name ? `${name} (${email})` : email))
      );
    }
  }
};

DocList.prototype._downloadSharedDoc = function(docObj) {
  return this.app.comm.downloadSharedDoc(docObj.docId, docObj.name)
  .then(() => this.docListModel.refreshDocList());
};

DocList.prototype._confirmDeclineInvite = function(docObj) {
  showConfirmDialog(`Ignore invite to ${docObj.name}?`, 'Ignore', () => this._ignoreInvite(docObj));
};

DocList.prototype._confirmRemoveDoc = function(docName) {
  if (window.isRunningUnderElectron) {
    showConfirmDialog(`Move ${docName} to trash?`, 'Move to trash', () => this.app.comm.deleteDoc(docName, false));
  } else {
    showConfirmDialog(`Delete ${docName} permanently?`, 'Delete', () => this.app.comm.deleteDoc(docName, true));
  }
};

DocList.prototype._ignoreInvite = function(docObj) {
  return this.app.comm.ignoreLocalInvite(docObj.docId)
  .then(() => this.docListModel.refreshDocList());
};

// commands useable while title is active
DocList.fileEditorCommands = {
  accept: function() { this.finishEditingFileName(true); },
  cancel: function() { this.finishEditingFileName(false); },
};

DocList.prototype.createNewDoc = function(source, event) {
  return this.app.comm.createNewDoc()
  .then(docName => urlState().pushUrl({doc: docName}, {avoidReload: true}))
  .catch(err => console.error(err));
};

DocList.prototype._onClickItem = function(ev, docObj) {
  ev.preventDefault();
  if (docObj.tag === 'sample') {
    // Note that we don't expect this to fail, so an error will show up in the NotifyBox.
    this.app.comm.importSampleDoc(docObj.name)
    .then(docName => urlState().pushUrl({doc: docName}, {avoidReload: true}));
    return false;
  }
  // To avoid a page reload, we handle the change of url.  Previously we used fragments,
  // so the browser knew there was no page change going on.  Now, we are using real urls
  // and we have to hold the browser's hand.
  urlState().pushUrl({doc: docObj.name}, {avoidReload: true});
  return false;
};

DocList.prototype.uploadNewDoc = function(uploadStatus, uploadProgress) {
  function progress(percent) {
    // We use one progress bar to combine the time to upload and the time to import in 40%-60%
    // split. TODO The second part needs to be done; currently it stops at 40%, but at least the
    // user can tell that there is still something to wait for.
    const p = percent * 0.4;
    uploadProgress(p);
    if (p > 0) { uploadStatus('uploading'); }
  }
  return bluebird.try(() => {
    return selectFiles({multiple: true, extensions: IMPORTABLE_EXTENSIONS},
                       progress);
  })
  .then(uploadResult => {
    // Put together a text summary of what got uploaded, currently only for debugging.
    const summaryList = uploadResult.files.map(f => `${f.origName} (${f.size})`);
    console.log('Upload summary:', summaryList.join(", "));
    // TODO: This step should include its own progress callback, and the progress indicator should
    // combine the two steps, e.g. in 40%-60% split.
    return this.app.comm.importDoc(uploadResult.uploadId);
  })
  .then(docName => {
    uploadStatus('success');
    return bluebird.delay(500)     // Let the user see the OK icon briefly.
    .then(() => urlState().pushUrl({doc: docName}, {avoidReload: true}));
  })
  .catch(err => {
    console.error("Upload failed: %s", err);
    uploadStatus('error');
    return bluebird.delay(2000);   // Let the user see the error icon.
  })
  .finally(() => {
    uploadStatus(null);
  });
};

function updateSort(sortObs, sortAsc, sortValue) {
  let currSort = sortObs();
  if (currSort === sortValue) {
    sortAsc(-1 * sortAsc());
  } else {
    sortObs(sortValue);
    sortAsc(1);
  }
}

module.exports = DocList;
