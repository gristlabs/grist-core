import { pickWorker } from "app/server/lib/DocWorkerUtils";
import { assert } from "chai";

describe("DocWorkerUtils", function () {
  describe("pickWorker", function () {
    it("returns the worker with the highest score", function () {
      const workers = [
        {
          id: "worker1",
          load: {
            freeMemoryMB: 0,
            totalMemoryMB: 4096,
            totalAssignmentsCount: 10,
            newAssignmentsCount: 0,
            loadingDocsCount: 0,
          },
        },
        {
          id: "worker2",
          load: {
            freeMemoryMB: 2048,
            totalMemoryMB: 4096,
            totalAssignmentsCount: 5,
            newAssignmentsCount: 1,
            loadingDocsCount: 2,
          },
        },
        {
          id: "worker3",
          load: null,
        },
        {
          id: "worker4",
          load: {
            freeMemoryMB: 3247,
            totalMemoryMB: 4096,
            totalAssignmentsCount: 2,
            newAssignmentsCount: 0,
            loadingDocsCount: 1,
          },
        },
        {
          id: "worker5",
          load: {
            freeMemoryMB: 4096,
            totalMemoryMB: 4096,
            totalAssignmentsCount: 0,
            newAssignmentsCount: 0,
            loadingDocsCount: 0,
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
          id: "worker1",
          load: {
            freeMemoryMB: 2048,
            totalMemoryMB: 4096,
            totalAssignmentsCount: 5,
            newAssignmentsCount: 1,
            loadingDocsCount: 2,
          },
        },
        {
          id: "worker2",
          load: {
            freeMemoryMB: 2048,
            totalMemoryMB: 4096,
            totalAssignmentsCount: 5,
            newAssignmentsCount: 2,
            loadingDocsCount: 1,
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
          id: "worker1",
          load: {
            freeMemoryMB: 0,
            totalMemoryMB: 4096,
            totalAssignmentsCount: 10,
            newAssignmentsCount: 0,
            loadingDocsCount: 0,
          },
        },
        {
          id: "worker2",
          load: {
            freeMemoryMB: 0,
            totalMemoryMB: 4096,
            totalAssignmentsCount: 10,
            newAssignmentsCount: 0,
            loadingDocsCount: 1,
          },
        },
        {
          id: "worker3",
          load: {
            freeMemoryMB: 0,
            totalMemoryMB: 4096,
            totalAssignmentsCount: 10,
            newAssignmentsCount: 0,
            loadingDocsCount: 2,
          },
        },
        {
          id: "worker4",
          load: {
            freeMemoryMB: 0,
            totalMemoryMB: 4096,
            totalAssignmentsCount: 10,
            newAssignmentsCount: 0,
            loadingDocsCount: 3,
          },
        },
      ];
      const assignmentsByWorkerId: Record<string, number> = {};
      for (let i = 0; i < 100; i++) {
        const worker = pickWorker(workers)!;
        if (assignmentsByWorkerId[worker.id]) {
          assignmentsByWorkerId[worker.id] += 1;
        } else {
          assignmentsByWorkerId[worker.id] = 1;
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

    it("accounts for new assignments and loading docs in score", function () {
      const worker = {
        id: "worker1",
        load: {
          freeMemoryMB: 4096,
          totalMemoryMB: 4096,
          totalAssignmentsCount: 0,
          newAssignmentsCount: 0,
          loadingDocsCount: 0,
        },
      };
      assert.equal(pickWorker([worker])!.score, 1);

      worker.load.totalAssignmentsCount++;
      worker.load.newAssignmentsCount++;
      assert.equal(pickWorker([worker])!.score, 0.98779296875);

      worker.load.newAssignmentsCount--;
      worker.load.loadingDocsCount++;
      assert.equal(pickWorker([worker])!.score, 0.98779296875);

      worker.load.totalAssignmentsCount++;
      worker.load.loadingDocsCount++;
      assert.equal(pickWorker([worker])!.score, 0.9755859375);

      worker.load.newAssignmentsCount = 0;
      worker.load.loadingDocsCount = 0;
      assert.equal(pickWorker([worker])!.score, 1);
    });
  });
});
