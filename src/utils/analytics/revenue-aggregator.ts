/**
 * Helper functions for revenue aggregation and formatting.
 */

/**
 * Format a number or string amount as a fixed decimal string.
 */
export const formatCurrencyAmount = (amount: number | string): string => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(num)) return "0.00";
  return num.toFixed(2);
};

/**
 * Convert revenue analytics payload to CSV format.
 */
export const revenueAnalyticsToCsv = (analytics: any): string => {
  const lines: string[] = [];
  
  lines.push("# Revenue Analytics Summary");
  lines.push(`Total Revenue,${formatCurrencyAmount(analytics.totals?.totalRevenue || 0)}`);
  lines.push(`Transaction Count,${analytics.totals?.transactionCount || 0}`);
  lines.push(`Average Transaction Value,${formatCurrencyAmount(analytics.totals?.averageTransactionValue || 0)}`);
  lines.push("");

  lines.push("# Breakdown by Item (Courses & Books)");
  lines.push("Item Type,Item ID,Title,Revenue,Transactions,Average Value");
  const items = [...(analytics.courses || []), ...(analytics.books || [])];
  for (const item of items) {
    const title = `"${String(item.title || "").replace(/"/g, '""')}"`;
    lines.push(`${item.itemType},${item.itemId},${title},${formatCurrencyAmount(item.revenue)},${item.transactionCount},${formatCurrencyAmount(item.averageTransactionValue)}`);
  }
  lines.push("");

  lines.push("# Revenue Over Time");
  lines.push("Period,Revenue,Transactions,Average Value");
  for (const bucket of (analytics.timeSeries || [])) {
    lines.push(`${bucket.period},${formatCurrencyAmount(bucket.revenue)},${bucket.transactionCount},${formatCurrencyAmount(bucket.averageTransactionValue)}`);
  }

  return lines.join("\n");
};

export default {
  formatCurrencyAmount,
  revenueAnalyticsToCsv,
};
