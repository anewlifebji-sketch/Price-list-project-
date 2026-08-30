/**
 * BackupDialog Component
 * Implements Requirements 4, 5, 6, 21:
 *  - Transactional JSON Import pipeline with zero data loss on validation failure
 *  - Comprehensive schema v1 & v2 validation reporting
 *  - Clean JSON export download generator
 *  - Rolling snapshots history with instantaneous restore
 *  - Factory reset protection
 */

import React, { useState, useRef } from "react";
import { useStore } from "../context/StoreContext";
import { BackupSnapshot, CURRENT_SCHEMA_VERSION, VALIDATION_LIMITS } from "../types/store";
import {
  X,
  Upload,
  Download,
  History,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  FileText,
  Clock,
  Database,
  ArrowRight,
} from "lucide-react";

interface BackupDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BackupDialog: React.FC<BackupDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    items,
    categories,
    snapshots,
    importBackup,
    exportBackupJson,
    restoreFromSnapshot,
    resetToDefaults,
  } = useStore();

  const [activeTab, setActiveTab] = useState<"import" | "export" | "snapshots">("import");
  const [importStatus, setImportStatus] = useState<{
    success?: boolean;
    message?: string;
    errors?: string[];
    itemCount?: number;
    categoryCount?: number;
  } | null>(null);

  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<BackupSnapshot | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Handle File Selection and Transactional Import
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > VALIDATION_LIMITS.MAX_BACKUP_FILE_BYTES) {
      setImportStatus({
        success: false,
        message: `File size exceeds the limit of ${
          VALIDATION_LIMITS.MAX_BACKUP_FILE_BYTES / (1024 * 1024)
        }MB.`,
        errors: [`Selected file size: ${(file.size / (1024 * 1024)).toFixed(2)} MB`],
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const res = importBackup(content, file.size);
      if (res.success) {
        setImportStatus({
          success: true,
          message: `Successfully imported backup with schema v${res.data.schemaVersion}!`,
          itemCount: res.data.items.length,
          categoryCount: res.data.categories.length,
        });
      } else {
        const err = res.error;
        if (err.type === "IMPORT_VALIDATION") {
          setImportStatus({
            success: false,
            message: err.message,
            errors: err.errors,
          });
        } else {
          setImportStatus({
            success: false,
            message: err.message,
          });
        }
      }
    };
    reader.onerror = () => {
      setImportStatus({
        success: false,
        message: "Failed to read the selected file from disk.",
      });
    };
    reader.readAsText(file);

    // Reset input value so same file can be re-selected if desired
    e.target.value = "";
  };

  // Handle Export File Download
  const handleExportDownload = () => {
    const jsonStr = exportBackupJson();
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().split("T")[0];
    const link = document.createElement("a");
    link.href = url;
    link.download = `store_price_list_backup_v${CURRENT_SCHEMA_VERSION}_${dateStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-dialog-title"
    >
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 id="backup-dialog-title" className="text-lg font-bold text-slate-900">
                Backup, Export & Snapshots
              </h2>
              <p className="text-xs text-slate-500">
                Transactional import, export, and rollback snapshots (Schema v{CURRENT_SCHEMA_VERSION})
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

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 px-6 pt-3 gap-2 bg-slate-50/40">
          <button
            type="button"
            onClick={() => setActiveTab("import")}
            className={`pb-3 px-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "import"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Upload className="w-4 h-4" />
            Import JSON
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("export")}
            className={`pb-3 px-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "export"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Download className="w-4 h-4" />
            Export Data
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("snapshots")}
            className={`pb-3 px-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "snapshots"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <History className="w-4 h-4" />
            Auto Snapshots ({snapshots.length})
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 space-y-4">
          {/* TAB 1: IMPORT */}
          {activeTab === "import" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-100 text-xs text-indigo-900 space-y-1">
                <p className="font-semibold">Transactional Import Pipeline:</p>
                <p className="text-indigo-700">
                  Read &rarr; Parse &rarr; Validate Constraints &rarr; Atomic Persist &rarr; Commit to UI.
                  If validation fails, your current data remains 100% untouched.
                </p>
              </div>

              {/* Upload Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-2xl p-6 text-center cursor-pointer bg-slate-50/50 hover:bg-indigo-50/20 transition-all space-y-2 group"
              >
                <div className="w-12 h-12 mx-auto rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Click or drag & drop backup JSON file
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Supports Schema v1 and v2 formats (Max 10MB)
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {/* Import Results Banner */}
              {importStatus && (
                <div
                  className={`p-4 rounded-xl border space-y-2 animate-in fade-in duration-150 ${
                    importStatus.success
                      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                      : "bg-rose-50 border-rose-200 text-rose-900"
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-sm">
                    {importStatus.success ? (
                      <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                    )}
                    <span>{importStatus.message}</span>
                  </div>

                  {importStatus.success && (
                    <div className="flex gap-4 text-xs font-medium text-emerald-800 pt-1">
                      <span>• Total Items: {importStatus.itemCount}</span>
                      <span>• Categories: {importStatus.categoryCount}</span>
                    </div>
                  )}

                  {importStatus.errors && importStatus.errors.length > 0 && (
                    <div className="pt-2 border-t border-rose-200 space-y-1">
                      <p className="text-xs font-bold text-rose-800">
                        Detailed Validation Errors:
                      </p>
                      <ul className="text-xs space-y-1 text-rose-700 max-h-32 overflow-y-auto pl-4 list-disc font-mono">
                        {importStatus.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: EXPORT */}
          {activeTab === "export" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase text-slate-700">
                    Current Catalog Summary
                  </span>
                  <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                    Schema v{CURRENT_SCHEMA_VERSION}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="p-3 bg-white rounded-lg border border-slate-200">
                    <div className="text-2xl font-black text-slate-900 font-mono">
                      {items.length}
                    </div>
                    <div className="text-xs text-slate-500 font-medium">Total Items</div>
                  </div>
                  <div className="p-3 bg-white rounded-lg border border-slate-200">
                    <div className="text-2xl font-black text-slate-900 font-mono">
                      {categories.length}
                    </div>
                    <div className="text-xs text-slate-500 font-medium">Categories</div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                id="btn-download-backup"
                onClick={handleExportDownload}
                className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-sm transition-colors"
              >
                <Download className="w-4 h-4" />
                Download JSON Backup File
              </button>

              {/* Danger Zone: Factory Reset */}
              <div className="pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-rose-50 border border-rose-100">
                  <div>
                    <h4 className="text-xs font-bold text-rose-900 uppercase">
                      Reset Data to Defaults
                    </h4>
                    <p className="text-xs text-rose-700">
                      Replaces store with initial sample grocery list
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsResetConfirmOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors"
                  >
                    Reset Store
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SNAPSHOTS */}
          {activeTab === "snapshots" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Automatic snapshots created before atomic writes. Select any snapshot to restore instant state.
              </p>

              {snapshots.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">
                  No automated snapshots recorded yet.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {snapshots.map((snap, idx) => (
                    <div
                      key={snap.timestamp}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-indigo-50/40 border border-slate-200 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <div>
                          <div className="text-xs font-semibold text-slate-900">
                            {snap.dateString}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {snap.itemCount} items, {snap.categoryCount} categories
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedSnapshot(snap)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white hover:bg-indigo-600 hover:text-white text-slate-700 text-xs font-semibold border border-slate-200 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-slate-100 bg-slate-50/70">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Snapshot Restore Confirmation Modal */}
      {selectedSnapshot && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-indigo-600">
              <RotateCcw className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900">
                Restore Snapshot from {selectedSnapshot.dateString}?
              </h3>
            </div>
            <p className="text-sm text-slate-600">
              This will restore the store state with{" "}
              <strong>{selectedSnapshot.itemCount} items</strong> and{" "}
              <strong>{selectedSnapshot.categoryCount} categories</strong>.
            </p>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedSnapshot(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  restoreFromSnapshot(selectedSnapshot);
                  setSelectedSnapshot(null);
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold"
              >
                Confirm Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Factory Reset Confirmation Modal */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900">
                Reset All Store Data to Defaults?
              </h3>
            </div>
            <p className="text-sm text-slate-600">
              Are you sure? All custom items and categories will be reset to the default sample dataset.
            </p>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  resetToDefaults();
                  setIsResetConfirmOpen(false);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold"
              >
                Yes, Reset All Data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
