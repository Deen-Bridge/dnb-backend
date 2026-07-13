<div align="center">

# 🕌 Deen Bridge — Backend API

**The REST API powering Deen Bridge: authentication, courses, library, community, and USDC payments on Stellar.**

[![CI](https://github.com/Deen-Bridge/dnb-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/Deen-Bridge/dnb-backend/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](CONTRIBUTING.md)
[![Stellar](https://img.shields.io/badge/Payments-Stellar%20USDC-0e75dd.svg)](https://stellar.org)

[Live API](https://dnb-backend-api.onrender.com) · [Web App](https://dnb-frontend.vercel.app) · [Report a Bug](https://github.com/Deen-Bridge/dnb-backend/issues) · [Contribute](CONTRIBUTING.md)

</div>

---

## About

This is the API service for **Deen Bridge**, a platform for authentic Islamic education. It handles users and roles, courses, the digital book library, community spaces, reels, notifications, and — at its core — **non-custodial USDC payments on the Stellar network**: the API builds an unsigned payment transaction, the buyer signs it in their own wallet, and the API verifies the payment on-chain before granting access. Creators receive USDC directly to their wallets.

The platform is composed of three services:

| Repository | Role | Live |
|------------|------|------|
| [dnb-frontend](https://github.com/Deen-Bridge/dnb-frontend) | Next.js web application | [dnb-frontend.vercel.app](https://dnb-frontend.vercel.app) |
| **dnb-backend** (this repo) | REST API — auth, content, Stellar payments | [dnb-backend-api.onrender.com](https://dnb-backend-api.onrender.com) |
| [dnb-ai](https://github.com/Deen-Bridge/dnb-ai) | FastAPI service for the AI assistant | [dnb-ai.onrender.com](https://dnb-ai.onrender.com) |

## ✨ Features

- 🔐 **JWT Authentication** — access + refresh tokens, role-based access (student / mentor / admin)
- 🎓 **Course Management** — create, enroll, review, and track courses
- 📚 **Digital Library** — upload, purchase, and read Islamic books
- ⭐ **Stellar Payments** — USDC payment initialize → sign → submit → on-chain verify flow
- 👛 **Wallet Management** — connect Freighter, xBull, or Albedo; balance and trustline checks
- 💬 **Real-time** — Socket.io messaging and notifications
- ☁️ **Media** — Cloudinary uploads for avatars, covers, books, and reels
- 🛡️ **Hardened** — helmet, rate limiting, sanitization (mongo-sanitize, hpp, xss), CORS

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20 · [Express 5](https://expressjs.com/) (ESM) |
| Database | [MongoDB](https://www.mongodb.com/) · [Mongoose 8](https://mongoosejs.com/) · [Redis](https://redis.io/) (caching) |
| Blockchain | [@stellar/stellar-sdk](https://github.com/stellar/js-stellar-sdk) v16 · Horizon |
| Auth | JWT (access + refresh) |
| Media & Realtime | [Cloudinary](https://cloudinary.com/) · Multer · Socket.io |
| Observability | Winston logging |

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- MongoDB (local or Atlas)
- Redis (optional, for caching)

### Setup

```bash
git clone https://github.com/Deen-Bridge/dnb-backend.git
cd dnb-backend
npm install
cp .env.example .env   # then fill in your values
npm run dev
```

The API runs at `http://localhost:5000`.

### Key Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default `5000`) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret for signing tokens (32+ chars) |
| `STELLAR_NETWORK` | `testnet` or `mainnet` |
| `CLOUDINARY_*` | Cloudinary credentials for media uploads |

See `.env.example` for the full list.

### Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start with hot reload |
| `npm start` | Start in production mode |
| `npm test` | Run the Jest + Supertest suite |
| `npm run seed` | Seed sample data |

## 🔗 API Overview

| Area | Base Route |
|------|-----------|
| Auth & Users | `/api/auth`, `/api/users` |
| Courses & Books | `/api/courses`, `/api/books` |
| Spaces & Reels | `/api/spaces`, `/api/reels` |
| Stellar Wallet | `/api/stellar/wallet/*` |
| Stellar Payments | `/api/stellar/payment/*` |

## 🌊 Contributing & Drips Wave

This repository participates in the **[Stellar Drips Wave](https://www.drips.network/wave/stellar)** bounty program — contributors earn real rewards for completing issues labeled `wave:1` through `wave:4`.

- All pull requests target the **`dev`** branch (`main` is releases only)
- CI (tests) must pass before review
- One contributor per issue — comment to claim it first

Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full workflow, coding standards, and Wave rules.

## 📜 License

[MIT](LICENSE) © Deen Bridge

## 🔗 Links

- 🌐 Website: [dnb-frontend.vercel.app](https://dnb-frontend.vercel.app)
- 🐦 X/Twitter: [@deen_bridge](https://x.com/deen_bridge)
- 🏢 Organization: [github.com/Deen-Bridge](https://github.com/Deen-Bridge)
