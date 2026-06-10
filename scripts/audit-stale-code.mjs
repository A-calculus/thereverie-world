import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const root = process.cwd();
const builtinNames = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

function walk(dir, predicate, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist" || entry.name === "package") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, acc);
    else if (predicate(full)) acc.push(full);
  }
  return acc;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalize(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function sourceFiles(projectDir) {
  return walk(projectDir, (file) => /\.(tsx?|mjs|cjs|jsx?)$/.test(file));
}

function importsFrom(source) {
  const imports = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) imports.push(match[1]);
  }
  return imports;
}

function packageName(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

function resolveSourceImport(projectRoot, fromFile, specifier, aliases = {}) {
  if (!specifier.startsWith(".") && !Object.keys(aliases).some((alias) => specifier === alias || specifier.startsWith(`${alias}/`))) {
    return null;
  }

  let base;
  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    const alias = Object.keys(aliases).find((key) => specifier === key || specifier.startsWith(`${key}/`));
    base = path.resolve(projectRoot, specifier.replace(alias, aliases[alias]).replace(/^\//, ""));
  }

  const candidates = [
    base,
    base.endsWith(".js") ? `${base.slice(0, -3)}.ts` : null,
    base.endsWith(".js") ? `${base.slice(0, -3)}.tsx` : null,
    base.endsWith(".mjs") ? `${base.slice(0, -4)}.ts` : null,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
    path.join(base, "index.mjs"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function graphFor(projectRoot, aliases = {}) {
  const files = sourceFiles(projectRoot);
  const fileSet = new Set(files.map((file) => path.resolve(file)));
  const graph = new Map();
  const packageImports = new Map();

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const deps = [];
    for (const specifier of importsFrom(source)) {
      const resolved = resolveSourceImport(projectRoot, file, specifier, aliases);
      if (resolved && fileSet.has(path.resolve(resolved))) {
        deps.push(path.resolve(resolved));
      } else if (!specifier.startsWith(".") && !builtinNames.has(packageName(specifier))) {
        const name = packageName(specifier);
        packageImports.set(name, (packageImports.get(name) ?? 0) + 1);
      }
    }
    graph.set(path.resolve(file), deps);
  }
  return { files: [...fileSet], graph, packageImports };
}

function markReachable(graph, roots) {
  const reachable = new Set();
  const stack = roots.map((file) => path.resolve(file));
  while (stack.length > 0) {
    const file = stack.pop();
    if (!file || reachable.has(file)) continue;
    reachable.add(file);
    for (const dep of graph.get(file) ?? []) stack.push(dep);
  }
  return reachable;
}

function nextEntrypoints(projectRoot) {
  const files = sourceFiles(path.join(projectRoot, "app"));
  return files.filter((file) => /\/(page|layout|route|loading|not-found|error|global-error|template|default)\.(tsx?|jsx?|mjs)$/.test(file));
}

function dependencyReport(projectRoot, packageImports) {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return [];
  const pkg = readJson(pkgPath);
  const deps = Object.keys(pkg.dependencies ?? {});
  return deps
    .filter((dep) => !packageImports.has(dep))
    .filter((dep) => dep !== "@worldframe/sdk")
    .filter((dep) => dep !== "react-dom")
    .sort();
}

function projectReport(name, projectDir, roots, aliases = {}) {
  const projectRoot = path.resolve(root, projectDir);
  const { files, graph, packageImports } = graphFor(projectRoot, aliases);
  const reachable = markReachable(graph, roots.map((entry) => path.resolve(projectRoot, entry)).filter(fs.existsSync));
  const unreachable = files
    .filter((file) => !reachable.has(file))
    .map(normalize)
    .filter((file) => !file.endsWith("/next-env.d.ts"))
    .sort();
  return {
    name,
    sourceFileCount: files.length,
    rootCount: roots.length,
    unreachable,
    unusedDependencies: dependencyReport(projectRoot, packageImports),
  };
}

function scriptRoots(projectDir) {
  const pkgPath = path.join(root, projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) return [];
  const pkg = readJson(pkgPath);
  return Object.values(pkg.scripts ?? {})
    .flatMap((script) => [...script.matchAll(/\b(?:node|tsx|ts-node)\s+([^\s]+)/g)].map((match) => match[1]))
    .filter((entry) => !entry.startsWith("-"));
}

const sdkRoots = ["src/index.ts", "src/browser.ts", "tsup.config.ts", ...scriptRoots("sdk")];
const frontendRoot = path.resolve(root, "reverie-frontend");
const frontendRoots = [
  ...nextEntrypoints(frontendRoot).map((file) => normalize(file).replace(/^reverie-frontend\//, "")),
  "components/providers.tsx",
  "components/providers/cache-lifecycle.tsx",
  "eslint.config.mjs",
  "next.config.ts",
  "playwright.config.ts",
  "postcss.config.mjs",
  "proxy.ts",
  "scripts/normalize-world-builder-state.mjs",
  ...sourceFiles(path.join(frontendRoot, "tests")).map((file) => normalize(file).replace(/^reverie-frontend\//, "")),
];
const reverieRoots = scriptRoots("reverie");

const reports = [
  projectReport("sdk", "sdk", sdkRoots),
  projectReport("reverie-frontend", "reverie-frontend", frontendRoots, { "@": "." }),
  projectReport("reverie", "reverie", reverieRoots),
];

for (const report of reports) {
  console.log(`\n## ${report.name}`);
  console.log(`source files: ${report.sourceFileCount}`);
  console.log(`roots: ${report.rootCount}`);
  console.log(`unreachable files: ${report.unreachable.length}`);
  for (const file of report.unreachable) console.log(`  - ${file}`);
  console.log(`unused dependencies by static imports: ${report.unusedDependencies.length}`);
  for (const dep of report.unusedDependencies) console.log(`  - ${dep}`);
}
