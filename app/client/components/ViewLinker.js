var _ = require('underscore');
var ko = require('knockout');
var gutil = require('app/common/gutil');
var dispose = require('../lib/dispose');
var dom = require('../lib/dom');
var kd = require('../lib/koDom');
var commands = require('./commands');

/**
 * Use the browser globals in a way that allows replacing them with mocks in tests.
 */
var G = require('../lib/browserGlobals').get('window', 'document', '$');


//----------------------------------------------------------------------
function ViewLinkerNode(section, column, tableId, primaryTableId) {
  this.section = section;
  this.sectionRef = section ? section.getRowId() : 0;
  this.col = column;
  this.colRef = column ? column.getRowId() : 0;
  this.tableId = tableId;
  this.primaryTableId = primaryTableId;
  this.nodeId = this.sectionRef + ':' + this.colRef;    // Uniquely identifies the node.
  this.linkIconDom = null;
}

ViewLinkerNode.prototype.isLinked = function() {
  return this.section && this.section.activeLinkSrcSectionRef() &&
    this.section.activeLinkTargetColRef() === this.colRef;
};

ViewLinkerNode.prototype.isValidLinkTo = function(targetNode) {
  let tablesMatch = (this.tableId === targetNode.tableId ||
    (this.primaryTableId === targetNode.primaryTableId && !this.col && !targetNode.col));

  // There are table-to-table links (cursor sync), table-to-column (filter), column-to-table
  // (cursor), and column-to-column (filter).

  // The table must match.
  if (!tablesMatch) { return false; }

  // The target must not be already linked.
  if (targetNode.section && targetNode.section.activeLinkSrcSectionRef()) {
    return false;
  }

  if (this.section) {
    // The link must not create a cycle.
    for (let sec = this.section; sec.getRowId(); sec = sec.linkSrcSection()) {
      if (targetNode.sectionRef === sec.getRowId()) {
        return false;
      }
    }
  }
  return true;
};


ViewLinkerNode.prototype.linkCoord = function() {
  var rect = this.linkIconDom.getBoundingClientRect();
  return {
    left: rect.left + rect.width / 2,
    top: rect.top + rect.height / 2
  };
};

//----------------------------------------------------------------------

/**
 * ViewLinker - Builds GUI for linking viewSections in viewModel
 */
function ViewLinker(viewModel) {
  this.viewModel = viewModel;
  this.viewSections = this.viewModel.viewSections().all();

  this.clicked = ko.observable(null);

  // For each section, the pair (section, colRef) represents a linkable node for every reference
  // column, and for colRef 0 (which corresponds to the special "id" column, or the table itself).
  this.allNodes = [];
  for (let section of this.viewSections) {
    this.allNodes.push(...ViewLinker.createNodes(section, section.table()));
  }
  this.nodesBySection = _.groupBy(this.allNodes, 'sectionRef');
  this.nodesById = _.indexBy(this.allNodes, 'nodeId');

  // A list of coordinate data objects for coordinates in no particular order.
  this.coordinates = null;

  this.boundMouseMove = this.handleMouseMove.bind(this);
  this.boundWindowResize = this.handleWindowResize.bind(this);

  this.autoDisposeCallback(function() {
    G.$(G.window).off('mousemove', this.boundMouseMove);
    G.$(G.window).off('resize', this.boundWindowResize);
  });

  this.canvas = this.autoDispose(dom('canvas.linker_canvas'));
  this.buttons = this.autoDispose(
    dom('div.linker_save_btns',
      dom('div.linker_btn', 'Apply',
        dom.on('click', () => {
          this.viewModel.isLinking(false);
        })
      ),
      dom('div.linker_btn', 'Apply & Save',
        dom.on('click', () => {
          commands.allCommands.saveLinks.run();
          this.viewModel.isLinking(false);
        })
      ),
      dom('div.linker_btn', 'Cancel',
        dom.on('click', () => {
          commands.allCommands.revertLinks.run();
          this.viewModel.isLinking(false);
        })
      )
    )
  );
  dom.id('grist-app').appendChild(this.canvas);
  dom.id('view_content').appendChild(this.buttons);
  this.ctx = this.canvas.getContext("2d");

  // Must monitor link values and redraw arrows on changes since undo-ing/redo-ing may
  // affect them.
  this.autoDispose(ko.computed(() => {
    for (let section of this.viewSections) {
      section.linkSrcSectionRef();
      section.linkSrcColRef();
      section.linkTargetColRef();
    }
    setTimeout(this.resetArrows.bind(this), 0);
  }));
  G.$(G.window).on('resize', this.boundWindowResize);

  this.handleWindowResize();
}
dispose.makeDisposable(ViewLinker);

