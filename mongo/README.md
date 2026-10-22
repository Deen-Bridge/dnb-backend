# MongoDB 3-Node Replica Set Setup & Configuration (`rs0`)

This directory contains the production-grade replica set configuration, initialization scripts, and connection documentation for MongoDB deployments supporting **Deen-Bridge (`dnb-backend`)**.

---

## 1. Overview & Architecture

A 3-node replica set provides high availability, automatic failover, and data redundancy without requiring a separate arbiter instance:

```
┌─────────────────────────────────────────────────────────────┐
│                    Replica Set: rs0                         │
│                                                             │
│   ┌─────────────────┐             ┌─────────────────┐       │
│   │  mongo1:27017   │  Replicate  │  mongo2:27017   │       │
│   │   (PRIMARY)     ├────────────►│  (SECONDARY)    │       │
│   │  priority: 2    │             │  priority: 1    │       │
│   └────────┬────────┘             └─────────────────┘       │
│            │                                                │
│            │ Replicate                                      │
│            ▼                                                │
│   ┌─────────────────┐                                       │
│   │  mongo3:27017   │                                       │
│   │  (SECONDARY)    │                                       │
│   │  priority: 1    │                                       │
│   └─────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

- **Quorum**: 3 voting members (majority = 2 votes needed for primary election and majority write concern).
- **Auto-Failover**: If the primary goes offline, the remaining 2 nodes elect a new primary within ~10 seconds.
- **Data Safety**: Write operations acknowledge across a majority of nodes before committing.

---

## 2. Directory Structure

```
mongo/
├── mongod.conf         # MongoDB daemon configuration file (storage, replication, logs, network)
├── init-replica.js     # Idempotent replica set initialization script
├── README.md           # This setup & operations guide
├── config/
│   └── readPreference.js # Read-preference routing constants & query mapper
└── connection/
    └── replicaSet.js   # Mongoose connection builder & failover event listeners
```

---

## 3. Configuration Details (`mongod.conf`)

Key settings defined in `mongo/mongod.conf`:

```yaml
net:
  port: 27017
  bindIp: 0.0.0.0
  maxIncomingConnections: 10000

storage:
  dbPath: /data/db
  journal:
    enabled: true
  wiredTiger:
    engineConfig:
      cacheSizeGB: 1
      journalCompressor: snappy

replication:
  replSetName: "rs0"
  oplogSizeMB: 2048
  enableMajorityReadConcern: true

operationProfiling:
  mode: slowOp
  slowOpThresholdMs: 100
```

---

## 4. Connection Strings

### Standard 3-Node URI

```bash
MONGO_URI="mongodb://mongo1:27017,mongo2:27017,mongo3:27017/dnb-backend?replicaSet=rs0&retryWrites=true&w=majority"
```

### Local Development / Docker Compose URI

```bash
MONGO_URI="mongodb://localhost:27017,localhost:27018,localhost:27019/dnb-backend?replicaSet=rs0&retryWrites=true&w=majority"
```

### Authenticated URI (Production with TLS & Keyfile)

```bash
MONGO_URI="mongodb://app_user:StrongPassword@mongo1.internal:27017,mongo2.internal:27017,mongo3.internal:27017/dnb-backend?replicaSet=rs0&authSource=admin&ssl=true&retryWrites=true&w=majority"
```

---

## 5. Read Preferences & Query Routing

Configured via `mongo/config/readPreference.js` and Mongoose helper `mongo/connection/replicaSet.js`.

| Read Preference Mode | Description | Recommended Use Case |
| :--- | :--- | :--- |
| `primary` *(Default)* | Read only from the active Primary node. | Financial transactions, user balance updates, critical mutations. |
| `primaryPreferred` | Read from Primary; fall back to Secondary during failover. | Real-time dashboards when read availability is prioritized. |
| `secondary` | Read only from Secondary nodes. | Heavy analytics, report generation, ETL pipelines. |
| `secondaryPreferred` | Read from Secondaries; fall back to Primary if none available. | Content queries (book catalogs, reel feeds, public profiles). |
| `nearest` | Read from member with lowest network latency. | Geographically distributed multi-region deployments. |

### Code Examples in `dnb-backend`

```js
import mongoose from "mongoose";
import { connectReplicaSet, buildReplicaSetOptions } from "./mongo/connection/replicaSet.js";
import { READ_PREFERENCE, getReadPreference } from "./mongo/config/readPreference.js";

// Connect to replica set with failover event monitoring
await connectReplicaSet(mongoose, {
  uri: process.env.MONGO_URI,
  replicaSet: "rs0",
  readPreference: READ_PREFERENCE.SECONDARY_PREFERRED,
});

// Routing specific queries to secondary nodes
const books = await Book.find({ isPublished: true })
  .read(READ_PREFERENCE.SECONDARY_PREFERRED)
  .lean();

// Automatic query type mapping (writes -> primary, reads -> secondaryPreferred)
const userReels = await Reel.find({ userId })
  .read(getReadPreference("read"))
  .exec();
```

---

## 6. Write Concern & Read Concern

- **Write Concern (`w: "majority"`)**:
  - Ensures writes are written to disk journal on the primary and replicated to at least one secondary before returning success.
  - Set `wtimeoutMS: 5000` to prevent operations from hanging indefinitely if quorum is lost.
  - Enabled by default in `buildReplicaSetOptions()`.

- **Read Concern (`majority`)**:
  - Ensures data returned from queries has been committed to a majority of nodes and cannot be rolled back during a network partition.

---

## 7. Initialization & Local Deployment

### Step 1: Run with Docker Compose

Run 3 MongoDB containers using the `mongo:7.0` image with `replSet rs0` enabled:

```bash
# Start nodes
docker run -d --name mongo1 --net dnb-net -p 27017:27017 mongo:7.0 mongod --replSet rs0 --bind_ip_all
docker run -d --name mongo2 --net dnb-net -p 27018:27017 mongo:7.0 mongod --replSet rs0 --bind_ip_all
docker run -d --name mongo3 --net dnb-net -p 27019:27017 mongo:7.0 mongod --replSet rs0 --bind_ip_all
```

### Step 2: Initialize Replica Set

Execute `init-replica.js` on the primary instance:

```bash
docker exec -i mongo1 mongosh < mongo/init-replica.js
```

Or via direct mongosh command:

```bash
mongosh "mongodb://localhost:27017" --file mongo/init-replica.js
```

---

## 8. Health Checks & Operational Commands

Inside `mongosh`:

```js
// Check replica set status & node roles
rs.status()

// View current replica set configuration
rs.conf()

// Check replication lag and oplog duration
rs.printReplicationInfo()
rs.printSecondaryReplicationInfo()

// Test manual failover (step down primary for 60 seconds)
rs.stepDown(60)
```
