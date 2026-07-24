import 'dotenv/config';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app.js';
import Category from '../src/models/Category.js';
import Course from '../src/models/Course.js';
import User from '../src/models/User.js';
import jwt from 'jsonwebtoken';

describe('Category Integration Tests', () => {
  let adminToken;
  let studentToken;
  let adminUser;
  let studentUser;
  let catFiqh;
  let catAqeedah;

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    await Category.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    adminUser = await User.create({ name: 'Admin', email: 'admin@test.com', password: 'password123', role: 'admin' });
    studentUser = await User.create({ name: 'Student', email: 'student@test.com', password: 'password123', role: 'student' });
    
    adminToken = jwt.sign({ userId: adminUser._id }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024");
    studentToken = jwt.sign({ userId: studentUser._id }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024");
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Category.deleteMany({});
    await Course.deleteMany({});
  });

  it('Stats aggregation correctness against a seeded fixture with known counts', async () => {
    catFiqh = await Category.create({ name: 'Fiqh', order: 1 });
    catAqeedah = await Category.create({ name: 'Aqeedah', order: 2 });
    
    // Fiqh: 1 paid course (price 50), 2 enrolled users
    const c1 = await Course.create({ 
      title: 'Fiqh 101', 
      description: 'Desc',
      categoryRef: catFiqh._id,
      category: 'Fiqh',
      price: 50,
      createdBy: adminUser._id,
      enrolledUsers: [studentUser._id, adminUser._id]
    });
    
    // Fiqh: 1 free course (price 0)
    const c2 = await Course.create({
      title: 'Fiqh Basics',
      description: 'Desc',
      categoryRef: catFiqh._id,
      category: 'Fiqh',
      price: 0,
      createdBy: adminUser._id
    });

    // Aqeedah: No courses yet

    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toHaveLength(2);

    const fiqhStat = res.body.categories.find(c => c.slug === 'fiqh');
    expect(fiqhStat.courseCount).toBe(2);
    expect(fiqhStat.enrollmentCount).toBe(2); // 2 enrolled in c1
    expect(fiqhStat.freeCount).toBe(1);
    expect(fiqhStat.paidCount).toBe(1);
    expect(fiqhStat.minPrice).toBe(50);
    expect(fiqhStat.maxPrice).toBe(50);

    const aqeedahStat = res.body.categories.find(c => c.slug === 'aqeedah');
    expect(aqeedahStat.courseCount).toBe(0);
    expect(aqeedahStat.enrollmentCount).toBe(0);
    expect(aqeedahStat.freeCount).toBe(0);
    expect(aqeedahStat.paidCount).toBe(0);
    expect(aqeedahStat.minPrice).toBeNull();
    expect(aqeedahStat.maxPrice).toBeNull();
  });

  it('Slug collision handling in API', async () => {
    await Category.create({ name: "Qur'an" }); // slug: quran
    const res = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Quran' }); // slug: quran-2

    expect(res.status).toBe(201);
    expect(res.body.category.slug).toBe('quran-2');
  });

  it('GET /api/courses?category=<slug> filtering', async () => {
    catFiqh = await Category.create({ name: 'Fiqh' });
    await Course.create({ title: 'Fiqh Course', description: 'Desc', categoryRef: catFiqh._id, category: 'Fiqh', createdBy: adminUser._id });
    
    const res = await request(app).get('/api/courses?category=fiqh');
    expect(res.status).toBe(200);
    expect(res.body.courses).toHaveLength(1);
    expect(res.body.courses[0].category).toBe('Fiqh');
  });

  it('Admin route authorization (401, 403, 201)', async () => {
    const res401 = await request(app).post('/api/categories').send({ name: 'Admin Test' });
    expect(res401.status).toBe(401);

    const res403 = await request(app).post('/api/categories').set('Authorization', `Bearer ${studentToken}`).send({ name: 'Admin Test' });
    expect(res403.status).toBe(403);

    const res201 = await request(app).post('/api/categories').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Admin Test' });
    expect(res201.status).toBe(201);
  });

  it('404 on unknown category slug', async () => {
    const res = await request(app).get('/api/categories/non-existent-slug');
    expect(res.status).toBe(404);
  });

  it('400 on invalid category in createCourse', async () => {
    const res = await request(app)
      .post('/api/courses')
      .set('Authorization', `Bearer ${adminToken}`) // Admin acts as tutor creating course
      .send({
        title: 'Invalid Cat Course',
        description: 'Test',
        category: 'NonExistent'
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid or inactive category/);
  });
});
