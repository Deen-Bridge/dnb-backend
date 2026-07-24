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

Optional Stellar discovery settings:

```env
STELLAR_NETWORK=testnet
STELLAR_PLATFORM_PUBLIC_KEY=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ORG_URL=https://deenbridge.com
ORG_LOGO=https://deenbridge.com/logo.png
SIGNING_KEY=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
WEB_AUTH_ENDPOINT=https://api.deenbridge.com/auth
TRANSFER_SERVER_SEP0024=https://api.deenbridge.com/sep24
```

Unset optional values are left out of `GET /.well-known/stellar.toml`. The
endpoint remains available and returns the configured network and USDC metadata.

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

## 🔍 **Monitor Logs**

```bash
# Watch all logs
tail -f logs/combined-*.log

# Watch errors only
tail -f logs/error-*.log
```

---

**That's it! Your secure backend is running!** ✨
