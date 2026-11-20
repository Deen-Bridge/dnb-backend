import axios from "axios";
import logger from "../config/logger.js";
import { PrayerTimeApiResponse, PrayerTimeQueryParams, PrayerTimeData } from "../types/prayerTime.js";

const ALADHAN_API_BASE = "https://api.aladhan.com/v1";
const FRESH_TTL_MS = 6 * 60 * 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 2;
const CIRCUIT_FAILURE_LIMIT = 5;
const CIRCUIT_OPEN_MS = 30_000;

type CacheEntry<T> = { value: T; freshUntil: number; staleUntil: number };

function normalizedKey(params: PrayerTimeQueryParams & { month?: number; year?: number }, kind: string) {
  const location = params.city && params.country
    ? `city:${String(params.city).trim().toLowerCase()}|country:${String(params.country).trim().toLowerCase()}`
    : `lat:${Number(params.latitude).toFixed(4)}|lon:${Number(params.longitude).toFixed(4)}`;
  return ["prayer", kind, location, params.date || "", params.month || "", params.year || "", params.method ?? 2, params.school ?? 0].join(":");
}

export class PrayerTimeService {
  private cache = new Map<string, CacheEntry<PrayerTimeData | PrayerTimeData[]>>();
  private inFlight = new Map<string, Promise<unknown>>();
  private failures = 0;
  private circuitOpenedAt = 0;

  private async request<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (cached && now < cached.freshUntil) return cached.value;
    if (this.circuitOpenedAt && now - this.circuitOpenedAt < CIRCUIT_OPEN_MS) {
      if (cached && now < cached.staleUntil) return cached.value;
      throw new Error("PRAYER_PROVIDER_UNAVAILABLE");
    }
    const pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const operation = (async () => {
      let lastError: any;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        try {
          const value = await fetcher();
          this.cache.set(key, { value, freshUntil: Date.now() + FRESH_TTL_MS, staleUntil: Date.now() + STALE_TTL_MS });
          this.failures = 0;
          this.circuitOpenedAt = 0;
          return value;
        } catch (error: any) {
          lastError = error;
          const status = error?.response?.status;
          const retryable = !status || status === 429 || status >= 500;
          if (!retryable || attempt === MAX_RETRIES) break;
          await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
        }
      }
      this.failures += 1;
      if (this.failures >= CIRCUIT_FAILURE_LIMIT) this.circuitOpenedAt = Date.now();
      const stale = this.cache.get(key) as CacheEntry<T> | undefined;
      if (stale && Date.now() < stale.staleUntil) return stale.value;
      throw new Error("PRAYER_PROVIDER_UNAVAILABLE");
    })();
    this.inFlight.set(key, operation);
    try { return await operation; } finally { this.inFlight.delete(key); }
  }

  private buildQuery(params: PrayerTimeQueryParams) {
    const queryParams: Record<string, any> = { method: params.method !== undefined ? params.method : 2 };
    if (params.city && params.country) {
      queryParams.city = params.city;
      queryParams.country = params.country;
      if (params.address) queryParams.address = params.address;
    } else if (params.latitude !== undefined && params.longitude !== undefined) {
      queryParams.latitude = params.latitude;
      queryParams.longitude = params.longitude;
    } else throw new Error("INVALID_PRAYER_LOCATION");
    if (params.date) queryParams.date = params.date;
    if (params.school !== undefined) queryParams.school = params.school;
    return queryParams;
  }
  /**
   * Fetch prayer times for a specific date and location using Aladhan API.
   */
  async getPrayerTimes(params: PrayerTimeQueryParams): Promise<PrayerTimeData> {
    const endpoint = params.city && params.country ? `${ALADHAN_API_BASE}/timingsByCity` : `${ALADHAN_API_BASE}/timings`;
    const queryParams = this.buildQuery(params);
    const key = normalizedKey(params, "daily");
    try {
      return await this.request(key, async () => {
      const response = await axios.get<PrayerTimeApiResponse>(endpoint, {
        params: queryParams,
        timeout: 5000,
      });
      if (response.data && response.data.code === 200 && response.data.data) {
        return response.data.data as PrayerTimeData;
      }
      throw new Error("invalid provider response");
      });
    } catch (error: any) { logger.error("PrayerTimeService error", { code: error.message }); throw error; }
  }

  /**
   * Fetch monthly calendar prayer schedules.
   */
  async getMonthlyPrayerCalendar(params: PrayerTimeQueryParams & { month?: number; year?: number }): Promise<PrayerTimeData[]> {
    if (!Number.isInteger(params.month ?? new Date().getMonth() + 1) || (params.month && (params.month < 1 || params.month > 12))) throw new Error("INVALID_PRAYER_MONTH");
    if (params.year && (!Number.isInteger(params.year) || params.year < 2000 || params.year > 2100)) throw new Error("INVALID_PRAYER_YEAR");
    const month = params.month || new Date().getMonth() + 1;
    const year = params.year || new Date().getFullYear();
    const endpoint = params.city && params.country ? `${ALADHAN_API_BASE}/calendarByCity` : `${ALADHAN_API_BASE}/calendar`;
    const queryParams: Record<string, any> = { ...this.buildQuery(params), month, year };
    delete queryParams.date;
    const key = normalizedKey({ ...params, month, year }, "monthly");
    try {
      return await this.request(key, async () => {
      const response = await axios.get<PrayerTimeApiResponse>(endpoint, {
        params: queryParams,
        timeout: 5000,
      });
      if (response.data && response.data.code === 200 && Array.isArray(response.data.data)) {
        return response.data.data as PrayerTimeData[];
      }
      throw new Error("invalid provider response");
      });
    } catch (error: any) { logger.error("PrayerTimeService calendar error", { code: error.message }); throw error; }
  }
}

export default new PrayerTimeService();
