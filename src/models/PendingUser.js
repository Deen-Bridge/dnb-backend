import mongoose from "mongoose";

const pendingUserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["student", "mentor"], default: "student" },
  verificationToken: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, index: { expires: "24h" } },
});

export default mongoose.model("PendingUser", pendingUserSchema);
