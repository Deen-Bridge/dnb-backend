import logger from "../../src/config/logger.js";

const NODE_ENV = () => process.env.NODE_ENV || "development";
const FRONTEND_URL = () => process.env.FRONTEND_URL || "http://localhost:3000";
const ASSET_URL = () =>
  process.env.EMAIL_ASSET_URL || `${FRONTEND_URL()}/images`;

const SENDLIB_API_URL = () => process.env.SENDLIB_API_URL || "";

// Must be the Gmail / Google Workspace address connected in SendLib.
const getFrom = () => process.env.EMAIL_FROM || "";

const emailShell = ({ content, preheader }) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>DeenBridge</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    ${preheader || ""}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f6f4; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td align="center" style="background: linear-gradient(135deg, #14532d 0%, #166534 55%, #15803d 100%); padding: 32px 24px;">
              <img src="${ASSET_URL()}/dnb-nobg.png" alt="DeenBridge" width="120" height="auto" style="width: 120px; height: auto; border: 0; outline: none; text-decoration: none;" />
              <p style="margin: 8px 0 0; color: #bbf7d0; font-size: 13px; font-weight: 500; letter-spacing: 1px; text-transform: uppercase;">Authentic Islamic Education</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 40px 32px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8faf8; border-top: 1px solid #e5e7eb; padding: 24px 40px; text-align: center;">
              <p style="margin: 0 0 8px; color: #166534; font-size: 15px; font-weight: 700; letter-spacing: 0.5px;">DEENBRIDGE</p>
              <p style="margin: 0 0 16px; color: #6b7280; font-size: 12px; line-height: 1.6;">
                Bridges of Islamic knowledge, guided by the Quran and Sunnah.
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 11px;">
                &copy; ${new Date().getFullYear()} DeenBridge. All rights reserved.<br/>
                You received this email because you have an account on DeenBridge.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const primaryButton = (href, label) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px auto;">
    <tr>
      <td align="center" style="background-color: #166534; border-radius: 8px;">
        <a href="${href}" target="_blank" style="display: inline-block; padding: 14px 40px; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">${label}</a>
      </td>
    </tr>
  </table>
