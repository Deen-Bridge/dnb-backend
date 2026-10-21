import express from 'express';
import { protect, requireVerifiedEducator } from '../../middlewares/authMiddleware.js';
import { getCreatorDashboardStats } from '../../services/analytics/creator-stats-service.js';
import { TimeFilterPeriod } from '../../types/analytics/creator-dashboard.js';

const router = express.Router();

router.get('/', protect, requireVerifiedEducator, async (req, res, next) => {
  try {
    const creatorId = req.user._id.toString();
    const period = (req.query.period as TimeFilterPeriod) || 'monthly';
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const stats = await getCreatorDashboardStats(creatorId, period, startDate, endDate);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
