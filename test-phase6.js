import 'dotenv/config';
import mongoose from 'mongoose';
import request from 'supertest';
import app from './app.js';
import Category from './src/models/Category.js';
import User from './src/models/User.js';
import Course from './src/models/Course.js';
import jwt from 'jsonwebtoken';

async function runTests() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  await Category.deleteMany({});
  await User.deleteMany({});
  await Course.deleteMany({});

  const admin = await User.create({ name: 'Admin User', email: 'admin@test.com', password: 'password123', role: 'admin' });
  const adminToken = jwt.sign({ userId: admin._id, sessionId: '123' }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024", { expiresIn: '1h' });

  const student = await User.create({ name: 'Student', email: 'student@test.com', password: 'password123', role: 'student' });
  const studentToken = jwt.sign({ userId: student._id, sessionId: '456' }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024", { expiresIn: '1h' });

  // 1. POST /api/categories
  console.log('\n--- POST /api/categories (401 - No Token) ---');
  const post401 = await request(app).post('/api/categories').send({ name: 'New Cat' });
  console.log(post401.status, JSON.stringify(post401.body, null, 2));

  console.log('\n--- POST /api/categories (403 - Wrong Role) ---');
  const post403 = await request(app).post('/api/categories').set('Authorization', `Bearer ${studentToken}`).send({ name: 'New Cat' });
  console.log(post403.status, JSON.stringify(post403.body, null, 2));

  console.log('\n--- POST /api/categories (Success) ---');
  const post201 = await request(app).post('/api/categories').set('Authorization', `Bearer ${adminToken}`).send({ name: 'New Cat', description: 'desc' });
  console.log(post201.status, JSON.stringify(post201.body, null, 2));

  const catId = post201.body.category._id;

  // Duplicate key (400)
  console.log('\n--- POST /api/categories (Duplicate - 400) ---');
  const postDup = await request(app).post('/api/categories').set('Authorization', `Bearer ${adminToken}`).send({ name: 'New Cat' });
  console.log(postDup.status, JSON.stringify(postDup.body, null, 2));

  // 2. PATCH /api/categories/:id
  console.log('\n--- PATCH /api/categories/:id (401 - No Token) ---');
  const patch401 = await request(app).patch(`/api/categories/${catId}`).send({ name: 'Updated Cat' });
  console.log(patch401.status, JSON.stringify(patch401.body, null, 2));

  console.log('\n--- PATCH /api/categories/:id (403 - Wrong Role) ---');
  const patch403 = await request(app).patch(`/api/categories/${catId}`).set('Authorization', `Bearer ${studentToken}`).send({ name: 'Updated Cat' });
  console.log(patch403.status, JSON.stringify(patch403.body, null, 2));

  console.log('\n--- PATCH /api/categories/:id (Success) ---');
  const patch200 = await request(app).patch(`/api/categories/${catId}`).set('Authorization', `Bearer ${adminToken}`).send({ name: 'Updated Cat' });
  console.log(patch200.status, JSON.stringify(patch200.body, null, 2));

  // 3. DELETE /api/categories/:id
  console.log('\n--- DELETE /api/categories/:id (401 - No Token) ---');
  const delete401 = await request(app).delete(`/api/categories/${catId}`);
  console.log(delete401.status, JSON.stringify(delete401.body, null, 2));

  console.log('\n--- DELETE /api/categories/:id (403 - Wrong Role) ---');
  const delete403 = await request(app).delete(`/api/categories/${catId}`).set('Authorization', `Bearer ${studentToken}`);
  console.log(delete403.status, JSON.stringify(delete403.body, null, 2));

  // Soft delete test
  await Course.create({ title: 'C', description: 'D', category: 'Updated Cat', categoryRef: catId, createdBy: admin._id });
  console.log('\n--- DELETE /api/categories/:id (Soft Delete Success) ---');
  const softDel = await request(app).delete(`/api/categories/${catId}`).set('Authorization', `Bearer ${adminToken}`);
  console.log(softDel.status, JSON.stringify(softDel.body, null, 2));

  // Hard delete test
  await Course.deleteMany({});
  console.log('\n--- DELETE /api/categories/:id (Hard Delete Success) ---');
  const hardDel = await request(app).delete(`/api/categories/${catId}`).set('Authorization', `Bearer ${adminToken}`);
  console.log(hardDel.status, JSON.stringify(hardDel.body, null, 2));

  await mongoose.disconnect();
}
runTests().catch(console.error);
