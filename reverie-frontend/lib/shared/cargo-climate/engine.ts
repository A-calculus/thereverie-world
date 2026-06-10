import routeGraph from '@/content/cargo-climate/routes.v1.json';
import officialTemplate from '@/content/official-templates/cargo-climate-guard.json';
import { applyLiveBuilderAgentDefaults } from '@/lib/shared/live-agent-step-defaults';
import type {
  AgentExecutionRecord,
  CargoGuardSimulationRun,
  CargoPort,
  CargoRouteEdge,
  CargoRouteGraph,
  CargoRouteLeg,
  CargoRoutePlan,
  CargoRouteProgress,
  CargoWaypoint,
  ForecastPoint,
  RiskAssessment,
  WeatherSample,
  WorldBuilderConfig,
} from '@/lib/shared/types';

const EARTH_RADIUS_NM = 3440.065;

export interface CargoRiskThresholds {
  safeBelow: number;
  dangerAtOrAbove: number;
  hardDangerWindKmh: number;
  hardDangerPrecipitationMm: number;
  hardDangerColdC: number;
  hardDangerHeatC: number;
}

export const DEFAULT_CARGO_RISK_THRESHOLDS: CargoRiskThresholds = {
  safeBelow: 45,
  dangerAtOrAbove: 70,
  hardDangerWindKmh: 45,
  hardDangerPrecipitationMm: 8,
  hardDangerColdC: -5,
  hardDangerHeatC: 40,
};

export function normalizeCargoRiskThresholds(value: unknown): CargoRiskThresholds {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    safeBelow: typeof record.safeBelow === 'number' ? record.safeBelow : DEFAULT_CARGO_RISK_THRESHOLDS.safeBelow,
    dangerAtOrAbove: typeof record.dangerAtOrAbove === 'number' ? record.dangerAtOrAbove : DEFAULT_CARGO_RISK_THRESHOLDS.dangerAtOrAbove,
    hardDangerWindKmh: typeof record.hardDangerWindKmh === 'number' ? record.hardDangerWindKmh : DEFAULT_CARGO_RISK_THRESHOLDS.hardDangerWindKmh,
    hardDangerPrecipitationMm: typeof record.hardDangerPrecipitationMm === 'number' ? record.hardDangerPrecipitationMm : DEFAULT_CARGO_RISK_THRESHOLDS.hardDangerPrecipitationMm,
    hardDangerColdC: typeof record.hardDangerColdC === 'number' ? record.hardDangerColdC : DEFAULT_CARGO_RISK_THRESHOLDS.hardDangerColdC,
    hardDangerHeatC: typeof record.hardDangerHeatC === 'number' ? record.hardDangerHeatC : DEFAULT_CARGO_RISK_THRESHOLDS.hardDangerHeatC,
  };
}

export function getCargoRouteGraph(): CargoRouteGraph {
  return routeGraph as CargoRouteGraph;
}

export function getCargoBuilderTemplate(): WorldBuilderConfig {
  return applyLiveBuilderAgentDefaults(officialTemplate as WorldBuilderConfig, 'cargo-climate-guard');
}

function toRadians(value: number) {
  return value * Math.PI / 180;
}

export function haversineNm(a: Pick<CargoWaypoint, 'latitude' | 'longitude'>, b: Pick<CargoWaypoint, 'latitude' | 'longitude'>): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(h));
}

function getWaypointMap(graph = getCargoRouteGraph()): Map<string, CargoWaypoint> {
  return new Map(graph.waypoints.map((waypoint) => [waypoint.id, waypoint]));
}

function getPortIds(graph = getCargoRouteGraph()): Set<string> {
  return new Set(graph.ports.map((port) => port.id));
}

function undirectedEdges(graph = getCargoRouteGraph()) {
  return graph.edges.flatMap((edge) => ([
    { ...edge, from: edge.from, to: edge.to },
    { ...edge, id: `${edge.id}:reverse`, from: edge.to, to: edge.from },
  ]));
}

