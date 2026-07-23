import { jest } from "@jest/globals";
import {
  preflightPayment,
  isMemoRequired,
  MEMO_REQUIRED_DATA_KEY,
  PREFLIGHT_REASON_CODES,
  USDC_ISSUER,
  server,
} from "../src/services/stellar/stellarService.js";

const SOURCE = "GASOURCE000000000000000000000000000000000000000000000000";
const DESTINATION = "GADEST0000000000000000000000000000000000000000000000000";

const memoRequiredDataAttr = () => ({
  [MEMO_REQUIRED_DATA_KEY]: Buffer.from("1").toString("base64"),
});

const fundedAccount = ({
  xlm = "10",
  usdc = "100",
  hasTrustline = true,
  subentryCount = 1,
  dataAttr,
} = {}) => ({
  balances: [
    { asset_type: "native", balance: xlm },
    ...(hasTrustline
      ? [{ asset_code: "USDC", asset_issuer: USDC_ISSUER, balance: usdc }]
      : []),
  ],
  subentry_count: subentryCount,
  ...(dataAttr && { data_attr: dataAttr }),
});

const notFoundError = () => {
  const error = new Error("Not Found");
  error.response = { status: 404 };
  return error;
};

const mockLoadAccount = (impl) => {
  jest.spyOn(server, "loadAccount").mockImplementation(impl);
};

