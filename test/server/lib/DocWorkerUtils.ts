import { pickWorker } from "app/server/lib/DocWorkerUtils";
import { assert } from "chai";

describe("DocWorkerUtils", function () {
  describe("pickWorker", function () {
    it("returns the worker with the highest score", function () {
      const workers = [
        {
          id: "id1",
          load: {
            freeMemoryMB: 0,
            totalMemoryMB: 4096,
            assignmentsCount: 10,
            loadingDocsCount: 0,
            unackedDocsCount: 0,
          },
        },
        {
          id: "id2",
          load: {
            freeMemoryMB: 2048,
            totalMemoryMB: 4096,
            assignmentsCount: 5,
            loadingDocsCount: 3,
            unackedDocsCount: 0,
          },
        },
        {
          id: "id3",
          load: null,
        },
        {
          id: "id4",
          load: {
            freeMemoryMB: 3247,
            totalMemoryMB: 4096,
            assignmentsCount: 2,
            loadingDocsCount: 1,
            unackedDocsCount: 0,
          },
        },
        {
          id: "id5",
          load: {
            freeMemoryMB: 4096,
            totalMemoryMB: 4096,
            assignmentsCount: 0,
            loadingDocsCount: 0,
            unackedDocsCount: 0,
          },
        },
      ];
      assert.deepEqual(pickWorker(workers), { ...workers[4], score: 1 });
      workers.pop();
      assert.deepEqual(pickWorker(workers), {
        ...workers[3],
        score: 0.780517578125,
      });
      workers.pop();
      assert.deepEqual(pickWorker(workers), {
        ...workers[2],
        score: 0.5,
      });
      workers.pop();
      assert.deepEqual(pickWorker(workers), {
        ...workers[1],
        score: 0.46337890625,
      });
      workers.pop();
      assert.deepEqual(pickWorker(workers), {
        ...workers[0],
        score: 0,
      });
    });

    it("returns the first worker if there is a tie", function () {
      const workers = [
        {
          id: "id1",
          load: {
            freeMemoryMB: 2048,
            totalMemoryMB: 4096,
            assignmentsCount: 5,
            loadingDocsCount: 3,
            unackedDocsCount: 0,
          },
        },
        {
          id: "id2",
          load: {
            freeMemoryMB: 2048,
            totalMemoryMB: 4096,
            assignmentsCount: 5,
            loadingDocsCount: 3,
            unackedDocsCount: 0,
          },
        },
      ];
      assert.deepEqual(pickWorker(workers), {
        ...workers[0],
        score: 0.46337890625,
      });
      workers.reverse();
      assert.deepEqual(pickWorker(workers), {
        ...workers[0],
        score: 0.46337890625,
      });
    });

    it("returns a random worker if there are no positive scores", function () {
      const workers = [
        {
          id: "id1",
          load: {
            freeMemoryMB: 0,
            totalMemoryMB: 4096,
            assignmentsCount: 10,
            loadingDocsCount: 0,
            unackedDocsCount: 0,
          },
        },
        {
          id: "id2",
          load: {
            freeMemoryMB: 0,
            totalMemoryMB: 4096,
            assignmentsCount: 10,
            loadingDocsCount: 1,
            unackedDocsCount: 0,
          },
        },
        {
          id: "id3",
          load: {
            freeMemoryMB: 0,
            totalMemoryMB: 4096,
            assignmentsCount: 10,
            loadingDocsCount: 2,
            unackedDocsCount: 0,
          },
        },
        {
          id: "id4",
          load: {
            freeMemoryMB: 0,
            totalMemoryMB: 4096,
            assignmentsCount: 10,
            loadingDocsCount: 3,
            unackedDocsCount: 0,
          },
        },
      ];
      const assignmentsByWorkerId: Record<string, number> = {};
      for (let i = 0; i < 100; i++) {
        const worker = pickWorker(workers);
        if (assignmentsByWorkerId[worker!.id]) {
          assignmentsByWorkerId[worker!.id] += 1;
        } else {
          assignmentsByWorkerId[worker!.id] = 1;
        }
      }

      // Check every worker got at least one assignment.
      assert.equal(Object.keys(assignmentsByWorkerId).length, workers.length);

      // Check no worker got over half the assignments.
      assert.isTrue(workers.every(({ id }) => assignmentsByWorkerId[id] <= 50));
    });

    it("returns undefined if there are no workers", function () {
      assert.isUndefined(pickWorker([]));
    });
  });
});
