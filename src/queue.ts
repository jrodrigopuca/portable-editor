// A serial queue: tasks run one at a time, in arrival order, and a failed
// task never blocks the next. This is the mechanism behind main.ts's
// document queue (invariant #11 in CLAUDE.md), kept pure so its three
// promises — order, isolation, and "don't wait on the queue from inside
// the queue" — are pinned by tests instead of rediscovered.

export interface SerialQueue {
  /** Runs `task` after every previously queued task has settled (pass or fail). */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    exclusive: <T>(task: () => Promise<T>): Promise<T> => {
      // `then(task, task)`: run regardless of how the previous one ended.
      const run = tail.then(task, task);
      tail = run.catch(() => {}); // a rejection is the caller's to handle, not the queue's
      return run;
    },
  };
}
