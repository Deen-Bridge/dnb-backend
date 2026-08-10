# Redis Caching Setup for DeenBridge

Complete guide to set up and use Redis caching in the DeenBridge backend.

## Why Redis?

✅ **Massive Performance Boost**

- 80-90% reduction in database queries
- API responses 10-100x faster
- Shared cache across all users

✅ **Reduced Server Load**

- Less database connections
- Lower CPU usage
- Better scalability

✅ **Better User Experience**

- Faster page loads
- Reduced latency
- Smoother app performance

## Installation

### 1. Install Redis Server

#### macOS (Using Homebrew):

```bash
brew install redis
brew services start redis
```

#### Ubuntu/Debian:

```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

#### Windows:

Download from: https://github.com/microsoftarchive/redis/releases
Or use Docker (recommended):

```bash
docker run -d -p 6379:6379 redis:alpine
```

### 2. Install Node Redis Package

```bash
cd dnb-backend
npm install redis
```

### 3. Configure Environment

Add to your `.env` file:

```env
# Redis Configuration (optional - defaults to localhost:6379)
REDIS_URL=redis://localhost:6379

# For production with password:
# REDIS_URL=redis://username:password@hostname:6379
```

## Verify Redis is Running

```bash
# Test Redis connection
redis-cli ping
# Should return: PONG

# Check Redis info
redis-cli info
```

## Usage in Routes

### Basic Caching

```javascript
import { smartCache } from "../middlewares/cache.js";
import { CACHE_TTL } from "../utils/cache.js";

// Cache for 10 minutes
router.get("/courses", smartCache({ ttl: CACHE_TTL.COURSES }), getCourses);
```

### Manual Caching

```javascript
import { getCacheOrSet, CACHE_KEYS, CACHE_TTL } from "../utils/cache.js";

export const getCourses = async (req, res) => {
  const courses = await getCacheOrSet(
    CACHE_KEYS.COURSES + "all",
    async () => {
      // This function runs only on cache miss
      return await Course.find();
    },
    CACHE_TTL.COURSES
  );

  res.json(courses);
};
```

### Cache Invalidation

```javascript
import { invalidateCacheMiddleware } from "../middlewares/cache.js";
import { deleteCache, CACHE_KEYS } from "../utils/cache.js";

// Invalidate on POST/PUT/DELETE
router.post(
  "/courses",
  invalidateCacheMiddleware(["route:*/courses*", "courses:*"]),
  createCourse
);

// Or manually in controller
export const updateCourse = async (req, res) => {
  const course = await Course.findByIdAndUpdate(req.params.id, req.body);

  // Clear specific cache
  await deleteCache(`${CACHE_KEYS.COURSE}${req.params.id}`);

  // Clear all courses cache
  await deleteCachePattern(`${CACHE_KEYS.COURSES}*`);

  res.json(course);
};
```

## Example Route Implementation

### Before (No Caching):

```javascript
router.get("/courses", getCourses);
router.get("/courses/:id", getCourseById);
router.post("/courses", createCourse);
router.put("/courses/:id", updateCourse);
router.delete("/courses/:id", deleteCourse);
```

### After (With Caching):

```javascript
import { smartCache, invalidateCacheMiddleware } from "../middlewares/cache.js";
import { CACHE_TTL } from "../utils/cache.js";

// Cache GET requests
router.get("/courses", smartCache({ ttl: CACHE_TTL.COURSES }), getCourses);

router.get(
  "/courses/:id",
  smartCache({ ttl: CACHE_TTL.COURSES }),
  getCourseById
);

// Invalidate cache on mutations
router.post(
  "/courses",
  invalidateCacheMiddleware(["route:*/courses*", "courses:*"]),
  createCourse
);

router.put(
  "/courses/:id",
  invalidateCacheMiddleware(["route:*/courses*", "courses:*"]),
  updateCourse
);

router.delete(
  "/courses/:id",
  invalidateCacheMiddleware(["route:*/courses*", "courses:*"]),
  deleteCourse
);
```

## Cache TTL Configuration

Pre-configured in `src/utils/cache.js`:

```javascript
CACHE_TTL.SHORT; // 3 minutes
CACHE_TTL.MEDIUM; // 10 minutes
CACHE_TTL.LONG; // 30 minutes
CACHE_TTL.VERY_LONG; // 1 hour

