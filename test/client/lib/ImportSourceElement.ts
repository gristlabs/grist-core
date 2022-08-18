import { ImportSourceElement } from 'app/client/lib/ImportSourceElement';
import { createRpcLogger, PluginInstance } from 'app/common/PluginInstance';
import { FileListItem } from 'app/plugin/grist-plugin-api';
import { assert } from 'chai';
import { Rpc } from 'grain-rpc';

// assign console to logger to show logs
const logger = {};

describe("ImportSourceElement.importSourceStub#getImportSource()", function() {
  it("should accept buffer for FileContent.content", async function() {
    const plugin = createImportSourcePlugin({
      getImportSource: () => (Promise.resolve({
        item: {
          kind: "fileList",
          files: [{
            content: new Uint8Array([1, 2]),
            name: "MyFile"
          }]
        }
      }))
    });
    const importSourceStub = ImportSourceElement.fromArray([plugin])[0].importSourceStub;
    const res = await importSourceStub.getImportSource(0);
    assert.equal((res!.item as FileListItem).files[0].name, "MyFile");
    assert.deepEqual((res!.item as FileListItem).files[0].content, new Uint8Array([1, 2]));
  });
});

// Helper that creates a plugin which contributes importSource.
function createImportSourcePlugin(importSource: any): PluginInstance {
  const plugin = new PluginInstance({
    id: "",
    path: "",
    manifest: {
      components: {
        safeBrowser: "index.html"
      },
      contributions: {
        importSources: [{
          label: "Importer",
          importSource: {
            component: "safeBrowser",
            name: "importer"
          }
        }]
      }
    },
  }, createRpcLogger(logger, "plugin instance"));
  const rpc = new Rpc({logger: createRpcLogger(logger, 'rpc')});
  rpc.setSendMessage((mssg: any) => rpc.receiveMessage(mssg));
  rpc.registerImpl("importer", importSource);
  plugin.rpc.registerForwarder("index.html", rpc);
  return plugin;
}
