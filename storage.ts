/**
 * Atomic & Transactional Storage Engine
 * Implements two-phase staged writes, crash recovery, corruption protection,
 * pre-mutation rolling snapshots, and persistent user preferences.
 */

import {
  CURRENT_SCHEMA_VERSION,
  APP_VERSION,
  StoreDataPayload,
  Result,
  BackupSnapshot,
  UserPreferences,
  DEFAULT_USER_PREFERENCES,
  INITIAL_DEFAULT_CATEGORIES,
  INITIAL_SAMPLE_ITEMS,
} from "../types/store";
import {
  validateCurrentPayloadStrict,
  migrateAndValidateStorePayload,
} from "./backupValidator";
import { generateUUID } from "../utils/helpers";

export const STORAGE_KEYS = {
  PRIMARY: "store_price_list_v2",
  STAGING: "store_price_list_v2_staging_tmp",
  SNAPSHOTS: "store_price_list_snapshots_v2",
  CORRUPT_ARCHIVE: "store_price_list_corrupted_archive",
  USER_PREFS: "store_price_list_prefs_v2",
} as const;

const MAX_SNAPSHOTS = 5;

export class AtomicStorageEngine {
  private static instance: AtomicStorageEngine;

  private constructor() {}

  public static getInstance(): AtomicStorageEngine {
    if (!AtomicStorageEngine.instance) {
      AtomicStorageEngine.instance = new AtomicStorageEngine();
    }
    return AtomicStorageEngine.instance;
  }

  /**
   * Save payload using an atomic 2-phase staged write.
   *
   * Hardened Sequence:
   * 1. Strictly validate the complete new payload before touching ANY storage key.
   * 2. Snapshot the PREVIOUS state prior to overwriting primary.
   * 3. Write and verify temporary staging key.
   * 4. Commit staged payload to primary storage key.
   * 5. Clean up staging key.
   */
  public saveAtomic(
    newPayload: StoreDataPayload,
    previousPayloadForSnapshot?: StoreDataPayload
  ): Result<void> {
    try {
      // 1. Storage-layer self-validation: Reject invalid payloads before writing anything!
      const validationRes = validateCurrentPayloadStrict(newPayload);
      if (!validationRes.success) {
        return {
          success: false,
          error: {
            type: "STORAGE",
            message: `Storage rejected invalid payload: ${validationRes.error.message}`,
            details: JSON.stringify(validationRes.error),
          },
        };
      }

      const validPayload = validationRes.data;

      // 2. Serialization of verified payload
      const serialized = JSON.stringify(validPayload, null, 2);
      if (!serialized || serialized.length === 0) {
        return {
          success: false,
          error: {
            type: "STORAGE",
            message: "Serialization produced an empty payload string.",
          },
        };
      }

      // 3. Snapshot PREVIOUS state BEFORE committing mutation to primary
      if (previousPayloadForSnapshot) {
        this.createSnapshotSafe(previousPayloadForSnapshot);
      } else {
        this.snapshotExistingPrimarySafe();
      }

      // 4. Phase 1: Write to temporary staging key with transactional envelope
      const stagingEnvelope = JSON.stringify({
        token: generateUUID(),
        timestamp: Date.now(),
        payload: validPayload,
      });

      try {
        localStorage.setItem(STORAGE_KEYS.STAGING, stagingEnvelope);
      } catch (storageErr: any) {
        // Attempt pruning snapshots to free quota if possible
        this.pruneOldestSnapshots();
        try {
          localStorage.setItem(STORAGE_KEYS.STAGING, stagingEnvelope);
        } catch (retryErr: any) {
          return {
            success: false,
            error: {
              type: "STORAGE",
              message: "Storage quota exceeded while writing staging buffer. Primary data was preserved.",
              details: String(retryErr?.message || storageErr?.message || retryErr),
            },
          };
        }
      }

      // 5. Verify staging content readback
      const stagingReadback = localStorage.getItem(STORAGE_KEYS.STAGING);
      if (!stagingReadback || stagingReadback !== stagingEnvelope) {
        try {
          localStorage.removeItem(STORAGE_KEYS.STAGING);
        } catch {}
        return {
          success: false,
          error: {
            type: "STORAGE",
            message: "Staging verification failed: readback did not match written staging payload.",
          },
        };
      }

      // 6. Phase 2: Commit staged content to primary storage key
      try {
        localStorage.setItem(STORAGE_KEYS.PRIMARY, serialized);
      } catch (commitErr: any) {
        // Commit failed - remove staging, leave previous primary intact
        try {
          localStorage.removeItem(STORAGE_KEYS.STAGING);
        } catch {}
        return {
          success: false,
          error: {
            type: "STORAGE",
            message: "Failed to commit payload to primary storage. Existing storage remains intact.",
            details: String(commitErr?.message || commitErr),
          },
        };
      }

      // 7. Cleanup staging key after verified commit
      try {
        localStorage.removeItem(STORAGE_KEYS.STAGING);
      } catch {}

      return { success: true, data: undefined };
    } catch (error: any) {
      try {
        localStorage.removeItem(STORAGE_KEYS.STAGING);
      } catch {}
      return {
        success: false,
        error: {
          type: "STORAGE",
          message: error?.message || "Unexpected storage failure during atomic save.",
          details: String(error),
        },
      };
    }
  }

