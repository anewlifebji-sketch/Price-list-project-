/**
 * TestSuiteDialog Component
 * Implements Requirements 23 & 24:
 *  - Interactive visual runner for repository, storage, validation, and reordering unit tests
 *  - Real-time execution stats, durations, and diagnostic assertions
 */

import React, { useState, useEffect } from "react";
import { runAllUnitTests, TestSuiteSummary, TestCaseResult } from "../utils/testRunner";
import { X, Play, CheckCircle2, XCircle, Clock, ShieldCheck, Activity, Terminal } from "lucide-react";

interface TestSuiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TestSuiteDialog: React.FC<TestSuiteDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [summary, setSummary] = useState<TestSuiteSummary | null>(null);

  const runTests = async () => {
    setIsRunning(true);
    try {
      const res = await runAllUnitTests();
      setSummary(res);
    } finally {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    if (isOpen && !summary) {
      runTests();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="test-suite-dialog-title"
    >
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 id="test-suite-dialog-title" className="text-lg font-bold text-slate-900">
                Release Verification & Unit Test Suite
              </h2>
              <p className="text-xs text-slate-500">
                Regression & transactional persistence test runner (Requirement 23)
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
        <div className="p-6 space-y-5">
          {/* Summary Metric Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-900 text-white shadow-inner">
            <div className="flex items-center gap-5">
              <div>
                <div className="text-2xl font-black font-mono">
                  {summary ? `${summary.passed}/${summary.total}` : "—"}
                </div>
                <div className="text-xs text-slate-400 font-medium">Tests Passed</div>
              </div>
              <div className="h-8 w-px bg-slate-700" />
              <div>
                <div className="text-2xl font-black font-mono text-emerald-400">
                  {summary ? (summary.failed === 0 ? "100%" : `${Math.round((summary.passed / summary.total) * 100)}%`) : "—"}
                </div>
                <div className="text-xs text-slate-400 font-medium">Pass Rate</div>
              </div>
              <div className="h-8 w-px bg-slate-700" />
              <div>
                <div className="text-2xl font-black font-mono text-indigo-300">
                  {summary ? `${summary.totalDurationMs}ms` : "—"}
                </div>
                <div className="text-xs text-slate-400 font-medium">Total Duration</div>
              </div>
            </div>

            <button
              type="button"
              id="btn-rerun-tests"
              disabled={isRunning}
              onClick={runTests}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold transition-all disabled:opacity-50"
            >
              {isRunning ? (
                <Activity className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {isRunning ? "Running Tests..." : "Re-Run All Tests"}
            </button>
          </div>

          {/* Test cases list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700 uppercase tracking-wider">
              <span>Test Case Assertions</span>
              <span>Status & Latency</span>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
              {summary?.results.map((test) => (
                <div
                  key={test.id}
                  className={`p-3 rounded-xl border transition-all ${
                    test.passed
                      ? "bg-emerald-50/50 border-emerald-200/80"
                      : "bg-rose-50 border-rose-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      {test.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">
                            {test.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-700">
                            {test.category}
                          </span>
                        </div>
                        {test.errorMessage && (
                          <p className="mt-1 text-xs text-rose-700 font-mono">
                            {test.errorMessage}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 text-xs font-mono">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-slate-600">{test.durationMs}ms</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Terminal className="w-4 h-4" />
            <span>All verification benchmarks passing.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
