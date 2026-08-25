# Redis High Availability & Cluster Setup Guide

This guide details the Redis High Availability (HA) architectures, configuration files, replication mechanisms, failover behaviors, and client connection setups for the **DeenBridge Backend**.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
   - [Option A: Redis Sentinel (Recommended for DeenBridge)](#option-a-redis-sentinel-recommended-for-deenbridge)
   - [Option B: Redis Cluster (Distributed Sharding)](#option-b-redis-cluster-distributed-sharding)
   - [Architecture Comparison](#architecture-comparison)
2. [Configuration Files](#2-configuration-files)
3. [Quick Start with Docker Compose](#3-quick-start-with-docker-compose)
   - [Running Redis Sentinel HA](#running-redis-sentinel-ha)
   - [Running Redis Cluster](#running-redis-cluster)
4. [Master-Replica Replication Setup](#4-master-replica-replication-setup)
   - [Replication Directives](#replication-directives)
   - [Verifying Replication](#verifying-replication)
5. [Sentinel Automatic Failover Deep Dive](#5-sentinel-automatic-failover-deep-dive)
   - [Failure Detection (SDOWN vs ODOWN)](#failure-detection-sdown-vs-odown)
   - [Sentinel Leader Election](#sentinel-leader-election)
   - [Replica Selection & Promotion](#replica-selection--promotion)
   - [Reconfiguration & Failover Completion](#reconfiguration--failover-completion)
   - [Node Recovery & Demotion](#node-recovery--demotion)
6. [Client Connection Configuration](#6-client-connection-configuration)
   - [Environment Variables](#environment-variables)
   - [Node.js `redis` (node-redis v4)](#nodejs-redis-node-redis-v4)
   - [Node.js `ioredis` (Native Sentinel Auto-Discovery)](#nodejs-ioredis-native-sentinel-auto-discovery)
   - [Connection Retry & Reconnect Resilience](#connection-retry--reconnect-resilience)
7. [Testing Failover & Disaster Recovery](#7-testing-failover--disaster-recovery)
8. [Production Hardening & Best Practices](#8-production-hardening--best-practices)

---

## 1. Architecture Overview

High availability ensures that Redis caching remains resilient against single-node crashes, hardware faults, and network partitions without interrupting application queries.

### Option A: Redis Sentinel (Recommended for DeenBridge)

Redis Sentinel provides high availability for standard primary-replica topologies. A quorum of Sentinel processes continuously monitors primary and replica instances, triggering automatic failover when the primary becomes unresponsive.

```
                         +-------------------+
                         | DeenBridge Server |
                         +--------+----------+
                                  |
                   Queries Sentinels for Primary Address
                                  |
                +-----------------+-----------------+
                |                 |                 |
         +------v-------+  +------v-------+  +------v-------+
         |  Sentinel 1  |  |  Sentinel 2  |  |  Sentinel 3  |
         | (Port 26379) |  | (Port 26380) |  | (Port 26381) |
         +------+-------+  +------+-------+  +------+-------+
                |                 |                 |
                +-----------------+-----------------+
                                  | Monitors & Elects
                +-----------------+-----------------+
                |                                   |
         +------v-------+                    +------v-------+
         | Redis Master |=== Async Sync ====>| Redis Replica|
         | (Port 6379)  |                    | (Port 6380)  |
         +--------------+                    +--------------+
                |
                +=========== Async Sync ====>+--------------+
                                             | Redis Replica|
                                             | (Port 6381)  |
                                             +--------------+
```

**Key Advantages:**
- Transparent primary-replica failover with zero manual intervention.
- Simple operational model for single-database caching workloads.
- Minimal overhead; Sentinels require very few system resources.

---

### Option B: Redis Cluster (Distributed Sharding)

Redis Cluster automatically shards datasets across multiple primary nodes using 16,384 hash slots, with each primary backed by one or more replicas.

```
       +--------------------------------------------------------+
       |                  Redis Cluster (16,384 Slots)          |
       |                                                        |
       |  [Slots 0-5460]         [Slots 5461-10922]   [Slots 10923-16383]|
       |  +------------+         +------------+       +------------+    |
       |  |  Master 1  |<=======>|  Master 2  |<=====>|  Master 3  |    |
       |  | (Port 7000)| Gossip  | (Port 7001)| Gossip| (Port 7002)|    |
       |  +-----+------+         +-----+------+       +-----+------+    |
       |        | Async Sync           | Async Sync         | Async Sync|
       |  +-----v------+         +-----v------+       +-----v------+    |
       |  |  Replica 1 |         |  Replica 2 |       |  Replica 3 |    |
       |  | (Port 7003)|         | (Port 7004)|       | (Port 7005)|    |
       |  +------------+         +------------+       +------------+    |
       +--------------------------------------------------------+
```

**Key Advantages:**
- Horizontal write/read scalability across multiple machines.
- Automated partition rebalancing and failover via internal cluster bus.

---

### Architecture Comparison

| Feature | Redis Sentinel | Redis Cluster |
| :--- | :--- | :--- |
| **Primary Goal** | High Availability & Auto-Failover | Sharding + Horizontal Scaling + HA |
| **Data Distribution** | Replicated (All nodes hold full dataset) | Partitioned (16,384 hash slots across primaries) |
| **Minimum Nodes** | 1 Primary + 1 Replica + 3 Sentinels | 3 Primaries + 3 Replicas (6 nodes minimum) |
| **Multi-Key Commands** | Supported out of the box | Restricted to keys hashing to the same slot (Hash tags `{user:123}:key`) |
| **Database Support** | Supports DB 0-15 | Supports DB 0 only |
| **Best For** | Caching, session stores, moderate dataset size | Massive datasets (>25GB), high-concurrency multi-master writes |

---

## 2. Configuration Files

The repository includes ready-to-use production configuration templates in the `redis/` directory:

| File | Purpose |
| :--- | :--- |
| [`redis/redis.conf`](./redis.conf) | Redis server configuration (Master/Replica replication, AOF/RDB persistence, security, memory eviction, and cluster settings) |
| [`redis/sentinel.conf`](./sentinel.conf) | Redis Sentinel configuration (Quorum, monitoring parameters, failover timeouts, and script execution policies) |
| [`redis/docker-compose.sentinel.yml`](./docker-compose.sentinel.yml) | Complete Docker Compose stack: 1 Master + 2 Replicas + 3 Sentinels |
| [`redis/docker-compose.cluster.yml`](./docker-compose.cluster.yml) | Complete Docker Compose stack: 6-node Redis Cluster with automatic cluster initialization |

---

## 3. Quick Start with Docker Compose

### Running Redis Sentinel HA

To start a complete 1-Master, 2-Replica, 3-Sentinel high-availability cluster:

```bash
# Start Sentinel HA stack
docker compose -f redis/docker-compose.sentinel.yml up -d

# Verify all containers are running and healthy
docker compose -f redis/docker-compose.sentinel.yml ps
```

Expected containers:
- `redis-master` on port `6379`
- `redis-replica-1` on port `6380`
- `redis-replica-2` on port `6381`
- `redis-sentinel-1` on port `26379`
- `redis-sentinel-2` on port `26380`
- `redis-sentinel-3` on port `26381`

### Running Redis Cluster

To start a 6-node Redis Cluster (3 Masters + 3 Replicas):

```bash
# Start Cluster stack (includes auto-clustering init container)
docker compose -f redis/docker-compose.cluster.yml up -d

# Check cluster node status
docker exec -it redis-cluster-node-1 redis-cli -p 7000 cluster nodes
```

---

## 4. Master-Replica Replication Setup

### Replication Directives

Replication is configured in `redis/redis.conf` using the following core directives:

1. **`replicaof <masterip> <masterport>`**: Instructs the Redis instance to act as a replica of the specified primary.
2. **`masterauth <password>`**: Authentication token for the replica to authenticate with password-protected masters.
3. **`replica-read-only yes`**: Guarantees that clients cannot accidentally write to replica nodes.
4. **`repl-diskless-sync yes`**: Allows the primary to stream RDB snapshots directly to replica sockets without creating intermediate disk files.
5. **`repl-backlog-size 64mb`**: Circular replication buffer allowing disconnected replicas to reconnect with partial resynchronization (`PSYNC`) rather than full sync.
6. **`min-replicas-to-write 1`** & **`min-replicas-max-lag 10`**: Prevents the master from accepting writes if fewer than `N` healthy replicas acknowledge replication within `M` seconds, mitigating split-brain data loss.

### Verifying Replication

Execute `INFO replication` on any node:

```bash
# Check Master status
docker exec -it redis-master redis-cli INFO replication
```
*Output:*
```ini
role:master
connected_slaves:2
slave0:ip=172.28.0.3,port=6379,state=online,offset=1240,lag=0
slave1:ip=172.28.0.4,port=6379,state=online,offset=1240,lag=0
master_replid:a1b2c3d4e5f6...
master_repl_offset:1240
```

```bash
# Check Replica status
docker exec -it redis-replica-1 redis-cli -p 6379 INFO replication
```
*Output:*
```ini
role:slave
master_host:redis-master
master_port:6379
master_link_status:up
slave_read_only:1
```

---

## 5. Sentinel Automatic Failover Deep Dive

Redis Sentinel executes automatic failover through a deterministic, consensus-driven state machine:

```
[Master Becomes Unresponsive]
             │
             ▼
[Subjective Down (SDOWN)]  ──> Each Sentinel detects missing PING replies for > 5000ms
             │
             ▼
[Objective Down (ODOWN)]   ──> Sentinels exchange SENTINEL IS-MASTER-DOWN-BY-ADDR;
             │                 Quorum (2/3) reached
             ▼
[Leader Sentinel Election] ──> Raft-like consensus elects one Sentinel to orchestrate failover
             │
             ▼
[Replica Promotion]        ──> Best replica selected (Priority -> Offset -> Run ID)
             │                 and sent `SLAVEOF NO ONE`
             ▼
[Cluster Reconfiguration]  ──> Other replicas reconfigured to `REPLICAOF <New-Master>`
             │
             ▼
[Old Master Rejoined]      ──> If old master recovers, Sentinel reconfigures it to be a replica
```

### Failure Detection (SDOWN vs ODOWN)

1. **Subjective Down (SDOWN)**: If a Sentinel instance sends a `PING` to the monitored master and does not receive a valid reply (`+PONG`, `-LOADING`, or `-MASTERDOWN`) within `down-after-milliseconds` (configured to `5000ms`), that Sentinel flags the master as `+sdown`.
2. **Objective Down (ODOWN)**: The detecting Sentinel broadcasts `SENTINEL is-master-down-by-addr` to all other Sentinels. When at least **2 out of 3** Sentinels confirm the `SDOWN` status, the master state transitions to `+odown`.

### Sentinel Leader Election

Once `ODOWN` is reached, the Sentinels initiate a leader election epoch:
- Each Sentinel requests votes from peers using a monotonic configuration epoch.
- The Sentinel that secures a majority of votes (at least `max(quorum, num_sentinels/2 + 1)`) becomes the **Leader Sentinel** responsible for executing the failover steps.

### Replica Selection & Promotion

The elected Sentinel ranks candidate replicas using deterministic criteria:
1. **Disqualification filter**: Replicas disconnected from the master for too long (`(now - master_link_down_time) > (down-after-milliseconds * 10) + failover_timeout`) or with `replica-priority 0` are disqualified.
2. **`replica-priority`**: Lowest priority integer wins (e.g., `10` is preferred over `100`).
3. **Replication Offset (`master_repl_offset`)**: The replica that has processed the highest replication byte offset from the master is chosen (minimizing data loss).
4. **Run ID**: Lexicographically smaller Run ID breaks ties deterministically.

The chosen replica is sent the `SLAVEOF NO ONE` command and transitions to `role:master`.

### Reconfiguration & Failover Completion

1. The Sentinel verifies the promoted replica has assumed the master role.
2. The Sentinel sends `REPLICAOF <new-master-ip> <new-master-port>` to the remaining replicas.
3. The parameter `sentinel parallel-syncs mymaster 1` ensures replicas synchronize sequentially, preventing network congestion.
4. Sentinel publishes a `+switch-master` event over Pub/Sub channel to notify all connected clients.

### Node Recovery & Demotion

When the failed former master comes back online, Sentinels detect its presence, reconfigure its role with `REPLICAOF <new-master-ip> <new-master-port>`, and attach it as a replica to the active master.

---

## 6. Client Connection Configuration

### Environment Variables

Configure your `.env` file depending on your Redis topology:

```env
# ==========================================
# Standalone / Sentinel-Fronted Redis
# ==========================================
REDIS_URL=redis://localhost:6379
# Or separate credentials:
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_USERNAME=default
# REDIS_PASSWORD=your_secure_password

# ==========================================
# Redis Cluster Configuration
# ==========================================
REDIS_IS_CLUSTER=false
# Comma-separated list of cluster root nodes:
# REDIS_CLUSTER_NODES=redis://127.0.0.1:7000,redis://127.0.0.1:7001,redis://127.0.0.1:7002
```

---

### Node.js `redis` (node-redis v4)

DeenBridge uses `redis@^4.7.1` in `src/config/redis.js`. The initialization automatically switches between standalone and cluster clients:

#### Standalone & Sentinel-proxy:
```javascript
import { createClient } from "redis";

const client = createClient({
  url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) return new Error("Max retry attempts reached");
      return Math.min(retries * 100, 3000);
    },
  },
});

await client.connect();
```

#### Redis Cluster:
```javascript
import { createCluster } from "redis";

const cluster = createCluster({
  rootNodes: process.env.REDIS_CLUSTER_NODES.split(",").map((url) => ({ url: url.trim() })),
  defaults: {
    password: process.env.REDIS_PASSWORD,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
  },
});

await cluster.connect();
```

---

### Node.js `ioredis` (Native Sentinel Auto-Discovery)

For native Sentinel client resolution where the application discovers the active master dynamically from Sentinels:

```javascript
import Redis from "ioredis";

const redis = new Redis({
  sentinels: [
    { host: "127.0.0.1", port: 26379 },
    { host: "127.0.0.1", port: 26380 },
    { host: "127.0.0.1", port: 26381 },
  ],
  name: "mymaster",
  password: process.env.REDIS_PASSWORD,
  sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD,
  retryStrategy(times) {
    return Math.min(times * 100, 3000);
  },
});

redis.on("connect", () => console.log("Connected to active Redis master via Sentinel"));
```

---

### Connection Retry & Reconnect Resilience

During a failover window (typically 3-6 seconds), writes to the old master will fail until promotion completes. The DeenBridge cache layer handles this gracefully:

1. **Non-blocking Cache Degradation**: If Redis is momentarily unavailable during failover, cache queries fall back directly to MongoDB without crashing HTTP handlers.
2. **Exponential Backoff Reconnect**: The client socket automatically retries connections with incremental backoff (`Math.min(retries * 100, 3000)`).
3. **Re-connection Listeners**: Client logs `reconnecting` and `ready` events to provide complete observability.

---

## 7. Testing Failover & Disaster Recovery

Follow this hands-on test procedure to verify automated failover in action:

### Step 1: Start Sentinel Stack
```bash
docker compose -f redis/docker-compose.sentinel.yml up -d
```

### Step 2: Write Data to Primary
```bash
docker exec -it redis-master redis-cli set test_key "deenbridge_ha_verified"
```

### Step 3: Verify Data Replicated to Replicas
```bash
docker exec -it redis-replica-1 redis-cli -p 6379 get test_key
docker exec -it redis-replica-2 redis-cli -p 6379 get test_key
# Both should return: "deenbridge_ha_verified"
```

### Step 4: Stream Sentinel Logs
Open a separate terminal window:
```bash
docker logs -f redis-sentinel-1
```

### Step 5: Simulate Master Crash
Stop the primary Redis container:
```bash
docker stop redis-master
```

### Step 6: Observe Failover in Sentinel Logs
Within ~5 seconds, you will observe the following sequence:
```
+sdown master mymaster 172.28.0.2 6379
+odown master mymaster 172.28.0.2 6379 #quorum 2/2
+try-failover master mymaster 172.28.0.2 6379
+vote-for-leader ...
+elected-leader master mymaster 172.28.0.2 6379
+failover-state-select-slave master mymaster 172.28.0.2 6379
+selected-slave slave 172.28.0.3:6379
+failover-state-send-slaveof-noone slave 172.28.0.3:6379
+failover-end master mymaster 172.28.0.2 6379
+switch-master mymaster 172.28.0.2 6379 172.28.0.3 6379
+slave slave 172.28.0.4:6379 (reconfigured to new master)
```

### Step 7: Verify New Master Accepts Writes
```bash
docker exec -it redis-replica-1 redis-cli -p 6379 set post_failover_key "cluster_active"
docker exec -it redis-replica-2 redis-cli -p 6379 get post_failover_key
# Returns: "cluster_active"
```

### Step 8: Recover Old Master
Restart the stopped container:
```bash
docker start redis-master
```
Sentinel detects the recovered node and automatically reconfigures it as a replica of the new primary (`+convert-to-slave`).

---

## 8. Production Hardening & Best Practices

### OS & Linux Kernel Tuning

Add the following settings to `/etc/sysctl.conf` on production hosts:

```ini
# Prevent background save / fork failures under memory pressure
vm.overcommit_memory = 1

# Increase max connection backlog for high throughput
net.core.somaxconn = 1024

# Increase file descriptor limit
fs.file-max = 65536
```

Apply with:
```bash
sudo sysctl -p
```

Disable **Transparent Huge Pages (THP)** to prevent latency spikes during memory allocations:
```bash
echo never | sudo tee /sys/kernel/mm/transparent_hugepage/enabled
```

### Memory & Eviction Tuning

1. Always set an explicit `maxmemory` limit (e.g. `512mb` or `75%` of total server RAM).
2. Set `maxmemory-policy allkeys-lru` for caching workloads.
3. Enable `lazyfree-lazy-eviction yes` and `lazyfree-lazy-expire yes` to prevent main thread blocking when expiring large keys.

### Security Checklist

- [ ] Place Redis instances inside private VPC subnets; never expose port `6379` or `26379` directly to the public internet.
- [ ] Configure strong passwords with `requirepass` and `masterauth` in `redis.conf`, and `sentinel auth-pass` in `sentinel.conf`.
- [ ] Rename or disable destructive commands (`FLUSHALL`, `FLUSHDB`, `DEBUG`).
- [ ] Enable TLS/SSL (`tls-port 6379`) if traffic traverses untrusted network zones.