export function findCargoRoute(
  startPortId: string,
  destinationPortId: string,
  options: { excludedEdgeIds?: string[]; graph?: CargoRouteGraph } = {}
): CargoRouteEdge[] {
  const graph = options.graph ?? getCargoRouteGraph();
  const portIds = getPortIds(graph);
  if (!portIds.has(startPortId) || !portIds.has(destinationPortId)) {
    throw new Error('Start and destination must be supported cargo ports.');
  }
  if (startPortId === destinationPortId) {
    throw new Error('Start and destination ports must be different.');
  }

  const excluded = new Set(options.excludedEdgeIds ?? []);
  const edges = undirectedEdges(graph).filter((edge) => !excluded.has(edge.id.replace(':reverse', '')));
  const distances = new Map<string, number>();
  const previous = new Map<string, { node: string; edge: CargoRouteEdge }>();
  const unvisited = new Set(graph.waypoints.map((waypoint) => waypoint.id));
  distances.set(startPortId, 0);

  while (unvisited.size > 0) {
    let current: string | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const node of unvisited) {
      const distance = distances.get(node) ?? Number.POSITIVE_INFINITY;
      if (distance < currentDistance) {
        current = node;
        currentDistance = distance;
      }
    }
    if (!current || currentDistance === Number.POSITIVE_INFINITY) break;
    if (current === destinationPortId) break;
    unvisited.delete(current);

    for (const edge of edges.filter((item) => item.from === current)) {
      const nextDistance = currentDistance + edge.distanceNm + edge.riskBias;
      if (nextDistance < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, nextDistance);
        previous.set(edge.to, { node: current, edge });
      }
    }
  }

  const path: CargoRouteEdge[] = [];
  let cursor = destinationPortId;
  while (cursor !== startPortId) {
    const step = previous.get(cursor);
    if (!step) throw new Error('No sea route exists between the selected ports.');
    path.unshift(step.edge);
    cursor = step.node;
  }
  return path.map((edge) => ({ ...edge, id: edge.id.replace(':reverse', '') }));
}

function interpolate(a: CargoWaypoint, b: CargoWaypoint, ratio: number) {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * ratio,
    longitude: a.longitude + (b.longitude - a.longitude) * ratio,
  };
}

export function buildCargoRoutePlan(params: {
  startPortId: string;
  destinationPortId: string;
  speedKnots: number;
  excludedEdgeIds?: string[];
  includeAlternatives?: boolean;
}): CargoRoutePlan {
  const graph = getCargoRouteGraph();
  const waypointMap = getWaypointMap(graph);
  const edges = findCargoRoute(params.startPortId, params.destinationPortId, {
    excludedEdgeIds: params.excludedEdgeIds,
    graph,
  });
  const legs: CargoRouteLeg[] = edges.map((edge) => {
    const from = waypointMap.get(edge.from);
    const to = waypointMap.get(edge.to);
    if (!from || !to) throw new Error(`Route edge ${edge.id} has invalid waypoints.`);
    return {
      edgeId: edge.id,
      from,
      to,
      lane: edge.lane,
      zoneId: edge.zoneId,
      distanceNm: edge.distanceNm,
    };
  });
  const totalDistanceNm = legs.reduce((sum, leg) => sum + leg.distanceNm, 0);
  const projectedPoints = projectForecastPoints(legs, params.speedKnots);
  const routeId = `${params.startPortId}-${params.destinationPortId}-${edges.map((edge) => edge.id).join('-')}`;
  const basePlan: CargoRoutePlan = {
    routeId,
    startPortId: params.startPortId,
    destinationPortId: params.destinationPortId,
    speedKnots: params.speedKnots,
    totalDistanceNm,
    stopovers: legs.slice(0, -1).map((leg) => leg.to.name),
    legs,
    projectedPoints,
  };
  const progress = projectCargoProgress(basePlan, { hoursAhead: 2 });
  return {
    ...basePlan,
    progress,
    alternatives: params.includeAlternatives
      ? findCargoRouteAlternatives(params).filter((plan) => plan.routeId !== routeId)
      : undefined,
  };
}

