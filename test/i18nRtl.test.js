import request from "supertest";
import express from "express";
import { rtlMiddleware } from "../src/middlewares/rtl.js";
import { detectTextDirection, isRTLLanguage, dirAttribute } from "../src/utils/textDirection.js";

const buildApp = () => {
  const app = express();
  app.use(rtlMiddleware);
  app.get("/probe", (req, res) =>
    res.json({ textDirection: req.textDirection, isRTL: req.isRTL })
  );
  return app;
};

describe("rtlMiddleware", () => {
  const app = buildApp();

  it.each(["ar", "ar-SA", "ur-PK", "fa", "he", "yi"])(
    "flags %s as RTL and sets headers",
    async (lang) => {
      const res = await request(app).get("/probe").set("Accept-Language", lang);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ textDirection: "rtl", isRTL: true });
      expect(res.headers["x-text-direction"]).toBe("rtl");
      expect(res.headers["content-language"]).toBe(lang.split("-")[0]);
    }
  );

  it("flags English as LTR", async () => {
    const res = await request(app).get("/probe").set("Accept-Language", "en-US,en;q=0.9");
    expect(res.body).toEqual({ textDirection: "ltr", isRTL: false });
    expect(res.headers["x-text-direction"]).toBe("ltr");
    expect(res.headers["content-language"]).toBe("en");
  });

  it("uses only the first listed language, ignoring q-values", async () => {
    const res = await request(app).get("/probe").set("Accept-Language", "ar;q=0.8,en;q=0.9");
    expect(res.body.isRTL).toBe(true);
    const res2 = await request(app).get("/probe").set("Accept-Language", "en,ar");
    expect(res2.body.isRTL).toBe(false);
  });

  it("is case-insensitive", async () => {
    const res = await request(app).get("/probe").set("Accept-Language", "AR-sa");
    expect(res.body.isRTL).toBe(true);
  });

  it("defaults to LTR / en when the header is missing", async () => {
    const res = await request(app).get("/probe");
    expect(res.body).toEqual({ textDirection: "ltr", isRTL: false });
    expect(res.headers["content-language"]).toBe("en");
  });

  it("treats unsupported locales as LTR without throwing", async () => {
    const res = await request(app).get("/probe").set("Accept-Language", "xx-YY");
    expect(res.status).toBe(200);
    expect(res.body.isRTL).toBe(false);
  });

  it.each(["*", ";;;", ",,,", "q=0.5", "   "])(
    "handles malformed header %p as LTR",
    async (header) => {
      const res = await request(app).get("/probe").set("Accept-Language", header);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ textDirection: "ltr", isRTL: false });
    }
  );

  it("does not resolve locale from a ?lang query parameter (header only)", async () => {
    const res = await request(app).get("/probe?lang=ar");
    expect(res.body.isRTL).toBe(false);
  });
});

describe("textDirection utils", () => {
  it("detects direction from text content", () => {
    expect(detectTextDirection("مرحبا")).toBe("rtl");
    expect(detectTextDirection("hello")).toBe("ltr");
    expect(detectTextDirection("123 שלום")).toBe("rtl");
  });

  it("returns ltr for empty or non-string input", () => {
    expect(detectTextDirection("")).toBe("ltr");
    expect(detectTextDirection(null)).toBe("ltr");
    expect(detectTextDirection(42)).toBe("ltr");
  });

  it("identifies RTL language codes", () => {
    expect(isRTLLanguage("ar-EG")).toBe(true);
    expect(isRTLLanguage("fr")).toBe(false);
    expect(isRTLLanguage(undefined)).toBe(false);
    expect(dirAttribute("he")).toBe("rtl");
    expect(dirAttribute("en")).toBe("ltr");
  });
});
