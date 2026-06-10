import { NextResponse } from 'next/server';
import { buildCargoRoutePlan, getCargoBuilderTemplate, getCargoRouteGraph } from '@/lib/shared/cargo-climate/engine';

export async function GET() {
  const graph = getCargoRouteGraph();
  return NextResponse.json({
    graph: {
      ...graph,
      routeAlternatives: buildCargoRoutePlan({
        startPortId: 'shanghai',
        destinationPortId: 'rotterdam',
        speedKnots: 18,
        includeAlternatives: true,
      }).alternatives,
      corridorIds: Array.from(new Set(graph.edges.map((edge) => edge.zoneId))),
      chokepoints: graph.waypoints.filter((waypoint) => waypoint.kind === 'chokepoint'),
    },
    builderTemplate: getCargoBuilderTemplate(),
    source: 'static-json',
  });
}
