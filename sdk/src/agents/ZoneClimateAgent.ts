import type { WorldInstance } from "../WorldInstance.js";
import type { SomniaAgentKit } from "../agentkit/SomniaAgentKit.js";
import type { WorldStyle } from "../types.js";
import type { InvokeOptions } from "../types/execution.js";
import {
  ALLOWED_CLIMATE_STATES,
  FIXED_PROMPTS,
  zoneClimateUserPrompt,
} from "./prompts.js";
import { nativeRequestOptions } from "./options.js";

const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  London: { lat: 51.5, lon: -0.1 },
  "New York": { lat: 40.7, lon: -74.0 },
  Tokyo: { lat: 35.7, lon: 139.7 },
  Lagos: { lat: 6.5, lon: 3.4 },
  Dubai: { lat: 25.2, lon: 55.3 },
  Paris: { lat: 48.9, lon: 2.3 },
  Singapore: { lat: 1.35, lon: 103.82 },
  Nairobi: { lat: -1.29, lon: 36.82 },
  "Sao Paulo": { lat: -23.55, lon: -46.63 },
  Mumbai: { lat: 19.08, lon: 72.88 },
  Seoul: { lat: 37.57, lon: 126.98 },
  Sydney: { lat: -33.87, lon: 151.21 },
  Cairo: { lat: 30.04, lon: 31.24 },
  Toronto: { lat: 43.65, lon: -79.38 },
  Berlin: { lat: 52.52, lon: 13.41 },
  "Mexico City": { lat: 19.43, lon: -99.13 },
};

function buildWeatherUrl(city: string, latitude?: number, longitude?: number): string {
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=weather_code,temperature_2m,wind_speed_10m`;
  }
  const cityCoords: Record<string, { lat: number; lon: number }> = {
    ...CITY_COORDS,
  };
  const coords = cityCoords[city] ?? { lat: 51.5, lon: -0.1 };
  return `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=weather_code,temperature_2m,wind_speed_10m`;
}

export interface ZoneClimateInvokeParams {
  zoneId: `0x${string}`;
  city: string;
  latitude?: number;
  longitude?: number;
  style?: WorldStyle;
}

export class ZoneClimateAgent {
  constructor(
    private world: WorldInstance,
    private agentKit: SomniaAgentKit
  ) {}

  async invoke(
    params: ZoneClimateInvokeParams,
    options: InvokeOptions = {}
  ) {
    const style = params.style ?? "epic";
    const url = buildWeatherUrl(params.city, params.latitude, params.longitude);

    const weather = await this.agentKit.executeJsonApi({
      url,
      selector: "current.weather_code",
      returnType: "string",
      ...nativeRequestOptions(options),
    });

    const weatherCode = String(weather.value);

    const llm = await this.agentKit.executeLLM({
      prompt: zoneClimateUserPrompt(params.city, weatherCode, params.zoneId, style),
      systemPrompt: FIXED_PROMPTS.zoneClimate,
      allowedValues: [...ALLOWED_CLIMATE_STATES],
      ...nativeRequestOptions(options),
    });

    const climateState = llm.text.trim().toLowerCase();

    let stateTxHash: `0x${string}` | undefined;
    if (options.persistOnChain !== false) {
      stateTxHash = await this.world.applyClimateResult(params.zoneId, climateState);
    }

    return {
      climateState,
      weatherCode,
      requestId: llm.requestId,
      txHash: llm.txHash,
      receiptUrl: llm.receiptUrl,
      stateTxHash,
    };
  }

  estimateCost() {
    return {
      depositRequired: "0.36+ STT",
      agentType: "json_api + llm",
      note: "Lane A via SomniaAgentKit; excess STT refunded",
    };
  }
}
