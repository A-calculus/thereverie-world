/**
 * test-zone-climate-agent.mjs
 *
 * E2E test for REVERIE Zone Climate Agent (Lane A via SDK).
 * Requires WORLD_ADDRESS in .env (from deploy-world.mjs).
 *
 * Fetches weather data via JSON API agent, then uses LLM to determine climate state.
 * Uses execution="sdk" with persistOnChain=false (set true to write on-chain).
 *
 * Usage: node test-zone-climate-agent.mjs
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

// ─── Run Zone Climate Agent ────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("🌤️  REVERIE Zone Climate Agent — E2E Test (Lane A)");
  console.log("=".repeat(60));
  console.log(`   World: ${world.address}`);

  const zoneId = keccak256(toBytes("zone:elden-ring:limgrave"));

  try {
    const result = await world.agents.zoneClimate.invoke(
      {
        zoneId,
        city: "London",
        style: "epic",
      },
      {
        execution: "sdk",
        // Set true to also apply the climate result on-chain
        persistOnChain: false,
      }
    );

    console.log("\n✅ Zone Climate Agent Result:");
    console.log(`   Climate State:  ${result.climateState}`);
    console.log(`   Weather Code:   ${result.weatherCode}`);
    console.log(`   Request ID:     ${result.requestId.toString()}`);
    console.log(`   Tx Hash:        ${result.txHash}`);
    console.log(`   Receipt:        ${result.receiptUrl}`);
    if (result.stateTxHash) {
      console.log(`   State Tx:       ${result.stateTxHash}`);
    }
  } catch (err) {
    console.error("\n❌ Zone Climate Agent failed:", err);
    process.exit(1);
  } finally {
    sdk.getAgentKit().destroy();
  }
}

main();