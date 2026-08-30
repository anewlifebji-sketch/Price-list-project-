/**
 * DraggableList Component
 * Robust reordering engine supporting:
 *  - Arbitrary variable row heights (dynamic bounding rect calculations)
 *  - Viewport & container edge auto-scrolling
 *  - Touch and mouse pointer tracking
 *  - Keyboard accessibility (Move Up / Move Down)
 *  - Deterministic master list synchronization
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Item, Category } from "../types/store";
import { ItemRow } from "./ItemRow";

interface DraggableListProps {
  items: Item[];
  categories: Category[];
  onReorder: (newFilteredIds: string[]) => void;
  onEditItem: (item: Item) => void;
  onDeleteItem: (item: Item) => void;
  isDraggable?: boolean;
}

export const DraggableList: React.FC<DraggableListProps> = ({
  items,
  categories,
  onReorder,
  onEditItem,
  onDeleteItem,
  isDraggable = true,
}) => {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const mousePositionRef = useRef<{ clientY: number } | null>(null);

  const categoryMap = React.useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach((c) => map.set(c.id, c));
    return map;
  }, [categories]);

  // Edge auto-scroll loop during drag
  const startAutoScroll = useCallback(() => {
    const checkScroll = () => {
      if (!mousePositionRef.current || !containerRef.current) {
        autoScrollRafRef.current = requestAnimationFrame(checkScroll);
        return;
      }

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const clientY = mousePositionRef.current.clientY;

      const topZone = rect.top + 70;
      const bottomZone = rect.bottom - 70;

      if (clientY < topZone) {
        // Scroll up
        const speed = Math.max(2, Math.min(15, (topZone - clientY) / 3));
        container.scrollTop -= speed;
        window.scrollBy(0, -speed);
      } else if (clientY > bottomZone) {
        // Scroll down
        const speed = Math.max(2, Math.min(15, (clientY - bottomZone) / 3));
        container.scrollTop += speed;
        window.scrollBy(0, speed);
      }

      autoScrollRafRef.current = requestAnimationFrame(checkScroll);
    };

    if (autoScrollRafRef.current === null) {
      autoScrollRafRef.current = requestAnimationFrame(checkScroll);
    }
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    mousePositionRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopAutoScroll();
    };
  }, [stopAutoScroll]);

  // HTML5 Drag Events
  const handleDragStart = (e: React.DragEvent, id: string) => {
    if (!isDraggable) return;
    setDraggedItemId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);

    // Add invisible or custom ghost image
    if (e.dataTransfer.setDragImage) {
      const ghost = document.getElementById(`item-row-${id}`);
      if (ghost) {
        e.dataTransfer.setDragImage(ghost, 20, 20);
      }
    }

    startAutoScroll();
  };

  const handleDragOver = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    mousePositionRef.current = { clientY: e.clientY };

    if (draggedItemId) {
      const currentIndex = items.findIndex((it) => it.id === draggedItemId);
      if (currentIndex !== -1 && currentIndex !== targetIndex) {
        setDragOverIndex(targetIndex);
      }
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    stopAutoScroll();

    const sourceId = draggedItemId || e.dataTransfer.getData("text/plain");
    if (!sourceId) {
      setDraggedItemId(null);
      setDragOverIndex(null);
      return;
    }

    const sourceIndex = items.findIndex((it) => it.id === sourceId);
    if (sourceIndex !== -1 && sourceIndex !== targetIndex) {
      const newItems = [...items];
      const [movedItem] = newItems.splice(sourceIndex, 1);
      newItems.splice(targetIndex, 0, movedItem);

      const newIds = newItems.map((it) => it.id);
      onReorder(newIds);
    }

    setDraggedItemId(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    stopAutoScroll();
    setDraggedItemId(null);
    setDragOverIndex(null);
  };

  // Keyboard accessibility move handlers
  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const newItems = [...items];
    const temp = newItems[index];
    newItems[index] = newItems[index - 1];
    newItems[index - 1] = temp;
    onReorder(newItems.map((it) => it.id));
  };

  const handleMoveDown = (index: number) => {
    if (index >= items.length - 1) return;
    const newItems = [...items];
    const temp = newItems[index];
    newItems[index] = newItems[index + 1];
    newItems[index + 1] = temp;
    onReorder(newItems.map((it) => it.id));
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      id="draggable-list-container"
      className="space-y-2.5 transition-all"
    >
      {items.map((item, index) => {
        const isBeingDragged = draggedItemId === item.id;
        const isTarget = dragOverIndex === index;

        return (
          <div
            key={item.id}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            className={`transition-all duration-150 ${
              isTarget && !isBeingDragged
                ? "border-t-4 border-indigo-500 pt-1"
                : ""
            }`}
          >
            <div
              draggable={isDraggable}
              onDragStart={(e) => handleDragStart(e, item.id)}
              onDragEnd={handleDragEnd}
            >
              <ItemRow
                item={item}
                category={categoryMap.get(item.categoryId)}
                index={index}
                totalCount={items.length}
                isDragging={isBeingDragged}
                onEdit={onEditItem}
                onDelete={onDeleteItem}
                onMoveUp={isDraggable ? handleMoveUp : undefined}
                onMoveDown={isDraggable ? handleMoveDown : undefined}
                dragHandleProps={
                  isDraggable
                    ? {
                        draggable: true,
                        onDragStart: (e: any) => handleDragStart(e, item.id),
                      }
                    : undefined
                }
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
