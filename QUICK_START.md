# 🚀 Quick Start - Secured Backend

## ⚡ **Get Running in 3 Steps**

### **1. Install New Dependencies**

```bash
npm install
```

### **2. Update .env File**

Make sure your `.env` has these minimum requirements:

```env
MONGO_URI=mongodb://localhost:27017/deenbridge
JWT_SECRET=deenbridge-super-secret-key-minimum-32-characters-long
NODE_ENV=development
PORT=5000
```

### **3. Start Server**

```bash
npm run dev
```

You should see:

```
✅ Environment variables validated successfully
✅🌿 MongoDB connected successfully
🚀🕌 DeenBridge API running on port 5000
```

---

## 📁 **Logs Directory**

Logs will be auto-created in `/logs`:

```
logs/
├── error-2025-10-24.log
├── combined-2025-10-24.log
└── http-2025-10-24.log
```

---

## 🧪 **Test It Works**

```bash
# Health check
curl http://localhost:5000/ping

# Try login (will be rate limited after 5 attempts)
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test"}'
```

---

## 🌐 **Stellar TOML (SEP-1)**

The API serves ecosystem metadata at `/.well-known/stellar.toml`:

```bash
curl http://localhost:5000/.well-known/stellar.toml
```

Optional env vars for the TOML: `STELLAR_PLATFORM_PUBLIC_KEY`, `ORG_NAME`, `ORG_URL`, `ORG_DESCRIPTION`, `ORG_LOGO`, `ORG_TWITTER`, `ORG_GITHUB`. (`SIGNING_KEY` is a placeholder that must remain unset until SEP-10 #25). See `.env.example`.

---

## 🔍 **Monitor Logs**

```bash
# Watch all logs
tail -f logs/combined-*.log

# Watch errors only
tail -f logs/error-*.log
```

---

**That's it! Your secure backend is running!** ✨