ViewLinker.createNodes = function(section, table) {
  const nodes = [];
  nodes.push(new ViewLinkerNode(section, null, table.tableId(),
                                table.primaryTableId()));
  for (let column of table.columns().peek()) {
    let tableId = gutil.removePrefix(column.type(), "Ref:");
    if (tableId) {
      nodes.push(new ViewLinkerNode(section, column, tableId));
    }
  }
  return nodes;
};

// Fills coordinates object with values and re-renders canvas.
ViewLinker.prototype.resetArrows = function() {
  this.resetCoordinates();
  this.redrawArrows();
};

ViewLinker.prototype.onClickNode = function(event, node) {
  if (!this.clicked()) {
    this.clicked(node);
    G.$(G.window).on('mousemove', this.boundMouseMove);
  } else {
    this.connectLink(node);
    this.clicked(null);
    G.$(G.window).off('mousemove', this.boundMouseMove);
  }
};

ViewLinker.prototype.onClickBackground = function(event) {
  if (this.clicked()) {
    this.clicked(null);
    G.$(G.window).off('mousemove', this.boundMouseMove);
    this.redrawArrows();
  } else {
    this.viewModel.isLinking(false);
  }
};

ViewLinker.prototype.handleMouseMove = function(event) {
  this.redrawArrows();
  let coord = this.clicked().linkCoord();
  drawArrow(this.ctx, coord.left, coord.top, event.clientX, event.clientY);
  this.ctx.stroke();
};

ViewLinker.prototype.handleWindowResize = function(event) {
  // Canvas must be scaled up in a particular way for improved resolution.
  var w = G.$(G.window);
  var windowWidth = w.innerWidth();
  var windowHeight = w.innerHeight();
  this.ctx.canvas.style.width = windowWidth + 'px';
  this.ctx.canvas.style.height = windowHeight + 'px';
  this.ctx.canvas.width = windowWidth * 2;
  this.ctx.canvas.height = windowHeight * 2;
  this.ctx.scale(2, 2);
  setTimeout(this.resetArrows.bind(this), 0);
};

// To be called by each viewSection when the ViewLinker is active.
ViewLinker.prototype.buildLeafDom = function(viewSection) {
  var sectionRef = viewSection.getRowId();
  var mainNode = this.nodesById[sectionRef + ':0'];
  var sectionNodes = this.nodesBySection[sectionRef];
  var getOtherSections = () => this.clicked() && this.clicked().sectionRef !== sectionRef;

  return dom('div.g_record_layout_linking',
    dom.on('click', event => { this.onClickBackground(event); }),
    dom('div.linker_box',
      dom('div.linker_box_section',
        dom('div.linker_box_header', 'Scroll',
          kd.toggleClass('visible', getOtherSections)
        ),
        this.buildLinkRowDom(viewSection, mainNode)
      ),
      dom('div.linker_box_columns',
        dom('div.linker_box_header', 'Filter',
          kd.toggleClass('visible', () => getOtherSections() && sectionNodes.length > 1)
        ),
        this.nodesBySection[sectionRef].map(node => {
          if (!node.col) { return null; }
          return this.buildLinkRowDom(viewSection, node);
        })
      )
    )
  );
};

