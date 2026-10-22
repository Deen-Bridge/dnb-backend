import mongoose from 'mongoose';
import Course from '../../models/Course.js';
import Book from '../../models/Book.js';
import Transaction from '../../models/Transaction.js';
import User from '../../models/User.js';
import { CreatorDashboardStats, ContentItemBreakdown, TimeFilterPeriod } from '../../types/analytics/creator-dashboard.js';

export const getDateBounds = (period?: TimeFilterPeriod, customStart?: string, customEnd?: string) => {
  if (customStart || customEnd) {
    return {
      start: customStart ? new Date(customStart) : null,
      end: customEnd ? new Date(customEnd) : null,
    };
  }

  const now = new Date();
  const start = new Date(now);

  switch (period) {
    case 'daily':
      start.setHours(0, 0, 0, 0);
      break;
    case 'weekly':
      start.setDate(now.getDate() - 7);
      break;
    case 'monthly':
      start.setMonth(now.getMonth() - 1);
      break;
    case 'all':
    default:
      return { start: null, end: null };
  }

  return { start, end: now };
};

export const getCreatorDashboardStats = async (
  creatorId: string,
  period: TimeFilterPeriod = 'monthly',
  startDate?: string,
  endDate?: string
): Promise<CreatorDashboardStats> => {
  const creatorObjectId = new mongoose.Types.ObjectId(creatorId);
  const { start, end } = getDateBounds(period, startDate, endDate);

  const dateMatch: Record<string, any> = {};
  if (start || end) {
    dateMatch.createdAt = {};
    if (start) dateMatch.createdAt.$gte = start;
    if (end) dateMatch.createdAt.$lte = end;
  }

  // Fetch creator courses and books
  const [courses, books] = await Promise.all([
    Course.find({ createdBy: creatorObjectId }).lean(),
    Book.find({ author: creatorObjectId }).lean(),
  ]);

  const courseIds = courses.map((c) => c._id);
  const bookIds = books.map((b) => b._id);

  // Aggregate transactions for these items
  const txMatch: Record<string, any> = {
    creator: creatorObjectId,
    status: 'confirmed',
    itemId: { $in: [...courseIds, ...bookIds] },
    ...dateMatch,
  };

  const transactions = await Transaction.find(txMatch).lean();

  const revenueByItemId: Record<string, number> = {};
  for (const tx of transactions) {
    if (!tx.itemId) continue;
    const idStr = tx.itemId.toString();
    const amt = parseFloat(tx.amount || '0');
    revenueByItemId[idStr] = (revenueByItemId[idStr] || 0) + amt;
  }

  // Calculate enrollments for courses via User purchasedCourses or enrolledUsers
  const enrollmentMatch: Record<string, any> = {
    'purchasedCourses.courseId': { $in: courseIds },
  };
  if (start || end) {
    enrollmentMatch['purchasedCourses.purchaseDate'] = dateMatch.createdAt;
  }

  const userEnrollments = await User.aggregate([
    { $match: { 'purchasedCourses.courseId': { $in: courseIds } } },
    { $unwind: '$purchasedCourses' },
    { $match: { 'purchasedCourses.courseId': { $in: courseIds }, ...(start || end ? { 'purchasedCourses.purchaseDate': dateMatch.createdAt } : {}) } },
    { $group: { _id: '$purchasedCourses.courseId', count: { $sum: 1 } } },
  ]);

  const enrollmentsByCourseId: Record<string, number> = {};
  for (const item of userEnrollments) {
    enrollmentsByCourseId[item._id.toString()] = item.count;
  }

  let totalRevenue = 0;
  let totalViews = 0;
  let totalEnrollments = 0;

  const coursesBreakdown: ContentItemBreakdown[] = courses.map((course) => {
    const idStr = course._id.toString();
    const rev = revenueByItemId[idStr] || 0;
    const views = course.views || 0;
    const enrollments = enrollmentsByCourseId[idStr] || (course.enrolledUsers ? course.enrolledUsers.length : 0);

    totalRevenue += rev;
    totalViews += views;
    totalEnrollments += enrollments;

    return {
      id: idStr,
      title: course.title,
      type: 'course',
      revenue: rev,
      currency: course.currency || 'USDC',
      views,
      enrollments,
      createdAt: course.createdAt,
    };
  });

  const booksBreakdown: ContentItemBreakdown[] = books.map((book) => {
    const idStr = book._id.toString();
    const rev = revenueByItemId[idStr] || 0;
    const views = book.readCount || 0;

    totalRevenue += rev;
    totalViews += views;

    return {
      id: idStr,
      title: book.title,
      type: 'book',
      revenue: rev,
      currency: book.currency || 'USDC',
      views,
      enrollments: 0,
      createdAt: book.createdAt,
    };
  });

  return {
    creatorId,
    totalRevenue,
    totalViews,
    totalEnrollments,
    period,
    coursesBreakdown,
    booksBreakdown,
  };
};
