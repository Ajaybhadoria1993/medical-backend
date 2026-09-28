/* eslint-disable @typescript-eslint/no-explicit-any */
import { medicineQueryClient } from '../../../configurations/dbConnection';

// Helper to remove accents from a string
function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export class GlobalMedicineService {
  static async getMedicineData({
    medicine_name,
    composition,
    page,
    limit,
  }: {
    medicine_name?: string;
    composition?: string;
    page: number;
    limit: number;
  }) {
    const offset = (page - 1) * limit;
    const medicineNameSearch = medicine_name?.trim();
    const compositionSearch = composition?.trim();

    const params: any[] = [];
    const conditions: string[] = [];
    let orderExpr = 'medicine_name ASC';

    if (medicineNameSearch) {
      // Normalize search query for accent-insensitive and word flexible regex matching
      const cleanQuery = removeAccents(medicineNameSearch.toLowerCase());
      const words = cleanQuery.split(/[\s-]+/).filter(Boolean);
      const regexPattern = words.join('[\\s-]*');
      const regexWordBoundaryPattern = '\\y' + regexPattern;

      params.push(cleanQuery); // $1
      const pQuery = `$1::text`;

      params.push(regexWordBoundaryPattern); // $2
      const pWordBoundary = `$2::text`;

      params.push(regexPattern); // $3
      const pRegex = `$3::text`;

      // Match in medicine_name or composition (utilizing indexes)
      let searchCond = `(
        lower(public.immutable_unaccent(medicine_name)) ~* ${pRegex}
        OR lower(public.immutable_unaccent(composition)) ~* ${pRegex}
      )`;

      // Apply similarity & phonetics for query lengths >= 4 (utilizing indexes)
      if (cleanQuery.length >= 4) {
        searchCond = `(
          ${searchCond}
          OR lower(public.immutable_unaccent(medicine_name)) % ${pQuery}
          OR soundex(lower(public.immutable_unaccent(medicine_name))) = soundex(lower(public.immutable_unaccent(${pQuery})))
          OR dmetaphone(lower(public.immutable_unaccent(medicine_name))) = dmetaphone(lower(public.immutable_unaccent(${pQuery})))
        )`;
      }

      conditions.push(searchCond);

      // Multi-criteria prioritize sorting
      orderExpr = `
        CASE 
          -- 1. Exact match on medicine_name (ignoring spaces/accents/hyphens)
          WHEN regexp_replace(lower(public.immutable_unaccent(medicine_name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(public.immutable_unaccent(${pQuery})), '[^a-z0-9]', '', 'g') THEN 100
          
          -- 2. Starts with word boundary of search query words on medicine_name
          WHEN lower(public.immutable_unaccent(medicine_name)) ~* ${pWordBoundary} THEN 80
          
          -- 3. Substring match on medicine_name
          WHEN lower(public.immutable_unaccent(medicine_name)) ~* ${pRegex} THEN 60
          
          -- 4. Trigram similarity match on medicine_name (high similarity)
          WHEN similarity(lower(public.immutable_unaccent(medicine_name)), lower(public.immutable_unaccent(${pQuery}))) > 0.4 THEN 40
          
          -- 5. Sound-based match on medicine_name
          WHEN dmetaphone(lower(public.immutable_unaccent(medicine_name))) = dmetaphone(lower(public.immutable_unaccent(${pQuery}))) THEN 35
          WHEN soundex(lower(public.immutable_unaccent(medicine_name))) = soundex(lower(public.immutable_unaccent(${pQuery}))) THEN 30
          
          -- 6. Composition match (contains the regex pattern)
          WHEN lower(public.immutable_unaccent(composition)) ~* ${pRegex} THEN 20
          
          ELSE 10
        END DESC,
        similarity(lower(public.immutable_unaccent(medicine_name)), lower(public.immutable_unaccent(${pQuery}))) DESC,
        medicine_name ASC
      `;
    }

    if (compositionSearch) {
      const cleanComp = removeAccents(compositionSearch.toLowerCase());
      const words = cleanComp.split(/[\s-]+/).filter(Boolean);
      const regexPattern = words.join('[\\s-]*');

      params.push(regexPattern);
      conditions.push(
        `lower(public.immutable_unaccent(composition)) ~* $${params.length}::text`
      );
    }

    let whereClause = '';
    if (conditions.length > 0) {
      whereClause = ' WHERE ' + conditions.join(' AND ');
    }

    // Prepare count query with dummy check to keep parameters binding consistent
    let countWhereExtra = '';
    if (medicineNameSearch) {
      countWhereExtra = ' AND ($1::text IS NOT NULL AND $2::text IS NOT NULL)';
    }
    const countStr = `SELECT COUNT(*) FROM medicine_data${whereClause}${countWhereExtra}`;
    const countParams = [...params];

    params.push(limit);
    const limitPlaceholder = `$${params.length}`;
    params.push(offset);
    const offsetPlaceholder = `$${params.length}`;

    const queryStr = `SELECT medicine_name, manufacturer_name, composition, source FROM medicine_data${whereClause} ORDER BY ${orderExpr} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`;
    const queryParams = [...params];

    // Execute query and count
    const dataPromise = medicineQueryClient.unsafe(queryStr, queryParams);
    const countPromise = medicineQueryClient.unsafe(countStr, countParams);

    const [data, countResult] = await Promise.all([dataPromise, countPromise]);

    const totalCount = Number(countResult[0]?.count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    return {
      data,
      pagination: {
        totalRecords: totalCount,
        totalPages,
        currentPage: page,
        pageSize: limit,
      },
    };
  }
}