ViewLinker.prototype.buildLinkRowDom = function(viewSection, node) {
  var sectionRef = viewSection.getRowId();
  var tableId = viewSection.table().tableTitle();

  var isAvailable = ko.computed(() => (this.clicked() ?
    this.clicked().isValidLinkTo(node) :
    // See if there are any nodes this could possibly link to.
    this.allNodes.some(tgt => node.isValidLinkTo(tgt))
  ));

  return dom('div.section_link.section_link_' + sectionRef,
    dom.autoDispose(isAvailable),
    // Prevents closing on link mode when clicking in link boxes.
    dom.on('click', event => { event.stopPropagation(); }),
    dom('span.view_link.link_' + sectionRef + (node.col ? '_' + node.col.getRowId() : ''),
      dom.on('click', event => {
        if (isAvailable()) { this.onClickNode(event, node); }
      }),
      node.linkIconDom =
        dom('span.glyphicon.glyphicon-link.view_link_icon',
          // Use 'visibility' rather than 'display', to keep size and position available.
          kd.style('visibility', () => isAvailable() ? 'visible' : 'hidden'),
          kd.toggleClass('selected_link', () => (node.isLinked() || this.clicked() === node))
      )
    ),
    dom('span.link_text', tableId + (node.col ? '.' + node.col.colId() : ''),
      kd.toggleClass('available_text', isAvailable),
      kd.toggleClass('selected_text', () => node.isLinked()),
      dom('span.glyphicon.glyphicon-remove.remove_link_icon',
        kd.style('visibility', () =>
          (node.isLinked() && !this.clicked() ? 'visible' : 'hidden')),
        dom.on('click', () => this.removeNodeLinks(node))
      )
    )
  );
};

// Initializes the coordinates array with linked node coordinates.
ViewLinker.prototype.resetCoordinates = function() {
  this.coordinates = [];
  for (let vs of this.viewSections) {
    if (vs.activeLinkSrcSectionRef.peek()) {
      let sourceNodeId = vs.activeLinkSrcSectionRef.peek() + ':' + vs.activeLinkSrcColRef.peek();
      let targetNodeId = vs.getRowId() + ':' + vs.activeLinkTargetColRef.peek();
      this.coordinates.push({
        'from': this.nodesById[sourceNodeId].linkCoord(),
        'to': this.nodesById[targetNodeId].linkCoord()
      });
    }
  }
};

// Draws all pre-existing arrows on the canvas.
ViewLinker.prototype.redrawArrows = function() {
  this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  this.ctx.beginPath();
  this.coordinates.forEach(conn =>
    drawArrow(this.ctx, conn.from.left, conn.from.top, conn.to.left, conn.to.top));
};

// Saves a new link from the clicked node to 'node' to the local list of links.
ViewLinker.prototype.connectLink = function(node) {
  var sourceNode = this.clicked();
  var section = node.section;
  section.activeLinkSrcSectionRef(sourceNode.sectionRef);
  section.activeLinkSrcColRef(sourceNode.colRef);
  section.activeLinkTargetColRef(node.colRef);
  this.resetArrows();
};

// Removes links from the given node.
ViewLinker.prototype.removeNodeLinks = function(node) {
  if (!node.isLinked()) { return; }
  var section = node.section;
  section.activeLinkSrcSectionRef(0);
  section.activeLinkSrcColRef(0);
  section.activeLinkTargetColRef(0);
  this.resetArrows();
};

// Draws an orange arrow with a black outline in context ctx from (origX, origY) to (x, y).
function drawArrow(ctx, origX, origY, x, y){
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  _drawBasicArrow(ctx, origX, origY, x, y);
  ctx.stroke();
  ctx.strokeStyle = '#F5A542';
  ctx.lineWidth = 3;
  _drawBasicArrow(ctx, origX, origY, x, y);
  ctx.stroke();
}

// Draws a single arrow with no outline.
function _drawBasicArrow(ctx, origX, origY, x, y) {
  var l = 10; // length of arrow head
  var angle = Math.atan2(y - origY, x - origX);
  ctx.moveTo(x, y);
  ctx.lineTo(x - l*Math.cos(angle - Math.PI/5), y - l*Math.sin(angle - Math.PI/5));
  ctx.moveTo(x, y);
  ctx.lineTo(x - l*Math.cos(angle + Math.PI/5), y - l*Math.sin(angle + Math.PI/5));
  ctx.moveTo(origX, origY);
  ctx.lineTo(x, y);
}

module.exports = ViewLinker;
