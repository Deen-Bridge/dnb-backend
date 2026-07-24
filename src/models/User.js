// models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
    },
    email: {
      type: String,
      unique: true,
      required: [true, "Email is required"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
    },
    avatar: {
      type: String, // Cloudinary URL for profile picture
    },
    gender: {
      type: String,
      enum: ["male", "female"],
    },
    age: {
      type: Number,
      min: 2,
      max: 120,
    },
    country: {
      type: String,
    },
    language: {
      type: String,
    },
    interests: [{ type: String }],
    bio: {
      type: String,
      maxlength: 500,
    },
    role: {
      type: String,
      enum: ["student", "tutor", "admin", "arbiter"],
      default: "student",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    // Follow system
    following: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    followers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    purchasedBooks: {
      type: [
        {
          bookId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Book",
          },
          purchaseDate: {
            type: Date,
            default: Date.now,
          },
        },
      ],
    },
    purchasedCourses: {
      type: [
        {
          courseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Course",
          },
          purchaseDate: {
            type: Date,
            default: Date.now,
          },
        },
      ],
    },
    bookmarkedBooks: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Book",
      },
    ],
    bookmarkedCourses: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Course",
      },
    ],
    // Stellar wallet for blockchain payments
    stellarWallet: {
      publicKey: {
        type: String,
        validate: {
          validator: function (v) {
            // Stellar public keys start with 'G' and are 56 characters
            return !v || /^G[A-Z0-9]{55}$/.test(v);
          },
          message: "Invalid Stellar public key format",
        },
      },
      connectedAt: {
        type: Date,
      },
      network: {
        type: String,
        enum: ["testnet", "mainnet"],
        default: "testnet",
      },
    },
    stat: {
      coursesEnrolled: { type: Number, default: 0 },
      booksRead: { type: Number, default: 0 },
      totalUptime: { type: Number, default: 0 }, // in seconds or minutes as you prefer
    },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
