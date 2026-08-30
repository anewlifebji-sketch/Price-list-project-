/**
 * CategoriesDialog Component
 * Fulfills Requirement 8, 13, 14:
 *  - ViewModel as strict Single Source of Truth
 *  - No parallel unsynced local duplicate state
 *  - Rename updates category without breaking item references (stable UUIDs)
 *  - Category deletion with safe item reassignment to Uncategorized or another category
 *  - Clear error feedback on duplicates or invalid names
 */

import React, { useState } from "react";
import { Category, CATEGORY_UNCATEGORIZED_ID, VALIDATION_LIMITS } from "../types/store";
import { useStore } from "../context/StoreContext";
import { X, Plus, Edit2, Trash2, Folder, Check, AlertCircle, RefreshCw } from "lucide-react";

interface CategoriesDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CategoriesDialog: React.FC<CategoriesDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    categories,
    items,
    addCategory,
    renameCategory,
    deleteCategory,
  } = useStore();

  // Add state
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState("#0284c7");
  const [addError, setAddError] = useState<string | null>(null);

  // Rename state
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#0284c7");
  const [renameError, setRenameError] = useState<string | null>(null);

  // Deletion Reassignment state
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<string>(CATEGORY_UNCATEGORIZED_ID);

  if (!isOpen) return null;

  // Item count per category
  const itemCountByCat = categories.reduce((acc, cat) => {
    acc[cat.id] = items.filter((it) => it.categoryId === cat.id).length;
    return acc;
  }, {} as { [catId: string]: number });

  // Handle Add
  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    const trimmed = newCatName.trim();
    if (!trimmed) {
      setAddError("Category name cannot be empty.");
      return;
    }

    const res = addCategory(trimmed, newCatColor);
    if (res.success) {
      setNewCatName("");
      setNewCatColor("#0284c7");
    } else {
      setAddError(res.error.message);
    }
  };

  // Handle Start Edit
  const handleStartEdit = (cat: Category) => {
    setEditingCatId(cat.id);
    setEditName(cat.name);
    setEditColor(cat.color || "#0284c7");
    setRenameError(null);
  };

  // Handle Save Rename
  const handleSaveRename = (catId: string) => {
    setRenameError(null);
    const trimmed = editName.trim();
    if (!trimmed) {
      setRenameError("Category name cannot be empty.");
      return;
    }

    const res = renameCategory(catId, trimmed, editColor);
    if (res.success) {
      setEditingCatId(null);
      setEditName("");
    } else {
      // If ViewModel rejects, UI does not update local duplicate state
      setRenameError(res.error.message);
    }
  };

  // Handle Delete Confirmation
  const handleConfirmDelete = () => {
    if (!deletingCategory) return;
    deleteCategory(deletingCategory.id, reassignTargetId);
    setDeletingCategory(null);
  };

  const COLOR_PRESETS = [
    "#0284c7", // Sky blue
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#ef4444", // Rose
    "#8b5cf6", // Purple
    "#ec4899", // Pink
    "#06b6d4", // Cyan
    "#64748b", // Slate
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="categories-dialog-title"
    >
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <Folder className="w-5 h-5" />
            </div>
            <div>
              <h2 id="categories-dialog-title" className="text-lg font-bold text-slate-900">
                Manage Categories
              </h2>
              <p className="text-xs text-slate-500">
                Organize items with stable categories and color tags
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Add Category Form */}
          <form onSubmit={handleAddSubmit} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Add New Category
            </h3>
            {addError && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{addError}</span>
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                maxLength={VALIDATION_LIMITS.MAX_CATEGORY_NAME_LENGTH}
                placeholder="Category name (e.g. Frozen Foods)"
                value={newCatName}
                onChange={(e) => {
                  setNewCatName(e.target.value);
                  if (addError) setAddError(null);
                }}
                className="flex-1 px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-600"
              />
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1 p-1 bg-white border border-slate-300 rounded-xl">
                  {COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewCatColor(color)}
                      aria-label={`Select color ${color}`}
                      className={`w-5 h-5 rounded-full transition-transform ${
                        newCatColor === color ? "scale-125 ring-2 ring-indigo-500 ring-offset-1" : "hover:scale-110"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <button
                  type="submit"
                  id="btn-submit-add-category"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>
            </div>
          </form>

          {/* Categories List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Existing Categories ({categories.length})
              </h3>
              <span className="text-xs text-slate-500">Items linked to stable IDs</span>
            </div>

            {renameError && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{renameError}</span>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1 divide-y divide-slate-100">
              {categories.map((cat) => {
                const count = itemCountByCat[cat.id] || 0;
                const isEditing = editingCatId === cat.id;
                const isUncategorized = cat.id === CATEGORY_UNCATEGORIZED_ID;

                if (isEditing) {
                  return (
                    <div
                      key={cat.id}
                      className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-200 space-y-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editName}
                          maxLength={VALIDATION_LIMITS.MAX_CATEGORY_NAME_LENGTH}
                          onChange={(e) => setEditName(e.target.value)}
                          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveRename(cat.id)}
                          aria-label="Save category rename"
                          className="p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCatId(null)}
                          aria-label="Cancel rename"
                          className="p-2 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500">Color:</span>
                        {COLOR_PRESETS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setEditColor(color)}
                            className={`w-4 h-4 rounded-full transition-transform ${
                              editColor === color ? "scale-125 ring-2 ring-indigo-500 ring-offset-1" : "hover:scale-110"
                            }`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0 shadow-2xs"
                        style={{ backgroundColor: cat.color || "#64748b" }}
                      />
                      <span className="font-semibold text-slate-900 text-sm truncate">
                        {cat.name}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-mono font-medium">
                        {count} {count === 1 ? "item" : "items"}
                      </span>
                      {isUncategorized && (
                        <span className="text-[11px] text-slate-400 italic">
                          (Default)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(cat)}
                        aria-label={`Rename ${cat.name}`}
                        className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Rename category"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {!isUncategorized && (
                        <button
                          type="button"
                          onClick={() => setDeletingCategory(cat)}
                          aria-label={`Delete ${cat.name}`}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Delete category"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-slate-100 bg-slate-50/70">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      </div>

      {/* Delete Category Reassignment Modal */}
      {deletingCategory && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs"
          role="dialog"
          aria-labelledby="delete-category-title"
        >
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2 rounded-xl bg-rose-50">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 id="delete-category-title" className="text-base font-bold text-slate-900">
                Delete Category "{deletingCategory.name}"?
              </h3>
            </div>

            <p className="text-sm text-slate-600">
              There are{" "}
              <strong className="text-slate-900">
                {itemCountByCat[deletingCategory.id] || 0} item(s)
              </strong>{" "}
              currently in this category. Where should they be reassigned?
            </p>

            <div>
              <label htmlFor="select-reassign-cat" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Reassign Items To:
              </label>
              <select
                id="select-reassign-cat"
                value={reassignTargetId}
                onChange={(e) => setReassignTargetId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {categories
                  .filter((c) => c.id !== deletingCategory.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeletingCategory(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-delete-category"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-colors"
              >
                Confirm Delete & Reassign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
