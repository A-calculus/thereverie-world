/**
 * test-conflict-resolution-agent.mjs
 *
 * E2E test for REVERIE Conflict Resolution Agent (Lane A via SDK).
 * Requires WORLD_ADDRESS in .env (from deploy-world.mjs).
 *
 * Reads zone data from the world contract, then uses LLM to resolve a conflict.
 * Uses execution="sdk" with persistOnChain=false (set true to apply on-chain).
 *
 * Usage: node test-conflict-resolution-agent.mjs
 */
import { WorldFrameSDK } from "@worldframe/sdk";
import { keccak256, toBytes } from "viem";
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

// ─── Run Conflict Resolution Agent ─────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("🤝 REVERIE Conflict Resolution Agent — E2E Test (Lane A)");
  console.log("=".repeat(60));
  console.log(`   World: ${world.address}`);

  const zoneId = keccak256(toBytes("zone:elden-ring:limgrave"));

  try {
    const result = await world.agents.conflict.invoke(
      {
        zoneId,
        factionA: "The Iron Legion",
        factionB: "The Shadow Covenant",
        context: "Both factions are fighting over control of the ancient ruins beneath the city.",
        style: "dark_fantasy",
      },
      {
        execution: "sdk",
        // Set true to also apply the conflict outcome on-chain
        persistOnChain: false,
      }
    );

    console.log("\n✅ Conflict Resolution Agent Result:");
    console.log(`   Outcome:        ${result.outcome}`);
    console.log(`   Request ID:     ${result.requestId.toString()}`);
    console.log(`   Tx Hash:        ${result.txHash}`);
    console.log(`   Receipt:        ${result.receiptUrl}`);
    if (result.stateTxHash) {
      console.log(`   State Tx:       ${result.stateTxHash}`);
    }

    // Also show valid outcomes
    console.log(`\n📋 Valid outcomes: ${world.agents.conflict.outcomes.join(", ")}`);
  } catch (err) {
    console.error("\n❌ Conflict Resolution Agent failed:", err);
    process.exit(1);
  } finally {
    sdk.getAgentKit().destroy();
  }
}

main();