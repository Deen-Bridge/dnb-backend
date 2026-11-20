# Jest coverage gate

Coverage is a release gate, not a locally committed artifact. The policy lives in
.github/coverage-thresholds.json and is loaded by jest.config.js, so the
thresholds used locally and in CI are the same. npm test remains the fast
non-coverage suite; use npm run test:coverage to exercise the gate locally.

CI runs the normal suite, validates the policy, then runs Jest with coverage and
uploads the coverage/ directory as the backend-coverage artifact. Generated
coverage stays ignored and is retained for 14 days.

## Minimums

The global minimum starts at 20% lines and statements, 15% functions, and 10%
branches. The critical-path floors are higher and are explicit in the policy:

- authentication: src/controllers/authController.js
- payments: src/controllers/stellar/paymentController.js
- webhooks: src/controllers/webhookController.js
- scholarship escrow: src/services/scholarshipEscrowStateMachine.js
- admin authorization: src/middlewares/authorize.js
- privacy/authentication middleware: src/middlewares/authMiddleware.js

The critical inventory includes negative and abuse-case suites such as
authentication failures, authorization denial, payment replay/idempotency,
webhook replay/signature failures, scholarship state rejection, and privacy
redaction checks. Add or update those tests when changing a critical path.

Threshold changes must be reviewed in the same change as the policy file.
npm run verify:coverage-policy rejects malformed values and missing path
metadata; lowering a threshold is therefore visible in the reviewed diff and
cannot happen silently through CI configuration drift.

## Local commands

    npm run verify:coverage-policy
    npm run test:coverage

The coverage command may require the repository's normal npm ci setup and
MongoDB/Redis test services, just like the existing test suite.
