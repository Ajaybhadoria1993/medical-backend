import axios from 'axios';
import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
const base = process.env.ONE_MG_BASE_URL;
const accessKey = process.env.ONE_MG_ACCESS_KEY || '1mg_client_access_key'; // doc default
const defaultPlatform = process.env.ONE_MG_PLATFORM || 'mobileweb-0.0.1';

export const getLocationsController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!base) {
      return res
        .status(500)
        .json({ success: false, message: 'Configuration error' });
    }

    // 2. Determine city parameter (allow body or query)
    const rawCity = req.validatedQuery.city;
    if (!rawCity) {
      return res
        .status(400)
        .json({ success: false, message: 'city is required' });
    }

    // Normalize city to string (handle object case)
    let cityParam: string;
    if (typeof rawCity === 'string' || typeof rawCity === 'number') {
      cityParam = String(rawCity);
    } else if (typeof rawCity === 'object') {
      cityParam =
        rawCity.name ?? rawCity.cityName ?? rawCity.id ?? rawCity.code;
      if (!cityParam) {
        return res
          .status(400)
          .json({ success: false, message: 'invalid city object' });
      }
    } else {
      return res
        .status(400)
        .json({ success: false, message: 'invalid city value' });
    }

    // 3. Build request using axios params (handles encoding)
    const url = `${base.replace(/\/$/, '')}/api/v4/city-serviceable`;
    try {
      const resp = await axios.get(url, {
        params: { city: cityParam },
        timeout: 15000,
        headers: {
          Accept: 'application/json',
          'X-Access-Key': accessKey, // per 1mg docs for serviceability
        },
        validateStatus: (s) => s < 500, // let 4xx be returned so you can forward message
      });

      // Forward successful or client-error responses from 1mg
      return res.status(resp.status).json(resp.data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err?.response) {
        return res.status(err.response.status).json({
          success: false,
          status: err.response.status,
          message: err.response.data?.message ?? 'Upstream error',
          details: err.response.data,
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        details: { message: err?.message },
      });
    }
  }
);

export const searchAllController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!base) {
      return res
        .status(500)
        .json({ success: false, message: 'Configuration error' });
    }

    // Accept from query or body (body is useful for POST proxies)
    const q = (req.validatedQuery.q ?? req.validatedBody?.q) as
      | string
      | undefined;
    const urlSerch = (req.validatedQuery.url ?? req.validatedBody?.url) as
      | string
      | undefined;
    const types = (req.validatedQuery.types ??
      req.validatedBody?.types ??
      'trending_query') as string | undefined;
    const per_page =
      req.validatedQuery.per_page ?? req.validatedBody?.per_page ?? undefined;
    const xPlatform = (req.get('X-Platform') ||
      req.validatedQuery.platform ||
      req.validatedBody?.platform) as string | undefined;
    const xCity = (req.get('X-City') ||
      req.validatedQuery.city ||
      req.validatedBody?.city) as string | undefined;
    const source = (req.validatedQuery.source ??
      req.validatedBody?.source ??
      'Clinic management system') as string | undefined;

    if (!q || String(q).trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'q (validatedQuery) parameter is required',
      });
    }

    const url = `${base.replace(/\/$/, '')}/api/v4${urlSerch}`;
    try {
      const resp = await axios.get(url, {
        params: {
          q: String(q),
          ...(types ? { types: 'drug' } : {}),
          ...(per_page ? { per_page: Number(per_page) } : {}),
        },
        timeout: 15000,
        headers: {
          Accept: 'application/json',
          'X-Access-Key': accessKey,
          'X-Platform': xPlatform ?? defaultPlatform,
          ...(xCity ? { 'X-City': xCity } : {}),
          ...(source ? { source } : {}),
        },
        // let 4xx pass through so we can forward client errors
        validateStatus: (status) => status < 500,
      });

      // Forward upstream status & body
      return res.status(resp.status).json(resp.data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err?.response) {
        return res.status(err.response.status).json({
          success: false,
          status: err.response.status,
          message: err.response.data?.message ?? 'Upstream error',
          details: err.response.data,
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        details: { error: err?.message },
      });
    }
  }
);

