import crypto from "crypto";
import { Experiment, ExperimentAssignment, ExperimentConversion } from "../../models/experiment.js";
import logger from "../../config/logger.js";

/**
 * Deterministically hash a string to a floating point number between 0 and 100.
 */
export const hashToPercentage = (str: string): number => {
  const hash = crypto.createHash("sha256").update(str).digest("hex");
  const intVal = parseInt(hash.slice(0, 8), 16);
  return (intVal % 10000) / 100;
};

/**
 * Assign a user/session to an experiment variant based on weights and targeting.
 */
export const assignVariant = async (experimentKey: string, identifier: string, userId?: string | null): Promise<string | null> => {
  try {
    const experiment = await Experiment.findOne({ key: experimentKey, status: "running" }).lean();
    if (!experiment || !experiment.variants || experiment.variants.length === 0) {
      return null;
    }

    // Check targeting percentage
    const targetingPercentage = experiment.targeting?.percentage ?? 100;
    const bucket = hashToPercentage(`${experimentKey}:${identifier}`);
    if (bucket > targetingPercentage) {
      return null; // Not targeted
    }

    // Check existing assignment in DB
    const query: any = { experimentKey, sessionId: identifier };
    if (userId) {
      query.$or = [{ userId }, { sessionId: identifier }];
    }

    let existing = await ExperimentAssignment.findOne(query);
    if (existing) {
      return existing.variantName;
    }

    // Select variant by weight
    const totalWeight = experiment.variants.reduce((sum: number, v: any) => sum + v.weight, 0);
    if (totalWeight <= 0) return null;

    const roll = hashToPercentage(`${experimentKey}:${identifier}:variant`) / 100 * totalWeight;
    let cumulative = 0;
    let selectedVariant = experiment.variants[0].name;

    for (const v of experiment.variants) {
      cumulative += v.weight;
      if (roll <= cumulative) {
        selectedVariant = v.name;
        break;
      }
    }

    // Save assignment
    await ExperimentAssignment.create({
      experimentKey,
      userId: userId || undefined,
      sessionId: identifier,
      variantName: selectedVariant,
      assignedAt: new Date(),
    }).catch(() => {
      // Handle race condition on duplicate unique index
    });

    return selectedVariant;
  } catch (error) {
    logger.error("Error assigning experiment variant:", error);
    return null;
  }
};

/**
 * Track conversion metric per variant.
 */
export const trackConversion = async (data: {
  experimentKey: string;
  metricName: string;
  identifier: string;
  userId?: string | null;
  value?: number;
  metadata?: Record<string, any>;
}): Promise<boolean> => {
  try {
    const { experimentKey, metricName, identifier, userId, value = 1, metadata } = data;

    const query: any = { experimentKey, sessionId: identifier };
    if (userId) {
      query.$or = [{ userId }, { sessionId: identifier }];
    }

    const assignment = await ExperimentAssignment.findOne(query).lean();
    if (!assignment) {
      return false;
    }

    await ExperimentConversion.create({
      experimentKey,
      variantName: assignment.variantName,
      userId: userId || undefined,
      sessionId: identifier,
      metricName,
      value,
      metadata: metadata || {},
      createdAt: new Date(),
    });

    return true;
  } catch (error) {
    logger.error("Error tracking experiment conversion:", error);
    return false;
  }
};

/**
 * Calculate Z-score and statistical significance between variants.
 */
export const calculateSignificance = async (experimentKey: string, metricName: string = "conversion") => {
  const experiment = await Experiment.findOne({ key: experimentKey }).lean();
  if (!experiment) {
    throw new Error("Experiment not found");
  }

  const variants = experiment.variants;
  const results: Record<string, any> = {};

  for (const v of variants) {
    const variantName = v.name;
    const participants = await ExperimentAssignment.countDocuments({ experimentKey, variantName });
    const conversions = await ExperimentConversion.countDocuments({ experimentKey, variantName, metricName });
    const conversionRate = participants > 0 ? conversions / participants : 0;

    results[variantName] = {
      participants,
      conversions,
      conversionRate,
    };
  }

  // Compare variants (e.g. first variant as control, others as treatments)
  const variantNames = variants.map((v: any) => v.name);
  const comparisons: Record<string, any> = {};

  if (variantNames.length >= 2) {
    const controlName = variantNames[0];
    const control = results[controlName];

    for (let i = 1; i < variantNames.length; i++) {
      const treatmentName = variantNames[i];
      const treatment = results[treatmentName];

      const n1 = control.participants;
      const p1 = control.conversionRate;
      const n2 = treatment.participants;
      const p2 = treatment.conversionRate;

      let zScore = 0;
      let pValue = 1;
      let significant = false;

      if (n1 > 0 && n2 > 0) {
        const pPool = (control.conversions + treatment.conversions) / (n1 + n2);
        const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
        if (se > 0) {
          zScore = (p2 - p1) / se;
          // Approximate two-tailed p-value from z-score
          pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
          significant = pValue < 0.05;
        }
      }

      comparisons[treatmentName] = {
        control: controlName,
        lift: p1 > 0 ? ((p2 - p1) / p1) * 100 : 0,
        zScore,
        pValue,
        significant,
      };
    }
  }

  return {
    experimentKey,
    metricName,
    variants: results,
    comparisons,
  };
};

/**
 * Helper for standard normal cumulative distribution function.
 */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const prob =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x >= 0 ? 1 - prob : prob;
}

export default {
  assignVariant,
  trackConversion,
  calculateSignificance,
};
