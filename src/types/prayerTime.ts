export interface PrayerTimes {
  Fajr: string;
  Sunrise: string;
  Dhuhr: string;
  Asr: string;
  Sunset: string;
  Maghrib: string;
  Isha: string;
  Imsak: string;
  Midnight: string;
  Firstthird?: string;
  Lastthird?: string;
}

export interface HijriDate {
  date: string;
  format: string;
  day: string;
  weekday: {
    en: string;
    ar: string;
  };
  month: {
    number: number;
    en: string;
    ar: string;
  };
  year: string;
  designation: {
    expanded: string;
    abbreviated: string;
  };
}

export interface GregorianDate {
  date: string;
  format: string;
  day: string;
  weekday: {
    en: string;
  };
  month: {
    number: number;
    en: string;
  };
  year: string;
}

export interface PrayerTimeDate {
  readable: string;
  timestamp: string;
  hijri: HijriDate;
  gregorian: GregorianDate;
}

export interface PrayerTimeMeta {
  latitude: number;
  longitude: number;
  timezone: string;
  method: {
    id: number;
    name: string;
    params: {
      Fajr: number | string;
      Isha: number | string;
    };
  };
  latitudeAdjustmentMethod: string;
  midnightMode: string;
  school: string;
  offset: Record<string, number>;
}

export interface PrayerTimeData {
  timings: PrayerTimes;
  date: PrayerTimeDate;
  meta: PrayerTimeMeta;
}

export interface PrayerTimeApiResponse {
  code: number;
  status: string;
  data: PrayerTimeData | PrayerTimeData[];
}

export interface PrayerTimeQueryParams {
  latitude?: number;
  longitude?: number;
  city?: string;
  country?: string;
  address?: string;
  date?: string;
  method?: number;
  school?: number;
}
