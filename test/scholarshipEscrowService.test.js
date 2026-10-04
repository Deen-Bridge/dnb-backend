import * as StellarSdk from "@stellar/stellar-sdk";
import {
  scholarshipEscrowContractId,
  scholarshipEscrowRpc,
} from "../src/services/stellar/scholarshipEscrowService.js";

const VALID_CONTRACT_ID = "CBP3UFPBCVGNQPTWIHHRH52VDD4PE64JGFPREF7GVFIIF7G4DZOWKX7Z";
const ENV_KEYS = ["SCHOLARSHIP_ESCROW_CONTRACT_ID", "GIVING_ESCROW_CONTRACT_ID", "STELLAR_NETWORK", "SOROBAN_RPC_URL"];
let originalEnv;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("scholarship escrow network configuration", () => {
  it("fails closed when no scholarship contract is configured", () => {
    expect(() => scholarshipEscrowContractId()).toThrow("Scholarship escrow is not configured");
  });

  it("rejects a malformed contract ID", () => {
    process.env.SCHOLARSHIP_ESCROW_CONTRACT_ID = "not-a-contract-id";
    expect(() => scholarshipEscrowContractId()).toThrow("Scholarship escrow contract ID is invalid");
  });

  it("requires an explicit Soroban RPC endpoint on mainnet", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    expect(() => scholarshipEscrowRpc()).toThrow("SOROBAN_RPC_URL must be configured");
  });

  it("uses the public passphrase and configured RPC on mainnet", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    process.env.SOROBAN_RPC_URL = "https://soroban-mainnet.example/rpc";
    process.env.SCHOLARSHIP_ESCROW_CONTRACT_ID = VALID_CONTRACT_ID;

    const config = scholarshipEscrowRpc();
    expect(config.network).toBe("mainnet");
    expect(config.networkPassphrase).toBe(StellarSdk.Networks.PUBLIC);
    expect(scholarshipEscrowContractId()).toBe(VALID_CONTRACT_ID);
  });
});
