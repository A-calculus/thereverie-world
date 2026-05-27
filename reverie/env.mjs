/**
 * env.mjs — shared .env loader for reverie test scripts
 *
 * Injects env vars into process.env so the SDK's address lookup works.
 *
 * Usage:
 *   import { env, requireEnv, validateRequired } from "./env.mjs";
 *   console.log(env.BUILDER_PRIVATE_KEY);
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, ".env");

if (!existsSync(envPath)) {
  console.error("❌ .env file not found at", envPath);
  process.exit(1);
}

// Parse .env file
const rawEntries = readFileSync(envPath, "utf-8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => {
    const idx = l.indexOf("=");
    return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
  });

// Export as a plain object
export const env = Object.fromEntries(rawEntries);

// Inject into process.env so SDK's addresses.ts can read them
for (const [key, value] of rawEntries) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

export function requireEnv(key) {
  if (!env[key] || env[key].startsWith("0x_your")) {
    console.error(`❌ Missing required env var: ${key}`);
    process.exit(1);
  }
  return env[key];
}

export function validateRequired(keys) {
  for (const key of keys) {
    requireEnv(key);
  }
}