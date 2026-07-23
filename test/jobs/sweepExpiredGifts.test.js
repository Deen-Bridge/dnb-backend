import { jest } from "@jest/globals";
import { sweepExpiredGifts } from "../../src/jobs/sweepExpiredGifts.js";
import GiftClaim from "../../src/models/GiftClaim.js";
import * as stellarService from "../../src/services/stellar/stellarService.js";

describe("Sweep Expired Gifts Job", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("marks open expired gifts as expired when balance exists", async () => {
    const giftMock = { _id: "gift1", balanceId: "bal1", status: "open", save: jest.fn() };
    jest.spyOn(GiftClaim, "find").mockResolvedValue([giftMock]);
    jest.spyOn(stellarService.server, "claimableBalances").mockReturnValue({
      claimableBalance: () => ({
        call: async () => ({ id: "bal1" }),
      }),
    });

    await sweepExpiredGifts();

    expect(GiftClaim.find).toHaveBeenCalledWith({
      status: "open",
      claimExpiryDate: { $lt: expect.any(Date) },
    });
    expect(giftMock.status).toBe("expired");
    expect(giftMock.save).toHaveBeenCalled();
  });

  it("marks open expired gifts as expired when balance returns 404", async () => {
    const giftMock = { _id: "gift2", balanceId: "bal2", status: "open", save: jest.fn() };
    jest.spyOn(GiftClaim, "find").mockResolvedValue([giftMock]);
    
    const notFoundError = new Error("Not Found");
    notFoundError.response = { status: 404 };
    jest.spyOn(stellarService.server, "claimableBalances").mockReturnValue({
      claimableBalance: () => ({
        call: async () => { throw notFoundError; },
      }),
    });

    await sweepExpiredGifts();

    expect(GiftClaim.find).toHaveBeenCalledWith({
      status: "open",
      claimExpiryDate: { $lt: expect.any(Date) },
    });
    expect(giftMock.status).toBe("expired");
    expect(giftMock.save).toHaveBeenCalled();
  });

  it("skips gift if Horizon throws a non-404 error", async () => {
    const giftMock = { _id: "gift3", balanceId: "bal3", status: "open", save: jest.fn() };
    jest.spyOn(GiftClaim, "find").mockResolvedValue([giftMock]);
    
    const serverError = new Error("Internal Server Error");
    serverError.response = { status: 500 };
    jest.spyOn(stellarService.server, "claimableBalances").mockReturnValue({
      claimableBalance: () => ({
        call: async () => { throw serverError; },
      }),
    });

    await sweepExpiredGifts();

    expect(giftMock.status).toBe("open"); // Should NOT change to expired
    expect(giftMock.save).not.toHaveBeenCalled();
  });
});
