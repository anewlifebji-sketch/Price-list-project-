/**
 * Backup Validator & Transactional Parsing Pipeline
 * Enforces strict constraints, type safety, UUID uniqueness, category reference integrity,
 * strict price type checking, size limitations, and schema verification for import and storage.
 *
 * Strict Separation:
 *  1. validateCurrentPayloadStrict: Validates current schema v2 payloads without silent auto-repairs.
 *  2. migrateAndValidateStorePayload: Safely migrates known older schemas (v1) and strictly validates current schemas.
 *  3. validateBackupFileRaw: Reads raw backup file text, parses JSON, and validates.
 */

import {
  CURRENT_SCHEMA_VERSION,
  APP_VERSION,
  VALIDATION_LIMITS,
  StoreDataPayload,
  Category,
  Item,
  Result,
  CurrencyCode,
  DEFAULT_UNCATEGORIZED_CATEGORY,
} from "../types/store";
import { generateUUID } from "../utils/helpers";

/**
 * Validate a raw string (e.g. uploaded file or storage text)
 */
export function validateBackupFileRaw(
  rawText: string,
  fileSizeBytes?: number,
  defaultCurrency: CurrencyCode = "TOMAN"
): Result<StoreDataPayload> {
  // 1. File Size Verification
  if (fileSizeBytes !== undefined && fileSizeBytes > VALIDATION_LIMITS.MAX_BACKUP_FILE_BYTES) {
    return {
      success: false,
      error: {
        type: "IMPORT_VALIDATION",
        message: `File size exceeds the maximum limit of ${
          VALIDATION_LIMITS.MAX_BACKUP_FILE_BYTES / (1024 * 1024)
        }MB.`,
        errors: [`File size: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`],
      },
    };
  }

  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    return {
      success: false,
      error: {
        type: "IMPORT_VALIDATION",
        message: "The backup file is empty or invalid.",
        errors: ["Zero bytes received."],
      },
    };
  }

  // 2. JSON Parse Attempt
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawText);
  } catch (parseErr: any) {
    return {
      success: false,
      error: {
        type: "IMPORT_VALIDATION",
        message: "Invalid JSON format in backup file.",
        errors: [parseErr?.message || "Syntax error while parsing JSON"],
      },
    };
  }

  return migrateAndValidateStorePayload(rawJson, defaultCurrency);
}

/**
 * Strict validation for current schema payload (Schema v2).
 * Used by saveAtomic to ensure no corrupt or malformed state ever enters storage.
 * Does NOT perform silent conversions (no null -> 0, "" -> 0, true -> 1).
 */
