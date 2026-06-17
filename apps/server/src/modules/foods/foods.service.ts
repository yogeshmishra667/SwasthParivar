import type { FoodCategory, Prisma } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { redis } from "../../shared/redis.js";
import { logger } from "../../shared/logger.js";
import type { FoodSearchLang } from "./foods.validation.js";

// CLAUDE.md "Caching (Redis)": food:search 7d. The reference table is
// effectively static between seeds, so a long TTL is safe; a reseed
// drifts at most one TTL window, which is acceptable for an advisory
// food picker. Key shape per phase4.md §H.3: food:search:${lang}:${q}.
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface FoodSearchResultItem {
  id: string;
  nameEn: string;
  nameHi: string;
  /** Localised display name for the requested lang; falls back to en. */
  displayName: string;
  category: FoodCategory;
  glycemicIndex: number;
  glycemicLoad: number;
  commonInRegions: string[];
}

interface SearchInput {
  q: string;
  lang: FoodSearchLang;
  limit: number;
}

const cacheKey = (lang: string, q: string, limit: number): string =>
  `food:search:${lang}:${limit}:${q.trim().toLowerCase()}`;

/**
 * Resolve the display name for a row in the requested language.
 * Regional languages live in name_regional (JSONB); a missing entry
 * falls back to name_en (§H.1 "missing language → search falls back").
 */
const displayNameFor = (
  lang: FoodSearchLang,
  row: { nameEn: string; nameHi: string; nameRegional: Prisma.JsonValue },
): string => {
  if (lang === "en") return row.nameEn;
  if (lang === "hi") return row.nameHi;
  const regional = row.nameRegional;
  if (regional !== null && typeof regional === "object" && !Array.isArray(regional)) {
    const candidate = (regional as Record<string, unknown>)[lang];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return row.nameEn;
};

export const searchFoodItems = async (input: SearchInput): Promise<FoodSearchResultItem[]> => {
  const key = cacheKey(input.lang, input.q, input.limit);

  // Cache read — best-effort; Redis down must never break search.
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as FoodSearchResultItem[];
    }
  } catch (err) {
    logger.warn({ err, q: input.q }, "food search cache read failed — falling through");
  }

  const prefix = input.q.trim();
  // Prefix match on the two always-present names (btree-backed,
  // case-insensitive). Regional-script queries also hit name_hi/name_en
  // via contains as a widening fallback. At ~220 rows this is sub-ms;
  // the cache exists to spare Redis-warm repeats, not to rescue a slow
  // query.
  const where: Prisma.IndianFoodItemWhereInput = {
    OR: [
      { nameEn: { startsWith: prefix, mode: "insensitive" } },
      { nameHi: { startsWith: prefix, mode: "insensitive" } },
      { nameEn: { contains: prefix, mode: "insensitive" } },
      { nameHi: { contains: prefix, mode: "insensitive" } },
    ],
  };

  const rows = await prisma.indianFoodItem.findMany({
    where,
    select: {
      id: true,
      nameEn: true,
      nameHi: true,
      nameRegional: true,
      category: true,
      glycemicIndex: true,
      glycemicLoad: true,
      commonInRegions: true,
    },
    // Prefix hits should rank above mid-string hits; Postgres can't
    // express that cheaply here, so sort by name and cap. Good enough
    // for an advisory picker at this table size.
    orderBy: { nameEn: "asc" },
    take: input.limit,
  });

  const results: FoodSearchResultItem[] = rows.map((row) => ({
    id: row.id,
    nameEn: row.nameEn,
    nameHi: row.nameHi,
    displayName: displayNameFor(input.lang, row),
    category: row.category,
    glycemicIndex: row.glycemicIndex,
    glycemicLoad: row.glycemicLoad,
    commonInRegions: row.commonInRegions,
  }));

  // Cache write — best-effort.
  try {
    await redis.set(key, JSON.stringify(results), "EX", CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, q: input.q }, "food search cache write failed");
  }

  return results;
};