export function projectForecastPoints(legs: CargoRouteLeg[], speedKnots: number): ForecastPoint[] {
  const points: ForecastPoint[] = [];
  for (let hour = 1; hour <= 5; hour += 1) {
    let targetDistance = Math.max(0, speedKnots * hour);
    let distanceBeforeLeg = 0;
    let selected = legs[legs.length - 1];
    for (const leg of legs) {
      if (targetDistance <= leg.distanceNm) {
        selected = leg;
        break;
      }
      targetDistance -= leg.distanceNm;
      distanceBeforeLeg += leg.distanceNm;
    }
    const ratio = selected.distanceNm > 0 ? Math.min(1, targetDistance / selected.distanceNm) : 0;
    const coordinate = interpolate(selected.from, selected.to, ratio);
    points.push({
      hourOffset: hour,
      latitude: Number(coordinate.latitude.toFixed(4)),
      longitude: Number(coordinate.longitude.toFixed(4)),
      distanceFromStartNm: Number((distanceBeforeLeg + targetDistance).toFixed(1)),
      lane: selected.lane,
      zoneId: selected.zoneId,
    });
  }
  return points;
}

export function projectCargoProgress(
  route: CargoRoutePlan,
  options: { hoursAhead?: number; distanceTravelledNm?: number } = {},
): CargoRouteProgress {
  const hoursAhead = Math.max(0, options.hoursAhead ?? 2);
  const startingDistance = Math.max(0, options.distanceTravelledNm ?? 0);
  const targetDistance = Math.min(route.totalDistanceNm, startingDistance + route.speedKnots * hoursAhead);
  let cursor = targetDistance;
  let selected = route.legs[route.legs.length - 1];
  for (const leg of route.legs) {
    if (cursor <= leg.distanceNm) {
      selected = leg;
      break;
    }
    cursor -= leg.distanceNm;
  }
  const ratio = selected.distanceNm > 0 ? Math.min(1, cursor / selected.distanceNm) : 0;
  const coordinate = interpolate(selected.from, selected.to, ratio);
  const projectedPosition: ForecastPoint = {
    hourOffset: hoursAhead,
    latitude: Number(coordinate.latitude.toFixed(4)),
    longitude: Number(coordinate.longitude.toFixed(4)),
    distanceFromStartNm: Number(targetDistance.toFixed(1)),
    lane: selected.lane,
    zoneId: selected.zoneId,
  };
  const remainingDistanceNm = Math.max(0, route.totalDistanceNm - targetDistance);
  return {
    routeId: route.routeId,
    hoursAhead,
    distanceTravelledNm: Number(targetDistance.toFixed(1)),
    remainingDistanceNm: Number(remainingDistanceNm.toFixed(1)),
    currentSegment: selected,
    projectedPosition,
    nextStop: selected.to,
    etaHours: route.speedKnots > 0 ? Number((remainingDistanceNm / route.speedKnots).toFixed(2)) : 0,
    arrivalProgress: route.totalDistanceNm > 0 ? Number(Math.min(1, targetDistance / route.totalDistanceNm).toFixed(4)) : 1,
    arrived: remainingDistanceNm <= 0,
  };
}

export function findCargoRouteAlternatives(params: {
  startPortId: string;
  destinationPortId: string;
  speedKnots: number;
  excludedEdgeIds?: string[];
  maxAlternatives?: number;
}): CargoRoutePlan[] {
  const maxAlternatives = Math.max(1, params.maxAlternatives ?? 3);
  const alternatives: CargoRoutePlan[] = [];
  const excluded = new Set(params.excludedEdgeIds ?? []);
  for (let attempt = 0; attempt < maxAlternatives; attempt += 1) {
    try {
      const plan = buildCargoRoutePlan({
        startPortId: params.startPortId,
        destinationPortId: params.destinationPortId,
        speedKnots: params.speedKnots,
        excludedEdgeIds: [...excluded],
        includeAlternatives: false,
      });
      alternatives.push(plan);
      const firstEdge = plan.legs[0]?.edgeId;
      if (!firstEdge || excluded.has(firstEdge)) break;
      excluded.add(firstEdge);
    } catch {
      break;
    }
  }
  return alternatives;
}

export function getCargoPorts(): CargoPort[] {
  return getCargoRouteGraph().ports;
}

