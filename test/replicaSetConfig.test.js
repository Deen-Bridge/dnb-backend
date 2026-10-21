import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildReplicaSetOptions } from "../mongo/connection/replicaSet.js";
import { READ_PREFERENCE, getReadPreference, isValidReadPreference } from "../mongo/config/readPreference.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

describe("MongoDB Replica Set Configuration (Issue #262)", () => {
  describe("mongo/mongod.conf", () => {
    const configPath = path.join(rootDir, "mongo", "mongod.conf");

    it("exists in the mongo/ directory", () => {
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it("contains replica set name rs0", () => {
      const content = fs.readFileSync(configPath, "utf8");
      expect(content).toMatch(/replSetName:\s*"rs0"/);
      expect(content).toMatch(/replication:/);
      expect(content).toMatch(/storage:/);
      expect(content).toMatch(/wiredTiger:/);
      expect(content).toMatch(/net:/);
    });
  });

  describe("mongo/init-replica.js", () => {
    const initScriptPath = path.join(rootDir, "mongo", "init-replica.js");

    it("exists in the mongo/ directory", () => {
      expect(fs.existsSync(initScriptPath)).toBe(true);
    });

    it("contains 3-node replica set configuration", () => {
      const content = fs.readFileSync(initScriptPath, "utf8");
      expect(content).toMatch(/_id:\s*0/);
      expect(content).toMatch(/_id:\s*1/);
      expect(content).toMatch(/_id:\s*2/);
      expect(content).toMatch(/rs\.initiate/);
      expect(content).toMatch(/rs\.status/);
    });
  });

  describe("mongo/README.md", () => {
    const readmePath = path.join(rootDir, "mongo", "README.md");

    it("exists and documents connection strings and read preferences", () => {
      expect(fs.existsSync(readmePath)).toBe(true);
      const content = fs.readFileSync(readmePath, "utf8");
      expect(content).toMatch(/replicaSet=rs0/);
      expect(content).toMatch(/secondaryPreferred/);
      expect(content).toMatch(/w: "majority"/);
    });
  });

  describe("Connection options builder", () => {
    it("builds replica set options with default majority write concern and secondaryPreferred", () => {
      const opts = buildReplicaSetOptions({
        replicaSet: "rs0",
        readPreference: "secondaryPreferred",
      });

      expect(opts.replicaSet).toBe("rs0");
      expect(opts.readPreference).toBe("secondaryPreferred");
      expect(opts.w).toBe("majority");
      expect(opts.retryWrites).toBe(true);
      expect(opts.retryReads).toBe(true);
    });

    it("validates read preference modes correctly", () => {
      expect(isValidReadPreference(READ_PREFERENCE.PRIMARY)).toBe(true);
      expect(isValidReadPreference(READ_PREFERENCE.SECONDARY_PREFERRED)).toBe(true);
      expect(isValidReadPreference("invalid_mode")).toBe(false);
      expect(getReadPreference("read")).toBe(READ_PREFERENCE.SECONDARY_PREFERRED);
      expect(getReadPreference("write")).toBe(READ_PREFERENCE.PRIMARY);
    });
  });
});
