/**
 * test-web-parse-agent.mjs
 *
 * E2E test for Somnia Native Web Parse Agent (Lane A).
 * Uses SomniaAgentKit directly — no WorldInstance required.
 *
 * Usage: node test-web-parse-agent.mjs
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
  timeoutMs: 380_000, // web parse can take longer
});

// ─── Run Web Parse Agent ───────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("🌐 Somnia Native Web Parse Agent — E2E Test");
  console.log("=".repeat(60));

  try {
    const result = await kit.executeWebParse({
      url: "https://en.wikipedia.org/wiki/Somnia_(film)",
      key: "summary",
      description: "Extract a one-sentence summary of the movie.",
      prompt: "What is the movie about? Give me the first paragraph.",
      options: [],
      resolveUrl: false,
      numPages: 1,
      confidenceThreshold: 50,
      subcommitteeSize: 3n,
      threshold: 2n,
    });

    console.log("\n✅ Web Parse Agent Result:");
    console.log(`   Text:       ${result.text}`);
    console.log(`   Length:     ${result.text.length} characters`);
    console.log(`   Request ID: ${result.requestId.toString()}`);
    console.log(`   Tx Hash:    ${result.txHash}`);
    console.log(`   Receipt:    ${result.receiptUrl}`);
  } catch (err) {
    console.error("\n❌ Web Parse Agent failed:", err);
    process.exit(1);
  } finally {
    kit.destroy();
  }
}

main();
