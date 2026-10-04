import {
  decideScholarshipApplication,
  getScholarshipApplicationConfig,
  reviewScholarshipApplication,
  submitScholarshipApplication,
} from "../src/controllers/stellar/scholarshipApplicationController.js";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import ScholarshipApplication from "../src/models/ScholarshipApplication.js";

const ENV_KEYS = ["SCHOLARSHIP_APPLICATIONS_OPEN", "SCHOLARSHIP_CYCLE_ID", "SCHOLARSHIP_ELIGIBILITY_RULES", "SCHOLARSHIP_FUNDING_POLICY"];
let originalEnv;
let mongoServer;

const response = () => {
  const result = {};
  return {
    result,
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
};

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
});

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await ScholarshipApplication.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer?.stop();
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("scholarship application round configuration", () => {
  it("keeps the application round closed without explicit switch and published rules", () => {
    const res = response();
    getScholarshipApplicationConfig({}, res);
    expect(res.result.body.applicationsOpen).toBe(false);

    process.env.SCHOLARSHIP_APPLICATIONS_OPEN = "true";
    getScholarshipApplicationConfig({}, res);
    expect(res.result.body.applicationsOpen).toBe(false);

    process.env.SCHOLARSHIP_ELIGIBILITY_RULES = "Applicants must meet published eligibility requirements for this round.";
    getScholarshipApplicationConfig({}, res);
    expect(res.result.body.applicationsOpen).toBe(false);

    process.env.SCHOLARSHIP_FUNDING_POLICY = "The round publishes award amounts, milestones, expiry, and refund terms.";
    getScholarshipApplicationConfig({}, res);
    expect(res.result.body.applicationsOpen).toBe(true);
  });

  it("does not accept applications while the round is closed", async () => {
    const res = response();
    await submitScholarshipApplication({ body: {} }, res);
    expect(res.result.status).toBe(409);
    expect(res.result.body.message).toMatch(/not open/i);
  });

  it("rejects an invalid amount before touching the database", async () => {
    process.env.SCHOLARSHIP_APPLICATIONS_OPEN = "true";
    process.env.SCHOLARSHIP_ELIGIBILITY_RULES = "Applicants must meet published eligibility requirements for this round.";
    process.env.SCHOLARSHIP_FUNDING_POLICY = "The round publishes award amounts, milestones, expiry, and refund terms.";
    const res = response();
    await submitScholarshipApplication({ body: { requestedAmountUsdc: "0", studyGoal: "", needStatement: "" } }, res);
    expect(res.result.status).toBe(400);
    expect(res.result.body.message).toMatch(/USDC/);
  });

  it("requires two independent scored reviews and permits only one selected recipient per round", async () => {
    process.env.SCHOLARSHIP_APPLICATIONS_OPEN = "true";
    process.env.SCHOLARSHIP_CYCLE_ID = "selection-test";
    process.env.SCHOLARSHIP_ELIGIBILITY_RULES = "Applicants must meet published eligibility requirements for this round.";
    process.env.SCHOLARSHIP_FUNDING_POLICY = "The round publishes award amounts, milestones, expiry, and refund terms.";
    const applicantId = new mongoose.Types.ObjectId();
    const reviewerOne = new mongoose.Types.ObjectId();
    const reviewerTwo = new mongoose.Types.ObjectId();
    const body = {
      requestedAmountUsdc: "250.00",
      studyGoal: "I plan to complete a structured course of study and apply the learning in my local community.",
      needStatement: "I cannot cover the full tuition cost myself and need support to complete this program.",
      eligibilityConfirmed: true,
    };
    const applicationResponse = response();
    await submitScholarshipApplication({ body, user: { _id: applicantId } }, applicationResponse);
    const applicationId = applicationResponse.result.body.application.id;

    const decisionBeforeReview = response();
    await decideScholarshipApplication({
      params: { applicationId },
      body: { decision: "selected", reason: "The panel supports this applicant after consideration." },
      user: { _id: reviewerOne },
    }, decisionBeforeReview);
    expect(decisionBeforeReview.result.status).toBe(409);

    const reviewPayload = {
      scores: { need: 4, studyPlan: 4, impact: 4, eligibility: 4 },
      recommendation: "support",
      note: "The application provides a clear plan and a strong case for financial need.",
    };
    const firstReview = response();
    await reviewScholarshipApplication({ params: { applicationId }, body: reviewPayload, user: { _id: reviewerOne } }, firstReview);
    expect(firstReview.result.status).toBe(201);

    const secondReview = response();
    await reviewScholarshipApplication({ params: { applicationId }, body: reviewPayload, user: { _id: reviewerTwo } }, secondReview);
    expect(secondReview.result.status).toBe(201);

    const selected = response();
    await decideScholarshipApplication({
      params: { applicationId },
      body: { decision: "selected", reason: "The two-review panel reached the published selection threshold." },
      user: { _id: reviewerTwo },
    }, selected);
    expect(selected.result.status).toBe(200);
    expect(selected.result.body.application.status).toBe("selected");

    const nextApplicationResponse = response();
    await submitScholarshipApplication({ body, user: { _id: new mongoose.Types.ObjectId() } }, nextApplicationResponse);
    const nextApplicationId = nextApplicationResponse.result.body.application.id;
    for (const reviewer of [reviewerOne, reviewerTwo]) {
      const nextReview = response();
      await reviewScholarshipApplication({ params: { applicationId: nextApplicationId }, body: reviewPayload, user: { _id: reviewer } }, nextReview);
      expect(nextReview.result.status).toBe(201);
    }
    const secondSelection = response();
    await decideScholarshipApplication({
      params: { applicationId: nextApplicationId },
      body: { decision: "selected", reason: "The review panel supports this applicant after consideration." },
      user: { _id: reviewerOne },
    }, secondSelection);
    expect(secondSelection.result.status).toBe(409);
  });
});
