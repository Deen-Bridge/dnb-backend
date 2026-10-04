import * as StellarSdk from "@stellar/stellar-sdk";
import { resolveStellarNetwork } from "../../config/stellar.js";
import { fromStroops, toStroops } from "./stellarService.js";
import { prepareSorobanInvocation } from "./sorobanService.js";

const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";

export const scholarshipEscrowContractId = () => {
  const contractId =
    process.env.SCHOLARSHIP_ESCROW_CONTRACT_ID ||
    process.env.GIVING_ESCROW_CONTRACT_ID;
  if (!contractId) {
    const error = new Error("Scholarship escrow is not configured");
    error.statusCode = 503;
    throw error;
  }
  try {
    StellarSdk.StrKey.decodeContract(contractId);
  } catch {
    const error = new Error("Scholarship escrow contract ID is invalid");
    error.statusCode = 503;
    throw error;
  }
  return contractId;
};

export const scholarshipEscrowRpc = () => {
  const network = resolveStellarNetwork();
  const rpcUrl = process.env.SOROBAN_RPC_URL || (network === "testnet" ? TESTNET_RPC_URL : null);
  if (!rpcUrl) {
    const error = new Error("SOROBAN_RPC_URL must be configured for the scholarship escrow network");
    error.statusCode = 503;
    throw error;
  }
  return {
    network,
    networkPassphrase: network === "mainnet" ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET,
    server: new StellarSdk.rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") }),
  };
};

const parseAmount = (amount) => {
  const value = String(amount ?? "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value) || /^0(?:\.0{1,7})?$/.test(value)) {
    const error = new Error("Amount must be a positive USDC value with at most 7 decimal places");
    error.statusCode = 400;
    throw error;
  }
  return toStroops(value);
};

const resultValue = (simulation) => {
  const retval = simulation.result?.retval ?? simulation.results?.[0]?.xdr;
  if (!retval) return null;
  if (typeof retval === "string") return StellarSdk.xdr.ScVal.fromXDR(retval, "base64");
  return retval;
};

const readContract = async ({ sourcePublicKey, method, args = [] }) => {
  const { server, networkPassphrase } = scholarshipEscrowRpc();
  const contract = new StellarSdk.Contract(scholarshipEscrowContractId());
  const account = await server.getAccount(sourcePublicKey);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(45)
    .build();
  const simulation = await server.simulateTransaction(tx);
  if (simulation.error) throw new Error(`Scholarship escrow query failed: ${simulation.error}`);
  const retval = resultValue(simulation);
  if (!retval) throw new Error("Scholarship escrow query returned no value");
  return StellarSdk.scValToNative(retval);
};

export const getScholarshipEscrowState = async ({ sourcePublicKey }) => {
  if (!sourcePublicKey) {
    const error = new Error("Connect a funded Stellar wallet to view the scholarship escrow");
    error.statusCode = 400;
    throw error;
  }
  try {
    StellarSdk.Keypair.fromPublicKey(sourcePublicKey);
  } catch {
    const error = new Error("Invalid Stellar public key");
    error.statusCode = 400;
    throw error;
  }

  const state = await readContract({ sourcePublicKey, method: "state" });
  const milestoneCount = Number(await readContract({ sourcePublicKey, method: "milestone_count" }));
  if (!Number.isInteger(milestoneCount) || milestoneCount < 1 || milestoneCount > 100) {
    throw new Error("Scholarship escrow has an invalid milestone count");
  }
  const milestones = await Promise.all(
    Array.from({ length: milestoneCount }, async (_, index) => {
      const milestone = await readContract({
        sourcePublicKey,
        method: "milestone",
        args: [StellarSdk.nativeToScVal(index, { type: "u32" })],
      });
      return {
        index,
        amountStroops: String(milestone.amount),
        amountUsdc: fromStroops(BigInt(milestone.amount)),
        released: Boolean(milestone.released),
      };
    })
  );
  const { network, server } = scholarshipEscrowRpc();
  const latestLedger = await server.getLatestLedger();
  return {
    contractId: scholarshipEscrowContractId(),
    network,
    explorerUrl: `https://stellar.expert/explorer/${network === "mainnet" ? "public" : "testnet"}/contract/${scholarshipEscrowContractId()}`,
    arbiter: String(state.arbiter),
    beneficiary: String(state.beneficiary),
    tokenContract: String(state.token),
    expiryLedger: Number(state.expiry),
    rpcLedger: latestLedger.sequence,
    targetStroops: String(state.milestone_total),
    fundedStroops: String(state.funded_total),
    releasedStroops: String(state.released_total),
    refundedStroops: String(state.refunded_total),
    targetUsdc: fromStroops(BigInt(state.milestone_total)),
    fundedUsdc: fromStroops(BigInt(state.funded_total)),
    releasedUsdc: fromStroops(BigInt(state.released_total)),
    refundedUsdc: fromStroops(BigInt(state.refunded_total)),
    milestones,
  };
};

const prepareEscrowCall = async ({ sourcePublicKey, method, args }) => {
  let address;
  try {
    address = StellarSdk.Address.fromString(sourcePublicKey);
  } catch {
    const error = new Error("Invalid Stellar public key");
    error.statusCode = 400;
    throw error;
  }

  const { server, networkPassphrase, network } = scholarshipEscrowRpc();
  const contractId = scholarshipEscrowContractId();
  const contract = new StellarSdk.Contract(contractId);
  const prepared = await prepareSorobanInvocation({
    server,
    networkPassphrase,
    sourcePublicKey,
    operation: contract.call(method, ...args(address)),
  });
  const transaction = StellarSdk.TransactionBuilder.fromXDR(prepared.xdr, networkPassphrase);
  return {
    xdr: prepared.xdr,
    expectedHash: transaction.hash().toString("hex"),
    contractId,
    network,
    networkPassphrase,
  };
};

export const buildScholarshipFundingTransaction = async ({ sourcePublicKey, amount }) => {
  const amountStroops = parseAmount(amount);
  return {
    ...(await prepareEscrowCall({
      sourcePublicKey,
      method: "fund",
      args: (address) => [
        address.toScVal(),
        StellarSdk.nativeToScVal(amountStroops, { type: "i128" }),
      ],
    })),
    amountStroops: amountStroops.toString(),
  };
};

export const buildScholarshipRefundTransaction = ({ sourcePublicKey }) =>
  prepareEscrowCall({
    sourcePublicKey,
    method: "refund",
    args: (address) => [address.toScVal()],
  });

export const buildScholarshipMilestoneApprovalTransaction = ({ sourcePublicKey, index }) => {
  if (!Number.isInteger(index) || index < 0 || index > 99) {
    const error = new Error("Milestone index is invalid");
    error.statusCode = 400;
    throw error;
  }
  return prepareEscrowCall({
    sourcePublicKey,
    method: "approve_milestone",
    args: () => [StellarSdk.nativeToScVal(index, { type: "u32" })],
  });
};

export { fromStroops };
