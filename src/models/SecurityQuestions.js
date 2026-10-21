import mongoose from "mongoose";

// Kept separate from User so answer hashes are never loaded with user docs.
const securityQuestionsSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    questions: {
      type: [
        {
          _id: false,
          questionId: { type: String, required: true },
          answerHash: { type: String, required: true },
        },
      ],
      validate: [(v) => v.length === 3, "Exactly 3 security questions required"],
    },
  },
  { timestamps: true }
);

export default mongoose.models.SecurityQuestions ||
  mongoose.model("SecurityQuestions", securityQuestionsSchema);