  /**
   * Load data from storage with corruption detection, staged recovery, and strict validation.
   * If primary is corrupted, NEVER overwrite it with an empty/default dataset.
   */
  public load(): Result<StoreDataPayload> {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PRIMARY);

      // Case 1: First run / uninitialized storage
      if (!raw || raw.trim().length === 0) {
        // Check if there is valid recoverable staging before creating default
        const stagingRaw = localStorage.getItem(STORAGE_KEYS.STAGING);
        if (stagingRaw && stagingRaw.trim().length > 0) {
          try {
            const parsedStaging = JSON.parse(stagingRaw);
            const candidate = parsedStaging?.payload || parsedStaging;
            const valStaging = migrateAndValidateStorePayload(candidate);
            if (valStaging.success) {
              const saveRes = this.saveAtomic(valStaging.data);
              if (saveRes.success) {
                return { success: true, data: valStaging.data };
              } else {
                // Ensure the original staging data is strictly restored and preserved
                try {
                  localStorage.setItem(STORAGE_KEYS.STAGING, stagingRaw);
                } catch {}

                // Staging promotion failed: preserve staging key, do NOT create default data, return recovery/corruption error
                return {
                  success: false,
                  error: {
                    type: "CORRUPTED_DATA",
                    message: `Valid recoverable staging data exists but failed to promote to primary: ${saveRes.error.message}`,
                    rawSnippet: stagingRaw.length > 400 ? stagingRaw.substring(0, 400) + "..." : stagingRaw,
                  },
                };
              }
            }
          } catch {}
        }

        // Initialize clean default sample payload only when there is no recoverable staging data
        const initialPayload: StoreDataPayload = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          appVersion: APP_VERSION,
          exportedAt: new Date().toISOString(),
          categories: INITIAL_DEFAULT_CATEGORIES,
          items: INITIAL_SAMPLE_ITEMS,
          metadata: {
            totalItems: INITIAL_SAMPLE_ITEMS.length,
            totalCategories: INITIAL_DEFAULT_CATEGORIES.length,
            currency: "TOMAN",
          },
        };

