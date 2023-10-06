import { ClientScope } from 'app/client/components/ClientScope';
import { Disposable } from 'app/client/lib/dispose';
import { ClientProcess, SafeBrowser } from 'app/client/lib/SafeBrowser';
import { LocalPlugin } from 'app/common/plugin';
import { PluginInstance } from 'app/common/PluginInstance';
import { GristLight } from 'app/common/themes/GristLight';
import { GristAPI, RPC_GRISTAPI_INTERFACE } from 'app/plugin/GristAPI';
import { Storage } from 'app/plugin/StorageAPI';
import { checkers } from 'app/plugin/TypeCheckers';
import { assert } from 'chai';
import { Rpc } from 'grain-rpc';
import { Computed } from 'grainjs';
import { noop } from 'lodash';
import { basename } from 'path';
import * as sinon from 'sinon';
import * as clientUtil from 'test/client/clientUtil';
import * as tic from "ts-interface-checker";
import { createCheckers } from "ts-interface-checker";
import * as url from 'url';

clientUtil.setTmpMochaGlobals();

const LOG_RPC = false; // tslint:disable-line:prefer-const

// uncomment next line to turn on rpc logging
// LOG_RPC = true;

describe('SafeBrowser', function() {

  let clientScope: any;
  const sandbox = sinon.createSandbox();
  let browserProcesses: Array<{path: string, proc: ClientProcess}> = [];

  let disposeSpy: sinon.SinonSpy;
  const cleanup: Array<() => void> = [];

  beforeEach(function() {
    const callPluginFunction = sinon.stub();
    callPluginFunction
      .withArgs('testing-plugin', 'unsafeNode', 'func1')
      .callsFake( (...args) => 'From Russia ' + args[3][0] + "!");
    callPluginFunction
       .withArgs('testing-plugin', 'unsafeNode', 'funkyName')
       .throws();
    clientScope = new ClientScope();

    browserProcesses = [];
    sandbox.stub(SafeBrowser, 'createWorker').callsFake(createProcess);
    sandbox.stub(SafeBrowser, 'createView').callsFake(createProcess);
    sandbox.stub(PluginInstance.prototype, 'getRenderTarget').returns(noop);
    disposeSpy = sandbox.spy(Disposable.prototype, 'dispose');
  });

  afterEach(function() {
    sandbox.restore();
    for (const cb of cleanup) { cb(); }
    cleanup.splice(0);
  });

  it('should support rpc', async function() {
    const {safeBrowser, pluginRpc} = createSafeBrowser('test_rpc');
    const foo = pluginRpc.getStub<Foo>('grist@test_rpc', FooDescription);
    await safeBrowser.activate();
    assert.equal(await foo.foo('rpc test'), 'foo rpc test');
  });

  it("can stub view processes", async function() {
    const {safeBrowser, pluginRpc} = createSafeBrowser('test_render');
    const foo = pluginRpc.getStub<Foo>('grist@test_render_view', FooDescription);
    await safeBrowser.activate();
    assert.equal(await foo.foo('rpc test'), 'foo rpc test from test_render_view');
  });

  it('can forward rpc to a view process', async function() {
    const {safeBrowser, pluginRpc} = createSafeBrowser("test_forward");
    const foo = pluginRpc.getStub<Foo>('grist@test_forward', FooDescription);
    await safeBrowser.activate();
    assert.equal(await foo.foo("safeBrowser"), "foo safeBrowser from test_forward_view");
  });

  it('should forward messages', async function() {
    const {safeBrowser, pluginRpc} = createSafeBrowser("test_messages");
    const foo = pluginRpc.getStub<Foo>('foo@test_messages', FooDescription);
    await safeBrowser.activate();
    assert.equal(await foo.foo("safeBrowser"), "from message view");
  });

  it('should support disposing a rendered view', async function() {
    const {safeBrowser, pluginRpc} = createSafeBrowser("test_dispose");
    const foo = pluginRpc.getStub<Foo>('grist@test_dispose', FooDescription);
    await safeBrowser.activate();
    await foo.foo("safeBrowser");
    assert.deepEqual(browserProcesses.map(p => p.path), ["test_dispose", "test_dispose_view1", "test_dispose_view2"]);

    assert.equal(disposeSpy.calledOn(processByName("test_dispose_view1")!), true);
    assert.equal(disposeSpy.calledOn(processByName("test_dispose_view2")!), false);
  });

  it('should dispose each process on deactivation', async function() {
    const {safeBrowser, pluginRpc} = createSafeBrowser("test_dispose");
    const foo = pluginRpc.getStub<Foo>('grist@test_dispose', FooDescription);
    await safeBrowser.activate();
    await foo.foo("safeBrowser");
    await safeBrowser.deactivate();
    assert.deepEqual(browserProcesses.map(p => p.path), ["test_dispose", "test_dispose_view1", "test_dispose_view2"]);
    for (const {proc} of browserProcesses) {
      assert.equal(disposeSpy.calledOn(proc), true);
    }
  });

  // it('should allow calling unsafeNode functions', async function() {
  //   const {safeBrowser, pluginRpc} = createSafeBrowser("test_function_call");
  //   const rpc = (safeBrowser as any)._pluginInstance.rpc as Rpc;
  //   const foo = rpc.getStub<Foo>('grist@test_function_call', FooDescription);
  //   await safeBrowser.activate();
  //   assert.equal(await foo.foo('func1'), 'From Russia with love!');
  //   await assert.isRejected(foo.foo('funkyName'));
  // });

  it('should allow access to client scope interfaces', async function() {
    const {safeBrowser, pluginRpc} = createSafeBrowser("test_client_scope");
    const foo = pluginRpc.getStub<Foo>('grist@test_client_scope', FooDescription);
    await safeBrowser.activate();
    assert.equal(await foo.foo('green'), '#0f0');
  });

  it('should allow access to client scope interfaces from view', async function() {
    const {safeBrowser, pluginRpc} = createSafeBrowser("test_client_scope_from_view");
    const foo = pluginRpc.getStub<Foo>('grist@test_client_scope_from_view', FooDescription);
    await safeBrowser.activate();
    assert.equal(await foo.foo('red'), 'red#f00');
  });

  it('should have type-safe access to client scope interfaces', async function() {
    const {safeBrowser, pluginRpc} = createSafeBrowser("test_client_scope_typed");
    const foo = pluginRpc.getStub<Foo>('grist@test_client_scope_typed', FooDescription);
    await safeBrowser.activate();
    await assert.isRejected(foo.foo('test'), /is not a string/);
  });

  it('should allow creating a view process from grist', async function() {
    const {safeBrowser, pluginRpc} = createSafeBrowser("test_view_process");
    // let's call buildDom on test_rpc
    const proc = safeBrowser.createViewProcess("test_rpc");

    // rpc should work
    const foo = pluginRpc.getStub<Foo>('grist@test_rpc', FooDescription);
    assert.equal(await foo.foo('Santa'), 'foo Santa');

    // now let's dispose
    proc.dispose();
  });

  function createProcess(safeBrowser: SafeBrowser, _rpc: Rpc, src: string) {
    const path: string = basename(url.parse(src).pathname!);
    const rpc = new Rpc({logger: LOG_RPC ? {
        // let's prepend path to the console 'info' and 'warn' channels
        info: console.info.bind(console, path),   // tslint:disable-line:no-console
        warn: console.warn.bind(console, path),   // tslint:disable-line:no-console
      } : {}, sendMessage: _rpc.receiveMessage.bind(_rpc)});
    _rpc.setSendMessage(msg => rpc.receiveMessage(msg));
    const api = rpc.getStub<GristAPI>(RPC_GRISTAPI_INTERFACE, checkers.GristAPI);
    function ready() {
      rpc.processIncoming();
      void rpc.sendReadyMessage();
    }
    // Start up the mock process for the plugin.
    const proc = new ClientProcess(safeBrowser, _rpc);
    PROCESSES[path]({rpc, api, ready });
    browserProcesses.push({path, proc});
    return proc;
  }

  // At the moment, only the .definition field matters for SafeBrowser.
  const localPlugin: LocalPlugin = {
    manifest: {
      components: { safeBrowser: 'main' },
      contributions: {}
    },
    id: "testing-plugin",
    path: ""
  };
  function createSafeBrowser(mainPath: string): {safeBrowser: SafeBrowser, pluginRpc: Rpc} {
    const pluginInstance = new PluginInstance(localPlugin, {});
    const safeBrowser = new SafeBrowser({
      pluginInstance,
      clientScope,
      untrustedContentOrigin: '',
      mainPath,
      baseLogger: {},
      theme: Computed.create(null, () => ({appearance: 'light', colors: GristLight})),
    });
    cleanup.push(() => safeBrowser.deactivate());
    pluginInstance.rpc.registerForwarder(mainPath, safeBrowser);
    return {safeBrowser, pluginRpc: pluginInstance.rpc};
  }

  function processByName(name: string): ClientProcess|undefined {
    const procInfo = browserProcesses.find(p => (p.path === name));
    return procInfo ? procInfo.proc : undefined;
  }
});

