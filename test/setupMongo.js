import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

let mongod;

export const setupMongo = async () => {
  if (mongoose.connection.readyState === 1) return;
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  await mongoose.connect(process.env.MONGO_URI);
};

export const teardownMongo = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongod) {
    await mongod.stop();
  }
};
