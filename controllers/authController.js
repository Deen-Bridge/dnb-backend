// controllers/authController.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const JWT_SECRET = process.env.JWT_SECRET;

export const registerUser = async (req, res) => {
  const { name, email, password, role } = req.body;

  try {
    console.log("📝 Registering user:", email);
    const existing = await User.findOne({ email });
    if (existing) {
      console.log("❌ Email already exists:", email);
      return res.status(400).json({ message: "❌ Email already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role,
    });
    console.log("✅ User registered:", email);
    res.status(201).json({ message: "✅ User created successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    console.log("🔐 Attempting login for:", email);
    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "❌ Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ message: "❌ Invalid credentials" });

    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, {
      expiresIn: "3d",
    });

    res.status(200).json({
      message: "Login successful 🎉",
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("❌ Registration error:", error.message);
    res.status(500).json({ error: err.message });
  }
};
