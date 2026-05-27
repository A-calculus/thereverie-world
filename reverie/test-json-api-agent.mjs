/**
 * test-json-api-agent.mjs
 *
 * E2E test for Somnia Native JSON API Agent (Lane A).
 * Uses SomniaAgentKit directly — no WorldInstance required.
 *
 * Usage: node test-json-api-agent.mjs
 */
import { SomniaAgentKit } from "@worldframe/sdk";
import { requireEnv, validateRequired } from "./env.mjs";

// ─── Validate env ──────────────────────────────────────────────────────────
validateRequired([
  "BUILDER_PRIVATE_KEY",
  "CALLBACK_RECEIVER_LLM",
  "CALLBACK_RECEIVER_PRIMARY",
]);

// ─── Init Agent Kit ────────────────────────────────────────────────────────
const kit = new SomniaAgentKit({
  network: "testnet",
  privateKey: requireEnv("BUILDER_PRIVATE_KEY"),
  callbackReceiverLlm: requireEnv("CALLBACK_RECEIVER_LLM"),
  callbackReceiverPrimary: requireEnv("CALLBACK_RECEIVER_PRIMARY"),
  timeoutMs: 320_000,
});

// ─── Run JSON API Agent ────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("🔗 Somnia Native JSON API Agent — E2E Test");
  console.log("=".repeat(60));

  try {
    const result = await kit.executeJsonApi({
      url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      selector: "bitcoin.usd",
      returnType: "string",
      subcommitteeSize: 1n,
      threshold: 1n,
    });

    console.log("\n✅ JSON API Agent Result:");
    console.log(`   Value:      ${result.value}`);
    console.log(`   Raw:        ${result.raw}`);
    console.log(`   Request ID: ${result.requestId.toString()}`);
    console.log(`   Tx Hash:    ${result.txHash}`);
    console.log(`   Receipt:    ${result.receiptUrl}`);
  } catch (err) {
    console.error("\n❌ JSON API Agent failed:", err);
    process.exit(1);
  } finally {
    kit.destroy();
  }
}

main();