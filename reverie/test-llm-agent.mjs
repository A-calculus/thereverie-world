/**
 * test-llm-agent.mjs
 *
 * E2E test for Somnia Native LLM Agent (Lane A).
 * Uses SomniaAgentKit directly — no WorldInstance required.
 *
 * Usage: node test-llm-agent.mjs
 */
import { SomniaAgentKit } from "@worldframe/sdk";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Load .env ─────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, ".env");

if (!existsSync(envPath)) {
  console.error("❌ .env file not found at", envPath);
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const required = [
  "BUILDER_PRIVATE_KEY",
  "CALLBACK_RECEIVER_LLM",
  "CALLBACK_RECEIVER_PRIMARY",
];
for (const key of required) {
  if (!env[key] || env[key].startsWith("0x_your")) {
    console.error(`❌ Missing required env var: ${key}`);
    process.exit(1);
  }
}

// ─── Init Agent Kit ────────────────────────────────────────────────────────
const kit = new SomniaAgentKit({
  network: "testnet",
  privateKey: env.BUILDER_PRIVATE_KEY,
  callbackReceiverLlm: env.CALLBACK_RECEIVER_LLM,
  callbackReceiverPrimary: env.CALLBACK_RECEIVER_PRIMARY,
  timeoutMs: 300_000,
});

// ─── Run LLM Agent ─────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("🧠 Somnia Native LLM Agent — E2E Test");
  console.log("=".repeat(60));

  try {
    const result = await kit.executeLLM({
      prompt: "What is the capital of Algeria? Answer in one word.",
      systemPrompt: "You are a helpful geography expert.",
      chainOfThought: false,
      allowedValues: [],
    });

    console.log("\n✅ LLM Agent Result:");
    console.log(`   Text:       ${result.text}`);
    console.log(`   Request ID: ${result.requestId.toString()}`);
    console.log(`   Tx Hash:    ${result.txHash}`);
    console.log(`   Receipt:    ${result.receiptUrl}`);
  } catch (err) {
    console.error("\n❌ LLM Agent failed:", err);
    process.exit(1);
  } finally {
    kit.destroy();
  }
}

main();
