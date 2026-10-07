// Quiet hours: a window of the day (in a chosen time zone) when the keep-alive ping
// stays silent, so Render's free plan may fall asleep and save instance hours.
//
// Written as plain functions with no imports from config, so they can be unit tested.

export type QuietWindow = {
  timeZone: string; // e.g. "Asia/Yangon" (Myanmar time, UTC+6:30)
  startHour: number; // 0-23, first quiet hour
  endHour: number; // 1-24, quiet until this hour (not included)
};

/** "0-5" -> quiet from 00:00 until 05:00. "23-5" -> from 23:00 across midnight until 05:00. */
export function parseQuietHours(raw: string, timeZone: string): QuietWindow | null {
  const text = raw.trim();
  if (text === "") return null; // no quiet hours: ping all day

  const match = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(text);
  if (!match) {
    throw new Error(`KEEP_ALIVE_QUIET_HOURS must look like "0-5", got: ${raw}`);
  }

  const startHour = Number(match[1]);
  const endHour = Number(match[2]);
  if (startHour > 23 || endHour < 1 || endHour > 24 || startHour === endHour) {
    throw new Error(
      `KEEP_ALIVE_QUIET_HOURS needs a start of 0-23 and an end of 1-24 that differ, got: ${raw}`,
    );
  }

  // Fail at startup (not at 3 AM) when the time zone name is wrong.
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
  } catch {
    throw new Error(`KEEP_ALIVE_TIMEZONE is not a valid time zone name: ${timeZone}`);
  }

  return { timeZone, startHour, endHour };
}

/** Is this hour (0-23) inside the quiet window? */
export function isQuietHour(hour: number, startHour: number, endHour: number): boolean {
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour; // window crosses midnight
}

/** The current hour (0-23) in the given time zone. */
export function hourIn(timeZone: string, now: Date = new Date()): number {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  return Number(text);
}

export function isQuietNow(window: QuietWindow | null, now: Date = new Date()): boolean {
  if (!window) return false;
  return isQuietHour(hourIn(window.timeZone, now), window.startHour, window.endHour);
}
