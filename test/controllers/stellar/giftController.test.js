import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { initializeGift, submitGift, initializeClaim, submitClaim } from "../../../src/controllers/stellar/giftController.js";
import User from "../../../src/models/User.js";
import Course from "../../../src/models/Course.js";
import GiftClaim from "../../../src/models/GiftClaim.js";
import * as stellarService from "../../../src/services/stellar/stellarService.js";
import * as StellarSdk from "@stellar/stellar-sdk";

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Gift Controller", () => {
  let sessionSpy;

  beforeAll(() => {
    sessionSpy = jest.spyOn(mongoose, "startSession").mockResolvedValue({
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("initializeGift", () => {
    it("returns 400 if recipient has no wallet", async () => {
      jest.spyOn(User, "findById").mockImplementation((id) => {
        if (id === "sender") return { session: () => ({ stellarWallet: { publicKey: "G123" } }) };
        if (id === "recipient") return { session: () => ({ stellarWallet: null }) }; // No wallet
      });

      const req = { user: { _id: "sender" }, body: { itemType: "course", itemId: "course1", recipientUserId: "recipient" } };
      const res = mockRes();

      await initializeGift(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Recipient does not have a connected Stellar wallet" }));
    });

    it("returns 400 if recipient already owns item", async () => {
      jest.spyOn(User, "findById").mockImplementation((id) => {
        if (id === "sender") return { session: () => ({ stellarWallet: { publicKey: "G123" } }) };
        if (id === "recipient") return { session: () => ({ stellarWallet: { publicKey: "G456" }, purchasedCourses: [{ courseId: "course1" }] }) };
      });
      jest.spyOn(Course, "findById").mockImplementation(() => ({
        populate: () => ({ session: () => ({ _id: "course1", price: 10, title: "Test Course", createdBy: {} }) })
      }));

      const req = { user: { _id: "sender" }, body: { itemType: "course", itemId: "course1", recipientUserId: "recipient" } };
      const res = mockRes();

      await initializeGift(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Recipient already owns this item" }));
    });

    it("returns 400 if there is a duplicate pending gift", async () => {
      jest.spyOn(User, "findById").mockImplementation((id) => {
        if (id === "sender") return { session: () => ({ stellarWallet: { publicKey: "G123" } }) };
        if (id === "recipient") return { session: () => ({ stellarWallet: { publicKey: "G456" } }) };
      });
      jest.spyOn(Course, "findById").mockImplementation(() => ({
        populate: () => ({ session: () => ({ _id: "course1", price: 10, title: "Test Course", createdBy: {} }) })
      }));
      jest.spyOn(GiftClaim, "findOne").mockImplementation(() => ({ session: () => ({ _id: "pending_gift" }) }));

      const req = { user: { _id: "sender" }, body: { itemType: "course", itemId: "course1", recipientUserId: "recipient" } };
      const res = mockRes();

      await initializeGift(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "You have a pending gift transaction for this item to this recipient" }));
    });
  });

  describe("submitGift", () => {
    let validXdr;
    beforeAll(() => {
      const kp = StellarSdk.Keypair.random();
      const tx = new StellarSdk.TransactionBuilder(
        new StellarSdk.Account(kp.publicKey(), "1"),
        { fee: "100", networkPassphrase: stellarService.networkPassphrase }
      )
        .setTimeout(300)
        .addOperation(StellarSdk.Operation.payment({ destination: kp.publicKey(), asset: StellarSdk.Asset.native(), amount: "10" }))
        .build();
      validXdr = tx.toXDR();
    });

    it("rejects tampered signed XDR before any DB change", async () => {
      const giftMock = { _id: "gift1", sender: "sender", status: "pending_signature", amount: "10", itemType: "course", itemId: "course1", save: jest.fn() };
      jest.spyOn(GiftClaim, "findOne").mockImplementation(() => ({ session: () => giftMock }));
      
      // Simulate transaction submission success
      jest.spyOn(stellarService.server, "submitTransaction").mockResolvedValue({ hash: "tampered_tx", ledger: 1, successful: true });

      const itemMock = { _id: "course1", createdBy: { stellarWallet: { publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" } } };
      jest.spyOn(Course, "findById").mockImplementation(() => ({
        populate: () => ({ session: () => itemMock })
      }));

      // Simulate verification failure (tampered)
      jest.spyOn(stellarService.server, "transactions").mockReturnValue({
        transaction: () => ({
          call: async () => ({ successful: false, ledger: 1, created_at: new Date().toISOString() }),
        }),
      });
      jest.spyOn(stellarService.server, "operations").mockReturnValue({
        forTransaction: () => ({
          call: async () => ({ records: [] }),
        }),
      });

      const req = { user: { _id: "sender" }, body: { giftId: "gift1", signedXdr: validXdr, variant: "direct_payment" } };
      const res = mockRes();

      await submitGift(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("On-chain verification failed") }));
      expect(giftMock.status).toBe("pending_signature"); // DB change for granting access did not happen
    });

    it("grants access to recipient not payer on success", async () => {
      const recipientMock = { _id: "recipient", purchasedCourses: [], save: jest.fn() };
      const giftMock = { _id: "gift1", sender: "sender", recipient: "recipient", status: "pending_signature", amount: "10", itemType: "course", itemId: "course1", save: jest.fn() };
      
      jest.spyOn(GiftClaim, "findOne").mockImplementation(() => ({ session: () => giftMock }));
      jest.spyOn(User, "findById").mockImplementation((id) => {
        if (id === "recipient") return { session: () => recipientMock };
      });
      jest.spyOn(Course, "findById").mockImplementation(() => ({
        populate: () => ({ session: () => ({ _id: "course1", createdBy: { stellarWallet: { publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" } } }) })
      }));
      jest.spyOn(Course, "findByIdAndUpdate").mockResolvedValue({});
      
      jest.spyOn(stellarService.server, "submitTransaction").mockResolvedValue({ hash: "valid_tx", ledger: 1, successful: true });
      jest.spyOn(stellarService.server, "transactions").mockReturnValue({
        transaction: () => ({
          call: async () => ({ successful: true, ledger: 1, created_at: new Date().toISOString() }),
        }),
      });
      jest.spyOn(stellarService.server, "operations").mockReturnValue({
        forTransaction: () => ({
          call: async () => ({ records: [] }),
        }),
      });

      const req = { user: { _id: "sender" }, body: { giftId: "gift1", signedXdr: validXdr, variant: "direct_payment" } };
      const res = mockRes();

      await submitGift(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(giftMock.status).toBe("claimed");
      expect(giftMock.save).toHaveBeenCalled();
      
      // Access granted to recipient
      expect(recipientMock.purchasedCourses.length).toBe(1);
      expect(recipientMock.purchasedCourses[0].courseId).toBe("course1");
      expect(recipientMock.save).toHaveBeenCalled();
    });
  });

  describe("initializeClaim", () => {
    it("rejects if not the creator", async () => {
      const giftMock = { _id: "gift1", status: "open", balanceId: "123", itemType: "course", itemId: "course1" };
      jest.spyOn(GiftClaim, "findById").mockResolvedValue(giftMock);
      
      const itemMock = { _id: "course1", createdBy: "creator_id" }; // Not the caller
      jest.spyOn(Course, "findById").mockResolvedValue(itemMock);

      const req = { user: { _id: "other_user" }, body: { giftId: "gift1" } };
      const res = mockRes();

      await initializeClaim(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Only the creator of this item can claim it") }));
    });

    it("rejects if gift is already claimed", async () => {
      const giftMock = { _id: "gift1", status: "claimed", balanceId: "123" };
      jest.spyOn(GiftClaim, "findById").mockResolvedValue(giftMock);

      const req = { user: { _id: "creator" }, body: { giftId: "gift1" } };
      const res = mockRes();

      await initializeClaim(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Gift is not available to be claimed") }));
    });
  });

  describe("submitClaim", () => {
    let validXdr;
    beforeAll(() => {
      const kp = StellarSdk.Keypair.random();
      const tx = new StellarSdk.TransactionBuilder(
        new StellarSdk.Account(kp.publicKey(), "1"),
        { fee: "100", networkPassphrase: stellarService.networkPassphrase }
      )
        .setTimeout(300)
        .addOperation(StellarSdk.Operation.payment({ destination: kp.publicKey(), asset: StellarSdk.Asset.native(), amount: "10" }))
        .build();
      validXdr = tx.toXDR();
    });

    it("correctly marks status claimed on success", async () => {
      const giftMock = { _id: "gift1", status: "open", balanceId: "123", itemType: "course", itemId: "course1", save: jest.fn() };
      jest.spyOn(GiftClaim, "findById").mockImplementation(() => ({ session: () => giftMock }));
      
      const itemMock = { _id: "course1", createdBy: "creator_id" };
      jest.spyOn(Course, "findById").mockImplementation(() => ({ session: () => itemMock }));

      jest.spyOn(stellarService.server, "submitTransaction").mockResolvedValue({ hash: "valid_tx", ledger: 1, successful: true });
      jest.spyOn(stellarService.server, "transactions").mockReturnValue({
        transaction: () => ({
          call: async () => ({ successful: true, ledger: 1, created_at: new Date().toISOString() }),
        }),
      });
      jest.spyOn(stellarService.server, "operations").mockReturnValue({
        forTransaction: () => ({
          call: async () => ({ records: [] }),
        }),
      });

      const req = { user: { _id: "creator_id" }, body: { giftId: "gift1", signedXdr: validXdr } };
      const res = mockRes();

      await submitClaim(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(giftMock.status).toBe("claimed");
      expect(giftMock.claimTxHash).toBe("valid_tx");
      expect(giftMock.save).toHaveBeenCalled();
    });
  });
});
