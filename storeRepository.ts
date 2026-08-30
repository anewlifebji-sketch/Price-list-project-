/**
 * Store Repository
 * Transactional business logic layer:
 *  - Validate -> Persist Atomic -> State Transition (State only publishes after verified storage write)
 *  - Crash-safe rollbacks on failure
 *  - Snapshot synchronicity on restore
 *  - Reorder determinism in filtered views
 *  - Stable Category ID management & safe deletion reassignments
 *  - Duplicate detection with Locale.ROOT normalization
 */

import {
  Category,
  Item,
  StoreDataPayload,
  Result,
  CurrencyCode,
  BackupSnapshot,
  UndoItemAction,
  CATEGORY_UNCATEGORIZED_ID,
  VALIDATION_LIMITS,
  CURRENT_SCHEMA_VERSION,
  APP_VERSION,
  DEFAULT_UNCATEGORIZED_CATEGORY,
} from "../types/store";
import { AtomicStorageEngine } from "./storage";
import { validateBackupFileRaw, validateCurrentPayloadStrict } from "./backupValidator";
import { generateUUID, normalizeText, sanitizeSynonyms } from "../utils/helpers";

export class StoreRepository {
  private storageEngine: AtomicStorageEngine;
  private currentPayload: StoreDataPayload;
  private currentCurrency: CurrencyCode;
  private inRecoveryMode: boolean = false;
  private recoveryReason: string | null = null;