export function validateCurrentPayloadStrict(payload: unknown): Result<StoreDataPayload> {
  const errors: string[] = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      success: false,
      error: {
        type: "VALIDATION",
        field: "root",
        message: "Store data payload must be a non-null JSON object.",
      },
    };
  }

  const p = payload as Record<string, any>;

  // 1. Schema Version Check
  if (p.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return {
      success: false,
      error: {
        type: "VALIDATION",
        field: "schemaVersion",
        message: `Payload schema version mismatch: expected ${CURRENT_SCHEMA_VERSION}, received ${p.schemaVersion}.`,
      },
    };
  }

  // 2. Categories Validation
  if (!Array.isArray(p.categories)) {
    return {
      success: false,
      error: {
        type: "VALIDATION",
        field: "categories",
        message: "Payload must contain a 'categories' array.",
      },
    };
  }

  const categoryIdSet = new Set<string>();
  const categoryNameLowerSet = new Set<string>();
  const validCategories: Category[] = [];

  for (let i = 0; i < p.categories.length; i++) {
    const cat = p.categories[i];
    if (!cat || typeof cat !== "object" || Array.isArray(cat)) {
      errors.push(`Category at index ${i} is not a valid object.`);
      continue;
    }

    if (typeof cat.id !== "string" || cat.id.trim().length === 0) {
      errors.push(`Category at index ${i} must have a non-empty string ID.`);
      continue;
    }

    const catId = cat.id.trim();
    if (categoryIdSet.has(catId)) {
      errors.push(`Duplicate category ID '${catId}' found.`);
      continue;
    }
    categoryIdSet.add(catId);

    if (typeof cat.name !== "string" || cat.name.trim().length === 0) {
      errors.push(`Category '${catId}' has an empty or invalid name.`);
      continue;
    }

    const catName = cat.name.trim();
    if (catName.length > VALIDATION_LIMITS.MAX_CATEGORY_NAME_LENGTH) {
      errors.push(`Category '${catName}' name exceeds maximum length of ${VALIDATION_LIMITS.MAX_CATEGORY_NAME_LENGTH}.`);
      continue;
    }

    const lowerName = catName.toLowerCase();
    if (categoryNameLowerSet.has(lowerName)) {
      errors.push(`Duplicate category name '${catName}' found.`);
      continue;
    }
    categoryNameLowerSet.add(lowerName);

    let color: string | undefined = undefined;
    if (cat.color !== undefined) {
      if (typeof cat.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(cat.color)) {
        errors.push(`Category '${catName}' has invalid hex color: ${JSON.stringify(cat.color)}.`);
        continue;
      }
      color = cat.color;
    } else {
      color = catId === DEFAULT_UNCATEGORIZED_CATEGORY.id ? DEFAULT_UNCATEGORIZED_CATEGORY.color : "#0284c7";
    }

    if (cat.isDefault !== undefined && typeof cat.isDefault !== "boolean") {
      errors.push(`Category '${catName}' has non-boolean isDefault: ${JSON.stringify(cat.isDefault)}.`);
      continue;
    }

    validCategories.push({
      id: catId,
      name: catName,
      color,
      isDefault: Boolean(cat.isDefault) || catId === DEFAULT_UNCATEGORIZED_CATEGORY.id,
    });
  }

  // Ensure default uncategorized category exists
  if (!categoryIdSet.has(DEFAULT_UNCATEGORIZED_CATEGORY.id)) {
    validCategories.unshift(DEFAULT_UNCATEGORIZED_CATEGORY);
    categoryIdSet.add(DEFAULT_UNCATEGORIZED_CATEGORY.id);
  }

  // 3. Items Validation
  if (!Array.isArray(p.items)) {
    return {
      success: false,
      error: {
        type: "VALIDATION",
        field: "items",
        message: "Payload must contain an 'items' array.",
      },
    };
  }

  const itemIdSet = new Set<string>();
  const validItems: Item[] = [];

  for (let i = 0; i < p.items.length; i++) {
    const it = p.items[i];
    if (!it || typeof it !== "object" || Array.isArray(it)) {
      errors.push(`Item at index ${i} is not a valid object.`);
      continue;
    }

    if (typeof it.id !== "string" || it.id.trim().length === 0) {
      errors.push(`Item at index ${i} must have a non-empty string ID.`);
      continue;
    }

    const itemId = it.id.trim();
    if (itemIdSet.has(itemId)) {
      errors.push(`Duplicate item ID '${itemId}' at index ${i}.`);
      continue;
    }
    itemIdSet.add(itemId);

    if (typeof it.name !== "string" || it.name.trim().length === 0) {
      errors.push(`Item at index ${i} (ID: ${itemId}) has an empty or invalid name.`);
      continue;
    }

    const itemName = it.name.trim();
    if (itemName.length > VALIDATION_LIMITS.MAX_ITEM_NAME_LENGTH) {
      errors.push(`Item '${itemName}' name exceeds maximum length of ${VALIDATION_LIMITS.MAX_ITEM_NAME_LENGTH}.`);
      continue;
    }

    if (typeof it.categoryId !== "string" || !categoryIdSet.has(it.categoryId.trim())) {
      errors.push(`Item '${itemName}' references non-existent category ID '${it.categoryId}'.`);
      continue;
    }
    const categoryId = it.categoryId.trim();

    // Strict Price Validation - No automatic type coercion (reject boolean, object, null, NaN, strings)
    const validatePriceField = (val: unknown, fieldName: string): { valid: boolean; num?: number } => {
      if (val === undefined) return { valid: true };
      if (typeof val !== "number" || isNaN(val) || !Number.isFinite(val)) {
        errors.push(`Item '${itemName}' has non-numeric ${fieldName}: ${JSON.stringify(val)}.`);
        return { valid: false };
      }
      if (val < VALIDATION_LIMITS.MIN_PRICE || val > VALIDATION_LIMITS.MAX_PRICE) {
        errors.push(`Item '${itemName}' has ${fieldName} out of range [${VALIDATION_LIMITS.MIN_PRICE}, ${VALIDATION_LIMITS.MAX_PRICE}]: ${val}.`);
        return { valid: false };
      }
      return { valid: true, num: Math.round(val * 100) / 100 };
    };

    const tomanCheck = validatePriceField(it.priceToman, "priceToman");
    const usdCheck = validatePriceField(it.priceUsd, "priceUsd");

    let legacyPriceCheck: { valid: boolean; num?: number } = { valid: true };
    if (it.price !== undefined) {
      legacyPriceCheck = validatePriceField(it.price, "price");
    }

    if (!tomanCheck.valid || !usdCheck.valid || !legacyPriceCheck.valid) {
      continue;
    }

    const priceToman = tomanCheck.num;
    const priceUsd = usdCheck.num;

    if (priceToman === undefined && priceUsd === undefined && legacyPriceCheck.num === undefined) {
      errors.push(`Item '${itemName}' must specify at least one valid price (Toman, USD, or both).`);
      continue;
    }

    const legacyPrice = priceToman ?? (priceUsd ?? (legacyPriceCheck.num || 0));

    // Synonyms validation
    let synonyms: string[] = [];
    if (it.synonyms !== undefined) {
      if (!Array.isArray(it.synonyms)) {
        errors.push(`Item '${itemName}' synonyms must be an array of strings.`);
        continue;
      }
      if (it.synonyms.length > VALIDATION_LIMITS.MAX_SYNONYMS_COUNT) {
        errors.push(`Item '${itemName}' exceeds max synonyms count of ${VALIDATION_LIMITS.MAX_SYNONYMS_COUNT}.`);
        continue;
      }
      for (const syn of it.synonyms) {
        if (typeof syn !== "string") {
          errors.push(`Item '${itemName}' has invalid non-string synonym: ${JSON.stringify(syn)}.`);
          continue;
        }
        const s = syn.trim();
        if (s.length > VALIDATION_LIMITS.MAX_SYNONYM_LENGTH) {
          errors.push(`Item '${itemName}' synonym '${s}' exceeds max length of ${VALIDATION_LIMITS.MAX_SYNONYM_LENGTH}.`);
          continue;
        }
        if (s.length > 0) {
          synonyms.push(s);
        }
      }
    }

    // Strict orderIndex check: no silent default to index i
    if (
      it.orderIndex === undefined ||
      typeof it.orderIndex !== "number" ||
      !Number.isInteger(it.orderIndex) ||
      it.orderIndex < 0
    ) {
      errors.push(`Item '${itemName}' has invalid or missing orderIndex: ${JSON.stringify(it.orderIndex)}.`);
      continue;
    }
    const orderIndex = it.orderIndex;

    // Strict updatedAt check: no silent default to Date.now()
    if (
      it.updatedAt === undefined ||
      typeof it.updatedAt !== "number" ||
      !Number.isFinite(it.updatedAt) ||
      it.updatedAt <= 0
    ) {
      errors.push(`Item '${itemName}' has invalid or missing updatedAt: ${JSON.stringify(it.updatedAt)}.`);
      continue;
    }
    const updatedAt = it.updatedAt;

    let unit: string | undefined = undefined;
    if (it.unit !== undefined) {
      if (typeof it.unit !== "string") {
        errors.push(`Item '${itemName}' unit must be a string.`);
        continue;
      }
      unit = it.unit.trim() || undefined;
    }

    let barcode: string | undefined = undefined;
    if (it.barcode !== undefined) {
      if (typeof it.barcode !== "string") {
        errors.push(`Item '${itemName}' barcode must be a string.`);
        continue;
      }
      barcode = it.barcode.trim() || undefined;
    }

    let notes: string | undefined = undefined;
    if (it.notes !== undefined) {
      if (typeof it.notes !== "string") {
        errors.push(`Item '${itemName}' notes must be a string.`);
        continue;
      }
      if (it.notes.length > VALIDATION_LIMITS.MAX_NOTES_LENGTH) {
        errors.push(`Item '${itemName}' notes exceed max length of ${VALIDATION_LIMITS.MAX_NOTES_LENGTH}.`);
        continue;
      }
      notes = it.notes.trim() || undefined;
    }

    validItems.push({
      id: itemId,
      name: itemName,
      categoryId,
      price: legacyPrice,
      priceToman,
      priceUsd,
      unit,
      synonyms: Array.from(new Set(synonyms)),
      barcode,
      notes,
      updatedAt,
      orderIndex,
    });
  }

  // Validate metadata if present
  let metadataCurrency: CurrencyCode = "TOMAN";
  if (p.metadata !== undefined) {
    if (!p.metadata || typeof p.metadata !== "object" || Array.isArray(p.metadata)) {
      errors.push("Payload metadata must be an object.");
    } else {
      if (p.metadata.currency !== undefined) {
        if (p.metadata.currency !== "TOMAN" && p.metadata.currency !== "USD") {
          errors.push(`Payload metadata currency must be 'TOMAN' or 'USD', received: ${JSON.stringify(p.metadata.currency)}.`);
        } else {
          metadataCurrency = p.metadata.currency;
        }
      }
      if (
        p.metadata.totalItems !== undefined &&
        (typeof p.metadata.totalItems !== "number" || !Number.isInteger(p.metadata.totalItems) || p.metadata.totalItems < 0)
      ) {
        errors.push("Payload metadata totalItems must be a non-negative integer.");
      }
      if (
        p.metadata.totalCategories !== undefined &&
        (typeof p.metadata.totalCategories !== "number" || !Number.isInteger(p.metadata.totalCategories) || p.metadata.totalCategories < 0)
      ) {
        errors.push("Payload metadata totalCategories must be a non-negative integer.");
      }
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      error: {
        type: "VALIDATION",
        field: "payload",
        message: `Validation failed with ${errors.length} error(s): ${errors.join("; ")}`,
      },
    };
  }

  const cleanedPayload: StoreDataPayload = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: typeof p.appVersion === "string" && p.appVersion.trim().length > 0 ? p.appVersion.trim() : APP_VERSION,
    exportedAt: typeof p.exportedAt === "string" && p.exportedAt.trim().length > 0 ? p.exportedAt.trim() : new Date().toISOString(),
    categories: validCategories,
    items: validItems,
    metadata: {
      totalItems: validItems.length,
      totalCategories: validCategories.length,
      currency: metadataCurrency,
    },
  };

  return { success: true, data: cleanedPayload };
}

