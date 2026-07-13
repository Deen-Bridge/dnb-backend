import request from "supertest";
import app from "../app.js";

describe("DeenBridge API", () => {
  it("should respond to GET / with welcome message", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Welcome to DeenBridge API");
  });

  it("should respond to GET /health", async () => {
    const res = await request(app).get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("success", true);
  });

  // Add more endpoint tests below as needed
  // Example: Test GET /api/courses
  it("should respond to GET /api/courses", async () => {
    const res = await request(app).get("/api/courses");
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("success");
  });

  // Example: Test GET /api/spaces
  it("should respond to GET /api/spaces", async () => {
    const res = await request(app).get("/api/spaces");
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("success");
  });
});
