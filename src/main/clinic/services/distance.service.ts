import axios from 'axios';
import { eq } from 'drizzle-orm';
import { envConfig } from '../../../utils/envConfig';
import logger from '../../../utils/logger';
import redisClient from '../../../configurations/redisConfig';
import { database } from '../../../configurations/dbConnection';
import { ClinicModel } from '../models/clinic.model';

const CLINIC_GEO_CACHE_TTL_SECONDS = 3600;

export interface ClinicCoordinates {
  latitude: number;
  longitude: number;
}

export interface ClinicGeoLookup {
  found: boolean; // clinic row exists
  coordinates: ClinicCoordinates | null; // null if clinic has no lat/long configured
}

/**
 * Cached (1h TTL) lookup of a clinic's existence + lat/long, to avoid a DB
 * round trip on every clinic.eta / join.live-queue call. Invalidated in
 * clinic.service.ts (`clinic_geo:{clinicId}`) whenever clinic details are updated.
 */
export async function getClinicCoordinates(
  clinicId: string
): Promise<ClinicGeoLookup> {
  const cacheKey = `clinic_geo:${clinicId}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached) as ClinicGeoLookup;
    }
  } catch {
    // Redis unavailable — fall through to DB
  }

  const [clinic] = await database
    .select({
      latitude: ClinicModel.latitude,
      longitude: ClinicModel.longitude,
    })
    .from(ClinicModel)
    .where(eq(ClinicModel.id, clinicId))
    .limit(1);

  const result: ClinicGeoLookup = {
    found: !!clinic,
    coordinates:
      clinic?.latitude != null && clinic?.longitude != null
        ? { latitude: clinic.latitude, longitude: clinic.longitude }
        : null,
  };

  await redisClient
    .setex(cacheKey, CLINIC_GEO_CACHE_TTL_SECONDS, JSON.stringify(result))
    .catch(() => {});

  return result;
}

export type TravelMode = 'car' | 'bike' | 'walking' | 'transit';

export interface VehicleEta {
  mode: TravelMode;
  distanceKm: number;
  durationMinutes: number;
  source: 'google' | 'estimate';
}

export interface ClinicEtaResult {
  clinicId: string;
  distanceKm: number;
  mapsShareUrl: string;
  vehicles: VehicleEta[];
}

const GOOGLE_TRAVEL_MODE: Record<TravelMode, string> = {
  car: 'driving',
  bike: 'bicycling',
  walking: 'walking',
  transit: 'transit',
};

// Rough average speeds (km/h) used for the haversine fallback when Google isn't configured/available.
const FALLBACK_AVG_SPEED_KMH: Record<TravelMode, number> = {
  car: 35,
  bike: 18,
  walking: 5,
  transit: 25,
};

const TRAVEL_MODES: TravelMode[] = ['car', 'bike', 'walking', 'transit'];

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const EARTH_RADIUS_KM = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function buildMapsShareUrl(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number }
): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}`;
}

function estimateVehicleEta(mode: TravelMode, distanceKm: number): VehicleEta {
  const speed = FALLBACK_AVG_SPEED_KMH[mode];
  const durationMinutes = Math.max(1, Math.round((distanceKm / speed) * 60));
  return {
    mode,
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMinutes,
    source: 'estimate',
  };
}

async function fetchGoogleEta(
  mode: TravelMode,
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number }
): Promise<VehicleEta | null> {
  if (!envConfig.GOOGLE_MAPS_API_KEY) return null;

  try {
    const response = await axios.get(
      'https://maps.googleapis.com/maps/api/distancematrix/json',
      {
        params: {
          origins: `${origin.latitude},${origin.longitude}`,
          destinations: `${destination.latitude},${destination.longitude}`,
          mode: GOOGLE_TRAVEL_MODE[mode],
          key: envConfig.GOOGLE_MAPS_API_KEY,
        },
        timeout: 5000,
      }
    );

    const element = response.data?.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') return null;

    return {
      mode,
      distanceKm: Math.round((element.distance.value / 1000) * 100) / 100,
      durationMinutes: Math.round(element.duration.value / 60),
      source: 'google',
    };
  } catch (error) {
    logger.warn(
      `[DistanceService] Google Distance Matrix failed for mode=${mode}`,
      error
    );
    return null;
  }
}

export async function computeClinicEta(
  clinicId: string,
  patient: { latitude: number; longitude: number },
  clinic: { latitude: number; longitude: number }
): Promise<ClinicEtaResult> {
  const straightLineDistanceKm = haversineDistanceKm(
    patient.latitude,
    patient.longitude,
    clinic.latitude,
    clinic.longitude
  );

  const vehicles = await Promise.all(
    TRAVEL_MODES.map(async (mode) => {
      const googleResult = await fetchGoogleEta(mode, patient, clinic);
      return googleResult ?? estimateVehicleEta(mode, straightLineDistanceKm);
    })
  );

  return {
    clinicId,
    distanceKm: Math.round(straightLineDistanceKm * 100) / 100,
    mapsShareUrl: buildMapsShareUrl(patient, clinic),
    vehicles,
  };
}
