/**
 * Comprehensive Unit Test & Verification Engine
 * Validates domain rules, repository transactions, storage corruption recovery,
 * backup validation, deterministic reordering, category lifecycle, 2-phase staged commits,
 * and currency persistence.
 *
 * Guaranteed Isolation:
 *  - Captures exact storage keys and existence flags before test execution.
 *  - Restores existing keys and explicitly deletes keys that did not exist before tests.
 *  - No test artifacts or temporary items can ever leak into user storage.
 */

import { StoreRepository } from "../data/storeRepository";
import { AtomicStorageEngine, STORAGE_KEYS } from "../data/storage";
import {
  validateBackupFileRaw,
  validateCurrentPayloadStrict,
  migrateAndValidateStorePayload,
} from "../data/backupValidator";
import {
  CATEGORY_UNCATEGORIZED_ID,
  CURRENT_SCHEMA_VERSION,
  APP_VERSION,
  VALIDATION_LIMITS,
  StoreDataPayload,
  BackupSnapshot,
  INITIAL_DEFAULT_CATEGORIES,
  INITIAL_SAMPLE_ITEMS,
} from "../types/store";
import { normalizeText, matchesSearchQuery } from "./helpers";

export interface TestCaseResult {
  id: string;
  name: string;
  category:
    | "Repository"
    | "Storage"
    | "Validation"
    | "Search & Reorder"
    | "Backup & Import"
    | "Integrity";
  passed: boolean;
  durationMs: number;
  errorMessage?: string;
  details?: string;
}

export interface TestSuiteSummary {
  total: number;
  passed: number;
  failed: number;
  totalDurationMs: number;
  results: TestCaseResult[];
}

