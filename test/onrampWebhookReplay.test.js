import crypto from "crypto";
import { verifyWebhookSignature } from "../src/services/stellar/onrampService.js";

const KEY = "test-moonpay-webhook-key";
const body = JSON.stringify({ data: { id: "tx_1", status: "completed" } });
const header = (ts) =>
  `t=${ts},s=${crypto.createHmac("sha256", KEY).update(`${ts}.${body}`).digest("hex")}`;

describe("MoonPay inbound webhook signature (replay protection)", () => {
  const prev = process.env.MOONPAY_WEBHOOK_KEY;
  beforeAll(() => { process.env.MOONPAY_WEBHOOK_KEY = KEY; });
  afterAll(() => {
    if (prev === undefined) delete process.env.MOONPAY_WEBHOOK_KEY;
    else process.env.MOONPAY_WEBHOOK_KEY = prev;
  });

  const now = () => Math.floor(Date.now() / 1000);

  it("accepts a fresh, correctly signed delivery", () => {
    expect(verifyWebhookSignature(body, header(now()))).toBe(true);
  });
  it("rejects a correctly signed but stale (replayed) delivery", () => {
    expect(verifyWebhookSignature(body, header(now() - 3600))).toBe(false);
  });
  it("rejects a tampered body and a missing header", () => {
    expect(verifyWebhookSignature(body + " ", header(now()))).toBe(false);
    expect(verifyWebhookSignature(body, undefined)).toBe(false);
  });
});
