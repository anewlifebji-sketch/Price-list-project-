/**
 * Store Price List - Domain Types & Constants
 * Strict type safety for transactional persistence, category management, currency, and backup schemas.
 */

export const CURRENT_SCHEMA_VERSION = 2;
export const APP_VERSION = "2.0.0-release";

export const CATEGORY_ALL_ID = "__ALL__";
export const CATEGORY_UNCATEGORIZED_ID = "cat_uncategorized";

export type CurrencyCode = "USD" | "TOMAN";

export interface UserPreferences {
  currency: CurrencyCode;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  currency: "TOMAN",
};

export const DEFAULT_UNCATEGORIZED_CATEGORY: Category = {
  id: CATEGORY_UNCATEGORIZED_ID,
  name: "Uncategorized",
  color: "#94a3b8",
  isDefault: true,
};

export const INITIAL_DEFAULT_CATEGORIES: Category[] = [
  DEFAULT_UNCATEGORIZED_CATEGORY,
  { id: "cat_produce", name: "Produce & Fruits", color: "#10b981", isDefault: false },
  { id: "cat_dairy", name: "Dairy & Eggs", color: "#f59e0b", isDefault: false },
  { id: "cat_bakery", name: "Bakery & Bread", color: "#d97706", isDefault: false },
  { id: "cat_meat", name: "Meat & Seafood", color: "#ef4444", isDefault: false },
  { id: "cat_beverages", name: "Beverages", color: "#06b6d4", isDefault: false },
  { id: "cat_pantry", name: "Pantry & Spices", color: "#8b5cf6", isDefault: false },
  { id: "cat_household", name: "Household & Cleaning", color: "#64748b", isDefault: false },
];

export const INITIAL_SAMPLE_ITEMS: Item[] = [
  {
    id: "item-init-001",
    name: "Organic Whole Milk (1 Gallon)",
    categoryId: "cat_dairy",
    priceToman: 48000,
    priceUsd: 3.5,
    unit: "gal",
    synonyms: ["milk", "whole milk", "dairy"],
    barcode: "011110416002",
    notes: "Vitamin D fortified",
    updatedAt: Date.now() - 3600000 * 5,
    orderIndex: 0,
  },
  {
    id: "item-init-002",
    name: "Hass Avocados (Bag of 4)",
    categoryId: "cat_produce",
    priceToman: 65000,
    unit: "bag",
    synonyms: ["avocado", "guacamole", "hass"],
    notes: "Ripe when dark green",
    updatedAt: Date.now() - 3600000 * 4,
    orderIndex: 1,
  },
  {
    id: "item-init-003",
    name: "Artisan Sourdough Loaf",
    categoryId: "cat_bakery",
    priceUsd: 2.75,
    unit: "loaf",
    synonyms: ["bread", "sourdough", "bakery"],
    updatedAt: Date.now() - 3600000 * 3,
    orderIndex: 2,
  },
  {
    id: "item-init-004",
    name: "Boneless Chicken Breasts",
    categoryId: "cat_meat",
    priceToman: 185000,
    priceUsd: 6.99,
    unit: "kg",
    synonyms: ["chicken", "poultry", "meat"],
    updatedAt: Date.now() - 3600000 * 2,
    orderIndex: 3,
  },
  {
    id: "item-init-005",
    name: "Cold Brew Arabica Coffee (32oz)",
    categoryId: "cat_beverages",
    priceUsd: 4.25,
    unit: "bottle",
    synonyms: ["coffee", "cold brew", "arabica"],
    updatedAt: Date.now() - 3600000 * 1,
    orderIndex: 4,
  },
  {
    id: "item-init-006",
    name: "Extra Virgin Olive Oil (750ml)",
    categoryId: "cat_pantry",
    priceToman: 320000,
    priceUsd: 11.5,
    unit: "bottle",
    synonyms: ["olive oil", "evoo", "cooking oil"],
    updatedAt: Date.now() - 1800000,
    orderIndex: 5,
  },
  {
    id: "item-init-007",
    name: "Eco Dish Soap Lemon (24oz)",
    categoryId: "cat_household",
    priceToman: 42000,
    unit: "bottle",
    synonyms: ["soap", "dish soap", "cleaning"],
    updatedAt: Date.now() - 900000,
    orderIndex: 6,
  },
];

export const VALIDATION_LIMITS = {
  MAX_ITEM_NAME_LENGTH: 120,
  MAX_CATEGORY_NAME_LENGTH: 60,
  MAX_SYNONYM_LENGTH: 50,
  MAX_SYNONYMS_COUNT: 25,
  MAX_PRICE: 999999999999, // Supports high-denomination currencies safely
  MIN_PRICE: 0.0,
  MAX_NOTES_LENGTH: 500,
  MAX_BACKUP_FILE_BYTES: 10 * 1024 * 1024, // 10MB
};

export interface Category {
  id: string; // Stable UUID
  name: string;
  color?: string;
  isDefault?: boolean;
}

export interface Item {
  id: string; // Stable UUID
  name: string;
  categoryId: string; // Foreign key referencing Category.id
  price?: number; // legacy fallback price
  priceToman?: number; // Price in Toman
  priceUsd?: number; // Price in USD ($)
  unit?: string;
  synonyms: string[]; // Normalized, trimmed string list
  barcode?: string;
  notes?: string;
  updatedAt: number; // UTC timestamp
  orderIndex: number; // Position for custom sorting
}

export interface StoreDataPayload {
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  categories: Category[];
  items: Item[];
  metadata?: {
    totalItems: number;
    totalCategories: number;
    currency: string;
  };
}

export enum SortOrder {
  CUSTOM = "CUSTOM",
  NAME_ASC = "NAME_ASC",
  NAME_DESC = "NAME_DESC",
  PRICE_ASC = "PRICE_ASC",
  PRICE_DESC = "PRICE_DESC",
  RECENT = "RECENT",
}

export type AppError =
  | { type: "VALIDATION"; field: string; message: string }
  | { type: "DUPLICATE"; name: string; message: string }
  | { type: "STORAGE"; message: string; details?: string }
  | { type: "CORRUPTED_DATA"; message: string; rawSnippet?: string }
  | { type: "RECOVERY_MODE"; message: string }
  | { type: "IMPORT_VALIDATION"; message: string; errors: string[] }
  | { type: "CATEGORY_IN_USE"; categoryId: string; itemCount: number; message: string }
  | { type: "NOT_FOUND"; message: string };

export interface SuccessResult<T> {
  success: true;
  data: T;
  error?: undefined;
}

export interface ErrorResult {
  success: false;
  error: AppError;
  data?: undefined;
}

export type Result<T> = SuccessResult<T> | ErrorResult;

export interface BackupSnapshot {
  id: string; // Stable UUID
  timestamp: number;
  dateString: string;
  itemCount: number;
  categoryCount: number;
  jsonData: string;
}

export interface UndoItemAction {
  item: Item;
  previousIndex: number;
  expiryTime: number;
}

export interface NotificationEvent {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title?: string;
  message: string;
  durationMs?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}
