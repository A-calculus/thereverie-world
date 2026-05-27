import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  // Bundle ALL dependencies internally — no host-environment conflicts
  noExternal: ["viem"],
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
