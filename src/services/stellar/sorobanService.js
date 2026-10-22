import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * Prepare an unsigned Soroban invocation for a wallet to sign.
 * Simulation supplies the resource footprint, resource fee, and authorization
 * entries required by the network. This helper never signs or submits.
 *
 * @param {{server: StellarSdk.rpc.Server, networkPassphrase: string, sourcePublicKey: string, operation: StellarSdk.xdr.Operation, memo?: string, timeoutSeconds?: number}} params
 * @returns {Promise<{xdr: string, networkPassphrase: string, resourceFee: string}>}
 */
export const prepareSorobanInvocation = async ({
  server,
  networkPassphrase,
  sourcePublicKey,
  operation,
  memo,
  timeoutSeconds = 180,
}) => {
  if (!server || !networkPassphrase || !sourcePublicKey || !operation) {
    throw new Error("Soroban transaction preparation requires RPC, network, source, and operation");
  }

  const sourceAccount = await server.getAccount(sourcePublicKey);
  const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  }).addOperation(operation);

  if (memo) builder.addMemo(StellarSdk.Memo.text(memo));

  const transaction = builder.setTimeout(timeoutSeconds).build();
  const simulation = await server.simulateTransaction(transaction);

  if (simulation.error) {
    throw new Error(`Soroban transaction simulation failed: ${simulation.error}`);
  }
  if (simulation.restorePreamble) {
    throw new Error(
      "Soroban transaction requires restoring archived contract data before it can be submitted"
    );
  }

  const assembled = StellarSdk.rpc.assembleTransaction(
    transaction,
    simulation
  ).build();

  return {
    xdr: assembled.toXDR(),
    networkPassphrase,
    resourceFee: String(simulation.minResourceFee ?? "0"),
  };
};
