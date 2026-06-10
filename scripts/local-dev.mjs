#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractsDir = resolve(root, 'contracts');
const sdkDir = resolve(root, 'sdk');
const frontendDir = resolve(root, 'reverie-frontend');

const deployKeys = [
  'UPGRADE_DELAY_SECONDS',
  'UPGRADE_PROPOSER_ADDRESS',
  'UPGRADE_EXECUTOR_ADDRESS',
  'TIMELOCK_ADDRESS',
  'REGISTRY_IMPLEMENTATION_ADDRESS',
  'REVERIE_REGISTRY_ADDRESS',
  'WORLD_IMPLEMENTATION_ADDRESS',
  'CALLBACK_RECEIVER_IMPLEMENTATION',
  'CALLBACK_RECEIVER_LLM',
  'CALLBACK_RECEIVER_PRIMARY',
];

const sdkEnvMap = {
  REVERIE_REGISTRY_ADDRESS: 'REVERIE_REGISTRY_ADDRESS',
  CALLBACK_RECEIVER_LLM: 'CALLBACK_RECEIVER_LLM',
  CALLBACK_RECEIVER_PRIMARY: 'CALLBACK_RECEIVER_PRIMARY',
};

const frontendEnvMap = {
  REVERIE_REGISTRY_ADDRESS: 'NEXT_PUBLIC_REVERIE_REGISTRY_ADDRESS',
  CALLBACK_RECEIVER_LLM: 'NEXT_PUBLIC_CALLBACK_RECEIVER_LLM',
  CALLBACK_RECEIVER_PRIMARY: 'NEXT_PUBLIC_CALLBACK_RECEIVER_PRIMARY',
};

function log(message) {
  const stamp = new Date().toISOString();
  console.log(`[reverie:local-dev ${stamp}] ${message}`);
}

function runStep(label, command, args, options = {}) {
  return new Promise((resolveStep, rejectStep) => {
    const cwd = options.cwd ?? root;
    const env = { ...process.env, ...(options.env ?? {}) };
    const capture = options.capture ?? false;
    const commandText = [command, ...args].join(' ');
    let output = '';

    log(`START ${label}`);
    log(`cwd=${cwd}`);
    log(`cmd=${commandText}`);

    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    });

    if (capture) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stdout.write(text);
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stderr.write(text);
      });
    }

    child.on('error', (error) => {
      rejectStep(new Error(`${label} failed to start: ${error.message}`));
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        log(`DONE ${label}`);
        resolveStep({ output, code, signal });
        return;
      }
      rejectStep(new Error(`${label} failed with code=${code ?? 'null'} signal=${signal ?? 'null'}`));
    });
  });
}

function parseKeyValueOutput(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z0-9_]+)=(.+)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim();
  }
  return values;
}

function requireDeployValues(values) {
  const required = ['REVERIE_REGISTRY_ADDRESS', 'CALLBACK_RECEIVER_LLM', 'CALLBACK_RECEIVER_PRIMARY'];
  const missing = required.filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`Deployment output did not include required keys: ${missing.join(', ')}`);
  }
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf8');
}

function upsertEnv(filePath, values, label) {
  let content = readEnvFile(filePath);
  const lines = content ? content.replace(/\r\n/g, '\n').split('\n') : [];

  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    const nextLine = `${key}=${value}`;
    const existingIndex = lines.findIndex((line) => line.match(new RegExp(`^\\s*${key}=`)));
    if (existingIndex >= 0) {
      lines[existingIndex] = nextLine;
    } else {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
      lines.push(nextLine);
    }
  }

  content = `${lines.join('\n').replace(/\n+$/, '')}\n`;
  writeFileSync(filePath, content, 'utf8');
  log(`UPDATED ${label}: ${filePath}`);
}

function mappedEnv(values, map) {
  return Object.fromEntries(
    Object.entries(map)
      .filter(([source]) => values[source])
      .map(([source, target]) => [target, values[source]])
  );
}

function startDevServer(env) {
  return new Promise((resolveStep, rejectStep) => {
    log('START frontend dev server');
    log(`cwd=${frontendDir}`);
    log('cmd=npm run dev');

    const child = spawn('npm', ['run', 'dev'], {
      cwd: frontendDir,
      env: { ...process.env, ...env },
      shell: false,
      stdio: 'inherit',
    });

    const shutdown = (signal) => {
      log(`Forwarding ${signal} to frontend dev server`);
      child.kill(signal);
    };
    const onSigint = () => shutdown('SIGINT');
    const onSigterm = () => shutdown('SIGTERM');

    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);

    child.on('error', (error) => {
      rejectStep(new Error(`frontend dev server failed to start: ${error.message}`));
    });
    child.on('close', (code, signal) => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
        log('DONE frontend dev server');
        resolveStep();
        return;
      }
      rejectStep(new Error(`frontend dev server failed with code=${code ?? 'null'} signal=${signal ?? 'null'}`));
    });
  });
}

async function main() {
  log('Workspace local dev bootstrap started');

  await runStep('contracts compile', 'npm', ['run', 'compile'], { cwd: contractsDir });
  const deploy = await runStep('contracts deploy:testnet', 'npm', ['run', 'deploy:testnet'], {
    cwd: contractsDir,
    capture: true,
  });
  const deployed = parseKeyValueOutput(deploy.output);
  requireDeployValues(deployed);

  const contractsEnv = Object.fromEntries(
    deployKeys.filter((key) => deployed[key]).map((key) => [key, deployed[key]])
  );
  const sdkEnv = mappedEnv(deployed, sdkEnvMap);
  const frontendEnv = mappedEnv(deployed, frontendEnvMap);

  upsertEnv(resolve(contractsDir, '.env'), contractsEnv, 'contracts deployment env');
  upsertEnv(resolve(sdkDir, '.env'), sdkEnv, 'sdk runtime env');
  upsertEnv(resolve(frontendDir, '.env'), frontendEnv, 'frontend public runtime env');

  await runStep('sdk build:package', 'npm', ['run', 'build:package'], {
    cwd: sdkDir,
    env: sdkEnv,
  });

  await runStep('frontend install local sdk package', 'npm', ['install', '--force', '../sdk/package/worldframe-sdk-0.1.0.tgz'], {
    cwd: frontendDir,
    env: frontendEnv,
  });

  const nextDir = resolve(frontendDir, '.next');
  log(`DELETE stale Next cache: ${nextDir}`);
  rmSync(nextDir, { recursive: true, force: true });

  await runStep('frontend production build', 'npm', ['run', 'build'], {
    cwd: frontendDir,
    env: frontendEnv,
  });

  log('All compile/deploy/build steps passed. Starting frontend dev server.');
  await startDevServer(frontendEnv);
}

main().catch((error) => {
  console.error('\n[reverie:local-dev] FAILED');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
