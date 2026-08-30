/**
 * Helper utilities: UUID generator, Locale-independent normalization,
 * currency formatters (Toman & USD), and search ranking algorithms.
 */

import { CurrencyCode, VALIDATION_LIMITS } from "../types/store";

/**
 * Generate cryptographic UUID v4 with fallback
 */
export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122 v4 compliant fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Locale-independent string normalization (equivalent to Kotlin Locale.ROOT lowercasing)
 * Strips diacritics where helpful and trims extra whitespace.
 */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return String(input)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip combining accents for consistent matching
}

/**
 * Clean, trim, and deduplicate list of synonym aliases
 */
export function sanitizeSynonyms(rawList: string[] | string): string[] {
  let list: string[] = [];
  if (Array.isArray(rawList)) {
    list = rawList;
  } else if (typeof rawList === "string") {
    list = rawList.split(",");
  }

  const cleaned = list
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= VALIDATION_LIMITS.MAX_SYNONYM_LENGTH);

  // Deduplicate while preserving first casing or lowercase
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of cleaned) {
    const key = normalizeText(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result.slice(0, VALIDATION_LIMITS.MAX_SYNONYMS_COUNT);
}

/**
 * Clean and fast currency price formatter for USD and TOMAN
 */
export function formatPrice(amount: number, currency: CurrencyCode = "TOMAN"): string {
  if (typeof amount !== "number" || isNaN(amount) || !Number.isFinite(amount)) {
    return currency === "USD" ? "$0.00" : "0 Toman";
  }
  const positive = Math.max(0, amount);

  if (currency === "USD") {
    return `$${positive.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  // TOMAN: Display formatted with commas + "Toman" suffix
  const isInteger = Math.floor(positive) === positive;
  return `${positive.toLocaleString("en-US", {
    minimumFractionDigits: isInteger ? 0 : 2,
    maximumFractionDigits: 2,
  })} Toman`;
}

export interface ItemPriceDisplayInfo {
  hasToman: boolean;
  hasUsd: boolean;
  hasBoth: boolean;
  tomanFormatted?: string;
  usdFormatted?: string;
  displayText: string;
}

/**
 * Format item price(s) with full support for Toman only, USD only, or both
 */
export function formatItemPrices(item: {
  priceToman?: number;
  priceUsd?: number;
  price?: number;
}): ItemPriceDisplayInfo {
  const hasToman =
    item.priceToman !== undefined &&
    item.priceToman !== null &&
    !isNaN(item.priceToman) &&
    item.priceToman >= 0;

  const hasUsd =
    item.priceUsd !== undefined &&
    item.priceUsd !== null &&
    !isNaN(item.priceUsd) &&
    item.priceUsd >= 0;

  // If neither modern field is set, check legacy `price` using fallback formatting
  if (!hasToman && !hasUsd && typeof item.price === "number" && !isNaN(item.price)) {
    const tomanFormatted = formatPrice(item.price, "TOMAN");
    return {
      hasToman: true,
      hasUsd: false,
      hasBoth: false,
      tomanFormatted,
      displayText: tomanFormatted,
    };
  }

  const tomanFormatted = hasToman ? formatPrice(item.priceToman!, "TOMAN") : undefined;
  const usdFormatted = hasUsd ? formatPrice(item.priceUsd!, "USD") : undefined;

  let displayText = "Free / No Price";
  if (hasToman && hasUsd) {
    displayText = `${usdFormatted} • ${tomanFormatted}`;
  } else if (hasToman) {
    displayText = tomanFormatted!;
  } else if (hasUsd) {
    displayText = usdFormatted!;
  }

  return {
    hasToman,
    hasUsd,
    hasBoth: hasToman && hasUsd,
    tomanFormatted,
    usdFormatted,
    displayText,
  };
}

/**
 * Legacy alias for formatPrice
 */
export function formatCurrency(amount: number, currencySymbol: string = "$"): string {
  if (currencySymbol === "Toman" || currencySymbol === "TOMAN") {
    return formatPrice(amount, "TOMAN");
  }
  return formatPrice(amount, "USD");
}

/**
 * Format relative / readable date
 */
export function formatRelativeDate(timestamp: number): string {
  if (!timestamp) return "Never";
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 45) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Multi-token deterministic match check
 */
export function matchesSearchQuery(
  searchQuery: string,
  fields: {
    name: string;
    categoryName?: string;
    synonyms?: string[];
    barcode?: string;
    notes?: string;
  }
): boolean {
  const query = normalizeText(searchQuery);
  if (!query) return true;

  // Split query into tokens for multi-word search (all tokens must match)
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const targetTokens: string[] = [
    normalizeText(fields.name),
    normalizeText(fields.categoryName || ""),
    normalizeText(fields.barcode || ""),
    normalizeText(fields.notes || ""),
    ...(fields.synonyms || []).map((s) => normalizeText(s)),
  ];

  const fullTargetString = targetTokens.join(" ");

  return tokens.every((token) => fullTargetString.includes(token));
}
