import request from "supertest";
import bcrypt from "bcryptjs";
import User from "../../src/models/User.js";

// Registration is email-verification-first, so POST /api/auth/register no longer
// returns tokens — it creates a pending record and emails a verification link.
// For suites that just need an authenticated user, seed a verified user directly
// and log in. Returns the full Mongoose user doc plus the access token.
export async function seedUserAndLogin(app, overrides = {}) {
  const creds = {
    name: "Test User",
    email: "seed_user@example.com",
    password: "Qx7#vLmp92Zt",
    role: "student",
    ...overrides,
  };

  const hashedPassword = await bcrypt.hash(creds.password, 12);
  const user = await User.create({
    name: creds.name,
    email: creds.email,
    password: hashedPassword,
    role: creds.role,
    isVerified: true,
  });

  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: creds.email, password: creds.password });

  return {
    token: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    user,
    res,
    creds,
  };
}
