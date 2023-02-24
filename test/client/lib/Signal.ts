import { assert } from 'chai';
import { Signal } from 'app/client/lib/Signal';

describe('Signal', function() {
  it('computes new signal from other events', function() {
    const started = Signal.create(null, false);
    const hovered = Signal.create(null, false);
    const hoverAndStarted = Signal.compute(null, on => on(started) && on(hovered));

    let flag: any = 'not-called';
    hoverAndStarted.listen(val => flag = val);

    function start(emit: boolean, expected: boolean) {
      started.emit(emit);
      assert.equal(flag, expected);
      flag = 'not-called';
    }

    function hover(emit: boolean, expected: boolean) {
      hovered.emit(emit);
      assert.equal(flag, expected);
      flag = 'not-called';
    }

    start(true, false);
    start(false, false);
    start(true, false);

    hover(true, true);
    hover(false, false);
    hover(true, true);

    start(false, false);
  });

  it('works as flag', function() {
    const started = Signal.create(null, false);
    const hovered = Signal.create(null, false);
    const andEvent = Signal.compute(null, on => on(started) && on(hovered)).distinct();

    const notCalled = {};
    let andCalled = notCalled;
    andEvent.listen(val => andCalled = val);

    function start(emit: boolean, expected: any) {
      started.emit(emit);
      assert.equal(andCalled, expected);
      andCalled = notCalled;
    }

    start(true, notCalled);
    start(false, notCalled);
    start(true, notCalled);

    function hover(emit: boolean, expected: any) {
      hovered.emit(emit);
      assert.equal(andCalled, expected);
      andCalled = notCalled;
    }

    hover(true, true);
    hover(false, false);
    hover(true, true);

    start(false, false);
  });

  it('supports basic compositions', function() {
    const numbers = Signal.create(null, 0);
    const even = numbers.filter(n => n % 2 === 0);
    const odd = numbers.filter(n => n % 2 === 1);

    let evenCount = 0;
    let oddCount = 0;
    even.listen(() => evenCount++);
    odd.listen(() => oddCount++);
    assert.equal(evenCount, 0);
    assert.equal(oddCount, 0);

    numbers.emit(2);
    assert.equal(evenCount, 1);
    assert.equal(oddCount, 0);

    numbers.emit(3);
    assert.equal(evenCount, 1);
    assert.equal(oddCount, 1);

    const distinct = numbers.distinct();
    let distinctCount = 0;
    distinct.listen(() => distinctCount++);
    assert.equal(distinctCount, 0);

    numbers.emit(3);
    assert.equal(distinctCount, 0);
    numbers.emit(3);
    assert.equal(distinctCount, 0);
    numbers.emit(4);
    assert.equal(distinctCount, 1);
    numbers.emit(4);
    assert.equal(distinctCount, 1);
    numbers.emit(5);
    assert.equal(distinctCount, 2);

    const trafficLight = Signal.create(null, false);
    const onRoad = numbers.filter(n => !!trafficLight.state.get());

    let onRoadCount = 0;
    onRoad.listen(() => onRoadCount++);
    assert.equal(onRoadCount, 0);
    numbers.emit(5);
    assert.equal(onRoadCount, 0);
    trafficLight.emit(true);
    assert.equal(onRoadCount, 0);
    numbers.emit(6);
    assert.equal(onRoadCount, 1);
  });

  it('detects cycles', function() {
    const first = Signal.create(null, 0);
    const second = Signal.create(null, 0);
    first.listen(n => second.emit(n + 1));
    second.listen(n => first.emit(n + 1));
    assert.throws(() => first.emit(1));
  });
});
