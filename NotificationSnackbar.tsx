/**
 * NotificationSnackbar Component
 * Implements Requirements 13 & 20:
 *  - Single-shot notification event queue
 *  - High visibility Undo snackbar with action trigger
 *  - Automatic auto-dismiss timer with manual close
 */

import React, { useEffect } from "react";
import { useStore } from "../context/StoreContext";
import { NotificationEvent } from "../types/store";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X, RotateCcw } from "lucide-react";

export const NotificationSnackbar: React.FC = () => {
  const { notifications, dismissNotification } = useStore();

  if (notifications.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-3"
    >
      {notifications.map((notif) => (
        <SnackbarItem
          key={notif.id}
          notification={notif}
          onDismiss={() => dismissNotification(notif.id)}
        />
      ))}
    </div>
  );
};

const SnackbarItem: React.FC<{
  notification: NotificationEvent;
  onDismiss: () => void;
}> = ({ notification, onDismiss }) => {
  useEffect(() => {
    if (notification.durationMs) {
      const timer = setTimeout(() => {
        onDismiss();
      }, notification.durationMs);
      return () => clearTimeout(timer);
    }
  }, [notification, onDismiss]);

  const getIcon = () => {
    switch (notification.type) {
      case "success":
        return <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />;
      case "error":
        return <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />;
      case "warning":
        return <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />;
      case "info":
      default:
        return <Info className="w-5 h-5 text-indigo-400 shrink-0" />;
    }
  };

  return (
    <div
      role="alert"
      className="pointer-events-auto flex items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-900 text-white shadow-2xl border border-slate-700/80 animate-in slide-in-from-bottom-5 duration-200"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {getIcon()}
        <div className="min-w-0 flex-1">
          {notification.title && (
            <p className="font-semibold text-xs text-slate-200">
              {notification.title}
            </p>
          )}
          <p className="text-xs font-medium text-slate-100 leading-snug">
            {notification.message}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {notification.action && (
          <button
            type="button"
            onClick={() => {
              notification.action?.onClick();
              onDismiss();
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {notification.action.label}
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
