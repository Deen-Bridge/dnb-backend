import { gregorianToHijri, hijriToGregorian, formatDualDate, ISLAMIC_MONTHS } from "../hijriCalendar.js";

describe("Hijri Calendar Utilities", () => {
  test("should list 12 Islamic months", () => {
    expect(ISLAMIC_MONTHS.length).toBe(12);
    expect(ISLAMIC_MONTHS[8].name).toBe("Ramadan");
    expect(ISLAMIC_MONTHS[8].arabic).toBe("رمضان");
  });

  test("should convert Gregorian date to Hijri date", () => {
    // Test a known date conversion
    const hijri = gregorianToHijri(new Date("2024-03-25"));
    expect(hijri).toHaveProperty("year");
    expect(hijri).toHaveProperty("month");
    expect(hijri).toHaveProperty("day");
    expect(hijri.monthName).toBeDefined();
  });

  test("should format dual date correctly", () => {
    const dual = formatDualDate(new Date("2024-01-01"));
    expect(dual).toHaveProperty("gregorian", "2024-01-01");
    expect(dual).toHaveProperty("hijri");
    expect(dual).toHaveProperty("hijriDetails");
  });
});