/**
 * Migrate known older schemas (e.g. v1) or validate current schema (v2).
 * Used for importing backups, loading storage, or restoring snapshots.
 * Does NOT perform arbitrary numeric currency guessing.
 */
export function migrateAndValidateStorePayload(
  rawJson: unknown,
  defaultCurrency: CurrencyCode = "TOMAN"
): Result<StoreDataPayload> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rawJson || typeof rawJson !== "object") {
    return {
      success: false,
      error: {
        type: "IMPORT_VALIDATION",
        message: "Root JSON entity must be a valid object.",
        errors: ["Expected JSON Object, received " + typeof rawJson],
      },
    };
  }

  let payloadObj: Record<string, any>;
  if (Array.isArray(rawJson)) {
    // Legacy direct item list (Schema v1)
    payloadObj = { schemaVersion: 1, items: rawJson, categories: [] };
  } else {
    payloadObj = rawJson as Record<string, any>;
  }

  // Schema Version & Compatibility Check
  const rawSchema = payloadObj.schemaVersion;
  let schemaVer = 1;

  if (rawSchema !== undefined && rawSchema !== null) {
    if (typeof rawSchema !== "number" || !Number.isInteger(rawSchema) || rawSchema <= 0) {
      return {
        success: false,
        error: {
          type: "IMPORT_VALIDATION",
          message: `Invalid schema version format: ${JSON.stringify(rawSchema)}.`,
          errors: ["Schema version must be a positive integer."],
        },
      };
    }
    schemaVer = rawSchema;
  }

  if (schemaVer > CURRENT_SCHEMA_VERSION) {
    return {
      success: false,
      error: {
        type: "IMPORT_VALIDATION",
        message: `Unsupported backup version (v${schemaVer}). Please upgrade Store Price List to import this file.`,
        errors: [`Current app version supports up to schema v${CURRENT_SCHEMA_VERSION}`],
      },
    };
  }

  // If current schema v2, perform strict validation
  if (schemaVer === CURRENT_SCHEMA_VERSION) {
    const strictRes = validateCurrentPayloadStrict(payloadObj);
    if (!strictRes.success) {
      return {
        success: false,
        error: {
          type: "IMPORT_VALIDATION",
          message: strictRes.error.message,
          errors: [strictRes.error.message],
        },
      };
    }
    return strictRes;
  }

  // Legacy Schema v1 Migration Path
  let rawCategories: any[] = Array.isArray(payloadObj.categories) ? payloadObj.categories : [];
  let rawItems: any[] = Array.isArray(payloadObj.items) ? payloadObj.items : [];

  if (!Array.isArray(payloadObj.items)) {
    return {
      success: false,
      error: {
        type: "IMPORT_VALIDATION",
        message: "Legacy backup does not contain a valid items list.",
        errors: ["Missing 'items' array"],
      },
    };
  }

  const validCategoriesMap = new Map<string, Category>();
  const categoryNameMap = new Map<string, string>(); // lowercase name -> ID
  const seenCategoryIds = new Set<string>();

  validCategoriesMap.set(DEFAULT_UNCATEGORIZED_CATEGORY.id, DEFAULT_UNCATEGORIZED_CATEGORY);
  categoryNameMap.set(DEFAULT_UNCATEGORIZED_CATEGORY.name.toLowerCase(), DEFAULT_UNCATEGORIZED_CATEGORY.id);
  seenCategoryIds.add(DEFAULT_UNCATEGORIZED_CATEGORY.id);

  rawCategories.forEach((rc, idx) => {
    if (!rc || typeof rc !== "object") return;
    const rawId = typeof rc.id === "string" && rc.id.trim().length > 0 ? rc.id.trim() : generateUUID();
    let name = typeof rc.name === "string" ? rc.name.trim() : `Category ${idx + 1}`;
    if (!name) name = `Category ${idx + 1}`;
    if (name.length > VALIDATION_LIMITS.MAX_CATEGORY_NAME_LENGTH) {
      name = name.substring(0, VALIDATION_LIMITS.MAX_CATEGORY_NAME_LENGTH).trim();
    }

    let finalId = rawId;
    if (seenCategoryIds.has(finalId) && finalId !== DEFAULT_UNCATEGORIZED_CATEGORY.id) {
      finalId = generateUUID();
    }
    seenCategoryIds.add(finalId);

    const category: Category = {
      id: finalId,
      name,
      color: typeof rc.color === "string" && /^#[0-9a-fA-F]{6}$/.test(rc.color) ? rc.color : "#64748b",
      isDefault: Boolean(rc.isDefault) || finalId === DEFAULT_UNCATEGORIZED_CATEGORY.id,
    };
    validCategoriesMap.set(finalId, category);
    categoryNameMap.set(name.toLowerCase(), finalId);
  });

  // Scan legacy item category strings
  rawItems.forEach((ri) => {
    if (!ri || typeof ri !== "object") return;
    const catString = typeof ri.category === "string" ? ri.category.trim() : "";
    if (catString && catString.toLowerCase() !== "uncategorized") {
      const lower = catString.toLowerCase();
      if (!categoryNameMap.has(lower)) {
        const newCatId = generateUUID();
        const newCat: Category = {
          id: newCatId,
          name: catString.substring(0, VALIDATION_LIMITS.MAX_CATEGORY_NAME_LENGTH),
          color: "#0284c7",
          isDefault: false,
        };
        validCategoriesMap.set(newCatId, newCat);
        categoryNameMap.set(lower, newCatId);
        seenCategoryIds.add(newCatId);
      }
    }
  });

  // Determine explicit payload-level currency for legacy records
  const legacyCurrency: CurrencyCode =
    payloadObj.metadata?.currency === "USD" || payloadObj.currency === "USD"
      ? "USD"
      : defaultCurrency;

  const validItems: Item[] = [];
  const seenItemIds = new Set<string>();

  rawItems.forEach((ri, idx) => {
    if (!ri || typeof ri !== "object") {
      errors.push(`Item at index ${idx} is not a valid object.`);
      return;
    }

    const rawId = typeof ri.id === "string" && ri.id.trim().length > 0 ? ri.id.trim() : generateUUID();
    const name = typeof ri.name === "string" ? ri.name.trim() : "";
    if (!name) {
      errors.push(`Item at index ${idx} is missing a name.`);
      return;
    }

    // Strict number parser helper for migration
    const parseNumberStrict = (val: unknown, fieldName: string): number | null => {
      if (val === undefined || val === null || val === "") return null;
      if (typeof val === "boolean" || typeof val === "object" || Array.isArray(val)) {
        errors.push(`Item '${name}' has invalid ${fieldName}: ${JSON.stringify(val)}.`);
        return null;
      }
      const num = typeof val === "number" ? val : Number(val);
      if (isNaN(num) || !Number.isFinite(num) || num < VALIDATION_LIMITS.MIN_PRICE) {
        errors.push(`Item '${name}' has negative or invalid ${fieldName}: '${val}'.`);
        return null;
      }
      if (num > VALIDATION_LIMITS.MAX_PRICE) {
        errors.push(`Item '${name}' has ${fieldName} exceeding maximum limit.`);
        return null;
      }
      return Math.round(num * 100) / 100;
    };

    const priceTomanVal = parseNumberStrict(ri.priceToman, "priceToman");
    const priceUsdVal = parseNumberStrict(ri.priceUsd, "priceUsd");
    const rawLegacyPrice = parseNumberStrict(ri.price, "price");

    let finalPriceToman: number | undefined = priceTomanVal !== null ? priceTomanVal : undefined;
    let finalPriceUsd: number | undefined = priceUsdVal !== null ? priceUsdVal : undefined;

    // Explicit currency migration without numeric value guessing
    if (finalPriceToman === undefined && finalPriceUsd === undefined) {
      if (rawLegacyPrice !== null) {
        // Check if item has explicit currency property
        if (ri.currency === "USD" || (ri.currency === undefined && legacyCurrency === "USD")) {
          finalPriceUsd = rawLegacyPrice;
        } else {
          finalPriceToman = rawLegacyPrice;
        }
      } else {
        errors.push(`Item '${name}' must have at least one valid price.`);
        return;
      }
    }

    const legacyPrice = finalPriceToman ?? (finalPriceUsd ?? 0);

    let categoryId = DEFAULT_UNCATEGORIZED_CATEGORY.id;
    if (typeof ri.category === "string") {
      const matchId = categoryNameMap.get(ri.category.trim().toLowerCase());
      if (matchId) categoryId = matchId;
    } else if (typeof ri.categoryId === "string" && validCategoriesMap.has(ri.categoryId.trim())) {
      categoryId = ri.categoryId.trim();
    }

    let synonyms: string[] = [];
    if (Array.isArray(ri.synonyms)) {
      synonyms = ri.synonyms
        .map((s: unknown) => String(s).trim().toLowerCase())
        .filter((s: string) => s.length > 0 && s.length <= VALIDATION_LIMITS.MAX_SYNONYM_LENGTH);
    } else if (typeof ri.synonyms === "string") {
      synonyms = ri.synonyms
        .split(",")
        .map((s: string) => s.trim().toLowerCase())
        .filter((s: string) => s.length > 0 && s.length <= VALIDATION_LIMITS.MAX_SYNONYM_LENGTH);
    }

    let finalItemId = rawId;
    if (seenItemIds.has(finalItemId)) {
      finalItemId = generateUUID();
    }
    seenItemIds.add(finalItemId);

    validItems.push({
      id: finalItemId,
      name: name.substring(0, VALIDATION_LIMITS.MAX_ITEM_NAME_LENGTH),
      categoryId,
      price: legacyPrice,
      priceToman: finalPriceToman,
      priceUsd: finalPriceUsd,
      unit: typeof ri.unit === "string" ? ri.unit.trim() || undefined : undefined,
      synonyms: Array.from(new Set(synonyms)).slice(0, VALIDATION_LIMITS.MAX_SYNONYMS_COUNT),
      barcode: typeof ri.barcode === "string" ? ri.barcode.trim() || undefined : undefined,
      notes: typeof ri.notes === "string" ? ri.notes.substring(0, VALIDATION_LIMITS.MAX_NOTES_LENGTH).trim() || undefined : undefined,
      updatedAt: typeof ri.updatedAt === "number" && !isNaN(ri.updatedAt) ? ri.updatedAt : Date.now(),
      orderIndex: typeof ri.orderIndex === "number" ? ri.orderIndex : idx,
    });
  });

  if (errors.length > 0) {
    return {
      success: false,
      error: {
        type: "IMPORT_VALIDATION",
        message: `Migration failed with ${errors.length} error(s).`,
        errors,
      },
    };
  }

  const finalCategories = Array.from(validCategoriesMap.values());

  const migratedPayload: StoreDataPayload = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: typeof payloadObj.exportedAt === "string" ? payloadObj.exportedAt : new Date().toISOString(),
    categories: finalCategories,
    items: validItems,
    metadata: {
      totalItems: validItems.length,
      totalCategories: finalCategories.length,
      currency: legacyCurrency,
    },
  };

  return { success: true, data: migratedPayload };
}

/**
 * Backward compatibility alias for validateStorePayload
 */
export function validateStorePayload(rawJson: unknown): Result<StoreDataPayload> {
  return migrateAndValidateStorePayload(rawJson);
}
