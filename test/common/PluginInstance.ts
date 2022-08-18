import {LocalPlugin} from 'app/common/plugin';
import * as clientUtil from 'test/client/clientUtil';
import * as sinon from 'sinon';
import {assert} from 'chai';

import * as browserGlobals from 'app/client/lib/browserGlobals';
const G: any = browserGlobals.get('$');

import {PluginInstance} from 'app/common/PluginInstance';

describe("PluginInstance", function() {
  clientUtil.setTmpMochaGlobals();
  it("can manages render target", function() {
    const plugin = new PluginInstance({manifest: {contributions: {}}} as LocalPlugin, {});
    assert.throws(() => plugin.getRenderTarget(2), /Unknown render target.*/);
    assert.doesNotThrow(() => plugin.getRenderTarget("fullscreen"));
    const renderTarget1 = sinon.spy();
    const renderTarget2 = sinon.spy();

    const el1 = G.$('<h1>el1</h1>');
    const el2 = G.$('<h1>el2</h1>');

    const handle1 = plugin.addRenderTarget(renderTarget1);
    plugin.getRenderTarget(handle1)(el1, {});
    sinon.assert.calledWith(renderTarget1, el1, {});
    plugin.removeRenderTarget(handle1);
    assert.throw(() => plugin.getRenderTarget(handle1));

    const handle2 = plugin.addRenderTarget(renderTarget2);
    plugin.getRenderTarget(handle2)(el2 as HTMLElement, {});
    sinon.assert.calledWith(renderTarget2, el2, {});
  });
});
