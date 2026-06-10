import { defineConfig } from "tsup";

const common = {
  format: ["esm", "cjs"] as const,
  dts: true,
  splitting: false,
  sourcemap: process.env.SDK_SOURCEMAP === "true",
  treeshake: true,
};

export default defineConfig([
  {
    ...common,
    entry: ["src/index.ts"],
    clean: true,
    // Bundle viem internally for the Node/full SDK build.
    noExternal: ["viem"],
  },
  {
    ...common,
    entry: ["src/browser.ts"],
    clean: false,
    platform: "browser",
    // Browser native-agent entry must not emit node:* imports.
    noExternal: ["viem", "zod"],
  },
]);