  constructor() {
    this.storageEngine = AtomicStorageEngine.getInstance();
    const loadRes = this.storageEngine.load();
    if (loadRes.success) {
      this.currentPayload = loadRes.data;
      this.currentCurrency = loadRes.data.metadata?.currency === "USD" ? "USD" : "TOMAN";
      this.inRecoveryMode = false;
      this.recoveryReason = null;
    } else {
      // Enter explicit Recovery Mode when primary storage is corrupted or unreadable
      this.inRecoveryMode = true;
      this.recoveryReason = loadRes.error.message;
      this.currentCurrency = "TOMAN";
      this.currentPayload = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        appVersion: APP_VERSION,
        exportedAt: new Date().toISOString(),
        categories: [DEFAULT_UNCATEGORIZED_CATEGORY],
        items: [],
        metadata: {
          totalItems: 0,
          totalCategories: 1,
          currency: this.currentCurrency,
        },
      };
    }
  }

  public isInRecoveryMode(): boolean {
    return this.inRecoveryMode;
  }

  public getRecoveryReason(): string | null {
    return this.recoveryReason;
  }

  private checkRecoveryBlocked(actionName: string): Result<never> | null {
    if (this.inRecoveryMode) {
      return {
        success: false,
        error: {
          type: "RECOVERY_MODE",
          message: `Operation '${actionName}' is blocked because the application is in Recovery Mode. You must restore a valid Snapshot or explicitly reset the store.`,
        },
      };
    }
    return null;
  }

  public getPayload(): StoreDataPayload {
    return this.currentPayload;
  }

  public getItems(): Item[] {
    return [...this.currentPayload.items];
  }

  public getCategories(): Category[] {
    return [...this.currentPayload.categories];
  }

  public getCategoryById(id: string): Category | undefined {
    return this.currentPayload.categories.find((c) => c.id === id);
  }

  public getCurrency(): CurrencyCode {
    return this.currentCurrency;
  }

  public setCurrency(currency: CurrencyCode): Result<void> {
    const recoveryBlock = this.checkRecoveryBlocked("Change Currency");
    if (recoveryBlock) return recoveryBlock;

    if (currency !== "USD" && currency !== "TOMAN") {
      return {
        success: false,
        error: {
          type: "VALIDATION",
          field: "currency",
          message: `Invalid currency code: ${currency}. Must be 'TOMAN' or 'USD'.`,
        },
      };
    }

    // 1. Construct the new state with metadata.currency as the single source of truth
    const updatedPayload: StoreDataPayload = {
      ...this.currentPayload,
      exportedAt: new Date().toISOString(),
      metadata: {
        totalItems: this.currentPayload.items.length,
        totalCategories: this.currentPayload.categories.length,
        currency,
      },
    };

    // 2. Validate it strictly
    const valRes = validateCurrentPayloadStrict(updatedPayload);
    if (!valRes.success) {
      return { success: false, error: valRes.error };
    }

    // 3. Persist atomically to PRIMARY storage key in a single transaction
    const saveRes = this.storageEngine.saveAtomic(valRes.data, this.currentPayload);
    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }

    // 4. Only after persistence succeeds, update in-memory state
    this.currentCurrency = currency;
    this.currentPayload = valRes.data;
    return { success: true, data: undefined };
  }

  /**
   * Add Item transactionally:
   * 1. Validate inputs (name & at least one price in Toman or USD)
   * 2. Construct new state
   * 3. Atomically persist with pre-mutation snapshot
   * 4. Publish / mutate in-memory state on success only
   */
  public addItem(data: {
    name: string;
    categoryId: string;
    priceToman?: number;
    priceUsd?: number;
    price?: number;
    unit?: string;
    synonyms?: string[] | string;
    barcode?: string;
    notes?: string;
  }): Result<Item> {
    const recoveryBlock = this.checkRecoveryBlocked("Add Item");
    if (recoveryBlock) return recoveryBlock;

    const trimmedName = (data.name || "").trim();

    // 1. Validation
    if (!trimmedName) {
      return {
        success: false,
        error: { type: "VALIDATION", field: "name", message: "Item name cannot be empty." },
      };
    }

    if (trimmedName.length > VALIDATION_LIMITS.MAX_ITEM_NAME_LENGTH) {
      return {
        success: false,
        error: {
          type: "VALIDATION",
          field: "name",
          message: `Item name cannot exceed ${VALIDATION_LIMITS.MAX_ITEM_NAME_LENGTH} characters.`,
        },
      };
    }

    const hasToman = data.priceToman !== undefined && data.priceToman !== null && !isNaN(data.priceToman);
    const hasUsd = data.priceUsd !== undefined && data.priceUsd !== null && !isNaN(data.priceUsd);
    const hasLegacy = data.price !== undefined && data.price !== null && !isNaN(data.price);

    if (!hasToman && !hasUsd && !hasLegacy) {
      return {
        success: false,
        error: {
          type: "VALIDATION",
          field: "price",
          message: "Please enter a valid price in Toman, USD, or both.",
        },
      };
    }

    if (hasToman && (data.priceToman! < VALIDATION_LIMITS.MIN_PRICE || data.priceToman! > VALIDATION_LIMITS.MAX_PRICE)) {
      return {
        success: false,
        error: {
          type: "VALIDATION",
          field: "priceToman",
          message: `Toman price must be between 0 and ${VALIDATION_LIMITS.MAX_PRICE.toLocaleString()}.`,
        },
      };
    }

    if (hasUsd && (data.priceUsd! < VALIDATION_LIMITS.MIN_PRICE || data.priceUsd! > VALIDATION_LIMITS.MAX_PRICE)) {
      return {
        success: false,
        error: {
          type: "VALIDATION",
          field: "priceUsd",
          message: `USD price must be between 0 and ${VALIDATION_LIMITS.MAX_PRICE.toLocaleString()}.`,
        },
      };
    }

    const priceToman = hasToman ? Math.round(data.priceToman! * 100) / 100 : undefined;
    const priceUsd = hasUsd ? Math.round(data.priceUsd! * 100) / 100 : undefined;
    const legacyPrice = priceToman ?? (priceUsd ?? (data.price || 0));

    // Category Reference check
    let categoryId = data.categoryId;
    const categoryExists = this.currentPayload.categories.some((c) => c.id === categoryId);
    if (!categoryExists) {
      categoryId = CATEGORY_UNCATEGORIZED_ID;
    }

    // Duplicate Name check (case-insensitive in category)
    const normName = normalizeText(trimmedName);
    const isDuplicate = this.currentPayload.items.some(
      (it) => normalizeText(it.name) === normName && it.categoryId === categoryId
    );
    if (isDuplicate) {
      return {
        success: false,
        error: {
          type: "DUPLICATE",
          name: trimmedName,
          message: `An item named '${trimmedName}' already exists in this category.`,
        },
      };
    }

    // Clean synonyms
    const cleanSynonyms = sanitizeSynonyms(data.synonyms || []);

    const newItem: Item = {
      id: generateUUID(),
      name: trimmedName,
      categoryId,
      price: legacyPrice,
      priceToman,
      priceUsd,
      unit: data.unit ? data.unit.trim() : undefined,
      synonyms: cleanSynonyms,
      barcode: data.barcode ? data.barcode.trim() : undefined,
      notes: data.notes ? data.notes.trim() : undefined,
      updatedAt: Date.now(),
      orderIndex: this.currentPayload.items.length,
    };

    // Construct new state
    const newItems = [...this.currentPayload.items, newItem];
    const newPayload: StoreDataPayload = {
      ...this.currentPayload,
      items: newItems,
      exportedAt: new Date().toISOString(),
      metadata: {
        totalItems: newItems.length,
        totalCategories: this.currentPayload.categories.length,
        currency: this.currentCurrency,
      },
    };

    // 2. Persist with pre-mutation snapshot of previous state
    const saveRes = this.storageEngine.saveAtomic(newPayload, this.currentPayload);
    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }

    // 3. Publish to in-memory state only after successful persist
    this.currentPayload = newPayload;
    return { success: true, data: newItem };
  }

  /**
   * Edit Item transactionally
   */
  public updateItem(
    itemId: string,
    data: {
      name: string;
      categoryId: string;
      priceToman?: number;
      priceUsd?: number;
      price?: number;
      unit?: string;
      synonyms?: string[] | string;
      barcode?: string;
      notes?: string;
    }
  ): Result<Item> {
    const recoveryBlock = this.checkRecoveryBlocked("Edit Item");
    if (recoveryBlock) return recoveryBlock;

    const itemIndex = this.currentPayload.items.findIndex((it) => it.id === itemId);
    if (itemIndex === -1) {
      return {
        success: false,
        error: { type: "NOT_FOUND", message: `Item with ID ${itemId} not found.` },
      };
    }

    const trimmedName = (data.name || "").trim();
    if (!trimmedName) {
      return {
        success: false,
        error: { type: "VALIDATION", field: "name", message: "Item name cannot be empty." },
      };
    }

    if (trimmedName.length > VALIDATION_LIMITS.MAX_ITEM_NAME_LENGTH) {
      return {
        success: false,
        error: {
          type: "VALIDATION",
          field: "name",
          message: `Item name cannot exceed ${VALIDATION_LIMITS.MAX_ITEM_NAME_LENGTH} characters.`,
        },
      };
    }

    const hasToman = data.priceToman !== undefined && data.priceToman !== null && !isNaN(data.priceToman);
    const hasUsd = data.priceUsd !== undefined && data.priceUsd !== null && !isNaN(data.priceUsd);
    const hasLegacy = data.price !== undefined && data.price !== null && !isNaN(data.price);

    if (!hasToman && !hasUsd && !hasLegacy) {
      return {
        success: false,
        error: {
          type: "VALIDATION",
          field: "price",
          message: "Please enter a valid price in Toman, USD, or both.",
        },
      };
    }

    if (hasToman && (data.priceToman! < VALIDATION_LIMITS.MIN_PRICE || data.priceToman! > VALIDATION_LIMITS.MAX_PRICE)) {
      return {
        success: false,
        error: {
          type: "VALIDATION",
          field: "priceToman",
          message: `Toman price must be between 0 and ${VALIDATION_LIMITS.MAX_PRICE.toLocaleString()}.`,
        },
      };
    }

    if (hasUsd && (data.priceUsd! < VALIDATION_LIMITS.MIN_PRICE || data.priceUsd! > VALIDATION_LIMITS.MAX_PRICE)) {
      return {
        success: false,
        error: {
          type: "VALIDATION",
          field: "priceUsd",
          message: `USD price must be between 0 and ${VALIDATION_LIMITS.MAX_PRICE.toLocaleString()}.`,
        },
      };
    }

    const priceToman = hasToman ? Math.round(data.priceToman! * 100) / 100 : undefined;
    const priceUsd = hasUsd ? Math.round(data.priceUsd! * 100) / 100 : undefined;
    const legacyPrice = priceToman ?? (priceUsd ?? (data.price || 0));

    // Category Reference check
    let categoryId = data.categoryId;
    const categoryExists = this.currentPayload.categories.some((c) => c.id === categoryId);
    if (!categoryExists) {
      categoryId = CATEGORY_UNCATEGORIZED_ID;
    }

    // Duplicate check with other items
    const normName = normalizeText(trimmedName);
    const isDuplicate = this.currentPayload.items.some(
      (it) => it.id !== itemId && normalizeText(it.name) === normName && it.categoryId === categoryId
    );
    if (isDuplicate) {
      return {
        success: false,
        error: {
          type: "DUPLICATE",
          name: trimmedName,
          message: `Another item named '${trimmedName}' already exists in this category.`,
        },
      };
    }

    const cleanSynonyms = sanitizeSynonyms(data.synonyms || []);

    const updatedItem: Item = {
      ...this.currentPayload.items[itemIndex],
      name: trimmedName,
      categoryId,
      price: legacyPrice,
      priceToman,
      priceUsd,
      unit: data.unit ? data.unit.trim() : undefined,
      synonyms: cleanSynonyms,
      barcode: data.barcode ? data.barcode.trim() : undefined,
      notes: data.notes ? data.notes.trim() : undefined,
      updatedAt: Date.now(),
    };

    const newItems = [...this.currentPayload.items];
    newItems[itemIndex] = updatedItem;

    const newPayload: StoreDataPayload = {
      ...this.currentPayload,
      items: newItems,
      exportedAt: new Date().toISOString(),
      metadata: {
        totalItems: newItems.length,
        totalCategories: this.currentPayload.categories.length,
        currency: this.currentCurrency,
      },
    };

    const saveRes = this.storageEngine.saveAtomic(newPayload, this.currentPayload);
    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }

    this.currentPayload = newPayload;
    return { success: true, data: updatedItem };
  }

  /**
   * Delete Item transactionally and prepare UndoAction
   */
  public deleteItem(itemId: string): Result<{ deletedItem: Item; undoAction: UndoItemAction }> {
    const recoveryBlock = this.checkRecoveryBlocked("Delete Item");
    if (recoveryBlock) return recoveryBlock;

    const itemIndex = this.currentPayload.items.findIndex((it) => it.id === itemId);
    if (itemIndex === -1) {
      return {
        success: false,
        error: { type: "NOT_FOUND", message: `Item with ID ${itemId} not found.` },
      };
    }

    const deletedItem = this.currentPayload.items[itemIndex];
    const newItems = this.currentPayload.items.filter((it) => it.id !== itemId);

    // Re-index remaining items
    const reIndexed = newItems.map((it, idx) => ({ ...it, orderIndex: idx }));

    const newPayload: StoreDataPayload = {
      ...this.currentPayload,
      items: reIndexed,
      exportedAt: new Date().toISOString(),
      metadata: {
        totalItems: reIndexed.length,
        totalCategories: this.currentPayload.categories.length,
        currency: this.currentCurrency,
      },
    };

    const saveRes = this.storageEngine.saveAtomic(newPayload, this.currentPayload);
    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }

    this.currentPayload = newPayload;

    const undoAction: UndoItemAction = {
      item: deletedItem,
      previousIndex: itemIndex,
      expiryTime: Date.now() + 6500,
    };

    return { success: true, data: { deletedItem, undoAction } };
  }

  /**
   * Restore deleted item (Undo) with category existence verification
   */
  public undoDeleteItem(undoAction: UndoItemAction): Result<Item> {
    const recoveryBlock = this.checkRecoveryBlocked("Undo Delete");
    if (recoveryBlock) return recoveryBlock;

    const item = { ...undoAction.item };

    // Verify if the item's category still exists in current categories
    const categoryStillExists = this.currentPayload.categories.some((c) => c.id === item.categoryId);
    if (!categoryStillExists) {
      item.categoryId = CATEGORY_UNCATEGORIZED_ID;
    }

    const targetIndex = Math.min(Math.max(0, undoAction.previousIndex), this.currentPayload.items.length);

    const newItems = [...this.currentPayload.items];
    newItems.splice(targetIndex, 0, item);

    // Re-index order positions
    const reIndexed = newItems.map((it, idx) => ({ ...it, orderIndex: idx }));

    const newPayload: StoreDataPayload = {
      ...this.currentPayload,
      items: reIndexed,
      exportedAt: new Date().toISOString(),
      metadata: {
        totalItems: reIndexed.length,
        totalCategories: this.currentPayload.categories.length,
        currency: this.currentCurrency,
      },
    };

    const saveRes = this.storageEngine.saveAtomic(newPayload, this.currentPayload);
    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }

    this.currentPayload = newPayload;
    return { success: true, data: item };
  }

  /**
   * Deterministic Reordering for Master List and Filtered/Search Lists
   */
  public reorderFilteredList(reorderedFilteredItemIds: string[]): Result<Item[]> {
    const recoveryBlock = this.checkRecoveryBlocked("Reorder Items");
    if (recoveryBlock) return recoveryBlock;

    const masterItems = [...this.currentPayload.items];
    const filteredIdSet = new Set(reorderedFilteredItemIds);

    // Find indices in master list that belong to the filtered items
    const slotIndices: number[] = [];
    masterItems.forEach((it, idx) => {
      if (filteredIdSet.has(it.id)) {
        slotIndices.push(idx);
      }
    });

    if (slotIndices.length !== reorderedFilteredItemIds.length) {
      return {
        success: false,
        error: {
          type: "VALIDATION",
          field: "reorder",
          message: "Reorder mismatch between filtered items and master list.",
        },
      };
    }

    // Build map for quick item lookup
    const itemMap = new Map<string, Item>();
    masterItems.forEach((it) => itemMap.set(it.id, it));

    // Place the reordered filtered items into the preserved slot indices
    reorderedFilteredItemIds.forEach((id, i) => {
      const slot = slotIndices[i];
      const it = itemMap.get(id);
      if (it) {
        masterItems[slot] = it;
      }
    });

    // Re-index all orderIndex
    const reIndexed = masterItems.map((it, idx) => ({ ...it, orderIndex: idx }));

    const newPayload: StoreDataPayload = {
      ...this.currentPayload,
      items: reIndexed,
      exportedAt: new Date().toISOString(),
    };

    const saveRes = this.storageEngine.saveAtomic(newPayload, this.currentPayload);
    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }

    this.currentPayload = newPayload;
    return { success: true, data: reIndexed };
  }

  /**
   * Add Category transactionally
   */
  public addCategory(name: string, color?: string): Result<Category> {
    const recoveryBlock = this.checkRecoveryBlocked("Add Category");
    if (recoveryBlock) return recoveryBlock;

    const trimmed = (name || "").trim();
    if (!trimmed) {
      return {
        success: false,
        error: { type: "VALIDATION", field: "categoryName", message: "Category name cannot be empty." },
      };
    }

    if (trimmed.length > VALIDATION_LIMITS.MAX_CATEGORY_NAME_LENGTH) {
      return {
        success: false,
        error: {
          type: "VALIDATION",
          field: "categoryName",
          message: `Category name cannot exceed ${VALIDATION_LIMITS.MAX_CATEGORY_NAME_LENGTH} characters.`,
        },
      };
    }

    const normName = normalizeText(trimmed);
    const exists = this.currentPayload.categories.some((c) => normalizeText(c.name) === normName);
    if (exists) {
      return {
        success: false,
        error: {
          type: "DUPLICATE",
          name: trimmed,
          message: `A category named '${trimmed}' already exists.`,
        },
      };
    }

    const newCategory: Category = {
      id: generateUUID(),
      name: trimmed,
      color: color || "#0284c7",
      isDefault: false,
    };

    const newCategories = [...this.currentPayload.categories, newCategory];
    const newPayload: StoreDataPayload = {
      ...this.currentPayload,
      categories: newCategories,
      exportedAt: new Date().toISOString(),
      metadata: {
        totalItems: this.currentPayload.items.length,
        totalCategories: newCategories.length,
        currency: this.currentCurrency,
      },
    };

    const saveRes = this.storageEngine.saveAtomic(newPayload, this.currentPayload);
    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }

    this.currentPayload = newPayload;
    return { success: true, data: newCategory };
  }

  /**
   * Rename Category transactionally (Stable ID preserved)
   */
  public renameCategory(categoryId: string, newName: string, color?: string): Result<Category> {
    const recoveryBlock = this.checkRecoveryBlocked("Rename Category");
    if (recoveryBlock) return recoveryBlock;

    const trimmed = (newName || "").trim();
    if (!trimmed) {
      return {
        success: false,
        error: { type: "VALIDATION", field: "categoryName", message: "Category name cannot be empty." },
      };
    }

    const catIndex = this.currentPayload.categories.findIndex((c) => c.id === categoryId);
    if (catIndex === -1) {
      return {
        success: false,
        error: { type: "NOT_FOUND", message: `Category with ID ${categoryId} not found.` },
      };
    }

    const currentCat = this.currentPayload.categories[catIndex];

    // Check duplicate with other categories
    const normName = normalizeText(trimmed);
    const isDuplicate = this.currentPayload.categories.some(
      (c) => c.id !== categoryId && normalizeText(c.name) === normName
    );
    if (isDuplicate) {
      return {
        success: false,
        error: {
          type: "DUPLICATE",
          name: trimmed,
          message: `Another category named '${trimmed}' already exists.`,
        },
      };
    }

    const updatedCat: Category = {
      ...currentCat,
      name: trimmed,
      color: color || currentCat.color || "#0284c7",
    };

    const newCategories = [...this.currentPayload.categories];
    newCategories[catIndex] = updatedCat;

    const newPayload: StoreDataPayload = {
      ...this.currentPayload,
      categories: newCategories,
      exportedAt: new Date().toISOString(),
    };

    const saveRes = this.storageEngine.saveAtomic(newPayload, this.currentPayload);
    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }

    this.currentPayload = newPayload;
    return { success: true, data: updatedCat };
  }

  /**
   * Delete Category with atomic Item Reassignment
   */
  public deleteCategory(
    categoryId: string,
    reassignTargetCategoryId: string = CATEGORY_UNCATEGORIZED_ID
  ): Result<{ deletedCategoryId: string; reassignedCount: number }> {
    const recoveryBlock = this.checkRecoveryBlocked("Delete Category");
    if (recoveryBlock) return recoveryBlock;

    if (categoryId === CATEGORY_UNCATEGORIZED_ID) {
      return {
        success: false,
        error: {
          type: "VALIDATION",
          field: "categoryId",
          message: "The default Uncategorized category cannot be deleted.",
        },
      };
    }

    const catExists = this.currentPayload.categories.some((c) => c.id === categoryId);
    if (!catExists) {
      return {
        success: false,
        error: { type: "NOT_FOUND", message: "Category not found." },
      };
    }

    // Ensure reassign target category exists
    const targetExists = this.currentPayload.categories.some((c) => c.id === reassignTargetCategoryId);
    const finalTargetId = targetExists ? reassignTargetCategoryId : CATEGORY_UNCATEGORIZED_ID;

    // Filter out category
    const newCategories = this.currentPayload.categories.filter((c) => c.id !== categoryId);

    // Reassign affected items
    let reassignedCount = 0;
    const newItems = this.currentPayload.items.map((it) => {
      if (it.categoryId === categoryId) {
        reassignedCount++;
        return {
          ...it,
          categoryId: finalTargetId,
          updatedAt: Date.now(),
        };
      }
      return it;
    });

    const newPayload: StoreDataPayload = {
      ...this.currentPayload,
      categories: newCategories,
      items: newItems,
      exportedAt: new Date().toISOString(),
      metadata: {
        totalItems: newItems.length,
        totalCategories: newCategories.length,
        currency: this.currentCurrency,
      },
    };

    const saveRes = this.storageEngine.saveAtomic(newPayload, this.currentPayload);
    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }

    this.currentPayload = newPayload;
    return { success: true, data: { deletedCategoryId: categoryId, reassignedCount } };
  }

  /**
   * Transactional Backup Import Pipeline:
   * "Read -> Parse -> Validate -> Persist -> Replace Current State"
   */
  public importFromBackup(rawFileContent: string, fileSizeBytes?: number): Result<StoreDataPayload> {
    const recoveryBlock = this.checkRecoveryBlocked("Import Backup");
    if (recoveryBlock) return recoveryBlock;

    // 1. Read & Validate
    const validationRes = validateBackupFileRaw(rawFileContent, fileSizeBytes);
    if (!validationRes.success) {
      return validationRes;
    }

    const validatedPayload = validationRes.data;

    // 2. Persist atomically with snapshot of current state
    const saveRes = this.storageEngine.saveAtomic(validatedPayload, this.currentPayload);
    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }

    // 3. Replace Current In-Memory State
    this.currentPayload = validatedPayload;
    this.currentCurrency = validatedPayload.metadata?.currency === "USD" ? "USD" : "TOMAN";
    return { success: true, data: validatedPayload };
  }

  /**
   * Restore state from a BackupSnapshot:
   * Allowed in Recovery Mode to restore healthy operation.
   * Strictly updates this.currentPayload and exits Recovery Mode upon verified persist success!
   */
  public restoreFromSnapshot(snapshot: BackupSnapshot): Result<StoreDataPayload> {
    const res = this.storageEngine.restoreFromSnapshot(snapshot, this.currentPayload);
    if (res.success) {
      this.currentPayload = res.data;
      this.currentCurrency = res.data.metadata?.currency === "USD" ? "USD" : "TOMAN";
      this.inRecoveryMode = false;
      this.recoveryReason = null;
    }
    return res;
  }

  /**
   * Export JSON Backup
   */
  public exportBackup(): string {
    const payload: StoreDataPayload = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      categories: this.currentPayload.categories,
      items: this.currentPayload.items,
      metadata: {
        totalItems: this.currentPayload.items.length,
        totalCategories: this.currentPayload.categories.length,
        currency: this.currentCurrency,
      },
    };
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Reset store to clean defaults (explicit user action)
   * Allowed in Recovery Mode to establish a new healthy store.
   * Strictly exits Recovery Mode upon verified persist success!
   */
  public resetToDefaults(): Result<StoreDataPayload> {
    const res = this.storageEngine.resetToDefaults(this.currentPayload);
    if (res.success) {
      this.currentPayload = res.data;
      this.currentCurrency = res.data.metadata?.currency === "USD" ? "USD" : "TOMAN";
      this.inRecoveryMode = false;
      this.recoveryReason = null;
    }
    return res;
  }
}
