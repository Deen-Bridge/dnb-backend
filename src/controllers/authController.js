// controllers/authController.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import sendMail from "../../services/emails/sendMail.js";
import { generatedOtp } from "../routes/emailRoutes.js";
import logger from "../config/logger.js";
import { catchAsync, APIError } from "../middlewares/errorHandler.js";

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

// Log JWT configuration on startup and warn if using fallback
if (!process.env.JWT_SECRET) {
  logger.warn(
    "⚠️ WARNING: JWT_SECRET not found in .env! Using fallback (INSECURE for production)"
  );
} else {
  logger.info(
    `✅ JWT_SECRET loaded from .env (length: ${process.env.JWT_SECRET.length})`
  );
}

export const registerUser = catchAsync(async (req, res, next) => {
  const { name, email, password, role } = req.body;

  logger.info(`📝 Registration attempt for: ${email}`);

  // Check if user already exists
  const existing = await User.findOne({ email });
  if (existing) {
    logger.warn(`❌ Registration failed - Email already exists: ${email}`);
    return next(new APIError("Email already exists", 400));
  }

  // Send OTP email
  try {
    await sendMail(generatedOtp, email);
    logger.info(`📧 OTP sent to: ${email}`);
  } catch (error) {
    logger.error(`Email sending failed for: ${email}`, error);
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Create user
  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    role: role || "student",
  });

  logger.info(`✅ User registered successfully: ${email} (ID: ${user._id})`);

  // Generate JWT token
  const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, {
    expiresIn: "3d",
  });

  res.status(201).json({
    success: true,
    message: "User created successfully",
    token,
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      email: user.email,
    },
  });
});

export const loginUser = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  logger.info(`🔐 Login attempt for: ${email} from IP: ${req.ip}`);

  // Validate input
  if (!email || !password) {
    return next(new APIError("Please provide email and password", 400));
  }

  // Find user
  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    logger.warn(`❌ Login failed - User not found: ${email}`);
    return next(new APIError("Invalid credentials", 401));
  }

  // Verify password
  const isPasswordCorrect = await bcrypt.compare(password, user.password);
  if (!isPasswordCorrect) {
    logger.warn(`❌ Login failed - Incorrect password: ${email}`);
    return next(new APIError("Invalid credentials", 401));
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  // Generate JWT token
  const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, {
    expiresIn: "3d",
  });

  logger.info(`✅ Login successful: ${email} (ID: ${user._id})`);

  res.status(200).json({
    success: true,
    message: "Login successful",
    token,
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      email: user.email,
      avatar: user.avatar,
      gender: user.gender,
      age: user.age,
      country: user.country,
      language: user.language,
      interests: user.interests,
      bio: user.bio,
    },
  });
});

// Request password reset (sends OTP)
export const requestPasswordReset = async (req, res) => {
  const { email } = req.body;

  try {
    console.log("🔑 Password reset requested for:", email);
    const user = await User.findOne({ email });

    if (!user) {
      // Don't reveal if user exists or not for security
      return res.status(200).json({
        message:
          "If an account exists with this email, you will receive a password reset code.",
      });
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // In production, you should:
    // 1. Store the OTP in database with expiration time
    // 2. Send email with OTP using your email service
    // For now, we'll use the existing sendMail function

    // Store OTP temporarily (you should add resetToken and resetTokenExpiry to User model)
    // user.resetToken = await bcrypt.hash(otp, 10);
    // user.resetTokenExpiry = Date.now() + 3600000; // 1 hour
    // await user.save();

    // Send OTP via email
    sendMail(otp, email);

    res.status(200).json({
      message: "Password reset code sent to your email",
      otp: otp, // Remove this in production! Only for development
    });
  } catch (err) {
    console.error("❌ Password reset request error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// Reset password with OTP
export const resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;

  try {
    console.log("🔐 Password reset attempt for:", email);
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "Invalid request" })
    }

    // In production, verify OTP from database
    // const isValidOtp = await bcrypt.compare(otp, user.resetToken);
    // if (!isValidOtp || user.resetTokenExpiry < Date.now()) {
    //   return res.status(400).json({ message: "Invalid or expired OTP" });
    // }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;

    // Clear reset token fields
    // user.resetToken = undefined;
    // user.resetTokenExpiry = undefined;
    await user.save();

    console.log("✅ Password reset successful for:", email);
    res.status(200).json({
      message:
        "Password reset successful. You can now login with your new password.",
    });
  } catch (err) {
    console.error("❌ Password reset error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