`;

const sendMail = async ({
  to,
  subject,
  html,
  text,
  replyTo,
  cc,
  bcc,
  attachments,
}) => {
  const apiKey = process.env.SENDLIB_API_KEY || "";
  const apiUrl = SENDLIB_API_URL();
  const from = getFrom();

  // Security: never log the html body — it contains OTP codes / verification
  // tokens. Log recipient + subject only.
  if (!apiKey || !apiUrl) {
    logger.warn(
      "SENDLIB_API_KEY / SENDLIB_API_URL not set — email not sent"
    );
    // Test env only (synthetic data): expose the body so tests can assert
    // OTP/verification behavior. NEVER logged in dev/prod — bodies carry secrets.
    if (NODE_ENV() === "test") {
      logger.info(`[EMAIL LOG] To: ${to} | Subject: ${subject} | Body: ${html}`);
    } else {
      logger.info(`[EMAIL SKIPPED] To: ${to} | Subject: ${subject}`);
    }
    return;
  }
  if (!from) {
    logger.warn(
      "EMAIL_FROM not set — SendLib requires your connected sender address"
    );
  }

  const body = { from, to, subject, html };
  if (text) body.text = text;
  if (replyTo) body.reply_to = replyTo;
  if (cc) body.cc = cc;
  if (bcc) body.bcc = bcc;
  if (attachments) body.attachments = attachments;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `SendLib API ${response.status}: ${JSON.stringify(payload)}`
      );
    }
    const messageId = payload.messageId || payload.id;
    logger.info(`Email sent to ${to}${messageId ? `: ${messageId}` : ""}`);
    return payload;
  } catch (error) {
    logger.error("Failed to send email:", error.message);
    if (NODE_ENV() === "development") {
      // Subject only — never log the body (contains OTP/token).
      logger.info(`[DEV FALLBACK] To: ${to} | Subject: ${subject}`);
      return;
    }
    throw error;
  }
};

export const sendOtpEmail = async (otp, email) => {
  if (!email || !otp) throw new Error("Email and OTP are required");
  logger.info(`Sending OTP email to: ${email}`);

  const content = `
    <h1 style="margin: 0 0 8px; color: #111827; font-size: 24px; font-weight: 700;">Password Reset</h1>
    <p style="margin: 0 0 24px; color: #6b7280; font-size: 15px; line-height: 1.6;">
      We received a request to reset your password. Use the code below to proceed:
    </p>
    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 8px;">
      <span style="font-size: 34px; font-weight: 700; letter-spacing: 10px; color: #166534;">${otp}</span>
    </div>
    <p style="margin: 16px 0 0; color: #6b7280; font-size: 13px; line-height: 1.6;">
      This code expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email — your password will not be changed.
    </p>
  `;

  await sendMail({
    to: email,
    subject: "Your Password Reset Code — DeenBridge",
    html: emailShell({
      content,
      preheader: "Use this code to reset your DeenBridge password.",
    }),
  });
};

export const sendReceiptEmail = async (receipt) => {
  if (!receipt.email || !receipt.txHash)
    throw new Error("Receipt email and transaction hash are required");
  logger.info(`Sending receipt for ${receipt.txHash} to: ${receipt.email}`);

  const content = `
    <h1 style="margin: 0 0 8px; color: #111827; font-size: 24px; font-weight: 700;">Payment Receipt</h1>
    <p style="margin: 0 0 24px; color: #6b7280; font-size: 15px; line-height: 1.6;">
      JazakAllah khair! Your contribution has been received. Here are the details:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8faf8; border: 1px solid #e5e7eb; border-radius: 12px; margin-bottom: 24px;">
      ${receipt.amount ? `
        <tr>
          <td style="padding: 14px 20px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Amount</td>
          <td style="padding: 14px 20px; color: #111827; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #e5e7eb;">${receipt.amount}</td>
        </tr>` : ""}
      <tr>
        <td style="padding: 14px 20px; color: #6b7280; font-size: 13px;">Transaction Hash</td>
        <td style="padding: 14px 20px; color: #166534; font-size: 13px; font-weight: 500; text-align: right; word-break: break-all;">${receipt.txHash}</td>
      </tr>
    </table>
    <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.6;">
      May Allah bless your contribution and accept it from you.
    </p>
  `;

  await sendMail({
    to: receipt.email,
    subject: "Payment Receipt — DeenBridge",
    html: emailShell({
      content,
      preheader: "Thank you for your contribution to DeenBridge.",
    }),
  });
};

export const sendVerificationEmail = async (email, token) => {
  if (!email || !token) throw new Error("Email and token are required");
  const link = `${FRONTEND_URL()}/verify-email?token=${token}`;
  logger.info(`Sending verification email to: ${email}`);

  const content = `
    <h1 style="margin: 0 0 8px; color: #111827; font-size: 24px; font-weight: 700;">Welcome to DeenBridge!</h1>
    <p style="margin: 0 0 8px; color: #6b7280; font-size: 15px; line-height: 1.6;">
      Assalamu Alaikum! We're excited to have you join our community of authentic Islamic learners.
    </p>
    <p style="margin: 0 0 24px; color: #6b7280; font-size: 15px; line-height: 1.6;">
      Please verify your email address by clicking the button below to activate your account:
    </p>
    ${primaryButton(link, "Verify My Email")}
    <p style="margin: 24px 0 8px; color: #6b7280; font-size: 13px; line-height: 1.6;">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="margin: 0 0 24px; background-color: #f8faf8; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; color: #166534; font-size: 12px; word-break: break-all;">${link}</p>
    <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.6;">
      This link expires in <strong>24 hours</strong>. If you didn't create an account with DeenBridge, please ignore this email.
    </p>
  `;

  await sendMail({
    to: email,
    subject: "Verify your email — DeenBridge",
    html: emailShell({
      content,
      preheader: "Click to verify your email and activate your DeenBridge account.",
    }),
  });
};

export default sendMail;