export function createWeatherSample(point: ForecastPoint, baseDate = new Date()): WeatherSample {
  const lat = Math.abs(point.latitude);
  const lon = Math.abs(point.longitude);
  const wind = Math.round((18 + ((lat + point.hourOffset * 7) % 34)) * 10);
  const precipitation = Math.round((((lon + point.hourOffset * 3) % 12)) * 10);
  const temperature = Math.round((24 - (lat / 5) + ((point.longitude % 9) - 4)) * 10);
  const weatherCode = wind >= 450 || precipitation >= 80 ? 95 : precipitation >= 30 ? 63 : 2;
  const sampleTime = new Date(baseDate.getTime() + point.hourOffset * 60 * 60 * 1000);
  return {
    hourOffset: point.hourOffset,
    latitude: point.latitude,
    longitude: point.longitude,
    temperatureC10: temperature,
    windKmh10: wind,
    precipitationMm10: precipitation,
    weatherCode,
    sampleTimeUtc: sampleTime.toISOString(),
    source: 'public-demo-json',
  };
}

export function assessCargoRisk(samples: WeatherSample[], thresholdInput?: unknown): RiskAssessment {
  const thresholds = normalizeCargoRiskThresholds(thresholdInput);
  const pointRisks = samples.map((sample) => {
    const temperatureC = sample.temperatureC10 / 10;
    const windKmh = sample.windKmh10 / 10;
    const precipitationMm = sample.precipitationMm10 / 10;
    const stormRisk = sample.weatherCode >= 95 ? 35 : sample.weatherCode >= 63 ? 16 : 0;
    const windRisk = Math.min(35, windKmh * 0.7);
    const precipitationRisk = Math.min(25, precipitationMm * 2.5);
    const temperatureRisk = temperatureC <= -5 || temperatureC >= 40 ? 20 : 0;
    const risk = Math.min(100, Math.round(stormRisk + windRisk + precipitationRisk + temperatureRisk));
    const hardDanger = sample.weatherCode >= 95 && (
      windKmh >= thresholds.hardDangerWindKmh ||
      precipitationMm >= thresholds.hardDangerPrecipitationMm
    ) || windKmh >= thresholds.hardDangerWindKmh ||
      precipitationMm >= thresholds.hardDangerPrecipitationMm ||
      temperatureC <= thresholds.hardDangerColdC ||
      temperatureC >= thresholds.hardDangerHeatC;
    return {
      hourOffset: sample.hourOffset,
      risk,
      reason: hardDanger
        ? 'Hard danger threshold crossed.'
        : risk >= thresholds.dangerAtOrAbove
          ? 'Combined maritime weather risk is dangerous.'
          : risk >= thresholds.safeBelow
            ? 'Route should continue with caution.'
            : 'Route conditions are acceptable.',
    };
  });
  const aggregateRisk = Math.max(...pointRisks.map((risk) => risk.risk), 0);
  const dangerous = aggregateRisk >= thresholds.dangerAtOrAbove || pointRisks.some((risk) => risk.reason === 'Hard danger threshold crossed.');
  return {
    aggregateRisk,
    dangerous,
    decision: dangerous ? 'REROUTE' : 'CONTINUE_ROUTE',
    reason: dangerous
      ? 'At least one forecast point is unsafe for immediate travel.'
      : 'The projected 5-hour corridor is acceptable for immediate travel.',
    pointRisks,
  };
}

function mockReceipt(id: string) {
  return `https://agents.testnet.somnia.network/receipts/${id}`;
}

export function createAgentRecord(
  id: string,
  name: string,
  agentType: AgentExecutionRecord['agentType'],
  request: unknown,
  response: unknown
): AgentExecutionRecord {
  return {
    id,
    name,
    agentType,
    request,
    response,
    receiptUrl: mockReceipt(`cargo-${id}-${Date.now()}`),
    status: 'complete',
  };
}

