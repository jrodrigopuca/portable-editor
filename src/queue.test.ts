import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./queue";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("createSerialQueue", () => {
  it("runs tasks one at a time, in arrival order, even when a later one is faster", async () => {
    const { exclusive } = createSerialQueue();
    const log: string[] = [];
    const slow = exclusive(async () => {
      log.push("slow:start");
      await tick();
      await tick();
      log.push("slow:end");
    });
    const fast = exclusive(async () => {
      log.push("fast");
    });
    await Promise.all([slow, fast]);
    expect(log).toEqual(["slow:start", "slow:end", "fast"]);
  });

  it("a rejected task does not block the next, and the rejection reaches its own caller", async () => {
    const { exclusive } = createSerialQueue();
    const failing = exclusive(async () => {
      throw new Error("boom");
    });
    const next = exclusive(async () => "ran");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
  });

  it("returns the task's value", async () => {
    const { exclusive } = createSerialQueue();
    await expect(exclusive(async () => 42)).resolves.toBe(42);
  });

  it("waiting on the queue from INSIDE a queued task never resolves (documents the deadlock)", async () => {
    // This is why main.ts has run* functions: anything already inside a
    // queued flow must call them directly, never the public wrappers.
    const { exclusive } = createSerialQueue();
    const nested = exclusive(() => exclusive(async () => "inner"));
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), 20));
    await expect(Promise.race([nested, timeout])).resolves.toBe("timed out");
  });
});
