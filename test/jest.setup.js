import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Start an in-memory MongoDB for tests
const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
global.__MONGOD__ = mongod;
