/**
 * Fixed system prompts for REVERIE agents — NOT overridable by builders.
 * User personality is passed only via `style` in the user prompt template.
 */
import type { WorldStyle } from "../types.js";

export const FIXED_PROMPTS = {
  chronicle:
    "You are a world historian. Write in the requested style. Be concise. Limit to 2-3 sentences. Never break the fourth wall.",

  zoneClimate:
    "You are a world climate engine. Map the provided real-world weather data to exactly one of the allowed world climate states. Output ONLY the matching value.",

  factionMorale:
    "You are a faction economist for a virtual world. Translate real-world market conditions into in-world faction morale and trade consequences. Output a JSON object with exactly two keys: moraleDelta (integer between -20 and 20) and narrative (a single sentence describing the consequence). Output ONLY the JSON object, no explanation.",

  conflict:
    "You are a conflict arbitrator for a virtual world. Analyse the provided context and output ONLY one of the allowed decision values. Do not explain your reasoning.",
} as const;

export const ALLOWED_CLIMATE_STATES = [
  "clear",
  "rain",
  "storm",
  "flood",
  "drought",
  "blizzard",
] as const;

export const ALLOWED_CONFLICT_OUTCOMES = [
  "faction_a_wins",
  "faction_b_wins",
  "ceasefire",
  "zone_destroyed",
  "stalemate",
] as const;

export function chronicleUserPrompt(event: string, style: WorldStyle): string {
  return `Write a ${style} in-world chronicle entry for this event: "${event}". Style: ${style}.`;
}

export function zoneClimateUserPrompt(
  city: string,
  weatherCode: string,
  zoneId: string,
  style: WorldStyle
): string {
  return [
    `Consensus-verified weather_code from ${city}: ${weatherCode}`,
    `WMO reference: 0-2 clear, 51-67 rain, 71-77 snow, 95-99 storm.`,
    `Map to one climate state for zone ${zoneId}. Style: ${style}.`,
  ].join("\n");
}

export function factionMoraleUserPrompt(
  pair: string,
  price: string,
  change: string,
  factionId: string,
  style: WorldStyle
): string {
  return [
    `Pair: ${pair}`,
    `USD price (consensus-verified): ${price}`,
    `24h change %: ${change}`,
    `Faction: ${factionId}`,
    `Style: ${style}`,
  ].join("\n");
}

export function conflictUserPrompt(
  zoneName: string,
  dangerLevel: bigint,
  climateState: string,
  factionA: string,
  factionB: string,
  context: string,
  style: WorldStyle
): string {
  return [
    `Zone: ${zoneName} (danger ${dangerLevel})`,
    `Climate: ${climateState}`,
    `Faction A: ${factionA}`,
    `Faction B: ${factionB}`,
    `Context: ${context}`,
    `Style: ${style}`,
  ].join("\n");
}
