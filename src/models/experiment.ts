import mongoose, { Schema, Document } from "mongoose";

export interface IVariant {
  name: string;
  weight: number;
  payload?: Record<string, any>;
}

export interface IExperiment extends Document {
  key: string;
  name: string;
  description?: string;
  status: "draft" | "running" | "paused" | "completed";
  variants: IVariant[];
  targeting?: {
    percentage?: number;
    userSegments?: string[];
  };
  startDate?: Date;
  endDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IExperimentAssignment extends Document {
  experimentKey: string;
  userId?: mongoose.Types.ObjectId;
  sessionId: string;
  variantName: string;
  assignedAt: Date;
}

export interface IExperimentConversion extends Document {
  experimentKey: string;
  variantName: string;
  userId?: mongoose.Types.ObjectId;
  sessionId: string;
  metricName: string;
  value: number;
  metadata?: Record<string, any>;
  createdAt: Date;
}

const variantSchema = new Schema<IVariant>(
  {
    name: { type: String, required: true },
    weight: { type: Number, required: true, min: 0 },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const experimentSchema = new Schema<IExperiment>(
  {
    key: { type: String, required: true, unique: true, index: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    status: {
      type: String,
      enum: ["draft", "running", "paused", "completed"],
      default: "draft",
      index: true,
    },
    variants: { type: [variantSchema], required: true },
    targeting: {
      percentage: { type: Number, default: 100, min: 0, max: 100 },
      userSegments: [{ type: String }],
    },
    startDate: { type: Date },
    endDate: { type: Date },
  },
  { timestamps: true }
);

const experimentAssignmentSchema = new Schema<IExperimentAssignment>(
  {
    experimentKey: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    sessionId: { type: String, required: true, index: true },
    variantName: { type: String, required: true },
    assignedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

experimentAssignmentSchema.index({ experimentKey: 1, userId: 1 }, { unique: true, sparse: true });
experimentAssignmentSchema.index({ experimentKey: 1, sessionId: 1 }, { unique: true });

const experimentConversionSchema = new Schema<IExperimentConversion>(
  {
    experimentKey: { type: String, required: true, index: true },
    variantName: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    sessionId: { type: String, required: true },
    metricName: { type: String, required: true, index: true },
    value: { type: Number, default: 1 },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export const Experiment = mongoose.models.Experiment || mongoose.model<IExperiment>("Experiment", experimentSchema);
export const ExperimentAssignment = mongoose.models.ExperimentAssignment || mongoose.model<IExperimentAssignment>("ExperimentAssignment", experimentAssignmentSchema);
export const ExperimentConversion = mongoose.models.ExperimentConversion || mongoose.model<IExperimentConversion>("ExperimentConversion", experimentConversionSchema);

export default {
  Experiment,
  ExperimentAssignment,
  ExperimentConversion,
};