/**
 * A Dummy Api to contribute to.
 */
interface Foo {
  foo(name: string): Promise<string>;
}

const FooDescription = createCheckers({
  Foo: tic.iface([], {
    foo: tic.func("string", tic.param("name", "string")),
  })
}).Foo;

interface TestProcesses {
  [s: string]: (grist: GristModule) => void;
}

/**
 * This interface describes what exposes grist-plugin-api.ts to the plugin.
 */
interface GristModule {
  rpc: Rpc;
  api: GristAPI;
  ready(): void;
}


/**
 * The safeBrowser's script needed for test.
 */
const PROCESSES: TestProcesses = {
  test_rpc: (grist: GristModule) => {
    class MyFoo {
      public async foo(name: string): Promise<string> {
        return 'foo ' + name;
      }
    }
    grist.rpc.registerImpl<Foo>('grist', new MyFoo(), FooDescription);
    grist.ready();
  },
  async test_render(grist: GristModule) {
    await grist.api.render('test_render_view', 'fullscreen');
    grist.ready();
  },
  test_render_view(grist: GristModule) {
    grist.rpc.registerImpl<Foo>('grist', {
      foo: (name: string) => `foo ${name} from test_render_view`
    });
    grist.ready();
  },
  async test_forward(grist: GristModule) {
    grist.rpc.registerImpl<Foo>('grist', {
      foo: (name: string) => viewFoo.foo(name)
    });
    grist.api.render('test_forward_view', 'fullscreen'); // eslint-disable-line @typescript-eslint/no-floating-promises
    const viewFoo = grist.rpc.getStub<Foo>('foo@test_forward_view', FooDescription);
    grist.ready();
  },
  test_forward_view: (grist: GristModule) => {
    grist.rpc.registerImpl<Foo>('foo', {
      foo: async (name) => `foo ${name} from test_forward_view`
    }, FooDescription);
    grist.ready();
  },
  test_messages: (grist: GristModule) => {
    grist.rpc.registerImpl<Foo>('foo', {
      foo(name): Promise<string> {
        return new Promise<string>(resolve => {
          grist.rpc.once('message', resolve);
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          grist.api.render('test_messages_view', 'fullscreen');
        });
      }
    }, FooDescription);
    grist.ready();
  },
  test_messages_view: (grist: GristModule) => {
    // test if works even if grist.ready() called after postmessage ?
    grist.ready();
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    grist.rpc.postMessageForward('test_messages', 'from message view');
  },
  test_dispose: (grist: GristModule) => {
    class MyFoo {
      public async foo(name: string): Promise<string> {
        const id = await grist.api.render('test_dispose_view1', 'fullscreen');
        await grist.api.render('test_dispose_view2', 'fullscreen');
        await grist.api.dispose(id);
        return "test";
      }
    }
    grist.rpc.registerImpl<Foo>('grist', new MyFoo(), FooDescription);
    grist.ready();
  },
  test_dispose_view1: (grist) => grist.ready(),
  test_dispose_view2: (grist) => grist.ready(),
  test_client_scope: (grist: GristModule) => {
    class MyFoo {
      public async foo(name: string): Promise<string> {
        const stub = grist.rpc.getStub<Storage>('storage');
        stub.setItem("red", "#f00");
        stub.setItem("green", "#0f0");
        stub.setItem("blue", "#00f");
        return stub.getItem(name);
      }
    }
    grist.rpc.registerImpl<Foo>('grist', new MyFoo(), FooDescription);
    grist.ready();
  },
  test_client_scope_from_view: (grist: GristModule) => {
    // hit linting limit for number of classes in a single file :-)
    const myFoo = {
      foo(name: string): Promise<string> {
        return new Promise<string> (resolve => {
          grist.rpc.once("message", (msg: any) => resolve(name + msg));
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          grist.api.render('view_client_scope', 'fullscreen');
        });
      }
    };
    grist.rpc.registerImpl<Foo>('grist', myFoo, FooDescription);
    grist.ready();
  },
  test_client_scope_typed: (grist: GristModule) => {
    const myFoo = {
      foo(name: string): Promise<string> {
        const stub = grist.rpc.getStub<any>('storage');
        return stub.setItem(1); // this should be an error
      }
    };
    grist.rpc.registerImpl<Foo>('grist', myFoo, FooDescription);
    grist.ready();
  },
  view1: (grist: GristModule) => {
    const myFoo = {
      async foo(name: string): Promise<string> {
        return `foo ${name} from view1`;
      }
    };
    grist.rpc.registerImpl<Foo>('foo', myFoo, FooDescription);
    grist.ready();
  },
  view2: (grist: GristModule) => {
    grist.ready();
  },
  view_client_scope: async (grist: GristModule) => {
    const stub = grist.rpc.getStub<Storage>('storage');
    grist.ready();
    stub.setItem("red", "#f00");
    const result = await stub.getItem("red");
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    grist.rpc.postMessageForward("test_client_scope_from_view", result);
  },
};
