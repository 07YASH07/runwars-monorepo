import * as turf from '@turf/helpers';
import buffer from '@turf/buffer';
import simplify from '@turf/simplify';
import difference from '@turf/difference';
import intersect from '@turf/intersect';
import type { GeoPoint } from '@runwars/shared';

// In-memory storage for Phase 2/3 (will move to Postgres in Phase 4)
export interface Territory {
  id: string;
  userId: string;
  color: string;
  polygon: turf.Feature<turf.Polygon | turf.MultiPolygon>;
}

const territories: Territory[] = [];

/**
 * Generate a territory polygon from a run route.
 * Buffers the linestring by 15 meters to create a thick path.
 */
export function generateTerritoryFromRoute(points: GeoPoint[]): turf.Feature<turf.Polygon | turf.MultiPolygon> | null {
  if (points.length < 2) {
    return null;
  }

  // Turf expects [longitude, latitude]
  const coordinates = points.map(p => [p.longitude, p.latitude]);
  
  const line = turf.lineString(coordinates);
  
  // Buffer by 15 meters (0.015 km)
  const buffered = buffer(line, 0.015, { units: 'kilometers' });
  
  if (!buffered) return null;
  
  // Simplify to reduce coordinate count
  const simplified = simplify(buffered, { tolerance: 0.0001, highQuality: false });
  
  return simplified as turf.Feature<turf.Polygon | turf.MultiPolygon>;
}

/**
 * Claim a territory for a user.
 * For now, just appends to the list. Later we can add boolean logic (difference/intersect)
 * to resolve conflicts with existing territories.
 */
export function claimTerritory(userId: string, color: string, points: GeoPoint[]): Territory | null {
  const polygon = generateTerritoryFromRoute(points);
  
  if (!polygon) return null;
  
  const newTerritory: Territory = {
    id: `territory_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    userId,
    color,
    polygon
  };
  
  territories.push(newTerritory);
  return newTerritory;
}

/**
 * Get all territories.
 */
export function getAllTerritories(): Territory[] {
  return territories;
}
