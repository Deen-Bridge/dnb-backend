import 'dotenv/config';
import mongoose from 'mongoose';
import request from 'supertest';
import app from './app.js';
import Category from './src/models/Category.js';
import Course from './src/models/Course.js';
import User from './src/models/User.js';
import jwt from 'jsonwebtoken';

async function runTests() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  await Category.deleteMany({});
  await Course.deleteMany({});
  await User.deleteMany({});

  const user = await User.create({ name: 'Admin User', email: 'admin@phase5.com', password: 'password123', role: 'tutor' });
  const token = jwt.sign({ userId: user._id, sessionId: '123' }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024", { expiresIn: '1h' });

  // 1. Seed categories
  const cat1 = await Category.create({ name: 'Fiqh', order: 1 });
  const cat2 = await Category.create({ name: 'Aqeedah', order: 2 });
  
  // 2. Create course using the new endpoint with category SLUG
  const createRes = await request(app)
    .post('/api/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Intro to Fiqh',
      description: 'Test course',
      category: 'fiqh', // Valid slug
      price: 10
    });
  
  console.log('\n--- createCourse (Valid Slug) ---');
  console.log(JSON.stringify(createRes.body, null, 2));

  // 3. Create course with INVALID category
  const createResInvalid = await request(app)
    .post('/api/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Intro to Math',
      description: 'Test course',
      category: 'math', // Invalid
      price: 10
    });
  
  console.log('\n--- createCourse (Invalid Slug -> 400) ---');
  console.log(JSON.stringify(createResInvalid.body, null, 2));

  // 4. Update course
  const courseId = createRes.body.course._id;
  const updateRes = await request(app)
    .patch(`/api/courses/${courseId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      category: 'aqeedah' // Change category
    });
  
  console.log('\n--- updateCourse (Change Category) ---');
  console.log(JSON.stringify(updateRes.body, null, 2));

  // 5. Create another course to test stats
  await request(app)
    .post('/api/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Advanced Aqeedah',
      description: 'Test course 2',
      category: 'aqeedah',
      price: 0 // free
    });

  // 6. Test GET /api/categories
  const catsRes = await request(app).get('/api/categories');
  console.log('\n--- GET /api/categories (Stats) ---');
  console.log(JSON.stringify(catsRes.body, null, 2));

  // 7. Test GET /api/categories/:slug
  const catSlugRes = await request(app).get('/api/categories/aqeedah?sort=price');
  console.log('\n--- GET /api/categories/aqeedah ---');
  console.log(JSON.stringify(catSlugRes.body, null, 2));

  // 8. Test 404 for unknown slug
  const catSlug404 = await request(app).get('/api/categories/unknown-slug');
  console.log('\n--- GET /api/categories/unknown-slug (404) ---');
  console.log(JSON.stringify(catSlug404.body, null, 2));

  // 9. Test ?category=<slug> filter on GET /api/courses
  const coursesFilterRes = await request(app).get('/api/courses?category=aqeedah');
  console.log('\n--- GET /api/courses?category=aqeedah ---');
  console.log(JSON.stringify(coursesFilterRes.body, null, 2));

  await mongoose.disconnect();
}
runTests().catch(console.error);
