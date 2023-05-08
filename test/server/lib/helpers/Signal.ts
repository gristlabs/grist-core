import {delay} from "bluebird";

/**
 * Helper that creates a promise that can be resolved from outside.
 */
export function signal() {
    let resolve: null | ((data: any) => void) = null;
    let promise: null | Promise<any> = null;
    let called = false;
    return {
        emit(data: any) {
            if (!resolve) {
                throw new Error("signal.emit() called before signal.reset()");
            }
            called = true;
            resolve(data);
        },
        async wait() {
            if (!promise) {
                throw new Error("signal.wait() called before signal.reset()");
            }
            const proms = Promise.race([promise, delay(2000).then(() => {
                throw new Error("signal.wait() timed out");
            })]);
            return await proms;
        },
        async waitAndReset() {
            try {
                return await this.wait();
            } finally {
                this.reset();
            }
        },
        called() {
            return called;
        },
        reset() {
            called = false;
            promise = new Promise((res) => {
                resolve = res;
            });
        }
    };
}