export function buildDemoCargoRun(params: {
  startPortId: string;
  destinationPortId: string;
  speedKnots: number;
  maxAttempts?: number;
  riskThresholds?: unknown;
}): CargoGuardSimulationRun {
  const maxAttempts = params.maxAttempts ?? 5;
  const attempts: CargoGuardSimulationRun['attempts'] = [];
  const excluded: string[] = [];
  let finalDecision: CargoGuardSimulationRun['finalDecision'] = 'STOP_WORLD';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let route;
    try {
      route = buildCargoRoutePlan({ ...params, excludedEdgeIds: excluded });
    } catch (error) {
      const latest = attempts[attempts.length - 1];
      if (!latest) throw error;
      latest?.agentResponses.push(createAgentRecord(
        'reroute-arbiter',
        'Reroute Arbiter',
        'native_llm',
        { attempts: attempts.length, maxAttempts, excludedEdgeIds: excluded },
        { decision: 'STOP_WORLD', reason: error instanceof Error ? error.message : 'No alternate sea route exists.' }
      ));
      break;
    }
    const weatherSamples = route.projectedPoints.map((point) => createWeatherSample(point));
    const riskAssessment = assessCargoRisk(weatherSamples, params.riskThresholds);
    const agentResponses: AgentExecutionRecord[] = [
      createAgentRecord('port-resolver', 'Port Resolver Agent', 'native_llm', {
        startPortId: params.startPortId,
        destinationPortId: params.destinationPortId,
      }, {
        status: 'supported',
        normalizedRoute: `${params.startPortId} to ${params.destinationPortId}`,
      }),
      ...weatherSamples.map((sample) => createAgentRecord(
        `weather-sampler-${attempt}-${sample.hourOffset}`,
        `Weather Sampler H+${sample.hourOffset}`,
        'native_json_api',
        { latitude: sample.latitude, longitude: sample.longitude, hourOffset: sample.hourOffset },
        sample
      )),
      createAgentRecord('maritime-risk', 'Maritime Risk Evaluator', 'native_llm', weatherSamples, riskAssessment),
    ];

    attempts.push({ attempt, route, weatherSamples, riskAssessment, agentResponses });
    if (!riskAssessment.dangerous) {
      finalDecision = 'CONTINUE_ROUTE';
      break;
    }
    excluded.push(...route.legs.slice(0, 1).map((leg) => leg.edgeId));
  }

  if (finalDecision === 'STOP_WORLD') {
    const latest = attempts[attempts.length - 1];
    latest?.agentResponses.push(createAgentRecord(
      'reroute-arbiter',
      'Reroute Arbiter',
      'native_llm',
      { attempts: attempts.length, maxAttempts },
      { decision: 'STOP_WORLD', reason: 'All immediate candidate routes remained dangerous.' }
    ));
  }

  const latestAttempt = attempts[attempts.length - 1];
  latestAttempt?.agentResponses.push(createAgentRecord(
    'stakeholder-impact',
    'Stakeholder Impact Agent',
    'native_llm',
    { finalDecision },
    {
      safetyAuthorityDelta: finalDecision === 'STOP_WORLD' ? 12 : 4,
      carrierOperationsDelta: finalDecision === 'STOP_WORLD' ? -10 : 3,
      cargoOwnerDelta: finalDecision === 'STOP_WORLD' ? 6 : 5,
      portCorridorNetworkDelta: finalDecision === 'STOP_WORLD' ? -6 : 2,
      narrative: finalDecision === 'STOP_WORLD'
        ? 'Safety overrides schedule because every immediate corridor is unsafe.'
        : 'The vessel can proceed while monitoring the active corridor.',
    }
  ));
  latestAttempt?.agentResponses.push(createAgentRecord(
    'chronicle',
    'Chronicle Agent',
    'reverie_custom',
    { finalDecision, attempts: attempts.length },
    {
      entry: finalDecision === 'STOP_WORLD'
        ? 'Cargo Climate Guard stopped the world after five unsafe route attempts.'
        : 'Cargo Climate Guard cleared the selected route for immediate travel.',
    }
  ));

  const now = new Date().toISOString();
  return {
    id: `cargo-run-${Date.now()}`,
    status: finalDecision === 'STOP_WORLD' ? 'stopped' : 'complete',
    startPortId: params.startPortId,
    destinationPortId: params.destinationPortId,
    speedKnots: params.speedKnots,
    maxAttempts,
    attempts,
    finalDecision,
    createdAt: now,
    completedAt: now,
  };
}
