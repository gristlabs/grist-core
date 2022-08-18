import {KeyedMutex} from 'app/common/KeyedMutex';
import {delay} from 'bluebird';
import {assert} from 'chai';

describe('KeyedMutex', function() {
  it('orders actions correctly', async function() {
    const m = new KeyedMutex();
    let v1: number = 0;
    let v2: number = 0;

    const fastAdd2 = m.acquire('2').then(unlock => {
      v2++;
      unlock();
    });
    const slowDouble2 = m.acquire('2').then(async unlock => {
      await delay(1000);
      v2 *= 2;
      unlock();
    });
    assert.equal(m.size, 1);

    const slowAdd1 = m.acquire('1').then(async unlock => {
      await delay(500);
      v1++;
      unlock();
    });
    const immediateDouble1 = m.acquire('1').then(unlock => {
      v1 *= 2;
      unlock();
    });
    assert.equal(m.size, 2);

    await Promise.all([slowAdd1, immediateDouble1]);
    assert.equal(m.size, 1);
    assert.equal(v1, 2);
    assert.equal(v2, 1);

    await Promise.all([fastAdd2, slowDouble2]);
    assert.equal(m.size, 0);
    assert.equal(v1, 2);
    assert.equal(v2, 2);
  });

  it('runs operations exclusively', async function() {
    const m = new KeyedMutex();
    let v1: number = 0;
    let v2: number = 0;

    const fastAdd2 = m.runExclusive('2', async () => {
      v2++;
    });
    const slowDouble2 = m.runExclusive('2', async () => {
      await delay(1000);
      v2 *= 2;
    });
    assert.equal(m.size, 1);

    const slowAdd1 = m.runExclusive('1', async () => {
      await delay(500);
      v1++;
    });
    const immediateDouble1 = m.runExclusive('1', async () => {
      v1 *= 2;
    });
    assert.equal(m.size, 2);

    await Promise.all([slowAdd1, immediateDouble1]);
    assert.equal(m.size, 1);
    assert.equal(v1, 2);
    assert.equal(v2, 1);

    await Promise.all([fastAdd2, slowDouble2]);
    assert.equal(m.size, 0);
    assert.equal(v1, 2);
    assert.equal(v2, 2);
  });
});
