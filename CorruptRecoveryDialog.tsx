/**
 * CorruptRecoveryDialog Component
 * Implements Requirement 3:
 *  - Prevents silent wipeout of corrupt storage
 *  - Displays diagnostic details and raw payload inspector
 *  - Provides immediate 1-click snapshot restore or clean reset
 */

import React from "react";
import { useStore } from "../context/StoreContext";
import { AlertOctagon, RotateCcw, Download, RefreshCw, Database } from "lucide-react";

export const CorruptRecoveryDialog: React.FC = () => {
  const {
    isCorrupted,
    corruptionDetails,
    corruptedRawSnippet,
    snapshots,
    restoreFromSnapshot,
    resetToDefaults,
  } = useStore();

  if (!isCorrupted) return null;

  const handleDownloadCorrupt = () => {
    if (!corruptedRawSnippet) return;
    const blob = new Blob([corruptedRawSnippet], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `corrupted_store_data_${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="corrupt-dialog-title"
    >
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-rose-300 p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
        {/* Title */}
        <div className="flex items-center gap-3 text-rose-600">
          <div className="p-2.5 rounded-xl bg-rose-100">
            <AlertOctagon className="w-6 h-6" />
          </div>
          <div>
            <h2 id="corrupt-dialog-title" className="text-lg font-bold text-slate-900">
              Storage Corruption Detected
            </h2>
            <p className="text-xs text-rose-700 font-medium">
              Data was protected from being silently overwritten as empty.
            </p>
          </div>
        </div>

        {/* Details Box */}
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 font-mono space-y-1">
          <p className="font-bold">Error Details:</p>
          <p>{corruptionDetails || "Malformed JSON syntax in local storage."}</p>
        </div>

        {/* Raw snippet preview */}
        {corruptedRawSnippet && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
              <span>Raw Corrupted Storage Content:</span>
              <button
                type="button"
                onClick={handleDownloadCorrupt}
                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 underline font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                Download Corrupt File
              </button>
            </div>
            <pre className="p-3 rounded-xl bg-slate-900 text-slate-200 font-mono text-[11px] max-h-32 overflow-y-auto whitespace-pre-wrap">
              {corruptedRawSnippet}
            </pre>
          </div>
        )}

        {/* Recovery Options */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Available Recovery Options
          </h3>

          {/* Option A: Restore from latest backup snapshot */}
          {snapshots.length > 0 ? (
            <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-between gap-3">
              <div className="text-xs text-indigo-950">
                <p className="font-bold">
                  Restore from Last Valid Snapshot ({snapshots[0].dateString})
                </p>
                <p className="text-indigo-700">
                  Contains {snapshots[0].itemCount} items and {snapshots[0].categoryCount} categories.
                </p>
              </div>
              <button
                type="button"
                id="btn-restore-latest-snapshot"
                onClick={() => restoreFromSnapshot(snapshots[0])}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors shrink-0 shadow-sm"
              >
                <RotateCcw className="w-4 h-4" />
                Restore Snapshot
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">
              No previous automatic backup snapshot is stored on this browser.
            </p>
          )}

          {/* Option B: Reset to clean sample store */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-slate-500">
              Or initialize a brand new store dataset:
            </span>
            <button
              type="button"
              id="btn-corrupt-reset-clean"
              onClick={resetToDefaults}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
