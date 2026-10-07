// Telegram answers "429 Too Many Requests" when the bot sends too fast (for example,
// many sellers submitting listings at the same moment: every album counts as several
// messages in the admin group). The answer says how many seconds to wait, so we wait
// that long and try again instead of failing.
//
// Only a 429 is retried. A 429 means Telegram did NOT send the message, so trying again
// can never create a duplicate.

type SleepFn = (ms: number) => Promise<void>;

export interface RetryAfterOptions {
  /** Longest single wait we accept, in seconds. A longer wait is left to the retry job. */
  maxWaitSeconds?: number;
  /** How many times to retry after the first attempt. */
  retries?: number;
  /** Called before each wait (used for logging). */
  onWait?: (seconds: number) => void;
  /** Replaceable in tests. */
  sleep?: SleepFn;
}

/** Seconds Telegram wants us to wait, or undefined if this is not a 429 error. */
export function retryAfterSeconds(err: unknown): number | undefined {
  const response = (err as { response?: unknown } | null)?.response as
    | { error_code?: number; parameters?: { retry_after?: number } }
    | undefined;

  if (response?.error_code !== 429) return undefined;

  const seconds = response.parameters?.retry_after;
  return typeof seconds === "number" && seconds >= 0 ? seconds : 5; // no number given: guess 5
}

const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetryAfter<T>(
  fn: () => Promise<T>,
  options: RetryAfterOptions = {},
): Promise<T> {
  const { maxWaitSeconds = 10, retries = 2, onWait, sleep = realSleep } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const wait = retryAfterSeconds(err);
      if (wait === undefined || attempt >= retries || wait > maxWaitSeconds) throw err;

      onWait?.(wait);
      await sleep((wait + 1) * 1000); // +1 second so we do not land exactly on the limit
    }
  }
}
