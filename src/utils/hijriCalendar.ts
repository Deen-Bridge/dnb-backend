/**
 * @module src/utils/hijriCalendar
 * Hijri (Islamic) calendar conversion utilities.
 * Uses standard tabular Islamic calendar calculations for accurate Gregorian <-> Hijri conversions.
 */

import { HijriDate, DualFormattedDate } from "../types/dates.ts";

export const ISLAMIC_MONTHS = [
  { number: 1, name: "Muharram", arabic: "المحرم" },
  { number: 2, name: "Safar", arabic: "صفر" },
  { number: 3, name: "Rabi' al-Awwal", arabic: "ربيع الأول" },
  { number: 4, name: "Rabi' al-Thani", arabic: "ربيع الثاني" },
  { number: 5, name: "Jumada al-Ula", arabic: "جمادى الأولى" },
  { number: 6, name: "Jumada al-Thani", arabic: "جمادى الآخرة" },
  { number: 7, name: "Rajab", arabic: "رجب" },
  { number: 8, name: "Sha'ban", arabic: "شعبان" },
  { number: 9, name: "Ramadan", arabic: "رمضان" },
  { number: 10, name: "Shawwal", arabic: "شوال" },
  { number: 11, name: "Dhu al-Qi'dah", arabic: "ذو القعدة" },
  { number: 12, name: "Dhu al-Hijjah", arabic: "ذو الحجة" },
];

/**
 * Check if a Hijri year is a leap year in the tabular Islamic calendar.
 */
export function isHijriLeapYear(year: number): boolean {
  return (11 * year + 14) % 30 < 11;
}

/**
 * Convert a JavaScript Date (or Gregorian year, month, day) to Julian Day Number (JDN).
 */
export function gregorianToJdn(year: number, month: number, day: number): number {
  if (month < 3) {
    year -= 1;
    month += 12;
  }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
}

/**
 * Convert a Julian Day Number (JDN) to Gregorian date [year, month, day].
 */
export function jdnToGregorian(jdn: number): [number, number, number] {
  const wjd = jdn + 0.5;
  const intPart = Math.floor(wjd);
  const f = wjd - intPart;

  let a = intPart;
  if (intPart >= 2299161) {
    const alpha = Math.floor((intPart - 1867216.25) / 36524.25);
    a = intPart + 1 + alpha - Math.floor(alpha / 4);
  }

  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);

  const day = Math.floor(b - d - Math.floor(30.6001 * e) + f);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;

  return [year, month, day];
}

/**
 * Convert Gregorian Date to Hijri Date.
 */
export function gregorianToHijri(date: Date | string | number): HijriDate {
  const d = new Date(date);
  const gYear = d.getFullYear();
  const gMonth = d.getMonth() + 1;
  const gDay = d.getDate();

  const jdn = gregorianToJdn(gYear, gMonth, gDay);

  // Approximation / tabular conversion from JDN to Hijri
  // Epoch JDN for 1 Muharram 1 AH is 1948439.5
  const daysSinceEpoch = Math.floor(jdn) - 1948439 + 1;
  
  let hYear = Math.floor((30 * daysSinceEpoch + 10646) / 10631);
  let hMonth = Math.min(12, Math.ceil((daysSinceEpoch - (29 + Math.floor(10631 * (hYear - 1) / 30))) / 29.5) + 1);
  if (hMonth < 1) hMonth = 1;
  
  // Refine using calculated start of year
  let hDay = daysSinceEpoch - (Math.floor(29.5 * (hMonth - 1)) + Math.floor(354 * (hYear - 1)) + Math.floor((3 + 11 * hYear) / 30)) + 1;
  
  if (hDay < 1) {
    hMonth -= 1;
    if (hMonth < 1) {
      hMonth = 12;
      hYear -= 1;
    }
    const prevDays = Math.floor(jdn) - gregorianToHijriJdn(hYear, hMonth, 1);
    hDay = prevDays + 1;
  }

  const monthObj = ISLAMIC_MONTHS.find((m) => m.number === hMonth) || ISLAMIC_MONTHS[0];

  return {
    day: Math.max(1, Math.min(30, hDay)),
    month: hMonth,
    monthName: monthObj.name,
    monthNameArabic: monthObj.arabic,
    year: hYear,
  };
}

/**
 * Helper to get JDN for a given Hijri date.
 */
export function gregorianToHijriJdn(year: number, month: number, day: number): number {
  return Math.floor((11 * year + 3) / 30) + 
         354 * (year - 1) + 
         30 * (month - 1) - 
         Math.floor((month - 1) / 2) + 
         day + 
         1948440 - 385;
}

/**
 * Convert Hijri Date to Gregorian Date.
 */
export function hijriToGregorian(year: number, month: number, day: number): Date {
  const julianDay = 
    Math.floor((11 * year + 3) / 30) +
    354 * (year - 1) +
    30 * (month - 1) -
    Math.floor((month - 1) / 2) +
    day +
    1948440 - 385;

  const [gYear, gMonth, gDay] = jdnToGregorian(julianDay);
  return new Date(gYear, gMonth - 1, gDay);
}

/**
 * Format date returning both Gregorian and Hijri representations.
 */
export function formatDualDate(date: Date | string | number = new Date()): DualFormattedDate {
  const d = new Date(date);
  const hijri = gregorianToHijri(d);

  return {
    gregorian: d.toISOString().split("T")[0],
    hijri: `${hijri.day} ${hijri.monthName} ${hijri.year} AH`,
    gregorianDetails: {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    },
    hijriDetails: hijri,
  };
}
