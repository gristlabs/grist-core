import Deque from 'double-ended-queue';

/**
 * Usage:
 *
 * OPTION 1, using a callback, which may be async (but doesn't have to be).
 *
 *   await mpool.withReserved(initialSize, async (updateReservation) => {
 *     ...
 *     updateReservation(newSize);   // if needed
 *     ...
 *   });
 *
 * OPTION 2, lower-level.
 *
 * Note: dispose() MUST be called (e.g. using try/finally). If not called, other work will
 * eventually deadlock waiting for it.
 *
 *   const memoryReservation = await mpool.waitAndReserve(initialSize);
 *   try {
 *     ...
 *     memoryReservation.updateReservation(newSize1);   // if needed
 *     memoryReservation.updateReservation(newSize2);   // if needed
 *     ...
 *   } finally {
 *     memoryReservation.dispose();
 *   }
 *
 * With both options, it's common for the initialSize to be a pool estimate. You may call
 * updateReservation() to update it. If it lowers the estimate, other work may unblock. If it
 * raises it, it may delay future work, but will have no impact on work that's already unblocked.
 * So it's always safer for initialSize to be an overestimate.
 *
 * When it's hard to estimate initialSize in bytes, you may specify it as e.g.
 * memPool.getTotalSize() / 20. This way at most 20 such parallel tasks may be unblocked at a
 * time, and further ones will wait until some release their memory or revise down their estimate.
 */
export class MemoryPool {
  private _reservedSize: number = 0;
  private _queue = new Deque<MemoryAwaiter>();

  constructor(private _totalSize: number) {}

  public getTotalSize(): number { return this._totalSize; }
  public getReservedSize(): number { return this._reservedSize; }
  public getAvailableSize(): number { return this._totalSize - this._reservedSize; }
  public isEmpty(): boolean { return this._reservedSize === 0; }
  public hasSpace(size: number): boolean { return this._reservedSize + size <= this._totalSize; }

  // To avoid failures, allow reserving more than totalSize when memory pool is empty.
  public hasSpaceOrIsEmpty(size: number): boolean { return this.hasSpace(size) || this.isEmpty(); }

  public numWaiting(): number { return this._queue.length; }

  public async waitAndReserve(size: number): Promise<MemoryReservation> {
    if (this.hasSpaceOrIsEmpty(size)) {
      this._updateReserved(size);
    } else {
      await new Promise<void>(resolve => this._queue.push({size, resolve}));
    }
    return new MemoryReservation(size, this._updateReserved.bind(this));
  }

  public async withReserved(size: number, callback: (updateRes: UpdateReservation) => void|Promise<void>) {
    const memRes = await this.waitAndReserve(size);
    try {
      return await callback(memRes.updateReservation.bind(memRes));
    } finally {
      memRes.dispose();
    }
  }

  // Update the total size. Returns the old size. This is intended for testing.
  public setTotalSize(newTotalSize: number): number {
    const oldTotalSize = this._totalSize;
    this._totalSize = newTotalSize;
    this._checkWaiting();
    return oldTotalSize;
  }

  private _checkWaiting() {
    while (!this._queue.isEmpty() && this.hasSpaceOrIsEmpty(this._queue.peekFront()!.size)) {
      const item = this._queue.shift()!;
      this._updateReserved(item.size);
      item.resolve();
    }
  }

  private _updateReserved(sizeDelta: number): void {
    this._reservedSize += sizeDelta;
    this._checkWaiting();
  }
}

type UpdateReservation = (sizeDelta: number) => void;

export class MemoryReservation {
  constructor(private _size: number, private _updateReserved: UpdateReservation) {}

  public updateReservation(newSize: number) {
    this._updateReserved(newSize - this._size);
    this._size = newSize;
  }

  public dispose() {
    this.updateReservation(0);
    this._updateReserved = undefined as any;    // Make sure we don't keep using it after dispose
  }
}

interface MemoryAwaiter {
  size: number;
  resolve: () => void;
}
