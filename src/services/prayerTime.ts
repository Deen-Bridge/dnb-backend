import axios from "axios";
import logger from "../config/logger.js";
import { PrayerTimeApiResponse, PrayerTimeQueryParams, PrayerTimeData } from "../types/prayerTime.js";

const ALADHAN_API_BASE = "https://api.aladhan.com/v1";

export class PrayerTimeService {
  /**
   * Fetch prayer times for a specific date and location using Aladhan API.
   */
  async getPrayerTimes(params: PrayerTimeQueryParams): Promise<PrayerTimeData> {
    try {
      const endpoint = params.city && params.country ? `${ALADHAN_API_BASE}/timingsByCity` : `${ALADHAN_API_BASE}/timings`;
      
      const queryParams: Record<string, any> = {
        method: params.method !== undefined ? params.method : 2, // Default ISNA calculation method
      };

      if (params.city && params.country) {
        queryParams.city = params.city;
        queryParams.country = params.country;
        if (params.address) queryParams.address = params.address;
      } else if (params.latitude !== undefined && params.longitude !== undefined) {
        queryParams.latitude = params.latitude;
        queryParams.longitude = params.longitude;
      } else {
        throw new Error("Either (city and country) or (latitude and longitude) must be provided.");
      }

      if (params.date) {
        queryParams.date = params.date;
      }

      if (params.school !== undefined) {
        queryParams.school = params.school;
      }

      const response = await axios.get<PrayerTimeApiResponse>(endpoint, {
        params: queryParams,
        timeout: 10000,
      });

      if (response.data && response.data.code === 200 && response.data.data) {
        return response.data.data as PrayerTimeData;
      }

      throw new Error(`Aladhan API returned invalid status code: ${response.data?.code || "unknown"}`);
    } catch (error: any) {
      logger.error("PrayerTimeService error:", error.message || error);
      throw new Error(error.response?.data?.data || error.message || "Failed to fetch prayer times");
    }
  }

  /**
   * Fetch monthly calendar prayer schedules.
   */
  async getMonthlyPrayerCalendar(params: PrayerTimeQueryParams & { month?: number; year?: number }): Promise<PrayerTimeData[]> {
    try {
      const now = new Date();
      const month = params.month || now.getMonth() + 1;
      const year = params.year || now.getFullYear();

      const endpoint = params.city && params.country 
        ? `${ALADHAN_API_BASE}/calendarByCity` 
        : `${ALADHAN_API_BASE}/calendar`;

      const queryParams: Record<string, any> = {
        method: params.method !== undefined ? params.method : 2,
        month,
        year,
      };

      if (params.city && params.country) {
        queryParams.city = params.city;
        queryParams.country = params.country;
      } else if (params.latitude !== undefined && params.longitude !== undefined) {
        queryParams.latitude = params.latitude;
        queryParams.longitude = params.longitude;
      } else {
        throw new Error("Either (city and country) or (latitude and longitude) must be provided.");
      }

      if (params.school !== undefined) {
        queryParams.school = params.school;
      }

      const response = await axios.get<PrayerTimeApiResponse>(endpoint, {
        params: queryParams,
        timeout: 15000,
      });

      if (response.data && response.data.code === 200 && Array.isArray(response.data.data)) {
        return response.data.data as PrayerTimeData[];
      }

      throw new Error("Failed to retrieve monthly prayer schedule calendar");
    } catch (error: any) {
      logger.error("PrayerTimeService calendar error:", error.message || error);
      throw new Error(error.response?.data?.data || error.message || "Failed to fetch monthly prayer calendar");
    }
  }
}

export default new PrayerTimeService();
