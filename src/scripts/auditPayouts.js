// scripts/auditPayouts.js
import dotenv from "dotenv";
import connectDB from "../config/db.js";
import { recalculateBalancesFromLedger } from "../services/payoutService.js";
import logger from "../config/logger.js";
import mongoose from "mongoose";

dotenv.config();

const runAudit = async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      await connectDB();
    }

    logger.info("Starting educator earnings ledger audit...");
    const { isExact, auditReport } = await recalculateBalancesFromLedger();

    logger.info(`Audit completed. Checked ${auditReport.length} educator balance record(s).`);

    for (const report of auditReport) {
      if (report.match) {
        logger.info(
          `✅ Educator ${report.educatorId}: Owed [stored ${report.storedOwed} == computed ${report.computedOwed}], Settled [stored ${report.storedSettled} == computed ${report.computedSettled}]`
        );
      } else {
        logger.error(
          `❌ Educator ${report.educatorId} MISMATCH: Owed [stored ${report.storedOwed} vs computed ${report.computedOwed}], Settled [stored ${report.storedSettled} vs computed ${report.computedSettled}]`
        );
      }
    }

    if (!isExact) {
      logger.error("Audit failed: Educator balance mismatch detected.");
      process.exit(1);
    }

    logger.info("✅ Audit passed: All stored balances match ledger entries exactly.");
    process.exit(0);
  } catch (error) {
    logger.error("Audit script error:", error);
    process.exit(1);
  }
};

runAudit();
