/**
 * ItemRow Component
 * Professional, dense, tabular item row with fixed-width columns
 * preventing layout shift, with category badge, price formatting in selected currency,
 * and quick actions.
 */

import React from "react";
import { Item, Category } from "../types/store";
import { formatItemPrices } from "../utils/helpers";
import { GripVertical, Edit3, Trash2, Tag, ChevronUp, ChevronDown, Barcode } from "lucide-react";

interface ItemRowProps {
  item: Item;
  category?: Category;
  index: number;
  totalCount: number;
  isDragging?: boolean;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
  onMoveUp?: (index: number) => void;
  onMoveDown?: (index: number) => void;
  dragHandleProps?: any;
}

export const ItemRow: React.FC<ItemRowProps> = ({
  item,
  category,
  index,
  totalCount,
  isDragging = false,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  dragHandleProps,
}) => {
  const categoryName = category?.name || "Uncategorized";
  const categoryColor = category?.color || "#64748b";
  const priceInfo = formatItemPrices(item);

  return (
    <div
      id={`item-row-${item.id}`}
      className={`group relative flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 px-3.5 py-2.5 rounded-xl border transition-all duration-150 bg-white ${
        isDragging
          ? "border-indigo-500 shadow-lg ring-2 ring-indigo-400/30 z-30 opacity-95"
          : "border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/50"
      }`}
    >
      {/* Column 1: Drag handle + Item Name & Subtitles (Flex 1, min-w-0) */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {/* Drag Handle */}
        <button
          type="button"
          {...dragHandleProps}
          aria-label={`Drag to reorder ${item.name}`}
          title="Drag to reorder"
          className="p-1 rounded-md text-slate-300 group-hover:text-slate-500 hover:bg-slate-100 cursor-grab active:cursor-grabbing focus:outline-none shrink-0 touch-none"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Item Primary & Secondary Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900 text-sm leading-tight truncate">
              {item.name}
            </h3>

            {item.unit && (
              <span className="shrink-0 text-[11px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">
                /{item.unit}
              </span>
            )}
          </div>

          {/* Subtitle details: Synonyms, Barcode, Notes on single compact line */}
          {((item.synonyms && item.synonyms.length > 0) || item.barcode || item.notes) && (
            <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 truncate">
              {item.synonyms && item.synonyms.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 truncate max-w-xs">
                  <Tag className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate">{item.synonyms.join(", ")}</span>
                </span>
              )}

              {item.barcode && (
                <span className="hidden md:inline-flex items-center gap-1 font-mono text-[11px] text-slate-400">
                  <Barcode className="w-3 h-3" />
                  {item.barcode}
                </span>
              )}

              {item.notes && (
                <span className="hidden lg:inline text-[11px] italic text-slate-400 truncate max-w-xs">
                  &bull; {item.notes}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Column 2: Category Badge (Fixed Width Column: w-32 or w-36 on desktop) */}
      <div className="flex items-center sm:w-36 shrink-0">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border max-w-full truncate"
          style={{
            backgroundColor: `${categoryColor}15`,
            borderColor: `${categoryColor}35`,
            color: categoryColor,
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: categoryColor }}
          />
          <span className="truncate">{categoryName}</span>
        </span>
      </div>

      {/* Column 3: Price (Fixed Width Column: w-44 on desktop, right-aligned) */}
      <div className="flex items-center justify-between sm:justify-end sm:w-44 shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-100">
        <div className="text-right flex flex-col items-end">
          {priceInfo.hasBoth ? (
            <>
              <span className="font-bold text-emerald-700 text-sm font-mono tracking-tight">
                {priceInfo.usdFormatted}
              </span>
              <span className="text-xs font-medium text-slate-600 font-mono tracking-tight">
                {priceInfo.tomanFormatted}
              </span>
            </>
          ) : priceInfo.hasUsd ? (
            <span className="font-bold text-emerald-700 text-sm sm:text-base font-mono tracking-tight">
              {priceInfo.usdFormatted}
            </span>
          ) : priceInfo.hasToman ? (
            <span className="font-bold text-slate-900 text-sm sm:text-base font-mono tracking-tight">
              {priceInfo.tomanFormatted}
            </span>
          ) : (
            <span className="text-xs font-medium text-slate-400 italic">
              No price
            </span>
          )}
        </div>

        {/* Column 4: Action Buttons (Fixed Width Column: w-20 to w-24, right-aligned) */}
        <div className="flex items-center gap-0.5 sm:w-24 justify-end shrink-0 ml-2">
          {/* Keyboard reorder buttons */}
          {onMoveUp && onMoveDown && (
            <div className="hidden lg:flex items-center">
              <button
                type="button"
                id={`btn-moveup-${item.id}`}
                disabled={index === 0}
                onClick={() => onMoveUp(index)}
                aria-label={`Move ${item.name} up`}
                title="Move up"
                className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-20 disabled:cursor-not-allowed hover:bg-slate-100 rounded"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                id={`btn-movedown-${item.id}`}
                disabled={index === totalCount - 1}
                onClick={() => onMoveDown(index)}
                aria-label={`Move ${item.name} down`}
                title="Move down"
                className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-20 disabled:cursor-not-allowed hover:bg-slate-100 rounded"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Edit button */}
          <button
            type="button"
            id={`btn-edit-${item.id}`}
            onClick={() => onEdit(item)}
            aria-label={`Edit ${item.name}`}
            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="Edit item"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>

          {/* Delete button */}
          <button
            type="button"
            id={`btn-delete-${item.id}`}
            onClick={() => onDelete(item)}
            aria-label={`Delete ${item.name}`}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
            title="Delete item"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
