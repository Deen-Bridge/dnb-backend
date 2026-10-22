export type TimeFilterPeriod = 'daily' | 'weekly' | 'monthly' | 'all';

export interface CreatorDashboardQuery {
  period?: TimeFilterPeriod;
  startDate?: string;
  endDate?: string;
}

export interface ContentItemBreakdown {
  id: string;
  title: string;
  type: 'course' | 'book';
  revenue: number;
  currency: string;
  views: number;
  enrollments: number;
  createdAt: Date;
}

export interface CreatorDashboardStats {
  creatorId: string;
  totalRevenue: number;
  totalViews: number;
  totalEnrollments: number;
  period: TimeFilterPeriod;
  coursesBreakdown: ContentItemBreakdown[];
  booksBreakdown: ContentItemBreakdown[];
}
