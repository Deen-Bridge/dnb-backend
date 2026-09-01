import { formatDualDate, gregorianToHijri, hijriToGregorian } from "../utils/hijriCalendar.js";
import { catchAsync } from "../middlewares/errorHandler.js";

/**
 * Convert date between Gregorian and Hijri formats
 */
export const convertDate = catchAsync(async (req, res) => {
  const { date, calendar, year, month, day } = req.query;

  if (calendar === "hijri" && year && month && day) {
    const gregorianDate = hijriToGregorian(parseInt(year, 10), parseInt(month, 10), parseInt(day, 10));
    const dual = formatDualDate(gregorianDate);
    return res.status(200).json({
      success: true,
      data: dual,
    });
  }

  const targetDate = date ? new Date(date) : new Date();
  const dual = formatDualDate(targetDate);

  res.status(200).json({
    success: true,
    data: dual,
  });
});
