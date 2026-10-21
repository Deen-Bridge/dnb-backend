/**
 * MongoDB Replica Set Initialization Script (3-Node rs0)
 * -------------------------------------------------------
 * Initializes and configures a 3-member MongoDB replica set ('rs0').
 *
 * Usage:
 *   mongosh mongodb://localhost:27017 /path/to/init-replica.js
 *   or inside Docker:
 *   docker exec -it mongo1 mongosh --file /mongo/init-replica.js
 */

const REPLICA_SET_NAME = process.env.MONGO_REPLICA_SET || "rs0";
const PRIMARY_HOST = process.env.MONGO_NODE1_HOST || "mongo1:27017";
const SECONDARY1_HOST = process.env.MONGO_NODE2_HOST || "mongo2:27017";
const SECONDARY2_HOST = process.env.MONGO_NODE3_HOST || "mongo3:27017";

const config = {
  _id: REPLICA_SET_NAME,
  version: 1,
  members: [
    {
      _id: 0,
      host: PRIMARY_HOST,
      priority: 2, // Preferred Primary
      votes: 1,
    },
    {
      _id: 1,
      host: SECONDARY1_HOST,
      priority: 1,
      votes: 1,
    },
    {
      _id: 2,
      host: SECONDARY2_HOST,
      priority: 1,
      votes: 1,
    },
  ],
  settings: {
    chainingAllowed: true,
    heartbeatIntervalMillis: 2000,
    heartbeatTimeoutSecs: 10,
    electionTimeoutMillis: 10000,
    catchUpTimeoutMillis: 60000,
  },
};

print(`[ReplicaSet] Checking replica set '${REPLICA_SET_NAME}' status...`);

try {
  const status = rs.status();
  if (status && status.ok === 1) {
    print(`[ReplicaSet] Replica set '${status.set}' is already initialized.`);
    print(`[ReplicaSet] Current primary: ${status.members.find((m) => m.stateStr === "PRIMARY")?.name || "electing..."}`);
  } else {
    throw new Error("Replica set not ok");
  }
} catch (err) {
  print(`[ReplicaSet] Initializing replica set '${REPLICA_SET_NAME}' with 3 nodes...`);
  const initResult = rs.initiate(config);

  if (initResult.ok === 1) {
    print(`[ReplicaSet] Successfully initiated '${REPLICA_SET_NAME}'.`);
  } else {
    print(`[ReplicaSet] Initiation returned: ${JSON.stringify(initResult)}`);
  }

  // Wait for Primary election
  print("[ReplicaSet] Waiting for PRIMARY election to settle...");
  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    sleep(1000);
    attempts++;
    try {
      const hello = db.hello();
      if (hello.isWritablePrimary || hello.ismaster) {
        print(`[ReplicaSet] Primary elected: ${hello.primary || hello.me}`);
        break;
      }
    } catch {
      // Node still transitioning
    }
  }

  print("[ReplicaSet] Configuration complete. Summary:");
  printjson(rs.conf());
}