// Entity-specific
CACHE_TTL.COURSES; // 15 minutes
CACHE_TTL.BOOKS; // 15 minutes
CACHE_TTL.USERS; // 10 minutes
CACHE_TTL.SPACES; // 5 minutes
CACHE_TTL.REELS; // 3 minutes
CACHE_TTL.SEARCH; // 5 minutes
```

## Cache Keys

Consistent naming in `src/utils/cache.js`:

```javascript
CACHE_KEYS.COURSES; // 'courses:'
CACHE_KEYS.COURSE; // 'course:'
CACHE_KEYS.BOOKS; // 'books:'
CACHE_KEYS.BOOK; // 'book:'
// ... etc
```

## Advanced Usage

### Cache with Custom Key

```javascript
import { cacheMiddleware } from "../middlewares/cache.js";

router.get(
  "/search",
  cacheMiddleware(
    300, // 5 minutes
    (req) => `search:${req.query.q}` // Custom key generator
  ),
  searchController
);
```

### User-Specific Caching

```javascript
router.get(
  "/dashboard",
  authenticate,
  smartCache({
    ttl: CACHE_TTL.MEDIUM,
    includeUser: true, // Separate cache per user
  }),
  getDashboard
);
```

### Check Cache Status

```javascript
import { cacheExists, getCacheTTL } from "../utils/cache.js";

const exists = await cacheExists("courses:all");
const ttl = await getCacheTTL("courses:all"); // Remaining seconds
```

### Clear All Cache (Admin Only)

```javascript
import { flushAllCache } from "../utils/cache.js";

router.post("/admin/clear-cache", isAdmin, async (req, res) => {
  await flushAllCache();
  res.json({ message: "Cache cleared successfully" });
});
```

## Monitoring

### Redis CLI Commands

```bash
# Check all keys
redis-cli KEYS '*'

# Get specific key
redis-cli GET "courses:all"

# Check memory usage
redis-cli INFO memory

# Monitor real-time commands
redis-cli MONITOR

# Clear all cache (BE CAREFUL!)
redis-cli FLUSHALL
```

### Application Logs

Cache hits and misses are logged:

```
✅ Cache hit: courses:all
❌ Cache miss: courses:all
🔄 Executing fallback for: courses:all
🗑️  Cache invalidated: courses:*
```

## Production Deployment

### Redis Cloud (Recommended)

1. **Redis Labs** (Free tier available)

   - https://redis.com/try-free/
   - 30MB free tier
   - Global availability

2. **Update `.env`**:

```env
REDIS_URL=redis://username:password@redis-12345.cloud.redislabs.com:12345
```

### Docker Compose

```yaml
version: "3.8"
services:
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  redis_data:
```

## Troubleshooting

### Redis not connecting?

1. Check if Redis is running:

```bash
redis-cli ping
```

2. Check Redis logs:

```bash
# macOS
tail -f /usr/local/var/log/redis.log

# Linux
sudo journalctl -u redis -f
```

3. Verify port 6379 is open:

```bash
netstat -an | grep 6379
```

### App works without Redis

The app is designed to work without Redis! If Redis fails:

- Logs will show warnings
- App continues without caching
- No errors thrown

## Performance Metrics

Expected improvements with Redis:

| Metric            | Before    | After   | Improvement      |
| ----------------- | --------- | ------- | ---------------- |
| API Response Time | 200-500ms | 10-50ms | 10-20x faster    |
| Database Queries  | 100%      | 10-20%  | 80-90% reduction |
| Server Load       | High      | Low     | 50-70% less CPU  |
| Concurrent Users  | 100       | 500+    | 5x capacity      |

## Best Practices

✅ **Do:**

- Cache GET requests only
- Invalidate cache on data changes
- Use appropriate TTL values
- Monitor cache hit rates

❌ **Don't:**

- Cache POST/PUT/DELETE requests
- Set TTL too high for changing data
- Cache user-specific data globally
- Forget to invalidate on updates

## Next Steps

1. Install Redis locally
2. Test the caching in development
3. Monitor cache performance
4. Deploy Redis in production
5. Celebrate your faster app! 🎉
