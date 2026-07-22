import { MongoMemoryServer } from "mongodb-memory-server";

let mongod;

beforeAll(async () => {
  // Start in-memory MongoDB
  mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();
  
  // Set test environment and MongoDB URI
  process.env.NODE_ENV = "test";
  process.env.MONGO_URI = mongoUri;
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-key-at-least-32-characters-long";
  process.env.PORT = process.env.PORT || "5000";
});

afterAll(async () => {
  if (mongod) {
    await mongod.stop();
  }
});

