/**
 * ItemDialog Component
 * Add / Edit Item modal with comprehensive validation:
 *  - Non-empty name & character length cap
 *  - Non-negative price, 2-decimal formatting, max price cap
 *  - Stable Category ID selector
 *  - Interactive Synonyms tag editor (trim, deduplicate)
 *  - Barcode and notes
 *  - Automatic currency display from user settings (Toman / USD)
 *  - Clear validation & duplicate error feedback
 */

import React, { useState, useEffect, useRef } from "react";
import { Item, VALIDATION_LIMITS, CATEGORY_UNCATEGORIZED_ID } from "../types/store";
import { useStore } from "../context/StoreContext";
import { sanitizeSynonyms } from "../utils/helpers";
import { X, Tag, AlertCircle, Sparkles, Check, DollarSign, Coins } from "lucide-react";

interface ItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialItem?: Item | null;
}

export const ItemDialog: React.FC<ItemDialogProps> = ({
  isOpen,
  onClose,
  initialItem,
}) => {
  const { categories, addItem, updateItem } = useStore();

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState(CATEGORY_UNCATEGORIZED_ID);
  const [priceToman, setPriceToman] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [unit, setUnit] = useState("");
  const [synonyms, setSynonyms] = useState<string[]>([]);
  const [synonymInput, setSynonymInput] = useState("");
  const [barcode, setBarcode] = useState("");
  const [notes, setNotes] = useState("");

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sync state when modal opens or initialItem changes
  useEffect(() => {
    if (isOpen) {
      if (initialItem) {
        setName(initialItem.name);
        setCategoryId(initialItem.categoryId || CATEGORY_UNCATEGORIZED_ID);
        setPriceToman(
          initialItem.priceToman !== undefined
            ? initialItem.priceToman.toString()
            : initialItem.price && initialItem.priceUsd === undefined
            ? initialItem.price.toString()
            : ""
        );
        setPriceUsd(
          initialItem.priceUsd !== undefined
            ? initialItem.priceUsd.toString()
            : ""
        );
        setUnit(initialItem.unit || "");
        setSynonyms(initialItem.synonyms || []);
        setBarcode(initialItem.barcode || "");
        setNotes(initialItem.notes || "");
      } else {
        setName("");
        setCategoryId(categories[0]?.id || CATEGORY_UNCATEGORIZED_ID);
        setPriceToman("");
        setPriceUsd("");
        setUnit("");
        setSynonyms([]);
        setBarcode("");
        setNotes("");
      }
      setErrorMessage(null);
      setFieldErrors({});
      setSynonymInput("");
      setTimeout(() => nameInputRef.current?.focus(), 80);
    }
  }, [isOpen, initialItem, categories]);

  if (!isOpen) return null;

  // Synonyms tag management
  const handleAddSynonym = () => {
    const trimmed = synonymInput.trim();
    if (!trimmed) return;
    const cleanList = sanitizeSynonyms([...synonyms, trimmed]);
    setSynonyms(cleanList);
    setSynonymInput("");
  };

  const handleSynonymKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      handleAddSynonym();
    }
  };

  const handleRemoveSynonym = (synToRemove: string) => {
    setSynonyms(synonyms.filter((s) => s.toLowerCase() !== synToRemove.toLowerCase()));
  };

  // Form Submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const errors: { [key: string]: string } = {};

    // Validate Name
    const trimmedName = name.trim();
    if (!trimmedName) {
      errors.name = "Item name is required.";
    } else if (trimmedName.length > VALIDATION_LIMITS.MAX_ITEM_NAME_LENGTH) {
      errors.name = `Item name cannot exceed ${VALIDATION_LIMITS.MAX_ITEM_NAME_LENGTH} characters.`;
    }

    // Validate Prices (Toman, USD, or both)
    const trimmedToman = priceToman.trim();
    const trimmedUsd = priceUsd.trim();

    let parsedToman: number | undefined = undefined;
    let parsedUsd: number | undefined = undefined;

    if (!trimmedToman && !trimmedUsd) {
      errors.price = "Please provide at least one price (in Toman, USD, or both).";
    }

    if (trimmedToman) {
      const numToman = parseFloat(trimmedToman);
      if (isNaN(numToman) || numToman < VALIDATION_LIMITS.MIN_PRICE) {
        errors.priceToman = "Toman price must be a valid non-negative number.";
      } else if (numToman > VALIDATION_LIMITS.MAX_PRICE) {
        errors.priceToman = `Toman price cannot exceed ${VALIDATION_LIMITS.MAX_PRICE.toLocaleString()}.`;
      } else {
        parsedToman = numToman;
      }
    }

    if (trimmedUsd) {
      const numUsd = parseFloat(trimmedUsd);
      if (isNaN(numUsd) || numUsd < VALIDATION_LIMITS.MIN_PRICE) {
        errors.priceUsd = "USD price must be a valid non-negative number.";
      } else if (numUsd > VALIDATION_LIMITS.MAX_PRICE) {
        errors.priceUsd = `USD price cannot exceed ${VALIDATION_LIMITS.MAX_PRICE.toLocaleString()}.`;
      } else {
        parsedUsd = numUsd;
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);

    const itemData = {
      name: trimmedName,
      categoryId,
      priceToman: parsedToman,
      priceUsd: parsedUsd,
      unit: unit.trim() || undefined,
      synonyms: sanitizeSynonyms(synonyms),
      barcode: barcode.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    if (initialItem) {
      const res = updateItem(initialItem.id, itemData);
      setIsSubmitting(false);
      if (res.success) {
        onClose();
      } else {
        setErrorMessage(res.error.message);
      }
    } else {
      const res = addItem(itemData);
      setIsSubmitting(false);
      if (res.success) {
        onClose();
      } else {
        setErrorMessage(res.error.message);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-dialog-title"
    >
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 id="item-dialog-title" className="text-lg font-bold text-slate-900">
                {initialItem ? "Edit Store Item" : "Add New Item"}
              </h2>
              <p className="text-xs text-slate-500">
                {initialItem ? "Update item details and dual-currency pricing" : "Create a new product price record"}
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{errorMessage}</div>
            </div>
          )}

          {/* Item Name */}
          <div>
            <label htmlFor="input-item-name" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Item Name <span className="text-rose-500">*</span>
            </label>
            <input
              ref={nameInputRef}
              id="input-item-name"
              type="text"
              required
              maxLength={VALIDATION_LIMITS.MAX_ITEM_NAME_LENGTH}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: "" }));
              }}
              placeholder="e.g. Organic Almond Milk (Half Gallon)"
              className={`w-full px-3.5 py-2.5 rounded-xl border text-sm font-medium text-slate-900 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 transition-all ${
                fieldErrors.name
                  ? "border-rose-400 focus:ring-rose-300 focus:border-rose-500"
                  : "border-slate-300 focus:ring-indigo-300 focus:border-indigo-600"
              }`}
            />
            {fieldErrors.name && (
              <p className="mt-1 text-xs text-rose-600 font-medium">{fieldErrors.name}</p>
            )}
          </div>

          {/* Category and Unit (2 columns) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Category */}
            <div className="sm:col-span-2">
              <label htmlFor="select-item-category" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Category <span className="text-rose-500">*</span>
              </label>
              <select
                id="select-item-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-600"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Unit */}
            <div>
              <label htmlFor="input-item-unit" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Unit (Optional)
              </label>
              <input
                id="input-item-unit"
                type="text"
                maxLength={15}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="kg, bottle, ea"
                title="Unit of measure"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-600"
              />
            </div>
          </div>

          {/* Dual-Currency Pricing Section */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Item Pricing
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                Enter Toman, USD, or both
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Toman Price Input */}
              <div>
                <label htmlFor="input-item-price-toman" className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1">
                  <Coins className="w-3.5 h-3.5 text-amber-600" />
                  <span>Price in Toman (تومان)</span>
                </label>
                <div className="relative">
                  <input
                    id="input-item-price-toman"
                    type="number"
                    step="any"
                    min="0"
                    max={VALIDATION_LIMITS.MAX_PRICE}
                    value={priceToman}
                    onChange={(e) => {
                      setPriceToman(e.target.value);
                      if (fieldErrors.price || fieldErrors.priceToman) {
                        setFieldErrors((prev) => ({ ...prev, price: "", priceToman: "" }));
                      }
                    }}
                    placeholder="e.g. 65000"
                    className={`w-full px-3 py-2.5 rounded-xl border text-sm font-mono text-slate-900 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 transition-all ${
                      fieldErrors.priceToman || fieldErrors.price
                        ? "border-rose-400 focus:ring-rose-300 focus:border-rose-500"
                        : "border-slate-300 focus:ring-indigo-300 focus:border-indigo-600"
                    }`}
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400 text-xs font-medium">
                    Toman
                  </div>
                </div>
                {fieldErrors.priceToman && (
                  <p className="mt-1 text-xs text-rose-600 font-medium">{fieldErrors.priceToman}</p>
                )}
              </div>

              {/* USD Price Input */}
              <div>
                <label htmlFor="input-item-price-usd" className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Price in USD ($)</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-mono text-sm">
                    $
                  </div>
                  <input
                    id="input-item-price-usd"
                    type="number"
                    step="any"
                    min="0"
                    max={VALIDATION_LIMITS.MAX_PRICE}
                    value={priceUsd}
                    onChange={(e) => {
                      setPriceUsd(e.target.value);
                      if (fieldErrors.price || fieldErrors.priceUsd) {
                        setFieldErrors((prev) => ({ ...prev, price: "", priceUsd: "" }));
                      }
                    }}
                    placeholder="e.g. 4.50"
                    className={`w-full pl-7 pr-3 py-2.5 rounded-xl border text-sm font-mono text-slate-900 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 transition-all ${
                      fieldErrors.priceUsd || fieldErrors.price
                        ? "border-rose-400 focus:ring-rose-300 focus:border-rose-500"
                        : "border-slate-300 focus:ring-indigo-300 focus:border-indigo-600"
                    }`}
                  />
                </div>
                {fieldErrors.priceUsd && (
                  <p className="mt-1 text-xs text-rose-600 font-medium">{fieldErrors.priceUsd}</p>
                )}
              </div>
            </div>

            {fieldErrors.price && (
              <p className="text-xs text-rose-600 font-medium">{fieldErrors.price}</p>
            )}
          </div>

          {/* Synonyms Tag Editor */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="input-item-synonym" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Synonyms / Search Aliases
              </label>
              <span className="text-[11px] text-slate-500">
                Press Enter or comma to add tag
              </span>
            </div>

            <div className="flex gap-2 mb-2">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Tag className="w-4 h-4" />
                </div>
                <input
                  id="input-item-synonym"
                  type="text"
                  value={synonymInput}
                  onChange={(e) => setSynonymInput(e.target.value)}
                  onKeyDown={handleSynonymKeyDown}
                  placeholder="e.g. beverage, plant milk, silk"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-600"
                />
              </div>
              <button
                type="button"
                id="btn-add-synonym"
                onClick={handleAddSynonym}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
              >
                Add Tag
              </button>
            </div>

            {/* Render Tags */}
            {synonyms.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200">
                {synonyms.map((syn) => (
                  <span
                    key={syn}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-white text-slate-800 border border-slate-200 shadow-2xs"
                  >
                    {syn}
                    <button
                      type="button"
                      onClick={() => handleRemoveSynonym(syn)}
                      aria-label={`Remove synonym ${syn}`}
                      className="text-slate-400 hover:text-rose-600 rounded-sm"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Barcode & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="input-item-barcode" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Barcode / SKU (Optional)
              </label>
              <input
                id="input-item-barcode"
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="e.g. 011110416002"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-600"
              />
            </div>
            <div>
              <label htmlFor="input-item-notes" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Notes (Optional)
              </label>
              <input
                id="input-item-notes"
                type="text"
                maxLength={VALIDATION_LIMITS.MAX_NOTES_LENGTH}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Aisle 4, shelf B"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-600"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              id="btn-cancel-item-dialog"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-save-item"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm transition-colors disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {initialItem ? "Save Changes" : "Create Item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
