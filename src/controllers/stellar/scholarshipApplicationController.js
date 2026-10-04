import mongoose from "mongoose";
import ScholarshipApplication from "../../models/ScholarshipApplication.js";
import logger from "../../config/logger.js";

const MIN_REVIEWERS = 2;
const SCORE_FIELDS = ["need", "studyPlan", "impact", "eligibility"];
const cycleId = () => process.env.SCHOLARSHIP_CYCLE_ID || "current";
const eligibilityRules = () => (process.env.SCHOLARSHIP_ELIGIBILITY_RULES || "").trim();
const fundingPolicy = () => (process.env.SCHOLARSHIP_FUNDING_POLICY || "").trim();
const applicationsOpen = () =>
  process.env.SCHOLARSHIP_APPLICATIONS_OPEN === "true" &&
  eligibilityRules().length >= 30 &&
  fundingPolicy().length >= 30;
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const ensureApplicationIndexes = () => Promise.all([
  ScholarshipApplication.collection.createIndex(
    { cycleId: 1, applicant: 1 },
    { unique: true, name: "unique_scholarship_applicant_per_cycle" }
  ),
  ScholarshipApplication.collection.createIndex(
    { cycleId: 1 },
    { unique: true, partialFilterExpression: { status: "selected" }, name: "one_selected_scholarship_per_cycle" }
  ),
]);

const serializeApplication = (application, { includePrivate = false } = {}) => {
  const result = {
    id: application._id,
    status: application.status,
    requestedAmountUsdc: application.requestedAmountUsdc,
    studyGoal: application.studyGoal,
    needStatement: application.needStatement,
    eligibilityRules: application.eligibilityRulesSnapshot,
    fundingPolicy: application.fundingPolicySnapshot,
    submittedAt: application.createdAt,
    reviews: application.reviews.map((review) => ({
      reviewer: includePrivate ? String(review.reviewer) : undefined,
      scores: review.scores,
      recommendation: review.recommendation,
      note: review.note,
      reviewedAt: review.reviewedAt,
    })),
    decision: application.decision?.reason
      ? { reason: application.decision.reason, decidedAt: application.decision.decidedAt }
      : null,
  };
  if (includePrivate) result.applicantId = String(application.applicant);
  return result;
};

export const getScholarshipApplicationConfig = (_req, res) =>
  res.status(200).json({
    success: true,
    applicationsOpen: applicationsOpen(),
    cycleId: cycleId(),
    eligibilityRules: eligibilityRules(),
    fundingPolicy: fundingPolicy(),
    minimumIndependentReviews: MIN_REVIEWERS,
    scoringCriteria: [
      { id: "need", label: "Financial need", description: "How clearly the applicant explains the need for support." },
      { id: "studyPlan", label: "Study plan", description: "Specificity and feasibility of the learning goal." },
      { id: "impact", label: "Expected impact", description: "Likely benefit to the applicant and their community." },
      { id: "eligibility", label: "Eligibility fit", description: "How well the application meets the published round rules." },
    ],
    selectionRule: "At least two different reviewers must support the application; average score must be 3/5 or higher; one recipient may be selected per cycle.",
    privacy: "Applications and review notes are private to the applicant and authorized administrators. Do not submit identity documents or secret keys.",
  });

