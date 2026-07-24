import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'fs';

async function start() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  
  // Write to .env
  fs.writeFileSync('.env', `MONGO_URI=${uri}\nJWT_SECRET=supersecret\nNODE_ENV=test\nPORT=5000\n`);
  
  console.log(`MongoDB Memory Server started at ${uri}`);
  console.log('Keeping process alive. Press Ctrl+C to stop.');
  
  // keep alive
  setInterval(() => {}, 1000 * 60 * 60);
}

start().catch(console.error);
