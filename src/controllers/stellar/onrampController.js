// controllers/stellar/onrampController.js
import OnrampTransaction from "../../models/OnrampTransaction.js";
import {
  buildWidgetUrl,
  isOnrampConfigured,
  verifyWebhookSignature,
  mapProviderStatus,
} from "../../services/stellar/onrampService.js";
import logger from "../../config/logger.js";

/**
 * Create a fiat on-ramp widget session for the authenticated user.
 *
 * Persists a `created` OnrampTransaction linked to the user, then returns a
 * signed MoonPay widget URL with the user's wallet address pre-filled. The
 * record id is passed to MoonPay as `externalTransactionId` so later webhooks
 * can be matched back to the originating record.
 *
 * POST /api/stellar/onramp/session
 *
 * @param {import("express").Request} req  Authenticated request (`req.user`).
 * @param {import("express").Response} res
 * @returns {Promise<void>}
 */
export const createOnrampSession = async (req, res) => {
  try {
    if (!isOnrampConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Fiat on-ramp is not configured",
      });
    }

    const userId = req.user._id;
    const { walletAddress, cryptoCurrency, fiatCurrency, fiatAmount, redirectUrl } =
      req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: "walletAddress is required",
      });
    }

    // Create the tracking record first so its id can be embedded in the widget
    // URL as the provider's externalTransactionId.
    const record = new OnrampTransaction({
      user: userId,
      walletAddress,
      provider: "moonpay",
      status: "created",
      cryptoCurrency: cryptoCurrency ? cryptoCurrency.toLowerCase() : undefined,
      fiatCurrency: fiatCurrency ? fiatCurrency.toLowerCase() : undefined,
      fiatAmount: fiatAmount !== undefined ? String(fiatAmount) : undefined,
    });

    let widget;
    try {
      widget = buildWidgetUrl({
        walletAddress,
        cryptoCurrency,
        baseCurrencyCode: fiatCurrency,
        baseCurrencyAmount: fiatAmount,
        externalTransactionId: record._id.toString(),
        email: req.user.email,
        redirectUrl,
      });
    } catch (buildError) {
      // Invalid wallet / unconfigured — surface without persisting the record.
      return res.status(buildError.statusCode || 400).json({
        success: false,
        message: buildError.message,
      });
    }

    record.cryptoCurrency = widget.cryptoCurrency;
    await record.save();

    logger.info(`On-ramp session created: ${record._id} for user ${userId}`);

    res.status(201).json({
      success: true,
      onrampId: record._id,
      provider: "moonpay",
      widgetUrl: widget.url,
      status: record.status,
    });
  } catch (error) {
    logger.error("Create on-ramp session error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create on-ramp session",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * List the authenticated user's on-ramp transactions, most recent first.
 *
 * GET /api/stellar/onramp/transactions
 *
 * @param {import("express").Request} req  Authenticated request (`req.user`).
 * @param {import("express").Response} res
 * @returns {Promise<void>}
 */
export const getOnrampTransactions = async (req, res) => {
  try {
    const userId = req.user._id;
    const transactions = await OnrampTransaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select(
        "provider status providerStatus cryptoCurrency fiatCurrency fiatAmount cryptoAmount cryptoTransactionHash walletAddress createdAt completedAt"
      );

    res.status(200).json({
      success: true,
      count: transactions.length,
      transactions,
    });
  } catch (error) {
    logger.error("Get on-ramp transactions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch on-ramp transactions",
    });
  }
};

/**
 * Handle inbound MoonPay webhooks for on-ramp status updates.
 *
 * Public endpoint: authenticity is established by verifying the provider HMAC
 * signature over the raw request body (`req.rawBody`, captured globally in
 * app.js). The matching OnrampTransaction is located by `externalTransactionId`
 * (our record id) or the provider transaction id, then updated in place.
 *
 * POST /api/stellar/onramp/webhook
 *
 * @param {import("express").Request} req  Public request; `req.rawBody` is the
 *   exact bytes of the body used for signature verification.
 * @param {import("express").Response} res
 * @returns {Promise<void>}
 */
export const handleWebhook = async (req, res) => {
  try {
    const signatureHeader =
      req.get("Moonpay-Signature-V2") || req.get("moonpay-signature-v2");

    const valid = verifyWebhookSignature(req.rawBody, signatureHeader);
    if (!valid) {
      logger.warn("Rejected on-ramp webhook: invalid signature");
      return res.status(401).json({
        success: false,
        message: "Invalid webhook signature",
      });
    }

    const data = req.body?.data || {};
    const providerStatus = data.status;
    const externalTransactionId = data.externalTransactionId;
    const providerTransactionId = data.id;

    // Locate the originating record: prefer our own id, fall back to the
    // provider id for events that omit externalTransactionId.
    let record = null;
    if (externalTransactionId) {
      record = await OnrampTransaction.findById(externalTransactionId).catch(
        () => null
      );
    }
    if (!record && providerTransactionId) {
      record = await OnrampTransaction.findOne({ providerTransactionId });
    }

    if (!record) {
      // Acknowledge to stop provider retries; nothing to update on our side.
      logger.warn(
        `On-ramp webhook for unknown transaction (external=${externalTransactionId}, provider=${providerTransactionId})`
      );
      return res.status(200).json({ success: true, matched: false });
    }

    if (providerTransactionId) record.providerTransactionId = providerTransactionId;
    if (providerStatus) {
      record.providerStatus = providerStatus;
      record.status = mapProviderStatus(providerStatus);
    }
    if (data.cryptoTransactionId) {
      record.cryptoTransactionHash = data.cryptoTransactionId;
    }
    if (data.quoteCurrencyAmount !== undefined && data.quoteCurrencyAmount !== null) {
      record.cryptoAmount = String(data.quoteCurrencyAmount);
    }
    if (data.baseCurrencyAmount !== undefined && data.baseCurrencyAmount !== null) {
      record.fiatAmount = String(data.baseCurrencyAmount);
    }
    if (data.failureReason) {
      record.failureReason = data.failureReason;
    }
    if (record.status === "completed" && !record.completedAt) {
      record.completedAt = new Date();
    }

    await record.save();

    logger.info(
      `On-ramp webhook applied: ${record._id} -> ${record.status} (${providerStatus})`
    );

    res.status(200).json({ success: true, matched: true });
  } catch (error) {
    logger.error("On-ramp webhook error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process on-ramp webhook",
    });
  }
};
