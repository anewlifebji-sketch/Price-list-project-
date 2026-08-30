/**
 * Store ViewModel & Reactive Context Provider
 * Single source of truth for:
 *  - Immutable UI State
 *  - Persistent User Currency (TOMAN / USD)
 *  - Categories Dialog transaction binding (no parallel unsynced states)
 *  - Single-shot notification & Undo event queue
 *  - Storage corruption recovery handlers
 *  - Snapshot synchronicity across repository and storage engine
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import {
  Item,
  Category,
  StoreDataPayload,
  SortOrder,
  UndoItemAction,
  NotificationEvent,
  Result,
  CurrencyCode,
  CATEGORY_ALL_ID,
  CATEGORY_UNCATEGORIZED_ID,
  BackupSnapshot,
} from "../types/store";
import { StoreRepository } from "../data/storeRepository";
import { AtomicStorageEngine } from "../data/storage";
import { matchesSearchQuery } from "../utils/helpers";

export interface StoreContextType {
  // State
  items: Item[];
  categories: Category[];
  filteredItems: Item[];
  selectedCategoryId: string;
  searchQuery: string;
  sortOrder: SortOrder;
  currency: CurrencyCode;
  isLoaded: boolean;
  isCorrupted: boolean;
  corruptionDetails: string | null;
  corruptedRawSnippet: string | null;
  snapshots: BackupSnapshot[];
  undoAction: UndoItemAction | null;
  notifications: NotificationEvent[];

  // Selection & Active Modal States
  activeModal:
    | "none"
    | "item_dialog"
    | "categories_dialog"
    | "backup_dialog"
    | "test_suite_dialog"
    | "delete_confirm_dialog"
    | "corrupt_recovery_dialog";
  editingItem: Item | null;
  deletingItem: Item | null;

  // Actions
  setSelectedCategoryId: (catId: string) => void;
  setSearchQuery: (q: string) => void;
  setSortOrder: (order: SortOrder) => void;
  setCurrency: (curr: CurrencyCode) => void;
  openAddItemDialog: () => void;
  openEditItemDialog: (item: Item) => void;
  openCategoriesDialog: () => void;
  openBackupDialog: () => void;
  openTestSuiteDialog: () => void;
  openDeleteConfirmDialog: (item: Item) => void;
  closeModal: () => void;

  // Domain CRUD
  addItem: (data: {
    name: string;
    categoryId: string;
    priceToman?: number;
    priceUsd?: number;
    price?: number;
    unit?: string;
    synonyms?: string[];
    barcode?: string;
    notes?: string;
  }) => Result<Item>;

  updateItem: (
    itemId: string,
    data: {
      name: string;
      categoryId: string;
      priceToman?: number;
      priceUsd?: number;
      price?: number;
      unit?: string;
      synonyms?: string[];
      barcode?: string;
      notes?: string;
    }
  ) => Result<Item>;

  deleteItem: (itemId: string) => Result<void>;
  undoDelete: () => void;
  dismissUndo: () => void;

  reorderItems: (filteredReorderedIds: string[]) => Result<Item[]>;

  addCategory: (name: string, color?: string) => Result<Category>;
  renameCategory: (categoryId: string, newName: string, color?: string) => Result<Category>;
  deleteCategory: (categoryId: string, reassignTargetId?: string) => Result<{ reassignedCount: number }>;

  importBackup: (fileContent: string, fileSizeBytes?: number) => Result<StoreDataPayload>;
  exportBackupJson: () => string;
  restoreFromSnapshot: (snapshot: BackupSnapshot) => Result<void>;
  resetToDefaults: () => void;

  // Notification actions
  pushNotification: (
    type: "success" | "error" | "info" | "warning",
    message: string,
    title?: string,
    action?: { label: string; onClick: () => void }
  ) => void;
  dismissNotification: (id: string) => void;
}

const StoreContext = createContext<StoreContextType | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const repositoryRef = React.useRef<StoreRepository | null>(null);
  if (!repositoryRef.current) {
    repositoryRef.current = new StoreRepository();
  }
  const repository = repositoryRef.current;
  const storageEngine = AtomicStorageEngine.getInstance();

  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(CATEGORY_ALL_ID);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.CUSTOM);
  const [currency, setCurrencyState] = useState<CurrencyCode>("TOMAN");

  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [isCorrupted, setIsCorrupted] = useState<boolean>(false);
  const [corruptionDetails, setCorruptionDetails] = useState<string | null>(null);
  const [corruptedRawSnippet, setCorruptedRawSnippet] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([]);

  // Modals & Active Edit Targets
  const [activeModal, setActiveModal] = useState<StoreContextType["activeModal"]>("none");
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [deletingItem, setDeletingItem] = useState<Item | null>(null);

  // Undo and Notifications
  const [undoAction, setUndoAction] = useState<UndoItemAction | null>(null);
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);

  const pushNotification = useCallback(
    (
      type: "success" | "error" | "info" | "warning",
      message: string,
      title?: string,
      action?: { label: string; onClick: () => void }
    ) => {
      const id = "notif_" + Math.random().toString(36).substring(2, 9);
      const newNotif: NotificationEvent = {
        id,
        type,
        message,
        title,
        action,
        durationMs: action ? 7500 : 4000,
      };
      setNotifications((prev) => [...prev, newNotif]);
    },
    []
  );

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Initialize and load store data
  const loadInitialData = useCallback(() => {
    const loadRes = storageEngine.load();
    setCurrencyState(repository.getCurrency());

    if (loadRes.success) {
      setItems(loadRes.data.items);
      setCategories(loadRes.data.categories);
      setCurrencyState(loadRes.data.metadata?.currency === "USD" ? "USD" : "TOMAN");
      setIsCorrupted(false);
      setCorruptionDetails(null);
      setCorruptedRawSnippet(null);
    } else {
      if (loadRes.error.type === "CORRUPTED_DATA") {
        setIsCorrupted(true);
        setCorruptionDetails(loadRes.error.message);
        setCorruptedRawSnippet(loadRes.error.rawSnippet || null);
        setActiveModal("corrupt_recovery_dialog");
      } else {
        pushNotification("error", loadRes.error.message, "Storage Error");
      }
    }
    setSnapshots(storageEngine.getSnapshots());
    setIsLoaded(true);
  }, [storageEngine, pushNotification]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Set Currency handler
  const setCurrency = useCallback(
    (newCurrency: CurrencyCode) => {
      const res = repository.setCurrency(newCurrency);
      if (res.success) {
        setCurrencyState(newCurrency);
        pushNotification("info", `Display currency set to ${newCurrency}.`);
      } else {
        pushNotification("error", res.error.message, "Currency Update Failed");
      }
    },
    [repository, pushNotification]
  );

  // Undo Timer Expiry
  useEffect(() => {
    if (!undoAction) return;
    const remaining = undoAction.expiryTime - Date.now();
    if (remaining <= 0) {
      setUndoAction(null);
      return;
    }
    const timer = setTimeout(() => {
      setUndoAction(null);
    }, remaining);
    return () => clearTimeout(timer);
  }, [undoAction]);

  // Modals helpers
  const openAddItemDialog = useCallback(() => {
    setEditingItem(null);
    setActiveModal("item_dialog");
  }, []);

  const openEditItemDialog = useCallback((item: Item) => {
    setEditingItem(item);
    setActiveModal("item_dialog");
  }, []);

  const openCategoriesDialog = useCallback(() => {
    setActiveModal("categories_dialog");
  }, []);

  const openBackupDialog = useCallback(() => {
    setSnapshots(storageEngine.getSnapshots());
    setActiveModal("backup_dialog");
  }, [storageEngine]);

  const openTestSuiteDialog = useCallback(() => {
    setActiveModal("test_suite_dialog");
  }, []);

  const openDeleteConfirmDialog = useCallback((item: Item) => {
    setDeletingItem(item);
    setActiveModal("delete_confirm_dialog");
  }, []);

  const closeModal = useCallback(() => {
    setActiveModal("none");
    setEditingItem(null);
    setDeletingItem(null);
  }, []);

  // CRUD Item Operations
  const addItem = useCallback(
    (data: {
      name: string;
      categoryId: string;
      priceToman?: number;
      priceUsd?: number;
      price?: number;
      unit?: string;
      synonyms?: string[];
      barcode?: string;
      notes?: string;
    }): Result<Item> => {
      const res = repository.addItem(data);
      if (res.success) {
        setItems(repository.getItems());
        setSnapshots(storageEngine.getSnapshots());
        pushNotification("success", `Item '${res.data.name}' added successfully.`);
      }
      return res;
    },
    [repository, storageEngine, pushNotification]
  );

  const updateItem = useCallback(
    (
      itemId: string,
      data: {
        name: string;
        categoryId: string;
        priceToman?: number;
        priceUsd?: number;
        price?: number;
        unit?: string;
        synonyms?: string[];
        barcode?: string;
        notes?: string;
      }
    ): Result<Item> => {
      const res = repository.updateItem(itemId, data);
      if (res.success) {
        setItems(repository.getItems());
        setSnapshots(storageEngine.getSnapshots());
        pushNotification("success", `Updated '${res.data.name}' successfully.`);
      }
      return res;
    },
    [repository, storageEngine, pushNotification]
  );

  const deleteItem = useCallback(
    (itemId: string): Result<void> => {
      const res = repository.deleteItem(itemId);
      if (res.success) {
        setItems(repository.getItems());
        setSnapshots(storageEngine.getSnapshots());
        setUndoAction(res.data.undoAction);
        pushNotification(
          "info",
          `Item '${res.data.deletedItem.name}' removed.`,
          undefined,
          {
            label: "Undo",
            onClick: () => {
              const undoRes = repository.undoDeleteItem(res.data.undoAction);
              if (undoRes.success) {
                setItems(repository.getItems());
                setUndoAction(null);
                pushNotification("success", `Restored '${undoRes.data.name}'.`);
              }
            },
          }
        );
        return { success: true, data: undefined };
      }
      return res;
    },
    [repository, storageEngine, pushNotification]
  );

  const undoDelete = useCallback(() => {
    if (!undoAction) return;
    const undoRes = repository.undoDeleteItem(undoAction);
    if (undoRes.success) {
      setItems(repository.getItems());
      setUndoAction(null);
      pushNotification("success", `Restored '${undoRes.data.name}'.`);
    } else {
      pushNotification("error", undoRes.error.message, "Undo Failed");
    }
  }, [undoAction, repository, pushNotification]);

  const dismissUndo = useCallback(() => {
    setUndoAction(null);
  }, []);

  // Deterministic Reordering
  const reorderItems = useCallback(
    (filteredReorderedIds: string[]): Result<Item[]> => {
      const res = repository.reorderFilteredList(filteredReorderedIds);
      if (res.success) {
        setItems(repository.getItems());
      }
      return res;
    },
    [repository]
  );

  // Category Operations
  const addCategory = useCallback(
    (name: string, color?: string): Result<Category> => {
      const res = repository.addCategory(name, color);
      if (res.success) {
        setCategories(repository.getCategories());
        setSnapshots(storageEngine.getSnapshots());
        pushNotification("success", `Category '${res.data.name}' created.`);
      }
      return res;
    },
    [repository, storageEngine, pushNotification]
  );

  const renameCategory = useCallback(
    (categoryId: string, newName: string, color?: string): Result<Category> => {
      const res = repository.renameCategory(categoryId, newName, color);
      if (res.success) {
        setCategories(repository.getCategories());
        setSnapshots(storageEngine.getSnapshots());
        pushNotification("success", `Category renamed to '${res.data.name}'.`);
      }
      return res;
    },
    [repository, storageEngine, pushNotification]
  );

  const deleteCategory = useCallback(
    (categoryId: string, reassignTargetId: string = CATEGORY_UNCATEGORIZED_ID): Result<{ reassignedCount: number }> => {
      const res = repository.deleteCategory(categoryId, reassignTargetId);
      if (res.success) {
        setCategories(repository.getCategories());
        setItems(repository.getItems());
        setSnapshots(storageEngine.getSnapshots());
        if (selectedCategoryId === categoryId) {
          setSelectedCategoryId(CATEGORY_ALL_ID);
        }
        pushNotification(
          "info",
          `Category deleted. ${res.data.reassignedCount} item(s) reassigned to Uncategorized.`
        );
        return { success: true, data: { reassignedCount: res.data.reassignedCount } };
      }
      return res;
    },
    [repository, storageEngine, selectedCategoryId, pushNotification]
  );

  // Backup & Restore (Repository is the single source of truth!)
  const importBackup = useCallback(
    (fileContent: string, fileSizeBytes?: number): Result<StoreDataPayload> => {
      const res = repository.importFromBackup(fileContent, fileSizeBytes);
      if (res.success) {
        setItems(repository.getItems());
        setCategories(repository.getCategories());
        setCurrencyState(repository.getCurrency());
        setSelectedCategoryId(CATEGORY_ALL_ID);
        setSearchQuery("");
        setSnapshots(storageEngine.getSnapshots());
        pushNotification(
          "success",
          `Successfully imported ${res.data.items.length} items & ${res.data.categories.length} categories.`
        );
      }
      return res;
    },
    [repository, storageEngine, pushNotification]
  );

  const exportBackupJson = useCallback(() => {
    return repository.exportBackup();
  }, [repository]);

  const restoreFromSnapshot = useCallback(
    (snapshot: BackupSnapshot): Result<void> => {
      const res = repository.restoreFromSnapshot(snapshot);
      if (res.success) {
        setItems(repository.getItems());
        setCategories(repository.getCategories());
        setCurrencyState(repository.getCurrency());
        setIsCorrupted(false);
        setCorruptionDetails(null);
        closeModal();
        pushNotification("success", `Restored snapshot from ${snapshot.dateString}.`);
        return { success: true, data: undefined };
      }
      return res;
    },
    [repository, closeModal, pushNotification]
  );

  const resetToDefaults = useCallback(() => {
    const res = repository.resetToDefaults();
    if (res.success) {
      setItems(repository.getItems());
      setCategories(repository.getCategories());
      setCurrencyState(repository.getCurrency());
      setSelectedCategoryId(CATEGORY_ALL_ID);
      setSearchQuery("");
      setIsCorrupted(false);
      setCorruptionDetails(null);
      closeModal();
      pushNotification("info", "Store data reset to initial clean defaults.");
    }
  }, [repository, closeModal, pushNotification]);

  // Filtered & Sorted Items computation
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [categories]);

  const filteredItems = useMemo(() => {
    return items
      .filter((item) => {
        // Category Filter
        if (selectedCategoryId !== CATEGORY_ALL_ID && item.categoryId !== selectedCategoryId) {
          return false;
        }

        // Search Match
        if (searchQuery.trim().length > 0) {
          const categoryName = categoryMap.get(item.categoryId) || "Uncategorized";
          return matchesSearchQuery(searchQuery, {
            name: item.name,
            categoryName,
            synonyms: item.synonyms,
            barcode: item.barcode,
            notes: item.notes,
          });
        }

        return true;
      })
      .sort((a, b) => {
        const getSortPrice = (item: Item): number => {
          if (item.priceToman !== undefined && item.priceToman !== null) {
            return item.priceToman;
          }
          if (item.priceUsd !== undefined && item.priceUsd !== null) {
            return item.priceUsd * 100000; // normalized scale for sorting
          }
          return item.price ?? 0;
        };

        switch (sortOrder) {
          case SortOrder.NAME_ASC:
            return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          case SortOrder.NAME_DESC:
            return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
          case SortOrder.PRICE_ASC:
            return getSortPrice(a) - getSortPrice(b);
          case SortOrder.PRICE_DESC:
            return getSortPrice(b) - getSortPrice(a);
          case SortOrder.RECENT:
            return b.updatedAt - a.updatedAt;
          case SortOrder.CUSTOM:
          default:
            return a.orderIndex - b.orderIndex;
        }
      });
  }, [items, selectedCategoryId, searchQuery, sortOrder, categoryMap]);

  const value = useMemo(
    () => ({
      items,
      categories,
      filteredItems,
      selectedCategoryId,
      searchQuery,
      sortOrder,
      currency,
      isLoaded,
      isCorrupted,
      corruptionDetails,
      corruptedRawSnippet,
      snapshots,
      undoAction,
      notifications,
      activeModal,
      editingItem,
      deletingItem,
      setSelectedCategoryId,
      setSearchQuery,
      setSortOrder,
      setCurrency,
      openAddItemDialog,
      openEditItemDialog,
      openCategoriesDialog,
      openBackupDialog,
      openTestSuiteDialog,
      openDeleteConfirmDialog,
      closeModal,
      addItem,
      updateItem,
      deleteItem,
      undoDelete,
      dismissUndo,
      reorderItems,
      addCategory,
      renameCategory,
      deleteCategory,
      importBackup,
      exportBackupJson,
      restoreFromSnapshot,
      resetToDefaults,
      pushNotification,
      dismissNotification,
    }),
    [
      items,
      categories,
      filteredItems,
      selectedCategoryId,
      searchQuery,
      sortOrder,
      currency,
      isLoaded,
      isCorrupted,
      corruptionDetails,
      corruptedRawSnippet,
      snapshots,
      undoAction,
      notifications,
      activeModal,
      editingItem,
      deletingItem,
      setCurrency,
      openAddItemDialog,
      openEditItemDialog,
      openCategoriesDialog,
      openBackupDialog,
      openTestSuiteDialog,
      openDeleteConfirmDialog,
      closeModal,
      addItem,
      updateItem,
      deleteItem,
      undoDelete,
      dismissUndo,
      reorderItems,
      addCategory,
      renameCategory,
      deleteCategory,
      importBackup,
      exportBackupJson,
      restoreFromSnapshot,
      resetToDefaults,
      pushNotification,
      dismissNotification,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export const useStore = (): StoreContextType => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error("useStore must be used within a StoreProvider");
  }
  return context;
};