export const submitScholarshipApplication = async (req, res) => {
  if (!applicationsOpen()) return fail(res, 409, "Scholarship applications are not open yet");
  const { requestedAmountUsdc, studyGoal, needStatement, eligibilityConfirmed } = req.body || {};
  const amount = String(requestedAmountUsdc ?? "").trim();
  if (!/^(?:[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(amount)) {
    return fail(res, 400, "Requested amount must be between 1 and 999999.99 USDC");
  }
  if (typeof studyGoal !== "string" || studyGoal.trim().length < 50 || studyGoal.trim().length > 1600) {
    return fail(res, 400, "Study goal must be between 50 and 1600 characters");
  }
  if (typeof needStatement !== "string" || needStatement.trim().length < 50 || needStatement.trim().length > 1600) {
    return fail(res, 400, "Need statement must be between 50 and 1600 characters");
  }
  if (eligibilityConfirmed !== true) return fail(res, 400, "Confirm that you meet this round's eligibility rules");

  try {
    await ensureApplicationIndexes();
    const application = await ScholarshipApplication.create({
      cycleId: cycleId(),
      applicant: req.user._id,
      requestedAmountUsdc: amount,
      studyGoal: studyGoal.trim(),
      needStatement: needStatement.trim(),
      eligibilityConfirmed,
      eligibilityRulesSnapshot: eligibilityRules(),
      fundingPolicySnapshot: fundingPolicy(),
    });
    return res.status(201).json({ success: true, application: serializeApplication(application) });
  } catch (error) {
    if (error.code === 11000) return fail(res, 409, "You already have an application in this scholarship round");
    logger.error({ message: error.message }, "Scholarship application submission failed");
    return fail(res, 503, "Could not submit the scholarship application");
  }
};

export const getMyScholarshipApplication = async (req, res) => {
  try {
    const application = await ScholarshipApplication.findOne({ cycleId: cycleId(), applicant: req.user._id });
    return res.status(200).json({
      success: true,
      applicationsOpen: applicationsOpen(),
      application: application ? serializeApplication(application) : null,
    });
  } catch (error) {
    logger.error({ message: error.message }, "Scholarship application lookup failed");
    return fail(res, 503, "Could not retrieve scholarship application");
  }
};

export const listScholarshipApplicationsForReview = async (req, res) => {
  try {
    const applications = await ScholarshipApplication.find({
      cycleId: cycleId(),
      status: "submitted",
      applicant: { $ne: req.user._id },
    })
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();
    return res.status(200).json({
      success: true,
      applications: applications.map((application) => serializeApplication(application, { includePrivate: true })),
    });
  } catch (error) {
    logger.error({ message: error.message }, "Scholarship review queue lookup failed");
    return fail(res, 503, "Could not retrieve scholarship review queue");
  }
};

export const reviewScholarshipApplication = async (req, res) => {
  const { scores, recommendation, note } = req.body || {};
  if (!scores || SCORE_FIELDS.some((field) => !Number.isInteger(scores[field]) || scores[field] < 1 || scores[field] > 5)) {
    return fail(res, 400, "Provide a 1–5 score for every published review criterion");
  }
  if (!["support", "do_not_support"].includes(recommendation)) {
    return fail(res, 400, "Recommendation must be support or do_not_support");
  }
  if (typeof note !== "string" || note.trim().length < 20 || note.trim().length > 1200) {
    return fail(res, 400, "Review note must be between 20 and 1200 characters");
  }
  if (!mongoose.isValidObjectId(req.params.applicationId)) return fail(res, 400, "Invalid application ID");

  try {
    const application = await ScholarshipApplication.findOneAndUpdate(
      {
        _id: req.params.applicationId,
        cycleId: cycleId(),
        status: "submitted",
        applicant: { $ne: req.user._id },
        "reviews.reviewer": { $ne: req.user._id },
      },
      {
        $push: {
          reviews: {
            reviewer: req.user._id,
            scores: Object.fromEntries(SCORE_FIELDS.map((field) => [field, scores[field]])),
            recommendation,
            note: note.trim(),
          },
        },
      },
      { new: true, runValidators: true }
    );
    if (application) return res.status(201).json({ success: true, application: serializeApplication(application, { includePrivate: true }) });

    const existing = await ScholarshipApplication.findOne({ _id: req.params.applicationId, cycleId: cycleId() });
    if (!existing) return fail(res, 404, "Application not found");
    if (String(existing.applicant) === String(req.user._id)) return fail(res, 403, "Reviewers cannot review their own application");
    if (existing.reviews.some((review) => String(review.reviewer) === String(req.user._id))) return fail(res, 409, "You have already reviewed this application");
    return fail(res, 409, "This application is no longer open for review");
  } catch (error) {
    logger.error({ message: error.message }, "Scholarship application review failed");
    return fail(res, 503, "Could not save scholarship review");
  }
};

export const decideScholarshipApplication = async (req, res) => {
  const { decision, reason } = req.body || {};
  if (!["selected", "not_selected"].includes(decision)) return fail(res, 400, "Decision must be selected or not_selected");
  if (typeof reason !== "string" || reason.trim().length < 20 || reason.trim().length > 1200) {
    return fail(res, 400, "Decision rationale must be between 20 and 1200 characters");
  }
  if (!mongoose.isValidObjectId(req.params.applicationId)) return fail(res, 400, "Invalid application ID");

  try {
    await ensureApplicationIndexes();
    const application = await ScholarshipApplication.findOne({
      _id: req.params.applicationId,
      cycleId: cycleId(),
      status: "submitted",
    });
    if (!application) return fail(res, 404, "Open application not found");
    if (application.reviews.length < MIN_REVIEWERS) return fail(res, 409, "Two independent reviews are required before a decision");

    if (decision === "selected") {
      const supportCount = application.reviews.filter((review) => review.recommendation === "support").length;
      const scoreTotal = application.reviews.reduce(
        (total, review) => total + SCORE_FIELDS.reduce((sum, field) => sum + review.scores[field], 0),
        0
      );
      const meanScore = scoreTotal / (application.reviews.length * SCORE_FIELDS.length);
      if (supportCount < 2 || supportCount <= application.reviews.length / 2 || meanScore < 3) {
        return fail(res, 409, "Selection requires at least two supporting reviewers, a majority in support, and an average score of 3/5 or higher");
      }
    }

    application.status = decision;
    application.decision = { decidedBy: req.user._id, decidedAt: new Date(), reason: reason.trim() };
    await application.save();
    return res.status(200).json({ success: true, application: serializeApplication(application, { includePrivate: true }) });
  } catch (error) {
    if (error.code === 11000) return fail(res, 409, "A recipient has already been selected for this scholarship round");
    logger.error({ message: error.message }, "Scholarship application decision failed");
    return fail(res, 503, "Could not record scholarship decision");
  }
};
