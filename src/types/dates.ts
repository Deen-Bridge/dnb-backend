/**
 * @module src/types/dates
 * Date format types and interfaces for Hijri and Gregorian calendar support.
 */

export type CalendarType = 'gregorian' | 'hijri';

export interface HijriDate {
  day: number;
  month: number;
  monthName: string;
  monthNameArabic: string;
  year: number;
}

export interface DualFormattedDate {
  gregorian: string;
  hijri: string;
  gregorianDetails: {
    year: number;
    month: number;
    day: number;
  };
  hijriDetails: HijriDate;
}

export interface DateFormatterOptions {
  calendar?: CalendarType;
  locale?: string;
}