export const searchSuggestionController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!base) {
      return res
        .status(500)
        .json({ success: false, message: 'Configuration error' });
    }

    // Accept q from query or body fallback
    const q = (req.validatedQuery?.q ?? req.validatedBody?.q) as
      | string
      | undefined;
    const per_page = (req.validatedQuery.per_page ??
      req.validatedBody?.per_page) as number | undefined;
    if (!q || String(q).trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'q (validatedQuery) param required, min 2 chars',
      });
    }

    const xPlatform = ((req.get('X-Platform') ||
      req.validatedQuery?.platform ||
      req.validatedBody?.platform) ??
      defaultPlatform) as string | undefined;

    const xCity = (req.get('X-City') ||
      req.validatedQuery.city ||
      req.validatedBody.city) as string | undefined;

    const types = (req.validatedQuery.types ??
      req.validatedBody?.types ??
      'trending_query') as string | undefined;
    const url = `${base.replace(/\/$/, '')}/api/v4/search/autocomplete`; // adjust if actual path differs
    try {
      const resp = await axios.get(url, {
        params: {
          q: String(q),
          ...(types ? { types: String(types) } : {}),
          ...(per_page ? { per_page: Number(per_page) } : {}),
        },
        timeout: 8000,
        headers: {
          Accept: 'application/json',
          'X-Access-Key': accessKey,
          'X-Platform': xPlatform ?? defaultPlatform,
          ...(xCity ? { 'X-City': xCity } : {}),
        },
        validateStatus: (s) => s < 500,
      });

      // Recommend returning only required fields to client (reduce payload)
      // For now forward upstream response
      // normalize search_results
      const searchResults = Array.isArray(resp.data?.data?.search_results)
        ? resp.data.data.search_results
        : [];

      // keep only trending_query (or change filter to include other types you want)
      const suggestions = searchResults.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => r?.type === 'trending_query'
      );

      if (suggestions.length > 0) {
        // return original data plus a suggestions array
        return res.status(resp.status).json({
          // data: resp.data,
          suggestions,
        });
      }

      // // fallback: return upstream response as-is
      // return res.status(resp.status).json(resp.data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err?.response) {
        return res.status(err.response.status).json({
          success: false,
          status: err.response.status,
          message: err.response.data?.message ?? 'Upstream error',
          details: err.response.data,
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        details: { error: err?.message },
      });
    }
  }
);

/**
 * Simple in-memory TTL cache for static endpoints
 * Key: string -> value { data: any, expiresAt: number }
 * Note: in production use Redis or another shared cache if you run multiple instances.
 */
const CACHE_TTL_MS = Number(
  process.env.DRUG_STATIC_CACHE_TTL_MS ?? 5 * 60 * 1000
); // default 5 minutes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = new Map<string, { data: any; expiresAt: number }>();

function cacheGet(key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cacheSet(key: string, data: any, ttl = CACHE_TTL_MS) {
  cache.set(key, { data, expiresAt: Date.now() + ttl });
}

/**
 * GET /drug-static/:drugSkuId
 * Proxies: GET {ONE_MG_BASE_URL}/api/v6/drug_skus/:drug_sku_id/static
 * Query params forwarded: client
 * Headers forwarded: X-Platform, X-City, X-Access-Key (default fallback)
 */
export const drugStaticController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!base) {
      console.error('ONE_MG_BASE_URL is not configured');
      return res
        .status(500)
        .json({ success: false, message: 'Configuration error' });
    }

    const drugSkuId = (req.validatedParams.drug_sku_id ??
      req.validatedParams.drugSkuId ??
      req.validatedParams.id) as string | undefined;
    if (!drugSkuId || String(drugSkuId).trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'drug_sku_id path parameter is required',
      });
    }

    const clientParam = (req.validatedQuery.client ??
      req.validatedBody?.client ??
      'app') as string | undefined;
    const xPlatform = ((req.get('X-Platform') ||
      req.validatedQuery.platform ||
      req.validatedBody?.platform) ??
      defaultPlatform) as string | undefined;
    const xCity = (req.get('X-City') ||
      req.validatedQuery.city ||
      req.validatedBody?.city) as string | undefined;

    const url = `${base.replace(/\/$/, '')}/api/v6/drug_skus/${encodeURIComponent(String(drugSkuId))}/static`;

    // Build cache key
    const cacheKey = `drugStatic:${drugSkuId}:client:${clientParam ?? '-'}:city:${xCity ?? '-'}:platform:${xPlatform ?? '-'}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res
        .status(200)
        .json({ success: true, fromCache: true, data: cached });
    }

    try {
      const resp = await axios.get(url, {
        params: {
          ...(clientParam ? { client: clientParam } : {}),
        },
        timeout: 15000,
        headers: {
          Accept: 'application/json',
          'X-Access-Key': accessKey,
          'X-Platform': xPlatform ?? defaultPlatform,
          ...(xCity ? { 'X-City': xCity } : {}),
        },
        validateStatus: (s) => s < 500, // forward 4xx as-is
      });

      // Cache successful 2xx responses only
      if (resp.status >= 200 && resp.status < 300) {
        cacheSet(cacheKey, resp.data);
      }

      return res.status(resp.status).json(resp.data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err?.response) {
        // forward upstream 4xx responses
        return res.status(err.response.status).json({
          success: false,
          status: err.response.status,
          message: err.response.data?.message ?? 'Upstream error',
          details: err.response.data,
        });
      }

      // network / unexpected error
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        details: { message: err?.message },
      });
    }
  }
);
