/**
 * test-chronicle-agent.mjs
 *
 * E2E test for REVERIE Chronicle Agent (Lane A via SDK).
 * Requires WORLD_ADDRESS in .env (from deploy-world.mjs).
 *
 * Uses execution="sdk" (default) — agent runs via SomniaAgentKit then optionally persists.
 * Set persistOnChain=false to skip on-chain state writes.
 *
 * Usage: node test-chronicle-agent.mjs
 */
import { WorldFrameSDK } from "@worldframe/sdk";
import { requireEnv, validateRequired } from "./env.mjs";

// ─── Validate env ──────────────────────────────────────────────────────────
validateRequired([
  "BUILDER_PRIVATE_KEY",
  "REVERIE_REGISTRY_ADDRESS",
  "WORLD_ADDRESS",
  "CALLBACK_RECEIVER_LLM",
  "CALLBACK_RECEIVER_PRIMARY",
]);

// ─── Init SDK & World ──────────────────────────────────────────────────────
const sdk = new WorldFrameSDK({
  mode: "privateKey",
  privateKey: requireEnv("BUILDER_PRIVATE_KEY"),
  network: "testnet",
});
sdk.setRegistry(requireEnv("REVERIE_REGISTRY_ADDRESS"));

// Pass config through to SomniaAgentKit via the SDK's internal config
const world = sdk.useWorld(requireEnv("WORLD_ADDRESS"));

// ─── Run Chronicle Agent ───────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("📜 REVERIE Chronicle Agent — E2E Test (Lane A)");
  console.log("=".repeat(60));
  console.log(`   World: ${world.address}`);

  try {
    const result = await world.agents.chronicle.invoke(
      {
        event: "The great dragon Aetheron descended upon the kingdom, casting a shadow that stretched for miles.",
        style: "epic",
      },
      {
        // Lane A (default: "sdk") — uses SomniaAgentKit for LLM inference
        execution: "sdk",
        // Set true to also write the narrative entry on-chain
        persistOnChain: false,
      }
    );

    console.log("\n✅ Chronicle Agent Result:");
    console.log(`   Text:            ${result.text}`);
    console.log(`   Request ID:      ${result.requestId.toString()}`);
    console.log(`   Tx Hash (agent): ${result.txHash}`);
    console.log(`   Receipt:         ${result.receiptUrl}`);
    if (result.onChainTxHash) {
      console.log(`   On-Chain Tx:     ${result.onChainTxHash}`);
    }
  } catch (err) {
    console.error("\n❌ Chronicle Agent failed:", err);
    process.exit(1);
  } finally {
    sdk.getAgentKit().destroy();
  }
}

main();