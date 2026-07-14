"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

export type SortableOptionListItem = {
  id: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

type DragPreview = {
  label: string;
  width: number;
  x: number;
  y: number;
};

type RenderSortableOptionRow<TItem extends SortableOptionListItem> = {
  dragHandle: ReactNode;
  isDragging: boolean;
  item: TItem;
  rowRef: (element: HTMLDivElement | null) => void;
};

export function SortableOptionList<TItem extends SortableOptionListItem>({
  dragHandleLabel,
  emptyState,
  getPreviewLabel,
  items,
  onReorder,
  renderRow,
}: {
  dragHandleLabel: string;
  emptyState: ReactNode;
  getPreviewLabel: (item: TItem) => string;
  items: TItem[];
  onReorder: (orderedIds: string[]) => void;
  renderRow: (props: RenderSortableOptionRow<TItem>) => ReactNode;
}) {
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const dragChangedRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);

  function beginDrag(
    item: TItem,
    event: React.PointerEvent<HTMLButtonElement>,
  ) {
    const row = rowRefs.current.get(item.id);
    const rect = row?.getBoundingClientRect();

    event.currentTarget.setPointerCapture(event.pointerId);
    dragChangedRef.current = false;
    setDragPreview({
      label: getPreviewLabel(item),
      width: Math.min(rect?.width ?? 280, 520),
      x: event.clientX + 12,
      y: event.clientY + 12,
    });
    setDraggingId(item.id);
  }

  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingId) return;

    setDragPreview((current) =>
      current
        ? { ...current, x: event.clientX + 12, y: event.clientY + 12 }
        : current,
    );

    const targetId = findItemIdAtPoint(event.clientX, event.clientY);

    if (!targetId || targetId === draggingId) return;

    dragChangedRef.current = true;
    onReorder(moveIdToTarget(items.map((item) => item.id), draggingId, targetId));
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragChangedRef.current = false;
    setDragPreview(null);
    setDraggingId(null);
  }

  function findItemIdAtPoint(clientX: number, clientY: number) {
    for (const item of items) {
      const row = rowRefs.current.get(item.id);
      if (!row) continue;

      const rect = row.getBoundingClientRect();

      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return item.id;
      }
    }

    return null;
  }

  if (items.length === 0) return <>{emptyState}</>;

  return (
    <>
      <div className="grid gap-2">
        {items.map((item) => (
          <SortableOptionListRow
            dragHandleLabel={dragHandleLabel}
            isDragging={draggingId === item.id}
            item={item}
            key={item.id}
            onBeginDrag={beginDrag}
            onEndDrag={endDrag}
            onMoveDrag={moveDrag}
            renderRow={renderRow}
            rowRefs={rowRefs}
          />
        ))}
      </div>
      {dragPreview ? <SortableRowDragPreview preview={dragPreview} /> : null}
    </>
  );
}

function SortableOptionListRow<TItem extends SortableOptionListItem>({
  dragHandleLabel,
  isDragging,
  item,
  onBeginDrag,
  onEndDrag,
  onMoveDrag,
  renderRow,
  rowRefs,
}: {
  dragHandleLabel: string;
  isDragging: boolean;
  item: TItem;
  onBeginDrag: (
    item: TItem,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void;
  onEndDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onMoveDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  renderRow: (props: RenderSortableOptionRow<TItem>) => ReactNode;
  rowRefs: React.RefObject<Map<string, HTMLElement>>;
}) {
  const rowRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) {
        rowRefs.current.set(item.id, element);
      } else {
        rowRefs.current.delete(item.id);
      }
    },
    [item.id, rowRefs],
  );

  return renderRow({
    dragHandle: (
      <button
        aria-label={dragHandleLabel}
        className="inline-flex size-10 touch-none cursor-grab items-center justify-center rounded-md border border-stone-200 bg-stone-50 text-lg font-semibold leading-none text-stone-400 transition hover:border-stone-300 hover:bg-stone-100 active:cursor-grabbing active:border-emerald-300 active:bg-emerald-50 active:text-emerald-800"
        onPointerCancel={onEndDrag}
        onPointerDown={(event) => onBeginDrag(item, event)}
        onPointerMove={onMoveDrag}
        onPointerUp={onEndDrag}
        type="button"
      >
        {"\u22ee\u22ee"}
      </button>
    ),
    isDragging,
    item,
    rowRef,
  });
}

function SortableRowDragPreview({ preview }: { preview: DragPreview }) {
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-stone-950 shadow-lg"
      style={{
        left: preview.x,
        top: preview.y,
        width: preview.width,
      }}
    >
      {preview.label}
    </div>
  );
}

function moveIdToTarget(ids: string[], itemId: string, targetId: string) {
  const orderedIds = [...ids];
  const fromIndex = orderedIds.indexOf(itemId);
  const toIndex = orderedIds.indexOf(targetId);

  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return orderedIds;
  }

  const [moved] = orderedIds.splice(fromIndex, 1);
  orderedIds.splice(toIndex, 0, moved);
  return orderedIds;
}
