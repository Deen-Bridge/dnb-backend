import { Router } from "express";
import prayerTimeService from "../../services/prayerTime.js";
import logger from "../../config/logger.js";

const router = Router();

/**
 * @route GET /api/prayer-times
 * @desc Get daily or calendar prayer schedule
 * @access Public
 */
router.get("/", async (req, res) => {
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

    const params: any = {};
    if (latitude !== undefined) params.latitude = parseFloat(latitude as string);
    if (longitude !== undefined) params.longitude = parseFloat(longitude as string);
    if (city) params.city = city;
    if (country) params.country = country;
    if (address) params.address = address;
    if (date) params.date = date;
    if (method !== undefined) params.method = parseInt(method as string, 10);
    if (school !== undefined) params.school = parseInt(school as string, 10);

    if (calendar === "true" || calendar === "1") {
      const monthlyData = await prayerTimeService.getMonthlyPrayerCalendar({
        ...params,
        month: month ? parseInt(month as string, 10) : undefined,
        year: year ? parseInt(year as string, 10) : undefined,
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
