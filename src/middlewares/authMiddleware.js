import jwt from "jsonwebtoken";
import User from "../models/User.js";

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

export const protect = async (req, res, next) => {
  let token;

  // Check for Authorization header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];

      // Verify token
      const decoded = jwt.verify(token, JWT_SECRET);

      // Attach user to request
      req.user = await User.findById(decoded.userId).select("-password");

      if (!req.user) {
        return res
          .status(401)
          .json({ success: false, message: "User not found" });
      }

      req.sessionId = decoded.sessionId;
      req.is2FAVerified = decoded.is2FAVerified === true;

      next();
    } catch (error) {
      return res
        .status(401)
        .json({ success: false, message: "Not authorized, token failed" });
    }
  } else {
    return res
      .status(401)
      .json({ success: false, message: "No token, authorization denied" });
  }
};

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Access requires one of the following roles: ${roles.join(", ")}`,
      });
    }

    // Enforce 2FA for admin role
    if (req.user.role === "admin") {
      if (!req.user.twoFactor?.enabled) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: Admin access requires TOTP two-factor authentication to be enabled.",
        });
      }
      if (!req.is2FAVerified) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: Admin access requires a 2FA-verified session.",
        });
      }
    }

    next();
  };
};

export const require2FA = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  if (!req.user.twoFactor?.enabled) {
    return res.status(403).json({
      success: false,
      message: "Two-factor authentication is required to be enabled for this action.",
    });
  }
  if (!req.is2FAVerified) {
    return res.status(403).json({
      success: false,
      message: "This action requires a 2FA-verified session.",
    });
  }
  next();
};

export const requireVerified = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  if (!req.user.isVerified) {
    return res.status(403).json({
      success: false,
      message: "Please verify your email before accessing this resource.",
    });
  }
  next();
};

export const requireVerifiedEducator = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  if (req.user.role === "admin") {
    return next();
  }
  if (!req.user.verifiedEducator) {
    return res.status(403).json({
      success: false,
      message:
        "Forbidden: You must be a verified educator to create content. Please submit a verification application via /api/educator-verification.",
    });
  }
  next();
};

export const restrictTo = (...roles) => authorizeRoles(...roles);
export const authorize = (...roles) => authorizeRoles(...roles);
