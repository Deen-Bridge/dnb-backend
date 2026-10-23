# Scholarship application and review process

Scholarship applications are separate from Sadaqah donations and from the Soroban escrow that holds campaign USDC. The application API stores only the requested USDC amount, a study goal, a need statement, and an eligibility self-attestation. It does not collect identity documents, wallet secret keys, or seed phrases. Applicants can read only their own record; the review queue is restricted to admins, whose access is protected by the existing 2FA middleware.

## Opening a round

Set `SCHOLARSHIP_CYCLE_ID` to a unique value for the round and publish its actual rules in `SCHOLARSHIP_ELIGIBILITY_RULES`. Publish the award amount or range, milestone schedule, expiry, and refunds in `SCHOLARSHIP_FUNDING_POLICY`. Only then set `SCHOLARSHIP_APPLICATIONS_OPEN=true`. The API keeps applications closed unless the explicit switch and at least 30 characters in both policy fields are present. Set a new cycle ID for the next round. Each account may apply once per round.

The app publishes four 1–5 scoring criteria: financial need, study plan, expected impact, and eligibility fit. Two different admins must submit reviews. Selection requires at least two supporting reviews, a majority in support, an average score of at least 3/5, and no prior selected recipient in the cycle. The decision must include a rationale. A reviewer cannot assess their own application. Rejected applicants can see their decision rationale; reviewers' identities remain private to applicants.

## Stellar funding after selection

Selection does not move money or publish applicant details on-chain. Agree on the final award, public beneficiary G-address, arbiter, milestone descriptions and USDC amounts, expiry, and refund rules after the panel decision. Then deploy and initialize a dedicated Soroban escrow for the round, configure `SCHOLARSHIP_ESCROW_CONTRACT_ID`, and verify the initialized state on the intended network. The escrow is separate from direct Stellar Sadaqah payments. Contributors sign USDC funding transactions in their own wallet; after each private evidence review, the arbiter signs the corresponding on-chain milestone release. Publish only the decision summary and Stellar transaction links, never private application material.

Applicants use `GET /api/stellar/scholarships/applications/config` to read the round rules, then `POST /api/stellar/scholarships/applications` and `GET /api/stellar/scholarships/applications/me`. Admins use `GET /api/stellar/scholarships/applications/review`, `POST /api/stellar/scholarships/applications/{id}/reviews`, and `POST /api/stellar/scholarships/applications/{id}/decision`. Admin decisions require the platform's 2FA-verified session. The round must remain closed until the actual criteria and the fundraising/refund policy have been reviewed and configured.
