import { Router } from "express";
import prayerTimeService from "../../services/prayerTime.js";
import logger from "../../config/logger.js";
import rateLimit from "express-rate-limit";

const router = Router();
const prayerTimesLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

const value = (input: unknown) => (typeof input === "string" ? input.trim() : "");
const integer = (input: unknown) => (value(input) === "" ? undefined : Number(value(input)));
const decimal = (input: unknown) => (value(input) === "" ? undefined : Number(value(input)));

/**
 * @route GET /api/prayer-times
 * @desc Get daily or calendar prayer schedule
 * @access Public
 */
router.get("/", prayerTimesLimiter, async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      city,
      country,
      address,
      date,
      method,
      school,
      calendar,
      month,
      year,
    } = req.query;

    const lat = decimal(latitude);
    const lon = decimal(longitude);
    const methodValue = integer(method);
    const schoolValue = integer(school);
    const monthValue = integer(month);
    const yearValue = integer(year);
    if ((lat !== undefined && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
        (lon !== undefined && (!Number.isFinite(lon) || lon < -180 || lon > 180)) ||
        (lat === undefined) !== (lon === undefined) ||
        (methodValue !== undefined && (!Number.isInteger(methodValue) || methodValue < 0 || methodValue > 23)) ||
        (schoolValue !== undefined && (!Number.isInteger(schoolValue) || ![0, 1].includes(schoolValue))) ||
        (monthValue !== undefined && (!Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12)) ||
        (yearValue !== undefined && (!Number.isInteger(yearValue) || yearValue < 1900 || yearValue > 2100)) ||
        [city, country, address].some((v) => v !== undefined && value(v).length > 100)) {
      return res.status(400).json({ success: false, message: "Invalid prayer-time query parameters", data: null });
    }

    const params: any = {};
    if (lat !== undefined && lon !== undefined) {
      params.latitude = lat;
      params.longitude = lon;
    } else {
      if (value(city)) params.city = value(city);
      if (value(country)) params.country = value(country);
      if (value(address)) params.address = value(address);
    }
    if (value(date) && !/^\d{1,2}-\d{1,2}-\d{4}$/.test(value(date))) {
      return res.status(400).json({ success: false, message: "date must be DD-MM-YYYY", data: null });
    }
    if (value(date)) params.date = value(date);
    if (methodValue !== undefined) params.method = methodValue;
    if (schoolValue !== undefined) params.school = schoolValue;

    if (calendar === "true" || calendar === "1") {
      const monthlyData = await prayerTimeService.getMonthlyPrayerCalendar({
        ...params,
        month: monthValue,
        year: yearValue,
      });
      return res.status(200).json({
        success: true,
        count: monthlyData.length,
        data: monthlyData,
      });
    }

    const prayerData = await prayerTimeService.getPrayerTimes(params);
    return res.status(200).json({
      success: true,
      data: prayerData,
    });
  } catch (error: any) {
    logger.error("Error handling prayer times request:", error);
    const providerFailure = ["PRAYER_PROVIDER_UNAVAILABLE"].includes(error.message);
    return res.status(providerFailure ? 503 : 400).json({
      success: false,
      code: error.message?.startsWith("INVALID_") ? error.message : providerFailure ? "PRAYER_PROVIDER_UNAVAILABLE" : "INVALID_PRAYER_REQUEST",
      message: providerFailure ? "Prayer times are temporarily unavailable" : "Invalid prayer time request",
      data: null,
    });
  }
});

export default router;
