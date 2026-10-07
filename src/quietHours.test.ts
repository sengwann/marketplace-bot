import { describe, expect, it } from "vitest";
import { hourIn, isQuietHour, isQuietNow, parseQuietHours } from "./quietHours";

describe("isQuietHour", () => {
  it("treats 0-5 as 00:00 to 04:59", () => {
    expect(isQuietHour(0, 0, 5)).toBe(true);
    expect(isQuietHour(4, 0, 5)).toBe(true);
    expect(isQuietHour(5, 0, 5)).toBe(false);
    expect(isQuietHour(23, 0, 5)).toBe(false);
  });

  it("handles a window that crosses midnight", () => {
    expect(isQuietHour(23, 23, 5)).toBe(true);
    expect(isQuietHour(2, 23, 5)).toBe(true);
    expect(isQuietHour(12, 23, 5)).toBe(false);
  });
});

describe("parseQuietHours", () => {
  it("returns null for an empty value (ping all day)", () => {
    expect(parseQuietHours("", "Asia/Yangon")).toBeNull();
  });

  it("parses a normal value", () => {
    expect(parseQuietHours("0-5", "Asia/Yangon")).toEqual({
      timeZone: "Asia/Yangon",
      startHour: 0,
      endHour: 5,
    });
  });

  it("rejects bad input", () => {
    expect(() => parseQuietHours("midnight", "Asia/Yangon")).toThrow();
    expect(() => parseQuietHours("5-5", "Asia/Yangon")).toThrow();
    expect(() => parseQuietHours("0-5", "Not/AZone")).toThrow();
  });
});

describe("Myanmar time (UTC+6:30)", () => {
  const window = parseQuietHours("0-5", "Asia/Yangon");

  it("converts UTC to Myanmar hours", () => {
    expect(hourIn("Asia/Yangon", new Date("2026-10-06T17:30:00Z"))).toBe(0); // 00:00 next day
    expect(hourIn("Asia/Yangon", new Date("2026-10-06T22:30:00Z"))).toBe(5); // 05:00
  });

  it("is quiet at 04:59 and awake at 05:00 and 23:50", () => {
    expect(isQuietNow(window, new Date("2026-10-06T22:29:00Z"))).toBe(true); // 04:59
    expect(isQuietNow(window, new Date("2026-10-06T22:30:00Z"))).toBe(false); // 05:00
    expect(isQuietNow(window, new Date("2026-10-06T17:20:00Z"))).toBe(false); // 23:50
    expect(isQuietNow(window, new Date("2026-10-06T17:30:00Z"))).toBe(true); // 00:00
  });
});
