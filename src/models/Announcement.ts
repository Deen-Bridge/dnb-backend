import mongoose, { Schema, Document } from "mongoose";

export interface IAnnouncement extends Document {
  title: string;
  message: string;
  type: "info" | "warning" | "critical";
  priority: "low" | "medium" | "high";
  status: "draft" | "scheduled" | "published" | "archived";
  scheduledFor?: Date;
  expiresAt?: Date;
  createdBy: mongoose.Types.ObjectId;
  acknowledgments: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const announcementSchema = new Schema<IAnnouncement>(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ["info", "warning", "critical"],
      default: "info",
      required: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
      required: true,
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "published", "archived"],
      default: "draft",
      required: true,
      index: true,
    },
    scheduledFor: { type: Date, index: true },
    expiresAt: { type: Date, index: true },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    acknowledgments: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true }
);

announcementSchema.index({ status: 1, scheduledFor: 1 });
announcementSchema.index({ status: 1, expiresAt: 1 });

export default mongoose.model<IAnnouncement>("Announcement", announcementSchema);