        const saveRes = this.saveAtomic(initialPayload);
        if (!saveRes.success) {
          return { success: false, error: saveRes.error };
        }
        return { success: true, data: initialPayload };
      }

      // Case 2: Parse & validate primary storage
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (parseError: any) {
        // CORRUPTED JSON DETECTED: Archive and protect from wipeout!
        try {
          localStorage.setItem(STORAGE_KEYS.CORRUPT_ARCHIVE, raw);
        } catch {}

        return {
          success: false,
          error: {
            type: "CORRUPTED_DATA",
            message: `Corrupted storage JSON syntax: ${parseError?.message || "Invalid JSON"}`,
            rawSnippet: raw.length > 400 ? raw.substring(0, 400) + "..." : raw,
          },
        };
      }

      // Validate schema and data integrity
      const validationResult = migrateAndValidateStorePayload(parsed);
      if (!validationResult.success) {
        try {
          localStorage.setItem(STORAGE_KEYS.CORRUPT_ARCHIVE, raw);
        } catch {}

        return {
          success: false,
          error: {
            type: "CORRUPTED_DATA",
            message: validationResult.error.message,
            rawSnippet: raw.length > 400 ? raw.substring(0, 400) + "..." : raw,
          },
        };
      }

      // Clean any stale staging leftovers since primary is 100% valid
      try {
        localStorage.removeItem(STORAGE_KEYS.STAGING);
      } catch {}

      return { success: true, data: validationResult.data };
    } catch (error: any) {
      return {
        success: false,
        error: {
          type: "STORAGE",
          message: error?.message || "Failed to load storage.",
          details: String(error),
        },
      };
    }
  }

  /**
   * Save a snapshot in rolling history (captures state BEFORE mutation).
   * Snapshot failures are caught safely and do not abort the main save.
   */
  public createSnapshotSafe(payloadToSnapshot: StoreDataPayload): void {
    try {
      if (!payloadToSnapshot || !Array.isArray(payloadToSnapshot.items)) return;

      const existing = this.getSnapshots();
      const newSnapshot: BackupSnapshot = {
        id: generateUUID(),
        timestamp: Date.now(),
        dateString: new Date().toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        itemCount: payloadToSnapshot.items.length,
        categoryCount: payloadToSnapshot.categories ? payloadToSnapshot.categories.length : 0,
        jsonData: JSON.stringify(payloadToSnapshot),
      };

      const updated = [newSnapshot, ...existing.slice(0, MAX_SNAPSHOTS - 1)];
      localStorage.setItem(STORAGE_KEYS.SNAPSHOTS, JSON.stringify(updated));
    } catch {
      // If snapshot storage fails (e.g. quota), attempt pruning
      this.pruneOldestSnapshots();
    }
  }

  /**
   * Helper to prune older snapshots when space is needed
   */
  private pruneOldestSnapshots(): void {
    try {
      const existing = this.getSnapshots();
      if (existing.length > 2) {
        const trimmed = existing.slice(0, 2);
        localStorage.setItem(STORAGE_KEYS.SNAPSHOTS, JSON.stringify(trimmed));
      }
    } catch {}
  }

  /**
   * Safe helper to snapshot whatever is currently in primary storage
   */
  private snapshotExistingPrimarySafe(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PRIMARY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          this.createSnapshotSafe(parsed);
        }
      }
    } catch {}
  }

  /**
   * Retrieve list of automated backup snapshots for recovery
   */
  public getSnapshots(): BackupSnapshot[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SNAPSHOTS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      const validSnapshots: BackupSnapshot[] = [];
      for (const s of parsed) {
        if (!s || typeof s !== "object" || Array.isArray(s)) continue;
        if (typeof s.id !== "string" || s.id.trim().length === 0) continue;
        if (typeof s.timestamp !== "number" || isNaN(s.timestamp) || s.timestamp <= 0) continue;
        if (typeof s.dateString !== "string" || s.dateString.trim().length === 0) continue;
        if (typeof s.jsonData !== "string" || s.jsonData.trim().length === 0) continue;

        try {
          const snapshotPayload = JSON.parse(s.jsonData);
          let valRes: Result<StoreDataPayload>;
          
          if (snapshotPayload && typeof snapshotPayload === "object" && (snapshotPayload as any).schemaVersion === CURRENT_SCHEMA_VERSION) {
            valRes = validateCurrentPayloadStrict(snapshotPayload);
          } else {
            valRes = migrateAndValidateStorePayload(snapshotPayload);
          }

          if (!valRes.success) {
            // Corrupted or invalid payload inside snapshot - discard / reject
            continue;
          }
          validSnapshots.push({
            id: s.id.trim(),
            timestamp: s.timestamp,
            dateString: s.dateString.trim(),
            itemCount: typeof s.itemCount === "number" && s.itemCount >= 0 ? s.itemCount : valRes.data.items.length,
            categoryCount: typeof s.categoryCount === "number" && s.categoryCount >= 0 ? s.categoryCount : valRes.data.categories.length,
            jsonData: s.jsonData,
          });
        } catch {
          // JSON parsing failed for snapshot payload
          continue;
        }
      }
      return validSnapshots;
    } catch {
      return [];
    }
  }

  /**
   * Restore state from a specific backup snapshot with full transactional safety
   */
  public restoreFromSnapshot(
    snapshot: BackupSnapshot,
    currentPayloadToSnapshot?: StoreDataPayload
  ): Result<StoreDataPayload> {
    try {
      if (!snapshot || typeof snapshot !== "object" || !snapshot.jsonData) {
        return {
          success: false,
          error: {
            type: "STORAGE",
            message: "Selected snapshot does not contain valid data.",
          },
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(snapshot.jsonData);
      } catch {
        return {
          success: false,
          error: {
            type: "IMPORT_VALIDATION",
            message: "Snapshot contains invalid JSON syntax.",
            errors: ["Invalid JSON syntax in snapshot jsonData"],
          },
        };
      }

      const validationRes = migrateAndValidateStorePayload(parsed);
      if (!validationRes.success) {
        return {
          success: false,
          error: {
            type: "IMPORT_VALIDATION",
            message: `Snapshot data is invalid: ${validationRes.error.message}`,
            errors: (validationRes.error as any).errors || [],
          },
        };
      }

      const validatedPayload = validationRes.data;

      // Commit atomically, saving current state as a snapshot before overwrite
      const saveRes = this.saveAtomic(validatedPayload, currentPayloadToSnapshot);
      if (!saveRes.success) {
        return { success: false, error: saveRes.error };
      }

      return { success: true, data: validatedPayload };
    } catch (e: any) {
      return {
        success: false,
        error: {
          type: "STORAGE",
          message: `Failed to restore snapshot: ${e?.message || "Invalid snapshot format"}`,
        },
      };
    }
  }

  /**
   * Reset store data completely to initial clean defaults
   */
  public resetToDefaults(currentPayloadToSnapshot?: StoreDataPayload): Result<StoreDataPayload> {
    const activeCurrency = currentPayloadToSnapshot?.metadata?.currency === "USD" ? "USD" : "TOMAN";
    const defaultPayload: StoreDataPayload = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      categories: INITIAL_DEFAULT_CATEGORIES,
      items: INITIAL_SAMPLE_ITEMS,
      metadata: {
        totalItems: INITIAL_SAMPLE_ITEMS.length,
        totalCategories: INITIAL_DEFAULT_CATEGORIES.length,
        currency: activeCurrency,
      },
    };

    const res = this.saveAtomic(defaultPayload, currentPayloadToSnapshot);
    if (!res.success) return { success: false, error: res.error };
    return { success: true, data: defaultPayload };
  }

  /**
   * Retrieve user persistent preferences (Currency, etc.)
   */
  public getUserPreferences(): UserPreferences {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.USER_PREFS);
      if (!raw) return DEFAULT_USER_PREFERENCES;
      const parsed = JSON.parse(raw);
      return {
        currency: parsed?.currency === "USD" ? "USD" : "TOMAN",
      };
    } catch {
      return DEFAULT_USER_PREFERENCES;
    }
  }

  /**
   * Save user persistent preferences transactionally
   */
  public saveUserPreferences(prefs: UserPreferences): Result<void> {
    try {
      localStorage.setItem(STORAGE_KEYS.USER_PREFS, JSON.stringify(prefs));
      return { success: true, data: undefined };
    } catch (err: any) {
      return {
        success: false,
        error: {
          type: "STORAGE",
          message: `Failed to persist user preferences: ${err?.message || "Storage error"}`,
        },
      };
    }
  }

  /**
   * Retrieve archived corrupted text for diagnostic download
   */
  public getCorruptedArchive(): string | null {
    return localStorage.getItem(STORAGE_KEYS.CORRUPT_ARCHIVE);
  }
}