describe("preflightPayment", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("passes with no reasons when source and destination are both healthy", async () => {
    mockLoadAccount(async (key) =>
      key === SOURCE ? fundedAccount() : fundedAccount()
    );

    const result = await preflightPayment({
      sourcePublicKey: SOURCE,
      destinationPublicKey: DESTINATION,
      amount: "50",
      memo: "DNB-BOOK-12345678",
    });

    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("flags destination_account_missing when destination is unfunded (404)", async () => {
    mockLoadAccount(async (key) => {
      if (key === DESTINATION) throw notFoundError();
      return fundedAccount();
    });

    const result = await preflightPayment({
      sourcePublicKey: SOURCE,
      destinationPublicKey: DESTINATION,
      amount: "50",
      memo: "DNB-BOOK-12345678",
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain(
      PREFLIGHT_REASON_CODES.DESTINATION_ACCOUNT_MISSING
    );
  });

  it("flags source_account_missing when source is unfunded (404)", async () => {
    mockLoadAccount(async (key) => {
      if (key === SOURCE) throw notFoundError();
      return fundedAccount();
    });

    const result = await preflightPayment({
      sourcePublicKey: SOURCE,
      destinationPublicKey: DESTINATION,
      amount: "50",
      memo: "DNB-BOOK-12345678",
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain(
      PREFLIGHT_REASON_CODES.SOURCE_ACCOUNT_MISSING
    );
  });

  it("flags destination_no_trustline when the destination has no USDC trustline", async () => {
    mockLoadAccount(async (key) =>
      key === DESTINATION
        ? fundedAccount({ hasTrustline: false })
        : fundedAccount()
    );

    const result = await preflightPayment({
      sourcePublicKey: SOURCE,
      destinationPublicKey: DESTINATION,
      amount: "50",
      memo: "DNB-BOOK-12345678",
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain(
      PREFLIGHT_REASON_CODES.DESTINATION_NO_TRUSTLINE
    );
  });

  it("flags source_insufficient_balance when the source USDC balance is too low", async () => {
    mockLoadAccount(async (key) =>
      key === SOURCE ? fundedAccount({ usdc: "10" }) : fundedAccount()
    );

    const result = await preflightPayment({
      sourcePublicKey: SOURCE,
      destinationPublicKey: DESTINATION,
      amount: "50",
      memo: "DNB-BOOK-12345678",
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain(
      PREFLIGHT_REASON_CODES.SOURCE_INSUFFICIENT_BALANCE
    );
  });

  it("flags source_insufficient_reserve when XLM balance can't cover the minimum reserve", async () => {
    mockLoadAccount(async (key) =>
      key === SOURCE
        ? fundedAccount({ xlm: "0.5", subentryCount: 1 })
        : fundedAccount()
    );

    const result = await preflightPayment({
      sourcePublicKey: SOURCE,
      destinationPublicKey: DESTINATION,
      amount: "50",
      memo: "DNB-BOOK-12345678",
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain(
      PREFLIGHT_REASON_CODES.SOURCE_INSUFFICIENT_RESERVE
    );
  });

  it("accounts for extra operations (fee split) when computing the reserve/fee floor", async () => {
    // (2 + 1 subentry) * 0.5 XLM = 1.5 XLM reserve, plus 2 ops * BASE_FEE.
    // 1.500011 XLM covers 1 op but not 2.
    mockLoadAccount(async (key) =>
      key === SOURCE
        ? fundedAccount({ xlm: "1.500011", subentryCount: 1 })
        : fundedAccount()
    );

    const singleOp = await preflightPayment({
      sourcePublicKey: SOURCE,
      destinationPublicKey: DESTINATION,
      amount: "50",
      memo: "DNB-BOOK-12345678",
      operationCount: 1,
    });
    expect(singleOp.ok).toBe(true);

    const twoOps = await preflightPayment({
      sourcePublicKey: SOURCE,
      destinationPublicKey: DESTINATION,
      amount: "50",
      memo: "DNB-BOOK-12345678",
      operationCount: 2,
    });
    expect(twoOps.ok).toBe(false);
    expect(twoOps.reasons.map((r) => r.code)).toContain(
      PREFLIGHT_REASON_CODES.SOURCE_INSUFFICIENT_RESERVE
    );
  });

  it("SEP-29: flags destination_memo_required when the destination requires a memo and none is given", async () => {
    mockLoadAccount(async (key) =>
      key === DESTINATION
        ? fundedAccount({ dataAttr: memoRequiredDataAttr() })
        : fundedAccount()
    );

    const result = await preflightPayment({
      sourcePublicKey: SOURCE,
      destinationPublicKey: DESTINATION,
      amount: "50",
      memo: "",
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain(
      PREFLIGHT_REASON_CODES.DESTINATION_MEMO_REQUIRED
    );
  });

  it("SEP-29: passes when the destination requires a memo and a compliant memo is supplied", async () => {
    mockLoadAccount(async (key) =>
      key === DESTINATION
        ? fundedAccount({ dataAttr: memoRequiredDataAttr() })
        : fundedAccount()
    );

    const result = await preflightPayment({
      sourcePublicKey: SOURCE,
      destinationPublicKey: DESTINATION,
      amount: "50",
      memo: "DNB-BOOK-12345678",
    });

    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("collects multiple reasons at once rather than short-circuiting", async () => {
    mockLoadAccount(async (key) => {
      if (key === DESTINATION) throw notFoundError();
      return fundedAccount({ usdc: "0", xlm: "0.1" });
    });

    const result = await preflightPayment({
      sourcePublicKey: SOURCE,
      destinationPublicKey: DESTINATION,
      amount: "50",
      memo: "DNB-BOOK-12345678",
    });

    expect(result.ok).toBe(false);
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain(PREFLIGHT_REASON_CODES.DESTINATION_ACCOUNT_MISSING);
    expect(codes).toContain(PREFLIGHT_REASON_CODES.SOURCE_INSUFFICIENT_BALANCE);
    expect(codes).toContain(PREFLIGHT_REASON_CODES.SOURCE_INSUFFICIENT_RESERVE);
  });
});

describe("isMemoRequired", () => {
  it("returns false when there is no config.memo_required data entry", () => {
    expect(isMemoRequired(fundedAccount())).toBe(false);
  });

  it("returns true when config.memo_required is base64-encoded '1'", () => {
    expect(
      isMemoRequired(fundedAccount({ dataAttr: memoRequiredDataAttr() }))
    ).toBe(true);
  });

  it("returns false for a falsy encoded value", () => {
    const dataAttr = { [MEMO_REQUIRED_DATA_KEY]: Buffer.from("0").toString("base64") };
    expect(isMemoRequired(fundedAccount({ dataAttr }))).toBe(false);
  });

  it("returns false when given no account", () => {
    expect(isMemoRequired(null)).toBe(false);
    expect(isMemoRequired(undefined)).toBe(false);
  });
});
