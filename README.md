# Deen Bridge Backend API

The backend API powering **Deen Bridge** - a modern platform empowering Muslims with authentic Islamic education through courses, books, spaces, and mentorship.

## Features

- **User Authentication**: Secure JWT-based authentication with refresh tokens
- **Course Management**: Create, manage, and enroll in Islamic courses
- **Digital Library**: Upload, purchase, and read Islamic books
- **Stellar Blockchain Integration**: USDC payments on Stellar network for courses and books
- **Wallet Management**: Connect Stellar wallets (Freighter, xBull, Albedo) for creator payments
- **Review System**: Rate and review courses and books
- **User Profiles**: Customizable profiles with avatar uploads
- **Role-based Access**: Student, mentor, and admin roles

## Tech Stack

| Technology | Description |
|------------|-------------|
| Node.js | JavaScript runtime |
| Express.js | Web framework |
| MongoDB | Database |
| Mongoose | ODM for MongoDB |
| JWT | Authentication tokens |
| Stellar SDK | Blockchain integration |
| Multer | File uploads |
| Winston | Logging |

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- npm or yarn

### Installation

```bash
# Clone the repository
git clone git@github.com:Deen-Bridge/dnb-backend.git
cd dnb-backend

# Install dependencies
npm install
```

### Environment Setup

Create a `.env` file with the following variables:

```env
# Server
PORT=5000
NODE_ENV=development

# Database
MONGO_URI=mongodb://localhost:27017/deenbridge

# Authentication
JWT_SECRET=your-super-secret-key-minimum-32-characters
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_SECRET=your-refresh-token-secret

# Stellar (for payments)
STELLAR_NETWORK=testnet
```

### Running the Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

You should see:
```
Environment variables validated successfully
MongoDB connected successfully
DeenBridge API running on port 5000
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout user

### Courses
- `GET /api/courses` - List all courses
- `GET /api/courses/:id` - Get course details
- `POST /api/courses` - Create course (mentor/admin)
- `PUT /api/courses/:id` - Update course
- `DELETE /api/courses/:id` - Delete course

### Library (Books)
- `GET /api/library` - List all books
- `GET /api/library/:id` - Get book details
- `POST /api/library` - Upload book (mentor/admin)
- `PUT /api/library/:id` - Update book
- `DELETE /api/library/:id` - Delete book

### Stellar Wallet
- `POST /api/stellar/wallet/connect` - Connect Stellar wallet
- `DELETE /api/stellar/wallet/disconnect` - Disconnect wallet
- `GET /api/stellar/wallet/me` - Get connected wallet info
- `GET /api/stellar/wallet/balance/:publicKey` - Check wallet balance

### Stellar Payments
- `POST /api/stellar/payment/initialize` - Initialize payment transaction
- `POST /api/stellar/payment/submit` - Submit signed transaction
- `GET /api/stellar/payment/transactions` - Get transaction history

### Users
- `GET /api/users/me` - Get current user
- `PUT /api/users/me` - Update profile
- `GET /api/users/:id` - Get user profile

## Stellar Integration

Deen Bridge uses the Stellar blockchain for creator payments:

- **Currency**: USDC on Stellar
- **Networks**: Testnet (development), Mainnet (production)
- **Wallets Supported**: Freighter, xBull, Albedo
- **Flow**: Buyer signs transaction in wallet -> Backend verifies on-chain -> Access granted

### For Creators
1. Connect your Stellar wallet in account settings
2. Receive USDC directly when users purchase your content
3. View transaction history in your dashboard

### For Buyers
1. Connect your Stellar wallet
2. Ensure you have USDC and a USDC trustline
3. Purchase courses/books with one-click payments

## Testing

```bash
# Run tests
npm test

# Health check
curl http://localhost:5000/ping
```

## Project Structure

```
dnb-backend/
├── src/
│   ├── controllers/     # Route handlers
│   ├── middleware/      # Auth, validation, etc.
│   ├── models/          # Mongoose schemas
│   ├── routes/          # API routes
│   └── services/        # Business logic
├── services/            # External services (Stellar)
├── logs/                # Application logs
├── app.js               # Express app setup
└── server.js            # Server entry point
```

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### For Drips Wave Contributors

This repository participates in the **Stellar Drips Wave** bounty program. Look for issues labeled with point values:
- `wave:1` - Small tasks (1 point)
- `wave:2` - Medium tasks (2 points)
- `wave:3` - Large tasks (3 points)
- `wave:4` - Complex tasks (4 points)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Links

- [Frontend Repository](https://github.com/Deen-Bridge/dnb-frontend)
- [Website](https://deenbridge.com)
- [Stellar Developer Docs](https://developers.stellar.org)
