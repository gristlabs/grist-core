

/* global grist, self */

self.importScripts('/grist-plugin-api.js');

grist.rpc.registerImpl("testApiBrowser", {
  getImportSource() {
    const api = grist.rpc.getStub('GristDocAPI@grist', grist.checkers.GristDocAPI);
    return api.getDocName()
    .then((result) => {
      const content = JSON.stringify({
        tables: [{
          table_name: '',
          column_metadata: [{
            id: 'getDocName',
            type: 'Text'
          }],
          table_data: [[result]]
        }]
      });
      const fileItem = {content, name: "GristDocAPI.jgrist"};
      return {
        item: { kind: "fileList", files: [fileItem] },
        description: "GristDocAPI results"
      };
    });
  }
});

grist.ready();