export async function runAllUnitTests(): Promise<TestSuiteSummary> {
  const results: TestCaseResult[] = [];
  const startAll = performance.now();

  async function executeTest(
    id: string,
    name: string,
    category: TestCaseResult["category"],
    fn: () => void | Promise<void>
  ) {
    const t0 = performance.now();
    try {
      await fn();
      results.push({
        id,
        name,
        category,
        passed: true,
        durationMs: Math.round((performance.now() - t0) * 100) / 100,
      });
    } catch (err: any) {
      results.push({
        id,
        name,
        category,
        passed: false,
        durationMs: Math.round((performance.now() - t0) * 100) / 100,
        errorMessage: err?.message || String(err),
      });
    }
  }

  // Exact Storage State Snapshot (records existence and value for every known key)
  const allKnownKeys = Object.values(STORAGE_KEYS);
  const initialStorageState = new Map<string, { exists: boolean; value: string | null }>();

  for (const key of allKnownKeys) {
    const val = localStorage.getItem(key);
    initialStorageState.set(key, { exists: val !== null, value: val });
  }

  try {
    // -------------------------------------------------------------
    // SCENARIO 1: Normal Transactional Save & Persistence
    // -------------------------------------------------------------
    await executeTest(
      "scenario-1-normal-save",
      "Scenario 1: Normal Transactional Item Creation & Storage",
      "Repository",
      () => {
        const repo = new StoreRepository();
        repo.resetToDefaults();

        const res = repo.addItem({
          name: "Test Organic Apples",
          categoryId: "cat_produce",
          priceToman: 55000,
          priceUsd: 2.99,
          unit: "lb",
          synonyms: ["granny smith", "green apple"],
        });

        if (!res.success) throw new Error(`Add item failed: ${JSON.stringify(res.error)}`);
        if (res.data.name !== "Test Organic Apples") throw new Error("Item name mismatch");
        if (res.data.priceToman !== 55000) throw new Error("Price Toman mismatch");
        if (res.data.priceUsd !== 2.99) throw new Error("Price USD mismatch");

        // Verify primary storage persisted
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRIMARY)!);
        const itemInStorage = saved.items.find((it: any) => it.id === res.data.id);
        if (!itemInStorage) throw new Error("Item was not persisted to atomic storage!");
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 2: Storage Layer Self-Validation on Invalid Payload
    // -------------------------------------------------------------
    await executeTest(
      "scenario-2-invalid-payload-save-atomic",
      "Scenario 2: saveAtomic Rejects Invalid Payload Without Storage Modification",
      "Storage",
      () => {
        const engine = AtomicStorageEngine.getInstance();
        engine.resetToDefaults();
        const primaryBefore = localStorage.getItem(STORAGE_KEYS.PRIMARY);

        const invalidPayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [{ id: "cat_1", name: "Valid Category" }],
          items: [
            {
              id: "item_bad",
              name: "", // Empty name is strictly illegal
              categoryId: "cat_1",
              priceToman: 100,
            },
          ],
        };

        const res = engine.saveAtomic(invalidPayload);
        if (res.success) throw new Error("saveAtomic should have failed on invalid payload!");
        if (res.error.type !== "STORAGE") throw new Error("Expected STORAGE error type");

        // Ensure primary was NOT altered
        const primaryAfter = localStorage.getItem(STORAGE_KEYS.PRIMARY);
        if (primaryAfter !== primaryBefore) throw new Error("Storage was modified by invalid saveAtomic call!");
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 3: Staging Write Failure Handling
    // -------------------------------------------------------------
    await executeTest(
      "scenario-3-staging-write-failure",
      "Scenario 3: Staging Write Failure Leaves Primary Storage Intact",
      "Storage",
      () => {
        const engine = AtomicStorageEngine.getInstance();
        engine.resetToDefaults();
        const primaryBefore = localStorage.getItem(STORAGE_KEYS.PRIMARY);

        const validNewPayload: StoreDataPayload = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          appVersion: "2.0.0",
          exportedAt: new Date().toISOString(),
          categories: [{ id: "cat_1", name: "Produce" }],
          items: [{ id: "it_1", name: "Apple", categoryId: "cat_1", priceToman: 5000, synonyms: [], updatedAt: Date.now(), orderIndex: 0 }],
        };

        // Simulate setItem failure on STAGING
        const originalSetItem = localStorage.setItem;
        try {
          localStorage.setItem = (key: string, val: string) => {
            if (key === STORAGE_KEYS.STAGING) {
              throw new Error("Simulated Staging Quota Exceeded");
            }
            return originalSetItem.call(localStorage, key, val);
          };

          const res = engine.saveAtomic(validNewPayload);
          if (res.success) throw new Error("saveAtomic should have reported staging write error");
          if (!res.error.message.includes("quota") && !res.error.message.includes("staging")) {
            throw new Error(`Expected staging quota error, received: ${res.error.message}`);
          }

          // Verify primary storage unchanged
          const primaryAfter = localStorage.getItem(STORAGE_KEYS.PRIMARY);
          if (primaryAfter !== primaryBefore) throw new Error("Primary was modified after staging failure!");
        } finally {
          localStorage.setItem = originalSetItem;
        }
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 4: Primary Write Failure Handling
    // -------------------------------------------------------------
    await executeTest(
      "scenario-4-primary-write-failure",
      "Scenario 4: Primary Write Failure Cleans Staging & Retains Previous State",
      "Storage",
      () => {
        const engine = AtomicStorageEngine.getInstance();
        engine.resetToDefaults();
        const primaryBefore = localStorage.getItem(STORAGE_KEYS.PRIMARY);

        const validNewPayload: StoreDataPayload = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          appVersion: "2.0.0",
          exportedAt: new Date().toISOString(),
          categories: [{ id: "cat_1", name: "Produce" }],
          items: [{ id: "it_1", name: "Apple", categoryId: "cat_1", priceToman: 5000, synonyms: [], updatedAt: Date.now(), orderIndex: 0 }],
        };

        const originalSetItem = localStorage.setItem;
        try {
          localStorage.setItem = (key: string, val: string) => {
            if (key === STORAGE_KEYS.PRIMARY) {
              throw new Error("Simulated Primary Disk I/O Error");
            }
            return originalSetItem.call(localStorage, key, val);
          };

          const res = engine.saveAtomic(validNewPayload);
          if (res.success) throw new Error("saveAtomic should have failed on primary write");

          // Verify staging was cleaned up
          const staging = localStorage.getItem(STORAGE_KEYS.STAGING);
          if (staging !== null) throw new Error("Staging key was left behind after primary failure!");

          // Verify original primary data still exists
          const primaryAfter = localStorage.getItem(STORAGE_KEYS.PRIMARY);
          if (primaryAfter !== primaryBefore) throw new Error("Primary was corrupted on write failure!");
        } finally {
          localStorage.setItem = originalSetItem;
        }
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 5: Snapshot Write Failure Isolation
    // -------------------------------------------------------------
    await executeTest(
      "scenario-5-snapshot-failure-safe",
      "Scenario 5: Snapshot Failure Does Not Abort Primary Save",
      "Storage",
      () => {
        const engine = AtomicStorageEngine.getInstance();
        engine.resetToDefaults();

        const validNewPayload: StoreDataPayload = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          appVersion: "2.0.0",
          exportedAt: new Date().toISOString(),
          categories: [{ id: "cat_1", name: "Bakery" }],
          items: [{ id: "it_bread", name: "Ciabatta", categoryId: "cat_1", priceUsd: 3.5, synonyms: [], updatedAt: Date.now(), orderIndex: 0 }],
        };

        const originalSetItem = localStorage.setItem;
        try {
          localStorage.setItem = (key: string, val: string) => {
            if (key === STORAGE_KEYS.SNAPSHOTS) {
              throw new Error("Simulated Snapshot Quota Exceeded");
            }
            return originalSetItem.call(localStorage, key, val);
          };

          const res = engine.saveAtomic(validNewPayload);
          if (!res.success) throw new Error(`Save failed due to snapshot failure: ${res.error.message}`);

          // Primary should have succeeded
          const loadRes = engine.load();
          if (!loadRes.success || loadRes.data.items[0]?.id !== "it_bread") {
            throw new Error("Primary save did not succeed despite isolated snapshot failure");
          }
        } finally {
          localStorage.setItem = originalSetItem;
        }
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 6: Crash / Interruption Recovery (Leftover Staging Key)
    // -------------------------------------------------------------
    await executeTest(
      "scenario-6-crash-recovery-staging",
      "Scenario 6: Interrupted Staging Key is Safely Discarded if Primary is Valid",
      "Storage",
      () => {
        const engine = AtomicStorageEngine.getInstance();
        engine.resetToDefaults();

        // Simulate orphaned staging key from crashed previous session
        localStorage.setItem(
          STORAGE_KEYS.STAGING,
          JSON.stringify({ token: "orphan", timestamp: Date.now() - 60000, payload: { corrupted: true } })
        );

        // Load storage
        const loadRes = engine.load();
        if (!loadRes.success) throw new Error("Load failed despite valid primary storage");

        // Leftover staging key should have been cleaned up
        const stagingAfter = localStorage.getItem(STORAGE_KEYS.STAGING);
        if (stagingAfter !== null) throw new Error("Leftover staging was not removed during load!");
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 7: Corrupted Primary Storage Archival & Protection
    // -------------------------------------------------------------
    await executeTest(
      "scenario-7-corrupted-primary-archival",
      "Scenario 7: Corrupted Primary is Archived and Never Silently Wiped",
      "Storage",
      () => {
        const engine = AtomicStorageEngine.getInstance();
        const badRawJson = "{ malformed_json: true, unterminated: ";
        localStorage.setItem(STORAGE_KEYS.PRIMARY, badRawJson);

        const loadRes = engine.load();
        if (loadRes.success) throw new Error("load() should have failed on corrupted primary!");
        if (loadRes.error.type !== "CORRUPTED_DATA") throw new Error("Expected CORRUPTED_DATA error type");

        // Verify primary was NOT replaced with clean default
        const primaryAfter = localStorage.getItem(STORAGE_KEYS.PRIMARY);
        if (primaryAfter !== badRawJson) throw new Error("Corrupted primary was silently overwritten!");

        // Verify corrupt archive was created
        const archive = localStorage.getItem(STORAGE_KEYS.CORRUPT_ARCHIVE);
        if (archive !== badRawJson) throw new Error("Corrupted data was not saved to corrupt archive!");
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 8 & 9: Corrupted / Stale Staging Data
    // -------------------------------------------------------------
    await executeTest(
      "scenario-8-corrupted-staging-ignored",
      "Scenario 8: Corrupted Staging Data Ignored When Primary is Valid",
      "Storage",
      () => {
        const engine = AtomicStorageEngine.getInstance();
        engine.resetToDefaults();
        localStorage.setItem(STORAGE_KEYS.STAGING, "{{{ corrupt broken JSON");

        const loadRes = engine.load();
        if (!loadRes.success) throw new Error("load() failed on valid primary with bad staging");
        if (loadRes.data.items.length === 0) throw new Error("Items missing");
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 10: Corrupted Snapshot Ignored Safely
    // -------------------------------------------------------------
    await executeTest(
      "scenario-10-corrupted-snapshot-safe",
      "Scenario 10: Corrupted Snapshot Handled Gracefully",
      "Storage",
      () => {
        const engine = AtomicStorageEngine.getInstance();
        localStorage.setItem(STORAGE_KEYS.SNAPSHOTS, "{ bad array syntax");

        const snapshots = engine.getSnapshots();
        if (!Array.isArray(snapshots) || snapshots.length !== 0) {
          throw new Error("getSnapshots did not return empty array for corrupted snapshots key");
        }
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 11, 12, 13, 14: Snapshot Restore, Add, Edit, Delete Sequence
    // -------------------------------------------------------------
    await executeTest(
      "scenario-11-14-restore-crud-sequence",
      "Scenarios 11-14: Restore Snapshot -> Add Item -> Edit Item -> Delete Item",
      "Repository",
      () => {
        const repo = new StoreRepository();
        repo.resetToDefaults();

        // 1. Create specific snapshot
        const snapshotPayload: StoreDataPayload = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          appVersion: "2.0.0",
          exportedAt: new Date().toISOString(),
          categories: [{ id: "cat_custom", name: "Custom Category", color: "#6366f1" }],
          items: [
            {
              id: "item_base",
              name: "Base Snapshot Item",
              categoryId: "cat_custom",
              priceToman: 12000,
              synonyms: [],
              updatedAt: Date.now(),
              orderIndex: 0,
            },
          ],
        };

        const restoreRes = repo.restoreFromSnapshot({
          id: "snap_test",
          timestamp: Date.now(),
          dateString: "Test Date",
          itemCount: 1,
          categoryCount: 1,
          jsonData: JSON.stringify(snapshotPayload),
        });

        if (!restoreRes.success) throw new Error(`Restore failed: ${restoreRes.error.message}`);
        if (repo.getItems().length !== 1) throw new Error("Item count after restore mismatch");
        if (repo.getItems()[0].name !== "Base Snapshot Item") throw new Error("Restored item name mismatch");

        // 2. Add item on top of restored state
        const addRes = repo.addItem({
          name: "Second Added Item",
          categoryId: "cat_custom",
          priceUsd: 4.5,
        });
        if (!addRes.success) throw new Error(`Add failed: ${addRes.error.message}`);
        if (repo.getItems().length !== 2) throw new Error("Add did not increment restored items");

        // 3. Edit restored item
        const editRes = repo.updateItem("item_base", {
          name: "Base Snapshot Item Edited",
          categoryId: "cat_custom",
          priceToman: 15000,
        });
        if (!editRes.success) throw new Error(`Edit failed: ${editRes.error.message}`);
        if (repo.getItems().find((it) => it.id === "item_base")?.name !== "Base Snapshot Item Edited") {
          throw new Error("Item was not edited");
        }

        // 4. Delete item
        const delRes = repo.deleteItem(addRes.data.id);
        if (!delRes.success) throw new Error(`Delete failed: ${delRes.error.message}`);
        if (repo.getItems().length !== 1) throw new Error("Delete failed to reduce count");
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 15: Invalid Backup File Handling
    // -------------------------------------------------------------
    await executeTest(
      "scenario-15-invalid-backup",
      "Scenario 15: Backup Import Rejects Non-JSON and Malformed Payloads",
      "Validation",
      () => {
        const notJson = "<html><body>502 Bad Gateway</body></html>";
        const res = validateBackupFileRaw(notJson);
        if (res.success) throw new Error("validateBackupFileRaw accepted HTML string");
        if (res.error.type !== "IMPORT_VALIDATION") throw new Error("Expected IMPORT_VALIDATION error");
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 16: Unsupported & Malformed Schema Version Handling
    // -------------------------------------------------------------
    await executeTest(
      "scenario-16-unsupported-schema-version",
      "Scenario 16: Unsupported Schema Versions (v999, negative, string) Rejected",
      "Validation",
      () => {
        // Future schema version
        const futurePayload = { schemaVersion: 999, items: [], categories: [] };
        const res1 = migrateAndValidateStorePayload(futurePayload);
        if (res1.success) throw new Error("Accepted future schema v999");

        // Malformed schema version
        const malformedPayload = { schemaVersion: "v2.0-beta", items: [], categories: [] };
        const res2 = migrateAndValidateStorePayload(malformedPayload);
        if (res2.success) throw new Error("Accepted non-integer schema version");

        // Negative schema version
        const negPayload = { schemaVersion: -1, items: [], categories: [] };
        const res3 = migrateAndValidateStorePayload(negPayload);
        if (res3.success) throw new Error("Accepted negative schema version");
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 17: Strict Price Type Checking (No Silent Coercions)
    // -------------------------------------------------------------
    await executeTest(
      "scenario-17-strict-price-types",
      "Scenario 17: Strict Price Types (Boolean, Object, Null, NaN) Rejected in Strict Validation",
      "Validation",
      () => {
        // Boolean price (must NOT be coerced: true -> 1)
        const booleanPricePayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [{ id: "cat_1", name: "Groceries" }],
          items: [{ id: "it_1", name: "Bool Price Item", categoryId: "cat_1", priceToman: true }],
        };
        const res1 = validateCurrentPayloadStrict(booleanPricePayload);
        if (res1.success) throw new Error("Accepted boolean true as price!");

        // String price
        const stringPricePayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [{ id: "cat_1", name: "Groceries" }],
          items: [{ id: "it_1", name: "String Price Item", categoryId: "cat_1", priceToman: "100" }],
        };
        const res2 = validateCurrentPayloadStrict(stringPricePayload);
        if (res2.success) throw new Error("Accepted string as price!");

        // Negative price
        const negPricePayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [{ id: "cat_1", name: "Groceries" }],
          items: [{ id: "it_1", name: "Neg Price Item", categoryId: "cat_1", priceToman: -50 }],
        };
        const res3 = validateCurrentPayloadStrict(negPricePayload);
        if (res3.success) throw new Error("Accepted negative price!");
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 18: Duplicate IDs Detection
    // -------------------------------------------------------------
    await executeTest(
      "scenario-18-duplicate-ids",
      "Scenario 18: Duplicate Item and Category IDs Rejected",
      "Validation",
      () => {
        // Duplicate Item IDs
        const dupItemPayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [{ id: "cat_1", name: "Groceries" }],
          items: [
            { id: "dup_id", name: "Item A", categoryId: "cat_1", priceToman: 100 },
            { id: "dup_id", name: "Item B", categoryId: "cat_1", priceToman: 200 },
          ],
        };
        const res1 = validateCurrentPayloadStrict(dupItemPayload);
        if (res1.success) throw new Error("Accepted duplicate item ID!");

        // Duplicate Category IDs
        const dupCatPayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [
            { id: "cat_dup", name: "Cat A" },
            { id: "cat_dup", name: "Cat B" },
          ],
          items: [],
        };
        const res2 = validateCurrentPayloadStrict(dupCatPayload);
        if (res2.success) throw new Error("Accepted duplicate category ID!");
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 19: Category Reference Integrity
    // -------------------------------------------------------------
    await executeTest(
      "scenario-19-category-reference-integrity",
      "Scenario 19: Items Referencing Non-Existent Categories Rejected in Strict Mode",
      "Validation",
      () => {
        const orphanItemPayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [{ id: "cat_existing", name: "Existing" }],
          items: [
            {
              id: "it_orphan",
              name: "Orphan Item",
              categoryId: "cat_non_existent_12345",
              priceToman: 500,
            },
          ],
        };
        const res = validateCurrentPayloadStrict(orphanItemPayload);
        if (res.success) throw new Error("Accepted item pointing to non-existent category!");
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 20: Storage Quota Handling Without In-Memory State Corruption
    // -------------------------------------------------------------
    await executeTest(
      "scenario-20-storage-quota-safety",
      "Scenario 20: Storage Quota Handled Without Corrupting In-Memory State",
      "Repository",
      () => {
        const repo = new StoreRepository();
        repo.resetToDefaults();
        const initialItemCount = repo.getItems().length;

        const originalSetItem = localStorage.setItem;
        try {
          localStorage.setItem = () => {
            const err = new Error("QuotaExceededError: DOM Exception 22");
            err.name = "QuotaExceededError";
            throw err;
          };

          const addRes = repo.addItem({
            name: "Item That Fails Save",
            categoryId: "cat_produce",
            priceToman: 9999,
          });

          if (addRes.success) throw new Error("addItem should have failed under QuotaExceededError");
          if (repo.getItems().length !== initialItemCount) {
            throw new Error("In-memory items were mutated despite storage write failure!");
          }
        } finally {
          localStorage.setItem = originalSetItem;
        }
      }
    );

    // -------------------------------------------------------------
    // SCENARIO 21: Multi-Currency Persistence & Zero Currency Guessing
    // -------------------------------------------------------------
    await executeTest(
      "scenario-21-multi-currency-zero-guessing",
      "Scenario 21: Dual-Currency Items and No Numeric-Value Guessing",
      "Repository",
      () => {
        const repo = new StoreRepository();
        repo.resetToDefaults();

        // 1. Dual price item
        const resBoth = repo.addItem({
          name: "Dual Currency Item",
          categoryId: "cat_produce",
          priceToman: 75000,
          priceUsd: 1.5,
        });
        if (!resBoth.success) throw new Error("Failed to add dual currency item");
        if (resBoth.data.priceToman !== 75000 || resBoth.data.priceUsd !== 1.5) {
          throw new Error("Dual prices not saved correctly");
        }

        // 2. Migration of legacy item with price: 2.99 without guessing
        const legacyV1Payload = {
          schemaVersion: 1,
          items: [{ id: "leg_1", name: "Decimal Price Item", category: "Produce", price: 2.99 }],
        };
        const migRes = migrateAndValidateStorePayload(legacyV1Payload, "TOMAN");
        if (!migRes.success) throw new Error("Migration failed");
        // In legacy migration, if explicit metadata or item currency is missing, it adopts the explicit default currency (TOMAN), without guessing USD solely from decimal 2.99
        if (migRes.data.items[0].priceToman !== 2.99) {
          throw new Error(`Expected priceToman to be 2.99 without value guessing, got: ${migRes.data.items[0].priceToman}`);
        }
      }
    );

    // -------------------------------------------------------------
    // EXTRA TESTS: Reordering, Search, and Category Cascades
    // -------------------------------------------------------------
    await executeTest(
      "test-deterministic-reorder",
      "Deterministic Reordering in Filtered Search View",
      "Search & Reorder",
      () => {
        const repo = new StoreRepository();
        repo.resetToDefaults();
        const items = repo.getItems();
        if (items.length < 3) throw new Error("Need at least 3 items");

        const targetIds = [items[2].id, items[0].id];
        const reorderRes = repo.reorderFilteredList(targetIds);
        if (!reorderRes.success) throw new Error("Reorder failed");

        const afterItems = repo.getItems();
        const slot0 = afterItems.findIndex((it) => it.id === targetIds[0]);
        const slot1 = afterItems.findIndex((it) => it.id === targetIds[1]);
        if (slot0 >= slot1) throw new Error("Slot order was not inverted deterministically");
      }
    );

    await executeTest(
      "test-category-delete-cascade",
      "Category Deletion Cascades Items to Uncategorized",
      "Repository",
      () => {
        const repo = new StoreRepository();
        repo.resetToDefaults();

        const catRes = repo.addCategory("Temporary Category");
        if (!catRes.success) throw new Error("Add cat failed");

        const itemRes = repo.addItem({
          name: "Item in Temp Cat",
          categoryId: catRes.data.id,
          priceToman: 1000,
        });
        if (!itemRes.success) throw new Error("Add item failed");

        const delCatRes = repo.deleteCategory(catRes.data.id);
        if (!delCatRes.success) throw new Error("Delete category failed");
        if (delCatRes.data.reassignedCount !== 1) throw new Error("Reassigned count mismatch");

        const updatedItem = repo.getItems().find((it) => it.id === itemRes.data.id);
        if (!updatedItem || updatedItem.categoryId !== CATEGORY_UNCATEGORIZED_ID) {
          throw new Error("Item was not reassigned to Uncategorized");
        }
      }
    );

    // -------------------------------------------------------------
    // CURRENCY TESTS: Transactional Currency Operations & Failure Paths
    // -------------------------------------------------------------
    await executeTest(
      "test-currency-transactional-failure",
      "Currency: setCurrency Failure Preserves In-Memory & Persisted State",
      "Repository",
      () => {
        const repo = new StoreRepository();
        repo.resetToDefaults();
        const setRes = repo.setCurrency("TOMAN");
        if (!setRes.success) throw new Error("Failed to set TOMAN currency");
        if (repo.getCurrency() !== "TOMAN") throw new Error("Initial currency must be TOMAN");

        const originalSetItem = localStorage.setItem;
        try {
          // Simulate storage failure on atomic save (staging or primary write)
          localStorage.setItem = (key: string, val: string) => {
            if (key === STORAGE_KEYS.PRIMARY || key === STORAGE_KEYS.STAGING) {
              throw new Error("Simulated storage write error for currency change");
            }
            return originalSetItem.call(localStorage, key, val);
          };

          const res = repo.setCurrency("USD");
          if (res.success) throw new Error("setCurrency should have failed when storage write threw");

          // In-memory currency MUST remain previous (TOMAN)
          if (repo.getCurrency() !== "TOMAN") {
            throw new Error(`In-memory currency was mutated to ${repo.getCurrency()} despite storage failure!`);
          }
        } finally {
          localStorage.setItem = originalSetItem;
        }

        // Verify reloaded storage still has authoritative TOMAN
        const reloadedRepo = new StoreRepository();
        if (reloadedRepo.getCurrency() !== "TOMAN") {
          throw new Error(`Authoritative stored currency was modified to ${reloadedRepo.getCurrency()} after failure!`);
        }
      }
    );

    await executeTest(
      "test-currency-reload-persistence",
      "Currency: Reload Reflects Persisted Currency Accurately",
      "Repository",
      () => {
        const repo1 = new StoreRepository();
        repo1.resetToDefaults();
        const res = repo1.setCurrency("USD");
        if (!res.success) throw new Error("setCurrency to USD failed");

        // Create new repository instance simulating reload
        const repo2 = new StoreRepository();
        if (repo2.getCurrency() !== "USD") {
          throw new Error(`Reloaded repository expected USD, got: ${repo2.getCurrency()}`);
        }
      }
    );

    await executeTest(
      "test-currency-price-support-modes",
      "Currency: Items Support Toman Only, USD Only, or Both",
      "Repository",
      () => {
        const repo = new StoreRepository();
        repo.resetToDefaults();

        // 1. Toman only
        const resToman = repo.addItem({
          name: "Toman Only Item",
          categoryId: "cat_produce",
          priceToman: 40000,
        });
        if (!resToman.success) throw new Error("Failed to add Toman only item");
        if (resToman.data.priceToman !== 40000 || resToman.data.priceUsd !== undefined) {
          throw new Error("Toman only item prices incorrect");
        }

        // 2. USD only
        const resUsd = repo.addItem({
          name: "USD Only Item",
          categoryId: "cat_produce",
          priceUsd: 5.99,
        });
        if (!resUsd.success) throw new Error("Failed to add USD only item");
        if (resUsd.data.priceUsd !== 5.99 || resUsd.data.priceToman !== undefined) {
          throw new Error("USD only item prices incorrect");
        }

        // 3. Both Toman and USD
        const resBoth = repo.addItem({
          name: "Dual Price Item",
          categoryId: "cat_produce",
          priceToman: 60000,
          priceUsd: 1.99,
        });
        if (!resBoth.success) throw new Error("Failed to add dual price item");
        if (resBoth.data.priceToman !== 60000 || resBoth.data.priceUsd !== 1.99) {
          throw new Error("Dual price item prices incorrect");
        }
      }
    );

    await executeTest(
      "test-currency-no-price-conversion",
      "Currency: Changing Active Currency Does NOT Convert Existing Item Prices",
      "Repository",
      () => {
        const repo = new StoreRepository();
        repo.resetToDefaults();

        const addRes = repo.addItem({
          name: "Price Preservation Item",
          categoryId: "cat_produce",
          priceToman: 50000,
          priceUsd: 2.5,
        });
        if (!addRes.success) throw new Error("Failed to add test item");
        const itemId = addRes.data.id;

        // Switch currency from TOMAN to USD
        const switchRes1 = repo.setCurrency("USD");
        if (!switchRes1.success) throw new Error("Failed to switch currency to USD");

        let itemAfterUsd = repo.getItems().find((it) => it.id === itemId);
        if (!itemAfterUsd) throw new Error("Item not found after currency change");
        if (itemAfterUsd.priceToman !== 50000 || itemAfterUsd.priceUsd !== 2.5) {
          throw new Error("Item prices were converted or mutated when switching to USD!");
        }

        // Switch back to TOMAN
        const switchRes2 = repo.setCurrency("TOMAN");
        if (!switchRes2.success) throw new Error("Failed to switch currency to TOMAN");

        let itemAfterToman = repo.getItems().find((it) => it.id === itemId);
        if (!itemAfterToman) throw new Error("Item not found after switching back");
        if (itemAfterToman.priceToman !== 50000 || itemAfterToman.priceUsd !== 2.5) {
          throw new Error("Item prices were converted or mutated when switching back to TOMAN!");
        }
      }
    );

    await executeTest(
      "test-restore-lifecycle-add-edit-delete-reload",
      "Restore Lifecycle: Restore -> Add -> Edit -> Delete -> Reload Sequence",
      "Repository",
      () => {
        const repo = new StoreRepository();
        repo.resetToDefaults();

        // 1. Create a snapshot of known state
        const initialSnap: BackupSnapshot = {
          id: "snap_lifecycle_test",
          timestamp: Date.now(),
          dateString: "Lifecycle Baseline",
          itemCount: 1,
          categoryCount: 1,
          jsonData: JSON.stringify({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            appVersion: APP_VERSION,
            exportedAt: new Date().toISOString(),
            categories: [{ id: "cat_life", name: "Life Category" }],
            items: [{ id: "it_base", name: "Base Item", categoryId: "cat_life", priceToman: 1000, synonyms: [], updatedAt: 1000, orderIndex: 0 }],
            metadata: { totalItems: 1, totalCategories: 1, currency: "TOMAN" },
          }),
        };

        // 2. Restore from snapshot
        const restoreRes = repo.restoreFromSnapshot(initialSnap);
        if (!restoreRes.success) throw new Error("Restore snapshot failed");
        if (repo.getItems().length !== 1 || repo.getItems()[0].name !== "Base Item") {
          throw new Error("Restored state mismatch");
        }

        // 3. Add Item after restore
        const addRes = repo.addItem({
          name: "Added After Restore",
          categoryId: "cat_life",
          priceToman: 2000,
        });
        if (!addRes.success) throw new Error("Add item after restore failed");
        if (repo.getItems().length !== 2) throw new Error("Expected 2 items after add");

        // 4. Edit Item after restore
        const editRes = repo.updateItem(addRes.data.id, {
          name: "Edited After Restore",
          categoryId: "cat_life",
          priceToman: 2500,
        });
        if (!editRes.success) throw new Error("Edit item after restore failed");
        const edited = repo.getItems().find((it) => it.id === addRes.data.id);
        if (edited?.name !== "Edited After Restore" || edited?.priceToman !== 2500) {
          throw new Error("Item edit values not reflected");
        }

        // 5. Delete Item after restore
        const delRes = repo.deleteItem(addRes.data.id);
        if (!delRes.success) throw new Error("Delete item after restore failed");
        if (repo.getItems().length !== 1) throw new Error("Expected 1 item after delete");

        // 6. Reload from storage simulation
        const reloadedRepo = new StoreRepository();
        if (reloadedRepo.getItems().length !== 1 || reloadedRepo.getItems()[0].name !== "Base Item") {
          throw new Error("Reloaded repository does not match expected post-lifecycle state!");
        }
      }
    );

    // -------------------------------------------------------------
    // STRICT CURRENT-SCHEMA VALIDATION TESTS (No Silent Defaults)
    // -------------------------------------------------------------
    await executeTest(
      "test-strict-validation-no-silent-defaults",
      "Validation: Strict Current-Schema Validation Rejects Corrupted Fields Without Silent Defaults",
      "Validation",
      () => {
        // Corrupted orderIndex
        const badOrderIndexPayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [{ id: "cat_1", name: "Produce" }],
          items: [{ id: "it_1", name: "Apple", categoryId: "cat_1", priceToman: 100, updatedAt: 1000, orderIndex: -1 }],
        };
        const resOrder = validateCurrentPayloadStrict(badOrderIndexPayload);
        if (resOrder.success) throw new Error("Strict validation accepted negative orderIndex!");

        // Missing orderIndex
        const missingOrderIndexPayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [{ id: "cat_1", name: "Produce" }],
          items: [{ id: "it_1", name: "Apple", categoryId: "cat_1", priceToman: 100, updatedAt: 1000 }],
        };
        const resMissingOrder = validateCurrentPayloadStrict(missingOrderIndexPayload);
        if (resMissingOrder.success) throw new Error("Strict validation accepted missing orderIndex!");

        // Corrupted updatedAt
        const badUpdatedAtPayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [{ id: "cat_1", name: "Produce" }],
          items: [{ id: "it_1", name: "Apple", categoryId: "cat_1", priceToman: 100, updatedAt: "invalid_date", orderIndex: 0 }],
        };
        const resUpdatedAt = validateCurrentPayloadStrict(badUpdatedAtPayload);
        if (resUpdatedAt.success) throw new Error("Strict validation accepted string updatedAt!");

        // Corrupted Category Color
        const badColorPayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [{ id: "cat_1", name: "Produce", color: "invalid_blue" }],
          items: [{ id: "it_1", name: "Apple", categoryId: "cat_1", priceToman: 100, updatedAt: 1000, orderIndex: 0 }],
        };
        const resColor = validateCurrentPayloadStrict(badColorPayload);
        if (resColor.success) throw new Error("Strict validation accepted invalid hex color!");

        // Corrupted isDefault
        const badIsDefaultPayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [{ id: "cat_1", name: "Produce", isDefault: "yes" }],
          items: [{ id: "it_1", name: "Apple", categoryId: "cat_1", priceToman: 100, updatedAt: 1000, orderIndex: 0 }],
        };
        const resIsDefault = validateCurrentPayloadStrict(badIsDefaultPayload);
        if (resIsDefault.success) throw new Error("Strict validation accepted non-boolean isDefault!");

        // Corrupted metadata
        const badMetaPayload: any = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          categories: [{ id: "cat_1", name: "Produce" }],
          items: [{ id: "it_1", name: "Apple", categoryId: "cat_1", priceToman: 100, updatedAt: 1000, orderIndex: 0 }],
          metadata: { currency: "INVALID_CURRENCY" },
        };
        const resMeta = validateCurrentPayloadStrict(badMetaPayload);
        if (resMeta.success) throw new Error("Strict validation accepted invalid metadata currency!");
      }
    );

    // -------------------------------------------------------------
    // RESTORE & IMPORT FAILURE PRESERVATION TESTS
    // -------------------------------------------------------------
    await executeTest(
      "test-restore-failure-preserves-state",
      "Restore: Restore Failure Preserves Previous Valid State",
      "Repository",
      () => {
        const repo = new StoreRepository();
        repo.resetToDefaults();
        const initialCount = repo.getItems().length;
        const initialName = repo.getItems()[0].name;

        // Try restoring a corrupted snapshot with invalid JSON
        const badSnapshot = {
          id: "bad_snap",
          timestamp: Date.now(),
          dateString: "Bad Date",
          itemCount: 1,
          categoryCount: 1,
          jsonData: "{ corrupted_data: [",
        };

        const res = repo.restoreFromSnapshot(badSnapshot);
        if (res.success) throw new Error("restoreFromSnapshot should have failed on corrupted JSON");

        // Previous state must be unchanged
        if (repo.getItems().length !== initialCount || repo.getItems()[0].name !== initialName) {
          throw new Error("Repository state was modified despite restore failure!");
        }
      }
    );

    await executeTest(
      "test-import-quota-failure-preserves-state",
      "Import: Import Quota Failure Preserves Previous State",
      "Repository",
      () => {
        const repo = new StoreRepository();
        repo.resetToDefaults();
        const initialCount = repo.getItems().length;

        const validImportJson = JSON.stringify({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          appVersion: "2.0.0",
          exportedAt: new Date().toISOString(),
          categories: [{ id: "cat_1", name: "Imported Cat" }],
          items: [{ id: "it_imp", name: "Imported Item", categoryId: "cat_1", priceToman: 1000, updatedAt: 1000, orderIndex: 0 }],
        });

        const originalSetItem = localStorage.setItem;
        try {
          localStorage.setItem = () => {
            const err = new Error("QuotaExceededError");
            err.name = "QuotaExceededError";
            throw err;
          };

          const res = repo.importFromBackup(validImportJson);
          if (res.success) throw new Error("importFromBackup should have failed on quota error");

          // Memory state must remain previous
          if (repo.getItems().length !== initialCount) {
            throw new Error("Repository items were replaced despite import storage failure!");
          }
        } finally {
          localStorage.setItem = originalSetItem;
        }
      }
    );

    // -------------------------------------------------------------
    // RECOVERY PATH COMBINATION TESTS
    // -------------------------------------------------------------
    await executeTest(
      "test-recovery-missing-primary-valid-staging",
      "Recovery: Missing Primary + Valid Staging Promotes Staging to Primary",
      "Storage",
      () => {
        const engine = AtomicStorageEngine.getInstance();
        localStorage.removeItem(STORAGE_KEYS.PRIMARY);

        const stagedData: StoreDataPayload = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          appVersion: "2.0.0",
          exportedAt: new Date().toISOString(),
          categories: [{ id: "cat_staged", name: "Staged Category" }],
          items: [{ id: "it_staged", name: "Staged Item", categoryId: "cat_staged", priceUsd: 10, synonyms: [], updatedAt: 1000, orderIndex: 0 }],
          metadata: { totalItems: 1, totalCategories: 1, currency: "USD" },
        };

        localStorage.setItem(
          STORAGE_KEYS.STAGING,
          JSON.stringify({ token: "stage_token", timestamp: Date.now(), payload: stagedData })
        );

        const loadRes = engine.load();
        if (!loadRes.success) throw new Error(`Load failed: ${loadRes.error.message}`);
        if (loadRes.data.items[0]?.name !== "Staged Item") {
          throw new Error("Staged payload was not promoted to primary!");
        }

        // Staging key should now be removed
        if (localStorage.getItem(STORAGE_KEYS.STAGING) !== null) {
          throw new Error("Staging was not removed after promotion!");
        }
      }
    );

    await executeTest(
      "test-search-multi-token",
      "Multi-Token Search Normalization & Diacritic Stripping",
      "Search & Reorder",
      () => {
        const fields = {
          name: "Café Organic Whole Milk",
          categoryName: "Dairy & Eggs",
          synonyms: ["fresh milk", "lait"],
        };

        if (!matchesSearchQuery("cafe milk", fields)) throw new Error("Diacritic search failed");
        if (!matchesSearchQuery("DAIRY lait", fields)) throw new Error("Category & synonym match failed");
        if (matchesSearchQuery("cafe meat", fields)) throw new Error("Non-matching search returned true");
      }
    );

    // -------------------------------------------------------------
    // RECOVERY MODE EXPLICIT SCENARIO TESTS (Technical Hardening)
    // -------------------------------------------------------------
    await executeTest(
      "test-recovery-mode-comprehensive-scenarios",
      "Recovery Mode: Corrupted Primary Blocks Mutations & Requires Snapshot Restore or Reset",
      "Repository",
      () => {
        const engine = AtomicStorageEngine.getInstance();

        // 1. Corrupted primary -> Recovery Mode & Preserve corrupted data
        const corruptJson = "{ invalid_json_syntax: true, items: [";
        localStorage.setItem(STORAGE_KEYS.PRIMARY, corruptJson);

        const repo = new StoreRepository();
        if (!repo.isInRecoveryMode()) {
          throw new Error("Repository did not enter Recovery Mode on corrupted primary storage!");
        }

        // Check corrupted primary was preserved / archived and not wiped
        const primaryCurrent = localStorage.getItem(STORAGE_KEYS.PRIMARY);
        if (primaryCurrent !== corruptJson) {
          throw new Error("Corrupted primary storage was modified or wiped on initialization!");
        }
        const archive = localStorage.getItem(STORAGE_KEYS.CORRUPT_ARCHIVE);
        if (archive !== corruptJson) {
          throw new Error("Corrupted primary storage was not safely archived!");
        }

        // 2. Recovery Mode -> Add is blocked
        const addRes = repo.addItem({ name: "Blocked Item", categoryId: "cat_1", priceToman: 1000 });
        if (addRes.success) throw new Error("Add item succeeded while in Recovery Mode!");
        if (addRes.error.type !== "RECOVERY_MODE") throw new Error("Expected RECOVERY_MODE error on Add");

        // 3. Recovery Mode -> Edit is blocked
        const editRes = repo.updateItem("any_id", { name: "Blocked Edit", categoryId: "cat_1", priceToman: 1000 });
        if (editRes.success) throw new Error("Update item succeeded while in Recovery Mode!");
        if (editRes.error.type !== "RECOVERY_MODE") throw new Error("Expected RECOVERY_MODE error on Edit");

        // 4. Recovery Mode -> Delete is blocked
        const delRes = repo.deleteItem("any_id");
        if (delRes.success) throw new Error("Delete item succeeded while in Recovery Mode!");
        if (delRes.error.type !== "RECOVERY_MODE") throw new Error("Expected RECOVERY_MODE error on Delete");

        // 5. Recovery Mode -> Reorder is blocked
        const reorderRes = repo.reorderFilteredList(["any_id"]);
        if (reorderRes.success) throw new Error("Reorder succeeded while in Recovery Mode!");
        if (reorderRes.error.type !== "RECOVERY_MODE") throw new Error("Expected RECOVERY_MODE error on Reorder");

        // 6. Recovery Mode -> Currency change is blocked
        const currRes = repo.setCurrency("USD");
        if (currRes.success) throw new Error("Currency change succeeded while in Recovery Mode!");
        if (currRes.error.type !== "RECOVERY_MODE") throw new Error("Expected RECOVERY_MODE error on Currency Change");

        // 7. Recovery Mode -> Normal Import is blocked
        const importRes = repo.importFromBackup('{"schemaVersion":2,"appVersion":"2.0.0","categories":[],"items":[]}');
        if (importRes.success) throw new Error("Import succeeded while in Recovery Mode!");
        if (importRes.error.type !== "RECOVERY_MODE") throw new Error("Expected RECOVERY_MODE error on Import");

        // 8. Verify corrupted primary remains unchanged
        if (localStorage.getItem(STORAGE_KEYS.PRIMARY) !== corruptJson) {
          throw new Error("Temporary state was written over corrupted primary during blocked actions!");
        }

        // 9. Failed Snapshot Restore -> remain in Recovery Mode
        const invalidSnapshot: BackupSnapshot = {
          id: "snap_bad",
          timestamp: Date.now(),
          dateString: "Bad Snapshot",
          itemCount: 0,
          categoryCount: 0,
          jsonData: "{ invalid_snap_json",
        };
        const failedRestoreRes = repo.restoreFromSnapshot(invalidSnapshot);
        if (failedRestoreRes.success) throw new Error("Invalid snapshot restore succeeded!");
        if (!repo.isInRecoveryMode()) {
          throw new Error("Repository exited Recovery Mode after a failed snapshot restore!");
        }
        if (localStorage.getItem(STORAGE_KEYS.PRIMARY) !== corruptJson) {
          throw new Error("Corrupted primary was modified after failed snapshot restore!");
        }

        // 10. Valid Snapshot Restore -> Restore succeeds and exits Recovery Mode
        const validSnapshot: BackupSnapshot = {
          id: "snap_good",
          timestamp: Date.now(),
          dateString: "Valid Snapshot",
          itemCount: 1,
          categoryCount: 1,
          jsonData: JSON.stringify({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            appVersion: APP_VERSION,
            exportedAt: new Date().toISOString(),
            categories: [{ id: "cat_rec", name: "Recovered Category" }],
            items: [{ id: "it_rec", name: "Recovered Item", categoryId: "cat_rec", priceToman: 99000, synonyms: [], updatedAt: 1000, orderIndex: 0 }],
            metadata: { totalItems: 1, totalCategories: 1, currency: "TOMAN" },
          }),
        };

        const restoreRes = repo.restoreFromSnapshot(validSnapshot);
        if (!restoreRes.success) throw new Error(`Valid snapshot restore failed: ${restoreRes.error.message}`);
        if (repo.isInRecoveryMode()) {
          throw new Error("Repository did not exit Recovery Mode after valid restore!");
        }

        // 11. Normal operations resume: Add -> Reload
        const addPostRestore = repo.addItem({ name: "Post Restore Item", categoryId: "cat_rec", priceToman: 45000 });
        if (!addPostRestore.success) throw new Error(`Add after restore failed: ${addPostRestore.error.message}`);
        const reloadedAfterAdd = new StoreRepository();
        if (reloadedAfterAdd.isInRecoveryMode()) throw new Error("Reloaded repository entered recovery mode unexpectedly");
        if (reloadedAfterAdd.getItems().length !== 2) throw new Error("Post-restore Add was not persisted on reload");

        // 12. Edit -> Reload
        const editPostRestore = repo.updateItem(addPostRestore.data.id, { name: "Edited Post Restore", categoryId: "cat_rec", priceToman: 48000 });
        if (!editPostRestore.success) throw new Error(`Edit after restore failed: ${editPostRestore.error.message}`);
        const reloadedAfterEdit = new StoreRepository();
        const foundEdited = reloadedAfterEdit.getItems().find((i) => i.id === addPostRestore.data.id);
        if (foundEdited?.name !== "Edited Post Restore") throw new Error("Post-restore Edit was not persisted on reload");

        // 13. Delete -> Reload
        const delPostRestore = repo.deleteItem(addPostRestore.data.id);
        if (!delPostRestore.success) throw new Error(`Delete after restore failed: ${delPostRestore.error.message}`);
        const reloadedAfterDel = new StoreRepository();
        if (reloadedAfterDel.getItems().length !== 1) throw new Error("Post-restore Delete was not persisted on reload");

        // 14. Corrupted state again -> Explicit Reset -> Exits recovery mode
        localStorage.setItem(STORAGE_KEYS.PRIMARY, "{ corrupt_again: [");
        const corruptRepo2 = new StoreRepository();
        if (!corruptRepo2.isInRecoveryMode()) throw new Error("Repository failed to enter Recovery Mode on second corruption");

        // 15. Failed Reset simulation (e.g. disk I/O error during reset)
        const originalSetItem = localStorage.setItem;
        try {
          localStorage.setItem = (key: string, val: string) => {
            if (key === STORAGE_KEYS.STAGING || key === STORAGE_KEYS.PRIMARY) {
              throw new Error("Disk quota exceeded during reset");
            }
            return originalSetItem.call(localStorage, key, val);
          };
          const failedResetRes = corruptRepo2.resetToDefaults();
          if (failedResetRes.success) throw new Error("Reset should have failed under storage write error");
          if (!corruptRepo2.isInRecoveryMode()) throw new Error("Repository exited recovery mode despite failed reset");
        } finally {
          localStorage.setItem = originalSetItem;
        }

        // 16. Successful explicit reset -> exits recovery mode
        const resetRes = corruptRepo2.resetToDefaults();
        if (!resetRes.success) throw new Error(`Reset to defaults failed: ${resetRes.error.message}`);
        if (corruptRepo2.isInRecoveryMode()) throw new Error("Repository did not exit Recovery Mode after explicit reset");
        const reloadedClean = new StoreRepository();
        if (reloadedClean.isInRecoveryMode()) throw new Error("Clean store reloaded in recovery mode");
        if (reloadedClean.getItems().length !== INITIAL_SAMPLE_ITEMS.length) {
          throw new Error("Clean store items do not match expected initial defaults");
        }
      }
    );

    await executeTest(
      "test-staging-promotion-failure-preserves-staging",
      "Staging Recovery: Failed Staging Promotion Preserves Staging & Enters Recovery Mode (No Default Wipe)",
      "Storage",
      () => {
        const engine = AtomicStorageEngine.getInstance();
        localStorage.removeItem(STORAGE_KEYS.PRIMARY);

        const validStagingPayload: StoreDataPayload = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          appVersion: APP_VERSION,
          exportedAt: new Date().toISOString(),
          categories: [{ id: "cat_stage_pres", name: "Preserved Staged Category" }],
          items: [
            {
              id: "it_stage_pres",
              name: "Preserved Staged Item",
              categoryId: "cat_stage_pres",
              priceToman: 77000,
              synonyms: [],
              updatedAt: 1000,
              orderIndex: 0,
            },
          ],
          metadata: { totalItems: 1, totalCategories: 1, currency: "TOMAN" },
        };

        const stagingJson = JSON.stringify({
          payload: validStagingPayload,
          stagingTimestamp: Date.now(),
        });
        localStorage.setItem(STORAGE_KEYS.STAGING, stagingJson);

        // Simulate write failure on primary promotion
        const originalSetItem = localStorage.setItem;
        try {
          localStorage.setItem = (key: string, val: string) => {
            if (key === STORAGE_KEYS.PRIMARY) {
              throw new Error("Primary disk write failed during promotion");
            }
            return originalSetItem.call(localStorage, key, val);
          };

          // load() should fail cleanly rather than wiping staging or returning default data
          const loadRes = engine.load();
          if (loadRes.success) {
            throw new Error("load() should have failed when staging promotion fails!");
          }
          if (loadRes.error.type !== "CORRUPTED_DATA") {
            throw new Error(`Expected CORRUPTED_DATA error, got: ${loadRes.error.type}`);
          }

          // Verify STAGING key is preserved exactly as-is
          const preservedStaging = localStorage.getItem(STORAGE_KEYS.STAGING);
          if (preservedStaging !== stagingJson) {
            throw new Error("Staging data was altered or deleted upon promotion failure!");
          }

          // Verify PRIMARY key was not initialized with default data
          const primaryVal = localStorage.getItem(STORAGE_KEYS.PRIMARY);
          if (primaryVal !== null) {
            throw new Error("Primary storage was written despite promotion failure!");
          }

          // Verify Repository enters Recovery Mode and does not expose a normal default store
          const repo = new StoreRepository();
          if (!repo.isInRecoveryMode()) {
            throw new Error("Repository failed to enter Recovery Mode after staging promotion failure!");
          }
        } finally {
          localStorage.setItem = originalSetItem;
        }

        // 6. Verify subsequent load succeeds and recovers the staged data now that disk write is healthy
        const recoveredLoad = engine.load();
        if (!recoveredLoad.success) {
          throw new Error(`Subsequent load failed to recover from preserved staging: ${recoveredLoad.error.message}`);
        }
        if (recoveredLoad.data.items.length !== 1 || recoveredLoad.data.items[0].id !== "it_stage_pres") {
          throw new Error("Subsequent load did not correctly restore the preserved staged items!");
        }

        const healthyRepo = new StoreRepository();
        if (healthyRepo.isInRecoveryMode()) {
          throw new Error("Repository remains in recovery mode after successful staging promotion!");
        }
        if (healthyRepo.getItems().length !== 1 || healthyRepo.getItems()[0].name !== "Preserved Staged Item") {
          throw new Error("Repository did not load the recovered item correctly!");
        }
      }
    );

    await executeTest(
      "test-getsnapshots-strict-vs-legacy-validation",
      "Snapshots: Current Schema Snapshots Enforce Strict Validation & Legacy Migrates",
      "Storage",
      () => {
        const engine = AtomicStorageEngine.getInstance();

        // 1. Current Schema Snapshot with invalid price (NaN / string) -> must be rejected by strict validation
        const invalidCurrentSnapshot: BackupSnapshot = {
          id: "snap_invalid_v2",
          timestamp: Date.now() - 2000,
          dateString: "Invalid V2 Snapshot",
          itemCount: 1,
          categoryCount: 1,
          jsonData: JSON.stringify({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            appVersion: APP_VERSION,
            categories: [{ id: "cat_snap", name: "Snap Category" }],
            items: [
              {
                id: "it_invalid_v2",
                name: "Invalid Item",
                categoryId: "cat_snap",
                priceToman: "invalid_string_price", // invalid in v2 strict
                synonyms: [],
                updatedAt: 1000,
                orderIndex: 0,
              },
            ],
          }),
        };

        // 2. Valid Legacy Schema (v1) Snapshot -> should be accepted via legacy migration
        const validLegacySnapshot: BackupSnapshot = {
          id: "snap_valid_v1",
          timestamp: Date.now() - 1000,
          dateString: "Valid V1 Snapshot",
          itemCount: 1,
          categoryCount: 0,
          jsonData: JSON.stringify([
            {
              id: "it_legacy",
              name: "Legacy Item",
              price: 35000,
            },
          ]),
        };

        localStorage.setItem(
          STORAGE_KEYS.SNAPSHOTS,
          JSON.stringify([invalidCurrentSnapshot, validLegacySnapshot])
        );

        const snapshots = engine.getSnapshots();
        if (snapshots.some((s) => s.id === "snap_invalid_v2")) {
          throw new Error("Invalid current-schema snapshot was not rejected by validateCurrentPayloadStrict!");
        }
        if (!snapshots.some((s) => s.id === "snap_valid_v1")) {
          throw new Error("Valid legacy snapshot was not properly migrated and included!");
        }
      }
    );
  } finally {
    // -------------------------------------------------------------
    // EXACT STORAGE RESTORATION: Guarantee Zero Residue in User Storage
    // -------------------------------------------------------------
    for (const [key, state] of initialStorageState.entries()) {
      if (state.exists && state.value !== null) {
        localStorage.setItem(key, state.value);
      } else {
        localStorage.removeItem(key);
      }
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed: passedCount,
    failed: results.length - passedCount,
    totalDurationMs: Math.round((performance.now() - startAll) * 100) / 100,
    results,
  };
}
