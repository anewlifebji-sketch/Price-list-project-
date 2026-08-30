/**
 * MainScreen Component
 * Primary Store Price List view:
 *  - Fixed column tabular header (Item Name | Category | Price | Actions)
 *  - Persistent Currency Toggle (Toman / USD)
 *  - High-contrast, mobile-friendly header with fast search
 *  - Category filter pills with real-time item counts
 *  - Sort options & manual reorder toggle
 *  - Utilitarian, dense layout without visual bloat
 */

import React, { useEffect, useRef } from "react";
import { useStore } from "../context/StoreContext";
import { SortOrder, CATEGORY_ALL_ID, CurrencyCode } from "../types/store";
import { DraggableList } from "./DraggableList";
import { ItemDialog } from "./ItemDialog";
import { CategoriesDialog } from "./CategoriesDialog";
import { BackupDialog } from "./BackupDialog";
import { TestSuiteDialog } from "./TestSuiteDialog";
import { CorruptRecoveryDialog } from "./CorruptRecoveryDialog";
import { NotificationSnackbar } from "./NotificationSnackbar";
import {
  Search,
  Plus,
  Folder,
  Database,
  ShieldCheck,
  X,
  ArrowUpDown,
  ShoppingBag,
  Trash2,
  PackageSearch,
  Coins,
} from "lucide-react";

