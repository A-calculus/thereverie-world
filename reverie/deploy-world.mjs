/**
 * deploy-world.mjs
 *
 * Deploys a new Reverie World via the ReverieRegistry.
 * Prints the world address — copy it into .env as WORLD_ADDRESS.
 *
 * Usage: node deploy-world.mjs
 */
import { WorldFrameSDK } from "@worldframe/sdk";
import { requireEnv, validateRequired } from "./env.mjs";

// ─── Validate env ──────────────────────────────────────────────────────────
validateRequired(["BUILDER_PRIVATE_KEY", "REVERIE_REGISTRY_ADDRESS"]);

// ─── Init SDK ──────────────────────────────────────────────────────────────
const sdk = new WorldFrameSDK({
  mode: "privateKey",
  privateKey: requireEnv("BUILDER_PRIVATE_KEY"),
  network: "testnet",
});
sdk.setRegistry(requireEnv("REVERIE_REGISTRY_ADDRESS"));

// ─── Deploy World ──────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("🌍 Deploying new Reverie World...");
  console.log("=".repeat(60));

  try {
    const world = await sdk.deployWorld({
      name: "Test World " + Date.now(),
      template: "fantasy",
    });

    console.log("\n✅ World deployed successfully!");
    console.log(`   World Address: ${world.address}`);
    console.log("\n📝 Add this to your .env file:");
    console.log(`   WORLD_ADDRESS=${world.address}`);
  } catch (err) {
    console.error("\n❌ World deployment failed:", err);
    process.exit(1);
  }
}

main();