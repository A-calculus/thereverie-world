/**
 * test-faction-morale-agent.mjs
 *
 * E2E test for REVERIE Faction Morale Agent (Lane A via SDK).
 * Requires WORLD_ADDRESS in .env (from deploy-world.mjs).
 *
 * Fetches crypto price data via JSON API agent, then uses LLM to determine faction morale.
 * Uses execution="sdk" with persistOnChain=false (set true to write on-chain).
 *
 * Usage: node test-faction-morale-agent.mjs
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

const world = sdk.useWorld(requireEnv("WORLD_ADDRESS"));

// ─── Run Faction Morale Agent ──────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("⚔️  REVERIE Faction Morale Agent — E2E Test (Lane A)");
  console.log("=".repeat(60));
  console.log(`   World: ${world.address}`);

  try {
    const result = await world.agents.factionMorale.invoke(
      {
        factionId: "house-of-stark",
        pair: "ETH/USDT",
        style: "cyberpunk",
      },
      {
        execution: "sdk",
        // Set true to also update faction morale on-chain
        persistOnChain: false,
      }
    );

    console.log("\n✅ Faction Morale Agent Result:");
    console.log(`   Morale Delta:   ${result.moraleDelta}`);
    console.log(`   Narrative:      ${result.narrative}`);
    console.log(`   Request ID:     ${result.requestId.toString()}`);
    console.log(`   Tx Hash:        ${result.txHash}`);
    console.log(`   Receipt:        ${result.receiptUrl}`);
    if (result.stateTxHash) {
      console.log(`   State Tx:       ${result.stateTxHash}`);
    }
  } catch (err) {
    console.error("\n❌ Faction Morale Agent failed:", err);
    process.exit(1);
  } finally {
    sdk.getAgentKit().destroy();
  }
}

main();