export const MainScreen: React.FC = () => {
  const {
    items,
    categories,
    filteredItems,
    selectedCategoryId,
    searchQuery,
    sortOrder,
    currency,
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
    deleteItem,
    reorderItems,
  } = useStore();

  const searchInputRef = useRef<HTMLInputElement>(null);
  const isCustomSort = sortOrder === SortOrder.CUSTOM;

  // Keyboard shortcut '/' to quickly focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Item counts per category
  const itemCountByCat = categories.reduce((acc, cat) => {
    acc[cat.id] = items.filter((it) => it.categoryId === cat.id).length;
    return acc;
  }, {} as { [catId: string]: number });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Top Application Bar */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          {/* Logo & Title */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-slate-900 tracking-tight truncate">
                Store Price List
              </h1>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              id="btn-open-categories"
              onClick={openCategoriesDialog}
              aria-label="Manage categories"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
              title="Categories manager"
            >
              <Folder className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden md:inline">Categories</span>
            </button>

            <button
              type="button"
              id="btn-open-backup"
              onClick={openBackupDialog}
              aria-label="Backup and export"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
              title="Backup and import JSON"
            >
              <Database className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden md:inline">Backup</span>
            </button>

            <button
              type="button"
              id="btn-open-test-suite"
              onClick={openTestSuiteDialog}
              aria-label="Run test suite"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
              title="Unit Test Suite & Verification"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden lg:inline">Tests</span>
            </button>

            <button
              type="button"
              id="btn-add-item-header"
              onClick={openAddItemDialog}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-all shrink-0 cursor-pointer active:scale-98"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Item</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-4 flex-1 space-y-3.5">
        {/* Search & Sort Bar */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              ref={searchInputRef}
              id="input-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search items, synonyms, category, barcode... (press '/' to focus)"
              className="w-full pl-9 pr-8 py-2 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm font-medium text-slate-900 placeholder-slate-400 shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-600 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                id="btn-clear-search"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Sort Selector */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <select
                id="select-sort-order"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                className="appearance-none pl-8 pr-7 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer"
              >
                <option value={SortOrder.CUSTOM}>Manual Custom Order</option>
                <option value={SortOrder.NAME_ASC}>Name (A to Z)</option>
                <option value={SortOrder.NAME_DESC}>Name (Z to A)</option>
                <option value={SortOrder.PRICE_ASC}>Price (Low to High)</option>
                <option value={SortOrder.PRICE_DESC}>Price (High to Low)</option>
                <option value={SortOrder.RECENT}>Recently Updated</option>
              </select>
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                <ArrowUpDown className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>
        </div>

        {/* Category Horizontal Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {/* "All" category pill */}
          <button
            type="button"
            onClick={() => setSelectedCategoryId(CATEGORY_ALL_ID)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
              selectedCategoryId === CATEGORY_ALL_ID
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
            }`}
          >
            <span>All</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                selectedCategoryId === CATEGORY_ALL_ID
                  ? "bg-slate-700 text-slate-100"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {items.length}
            </span>
          </button>

          {/* Individual Category Pills */}
          {categories.map((cat) => {
            const isSelected = selectedCategoryId === cat.id;
            const count = itemCountByCat[cat.id] || 0;
            const catColor = cat.color || "#64748b";

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all shrink-0 cursor-pointer ${
                  isSelected
                    ? "bg-slate-900 text-white shadow-xs font-semibold"
                    : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100"
                }`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: catColor }}
                />
                <span>{cat.name}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    isSelected ? "bg-slate-700 text-slate-100" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Fixed Column Header Bar for List */}
        <div className="hidden sm:flex items-center justify-between px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100/70 rounded-lg border border-slate-200/60">
          <div className="flex-1 min-w-0">Item Name</div>
          <div className="w-36 shrink-0">Category</div>
          <div className="w-44 shrink-0 text-right">Price (Toman / USD)</div>
          <div className="w-24 shrink-0 text-right">Actions</div>
        </div>

        {/* Item List or Empty State */}
        {filteredItems.length > 0 ? (
          <DraggableList
            items={filteredItems}
            categories={categories}
            onReorder={reorderItems}
            onEditItem={openEditItemDialog}
            onDeleteItem={openDeleteConfirmDialog}
            isDraggable={isCustomSort}
          />
        ) : (
          <div className="p-10 text-center bg-white rounded-xl border border-slate-200 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
              <PackageSearch className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {searchQuery || selectedCategoryId !== CATEGORY_ALL_ID
                  ? "No matching items found"
                  : "Price list is empty"}
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                {searchQuery || selectedCategoryId !== CATEGORY_ALL_ID
                  ? "Try clearing your search query or selecting a different category."
                  : "Add your first item or import a backup file to get started."}
              </p>
            </div>
            <div className="pt-1 flex items-center justify-center gap-2">
              {searchQuery || selectedCategoryId !== CATEGORY_ALL_ID ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedCategoryId(CATEGORY_ALL_ID);
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors"
                >
                  Reset Filters
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openAddItemDialog}
                  className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add First Item
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-3 text-center text-xs text-slate-400">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Store Price List &bull; Offline-First & Transactional</span>
          <span className="font-mono text-[11px]">v2.0.0 Release-Ready</span>
        </div>
      </footer>

      {/* Modals & Dialogs */}
      <ItemDialog
        isOpen={activeModal === "item_dialog"}
        onClose={closeModal}
        initialItem={editingItem}
      />

      <CategoriesDialog
        isOpen={activeModal === "categories_dialog"}
        onClose={closeModal}
      />

      <BackupDialog
        isOpen={activeModal === "backup_dialog"}
        onClose={closeModal}
      />

      <TestSuiteDialog
        isOpen={activeModal === "test_suite_dialog"}
        onClose={closeModal}
      />

      <CorruptRecoveryDialog />

      {/* Item Delete Confirmation Dialog */}
      {activeModal === "delete_confirm_dialog" && deletingItem && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs"
          role="dialog"
          aria-labelledby="delete-item-title"
        >
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2 rounded-xl bg-rose-50">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 id="delete-item-title" className="text-base font-bold text-slate-900">
                Delete "{deletingItem.name}"?
              </h3>
            </div>
            <p className="text-sm text-slate-600">
              Are you sure you want to remove this item? You can restore it immediately using the Undo button.
            </p>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-delete-item"
                onClick={() => {
                  deleteItem(deletingItem.id);
                  closeModal();
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-colors"
              >
                Delete Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification and Undo Toast Queue */}
      <NotificationSnackbar />
    </div>
  );
};
