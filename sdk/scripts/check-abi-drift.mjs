import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const sdkRoot = process.cwd();
const repoRoot = path.resolve(sdkRoot, "..");
const sdkAbiPath = path.join(sdkRoot, "src", "abis.ts");
const artifactPath = path.join(
  repoRoot,
  "contracts",
  "artifacts",
  "contracts",
  "ReverieWorldInstance.sol",
  "ReverieWorldInstance.json"
);

const requiredEntries = new Set([
  "config",
  "setZone",
  "applyClimateResult",
  "applyConflictOutcome",
  "updateFactionMorale",
  "requestAgentDecision",
  "requestLlmToolsChat",
  "requestJsonOracle",
  "chronicleFromAgent",
  "requestWebParse",
  "configureManifest",
  "armWorld",
  "pauseWorld",
  "stopWorld",
  "fireManualTrigger",
  "subscribeTrigger",
  "unsubscribeTrigger",
  "manifestHash",
  "lifecycleStatus",
  "getManifestCounts",
  "getManifestTrigger",
  "upgradeToAndCall",
]);

function loadSdkAbi() {
  const source = fs.readFileSync(sdkAbiPath, "utf8");
  const match = source.match(
    /export const WORLD_INSTANCE_ABI = ([\s\S]*?\n] as const);/
  );
  if (!match) {
    throw new Error("Could not find WORLD_INSTANCE_ABI in sdk/src/abis.ts");
  }

  const arrayExpression = match[1].replace(/\n] as const$/, "\n]");
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `globalThis.WORLD_INSTANCE_ABI = ${arrayExpression};`,
    context,
    { filename: sdkAbiPath }
  );
  return context.WORLD_INSTANCE_ABI;
}

function signatureOf(entry) {
  return {
    name: entry.name,
    type: entry.type,
    stateMutability: entry.stateMutability,
    inputs: (entry.inputs ?? []).map((input) => ({
      name: input.name ?? "",
      type: input.type,
      indexed: input.indexed,
    })),
    outputs: (entry.outputs ?? []).map((output) => ({
      name: output.name ?? "",
      type: output.type,
    })),
  };
}

function entriesByName(abi) {
  const map = new Map();
  for (const entry of abi) {
    if (!requiredEntries.has(entry.name)) continue;
    map.set(entry.name, signatureOf(entry));
  }
  return map;
}

const sdkAbi = loadSdkAbi();
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const sdkEntries = entriesByName(sdkAbi);
const artifactEntries = entriesByName(artifact.abi);

let failed = false;
for (const name of requiredEntries) {
  const sdkEntry = sdkEntries.get(name);
  const artifactEntry = artifactEntries.get(name);
  if (!sdkEntry || !artifactEntry) {
    console.error(`${name}: missing in ${sdkEntry ? "artifact" : "SDK ABI"}`);
    failed = true;
    continue;
  }

  if (JSON.stringify(sdkEntry) !== JSON.stringify(artifactEntry)) {
    console.error(`${name}: SDK ABI differs from contract artifact`);
    console.error("SDK     ", JSON.stringify(sdkEntry));
    console.error("Artifact", JSON.stringify(artifactEntry));
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("World ABI drift check passed.");
