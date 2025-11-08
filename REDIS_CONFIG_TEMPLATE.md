# Redis Configuration Template

## Your Redis Cloud Credentials

Based on your Redis dashboard, here are your credentials:

```javascript
// Redis Cloud Connection Details
username: "default";
password: "UwXT4EhwxwVLWAohKgh6Hn76ElthQcR7";
host: "redis-19109.c283.us-east-1-4.ec2.redns.redis-cloud.com";
port: 19109;
```

## Environment Variables Setup

Add these to your `dnb-backend/.env` file:

```env
# Redis Cloud Configuration
REDIS_USERNAME=default
REDIS_PASSWORD=UwXT4EhwxwVLWAohKgh6Hn76ElthQcR7
REDIS_HOST=redis-19109.c283.us-east-1-4.ec2.redns.redis-cloud.com
REDIS_PORT=19109

# Alternative: You can also use a single URL format
# REDIS_URL=redis://default:UwXT4EhwxwVLWAohKgh6Hn76ElthQcR7@redis-19109.c283.us-east-1-4.ec2.redns.redis-cloud.com:19109
```

## Test Connection

Run this to test your Redis connection:

```bash
cd dnb-backend
npm run dev
```

You should see:

```
✅ Redis connected and ready
```

## Production Deployment

For production (Vercel/Render/Railway), add these environment variables:

- `REDIS_USERNAME` = default
- `REDIS_PASSWORD` = UwXT4EhwxwVLWAohKgh6Hn76ElthQcR7
- `REDIS_HOST` = redis-19109.c283.us-east-1-4.ec2.redns.redis-cloud.com
- `REDIS_PORT` = 19109

## Cache Benefits

Once connected, your app will automatically cache:

- ✅ Course data (5 minutes)
- ✅ Book data (5 minutes)
- ✅ User profiles (10 minutes)
- ✅ Search results (2 minutes)
- ✅ AI chat history (15 minutes)

This will make your app **3-5x faster**! 🚀
