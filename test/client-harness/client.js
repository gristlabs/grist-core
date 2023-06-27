/* global window */
window.loadTests = function() {
  require('test/common/BinaryIndexedTree');
  require('test/common/CircularArray');
  require('test/common/MemBuffer');
  require('test/common/arraySplice');
  require('test/common/gutil');
  require('test/common/marshal');
  require('test/common/promises');
  require('test/common/serializeTiming');
  require('test/common/timeFormat');
  require('test/common/ValueFormatter');
  require('test/common/InactivityTimer');

  require('test/client/clientUtil');
  require('test/client/components/Layout');
  require('test/client/components/commands');
  require('test/client/components/sampleLayout');
  require('test/client/lib/ObservableMap');
  require('test/client/lib/ObservableSet');
  require('test/client/lib/dispose');
  require('test/client/lib/dom');
  require('test/client/lib/koArray');
  require('test/client/lib/koDom');
  require('test/client/lib/koForm');
  require('test/client/lib/koUtil');
  require('test/client/models/modelUtil');
  require('test/client/models/rowset');
  require('test/client/lib/localStorageObs');
}
