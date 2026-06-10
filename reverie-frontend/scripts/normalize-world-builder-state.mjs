#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');
const cwd = process.cwd();
const envPath = path.join(cwd, '.env');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function distribute(items) {
  if (items.length === 0) return [];
  const base = Math.floor(100 / items.length);
  let remaining = 100;
  return items.map((item, index) => {
    const allocationPercent = index === items.length - 1 ? remaining : base;
    remaining -= allocationPercent;
    return { ...item, allocationPercent: item.allocationPercent ?? allocationPercent };
  });
}

function normalizeBuilder(builder) {
  const factions = distribute((builder.factions ?? []).map((faction, index) => {
    const id = faction.id ?? `faction-${index + 1}`;
    return {
      ...faction,
      id,
      state: {
        latestDecision: 'pending',
        morale: 50,
        narrative: `${faction.name ?? id} is initialized from the world manifest.`,
        ...objectValue(faction.state),
      },
    };
  }));
  const defaultFactionId = factions[0]?.id ?? 'faction-1';
  const zones = distribute((builder.zones ?? []).map((zone, index) => {
    const id = zone.id ?? `zone-${index + 1}`;
    return {
      ...zone,
      id,
      state: {
        latestDecision: 'pending',
        dangerLevel: 0,
        controllingFaction: defaultFactionId,
        climate: 'CALM',
        ...objectValue(zone.state),
      },
    };
  }));
  const triggers = (builder.triggers ?? []).map((trigger) => ({
    ...trigger,
    outputMapping: (trigger.outputMapping ?? objectValue(trigger.condition).outputMapping ?? []).map((mapping) => ({
      ...mapping,
      weightPercent: mapping.weightPercent ?? mapping.priorityPercent ?? 100,
    })),
  }));
  const graph = builder.graph
    ? {
        ...builder.graph,
        edges: (builder.graph.edges ?? []).map((edge) => ({
          ...edge,
          weightPercent: edge.weightPercent ?? edge.priorityPercent ?? 100,
        })),
      }
    : builder.graph;
  return { ...builder, zones, factions, triggers, graph };
}

function normalizeWorldState(state) {
  const builder = normalizeBuilder(objectValue(state.builder));
  return {
    ...state,
    builder,
    zones: builder.zones,
    factions: builder.factions,
  };
}

loadDotEnv(envPath);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run from reverie-frontend with .env loaded.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: worlds, error } = await supabase.from('worlds').select('id,name,world_state');
if (error) {
  console.error('Failed to load worlds:', error.message);
  process.exit(1);
}

let changed = 0;
for (const world of worlds ?? []) {
  const current = objectValue(world.world_state);
  const next = normalizeWorldState(current);
  const currentJson = JSON.stringify(current);
  const nextJson = JSON.stringify(next);
  if (currentJson === nextJson) continue;
  changed += 1;
  console.log(`${apply ? 'Updating' : 'Would update'} ${world.name} (${world.id})`);
  if (apply) {
    const { error: updateError } = await supabase
      .from('worlds')
      .update({ world_state: next, updated_at: new Date().toISOString() })
      .eq('id', world.id);
    if (updateError) {
      console.error(`Failed to update ${world.id}:`, updateError.message);
      process.exit(1);
    }
  }
}

console.log(`${apply ? 'Applied' : 'Dry run complete'}: ${changed} world(s) need normalization.`);
