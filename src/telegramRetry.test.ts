import { describe, expect, it } from "vitest";
import { retryAfterSeconds, withRetryAfter } from "./telegramRetry";

const tooMany = (seconds?: number) => ({
  response: {
    error_code: 429,
    ...(seconds === undefined ? {} : { parameters: { retry_after: seconds } }),
  },
});

describe("retryAfterSeconds", () => {
  it("reads retry_after from a 429", () => {
    expect(retryAfterSeconds(tooMany(7))).toBe(7);
  });

  it("guesses 5 seconds when a 429 has no number", () => {
    expect(retryAfterSeconds(tooMany())).toBe(5);
  });

  it("ignores every other error", () => {
    expect(retryAfterSeconds(new Error("boom"))).toBeUndefined();
    expect(retryAfterSeconds({ response: { error_code: 400 } })).toBeUndefined();
    expect(retryAfterSeconds(null)).toBeUndefined();
  });
});

describe("withRetryAfter", () => {
  const noSleep = async () => {};

  it("returns the result when nothing fails", async () => {
    expect(await withRetryAfter(async () => "ok", { sleep: noSleep })).toBe("ok");
  });

  it("waits and retries after a 429, then succeeds", async () => {
    let calls = 0;
    const waits: number[] = [];
    const result = await withRetryAfter(
      async () => {
        calls++;
        if (calls === 1) throw tooMany(3);
        return "sent";
      },
      { sleep: async (ms) => void waits.push(ms) },
    );
    expect(result).toBe("sent");
    expect(calls).toBe(2);
    expect(waits).toEqual([4000]); // 3 seconds + 1
  });

  it("gives up after the allowed number of retries", async () => {
    let calls = 0;
    await expect(
      withRetryAfter(
        async () => {
          calls++;
          throw tooMany(1);
        },
        { sleep: noSleep },
      ),
    ).rejects.toBeTruthy();
    expect(calls).toBe(3); // first try + 2 retries
  });

  it("does not wait when Telegram asks for too long", async () => {
    let calls = 0;
    await expect(
      withRetryAfter(
        async () => {
          calls++;
          throw tooMany(60);
        },
        { sleep: noSleep },
      ),
    ).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });

  it("never retries other errors", async () => {
    let calls = 0;
    await expect(
      withRetryAfter(
        async () => {
          calls++;
          throw new Error("chat not found");
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow("chat not found");
    expect(calls).toBe(1);
  });
});
