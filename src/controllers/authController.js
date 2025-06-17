// controllers/authController.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import cloudinary from "../middlewares/upload.js"

const JWT_SECRET = process.env.JWT_SECRET;

export const registerUser = async (req, res) => {
  const { name, email, password, role, gender, age, country, language, interests, bio } = req.body;
  let avatarUrl = req.body.avatar;

  try {
    console.log("📝 Registering user:", email);
    const existing = await User.findOne({ email });
    if (existing) {
      console.log("❌ Email already exists:", email);
      return res.status(400).json({ message: "Email already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    // Handle avatar upload if file is provided
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "user-avatars" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });
      avatarUrl = result.secure_url;
    }

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role,
      avatar: avatarUrl,
      gender,
      age,
      country,
      language,
      interests,
      bio,
    });
    console.log("✅ User registered:", email);
    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, {
      expiresIn: "3d",
    });
    res.status(201).json({
      message: "✅ User created successfully",
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    console.log("🔐 Attempting login for:", email);
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid credentials" });

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
        avatar: user.avatar,
        gender: user.gender,
        age: user.age,
        country: user.country,
        language: user.language,
        interests: user.interests,
        bio: user.bio,
      },
    });
  } catch (err) {
    console.error("❌ Registration error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
