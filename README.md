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
- ⛽ **Fee Sponsorship** — optional platform-paid network fees via fee-bump, with a structural whitelist and spend caps ([docs](docs/fee-sponsorship.md))
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
- Redis (optional, for caching) — see [docs/redis.md](docs/redis.md) for setup

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
| `STELLAR_NETWORK` | `testnet` or `mainnet` (`public` accepted; validated at boot) |
| — | **Switching to mainnet? See [docs/MAINNET.md](docs/MAINNET.md)** — env changes, creator trustlines, smoke-test checklist |
| `CLOUDINARY_*` | Cloudinary credentials for media uploads |
| `QUEUE_DRIVER` | `mongo` (durable production default) or `inline` (tests/CI) |
| `JOBS_ENABLED` | Start background workers; defaults to `true` |
| `JOBS_DASHBOARD_TOKEN` | Bearer token protecting `/admin/jobs` |
| `STELLAR_PLATFORM_PUBLIC_KEY` | Public key published in `stellar.toml` `ACCOUNTS[]` |
| `FEE_SPONSOR_ENABLED` | Turn on platform-paid network fees (fee-bump). Off by default; when on, `FEE_SPONSOR_SECRET` is validated at boot ([docs](docs/fee-sponsorship.md)) |

See `.env.example` for the full list.

### Background jobs

Slow email and Stellar verification work uses the thin `src/jobs/queue.js`
abstraction. The production `mongo` driver persists jobs in the mandatory
MongoDB deployment, so work and idempotency keys survive restarts without
making optional Redis a new requirement. The `inline` driver uses the same
handlers in tests and CI. Jobs retry with exponential backoff and jitter,
terminal failures are queryable at `/admin/jobs/dead`, and the token-protected
dashboard is available at `/admin/jobs`.

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
| SEP-1 Metadata | `/.well-known/stellar.toml` |
| Auth & Users | `/api/auth`, `/api/users` |
| Courses & Books | `/api/courses`, `/api/books` |
| Spaces & Reels | `/api/spaces`, `/api/reels` |
| Stellar Wallet | `/api/stellar/wallet/*` |
| Stellar Payments | `/api/stellar/payment/*` |

### API response envelope convention

Read/list endpoints return a consistent envelope so clients can rely on the
shape and distinguish an empty result from an error:

- **`200` + `{ success: true, data: [...] }`** — a successful read/list. When a
  query legitimately matches nothing, `data` is an empty array and `success` is
  still `true`. An empty result set is *not* an error.
- **`{ success: false }` with a `4xx`/`5xx` status** — reserved strictly for
  genuine failures (missing resource `404`, invalid input `400`, forbidden
  `403`, server errors `500`).

This applies to the bookstore, course, and search read endpoints. New
controllers should follow the same rule: if the query could return zero rows
for a normal request, return `success: true` with an empty `data` array — never
flip `success` to `false` for an empty result.

### Machine-readable spec

The full OpenAPI 3.1 contract for every mounted route lives in [`openapi.yaml`](openapi.yaml).
Open it in any OpenAPI viewer (Swagger Editor, Redoc, Stoplight) or point a client generator
at it. It documents auth requirements, path and query parameters, request bodies, response
schemas and status codes, reusable schemas for the core models, the standard error shape, and
the endpoints whose response envelope is still non-standard.

## 🌊 Contributing & Drips Wave

This repository is hoping to  participates in the **[Stellar Drips Wave](https://www.drips.network/wave/stellar)** bounty program — contributors earn Points (and real rewards) for resolving this repo's issues during a Wave, with complexity tiers set in the Drips Wave app.

- All pull requests target the **`dev`** branch (`main` is releases only)
- CI (tests) must pass before review
- One contributor per issue — request it through the campaign (Drips Wave / GrantFox OSS); the maintainer assigns it. Please don't open a PR for an issue you haven't been assigned.

Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full workflow, coding standards, and Wave rules.

## 📜 License

[MIT](LICENSE) © Deen Bridge

## 🔗 Links

- 🌐 Website: [dnb-frontend.vercel.app](https://dnb-frontend.vercel.app)
- 🐦 X/Twitter: [@deen_bridge](https://x.com/deen_bridge)
- 🏢 Organization: [github.com/Deen-Bridge](https://github.com/Deen-Bridge)
# Course categories

Seed the curated Islamic-discipline taxonomy with `npm run seed:categories`. Existing free-text course and book categories can be linked without removing their legacy string values by running `npm run migrate:categories`. Both commands are idempotent and require `MONGO_URI`.
