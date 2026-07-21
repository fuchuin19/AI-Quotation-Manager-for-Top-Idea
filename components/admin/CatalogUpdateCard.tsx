"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, X } from "lucide-react";
import { Card, GhostButton, PrimaryButton, Row, SecondaryButton } from "@/components/quote/ui";

interface DiffCounts {
  new: number;
  changed: number;
  unchanged: number;
  removed: number;
  total: number;
}

interface ImageToUpload {
  key: string;
  contentType: string;
  buffer: Uint8Array;
}

interface SummaryData {
  counts: DiffCounts;
  conflicts: unknown[];
  missingPriceCount: number;
  skippedSheets: { name: string; reason: string }[];
  imagesToUploadCount: number;
  imagesToUploadBytes: number;
  unsupportedFormats: string[];
  imagesToUpload: ImageToUpload[];
  finalProducts: unknown[];
}

type Stage = "idle" | "working" | "summary" | "uploading" | "saving" | "done" | "error";

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let idx = 0;
  const workerCount = Math.min(limit, items.length) || 0;
  await Promise.all(
    new Array(workerCount).fill(0).map(async () => {
      while (idx < items.length) {
        const i = idx++;
        await fn(items[i]);
      }
    })
  );
}

export function CatalogUpdateCard({ onCatalogUpdated }: { onCatalogUpdated?: () => void }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState("");
  const [sheetProgress, setSheetProgress] = useState<{ current: number; total: number; sheetName: string } | null>(null);
  const [imageProgress, setImageProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [failedImages, setFailedImages] = useState<ImageToUpload[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [doneCount, setDoneCount] = useState<{ total: number; added: number } | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => workerRef.current?.terminate();
  }, []);

  // Closing the tab mid-upload could leave images uploaded but the
  // catalogue never saved to point at them — not corrupt, just wasted
  // work, but worth stopping him from doing by accident.
  useEffect(() => {
    if (stage !== "uploading" && stage !== "saving") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [stage]);

  const reset = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setStage("idle");
    setPhaseLabel("");
    setSheetProgress(null);
    setImageProgress(null);
    setSummary(null);
    setUploadProgress({ done: 0, total: 0 });
    setFailedImages([]);
    setErrorMessage("");
    setDoneCount(null);
  }, []);

  const startParsing = useCallback((file: File) => {
    if (!/\.xlsx$/i.test(file.name)) {
      setErrorMessage("That's not a .xlsx file. Drop the updated Quotation items Library.xlsx.");
      setStage("error");
      return;
    }

    setStage("working");
    setPhaseLabel("Starting…");
    setSheetProgress(null);
    setImageProgress(null);

    (async () => {
      let baseline: unknown[] = [];
      try {
        const res = await fetch("/api/products", { cache: "no-store" });
        if (res.ok) baseline = await res.json();
      } catch {
        // A fresh/empty baseline just means everything shows up as "new" —
        // still safe to proceed rather than blocking on a catalogue fetch hiccup.
      }

      const worker = new Worker(new URL("./catalogWorker.js", import.meta.url));
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "phase") {
          if (msg.phase === "reading") setPhaseLabel("Reading the file…");
          else if (msg.phase === "parsing") setPhaseLabel("Reading the workbook…");
          else if (msg.phase === "comparing") setPhaseLabel("Comparing against the current catalogue…");
          else if (msg.phase === "images") setPhaseLabel("Checking product photos…");
        } else if (msg.type === "progress") {
          setSheetProgress({ current: msg.current, total: msg.total, sheetName: msg.sheetName });
        } else if (msg.type === "progress-images") {
          setImageProgress({ done: msg.done, total: msg.total });
        } else if (msg.type === "summary") {
          setSummary(msg as SummaryData);
          setStage("summary");
          worker.terminate();
          workerRef.current = null;
        } else if (msg.type === "error") {
          setErrorMessage(msg.message);
          setStage("error");
          worker.terminate();
          workerRef.current = null;
        }
      };
      worker.onerror = (err) => {
        setErrorMessage(err.message || "Something went wrong reading that file.");
        setStage("error");
        worker.terminate();
        workerRef.current = null;
      };

      worker.postMessage({ file, baseline, publicUrlBase: process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "" });
    })();
  }, []);

  const uploadBatch = useCallback(
    async (images: ImageToUpload[]) => {
      setStage("uploading");
      setUploadProgress({ done: 0, total: images.length });
      const failed: ImageToUpload[] = [];
      let done = 0;

      await runWithConcurrency(images, 4, async (img) => {
        try {
          // Always request a fresh presigned URL here rather than reusing
          // the one from the summary step — he may have sat looking at the
          // summary for a while, and a stale signed URL would just 403.
          const res = await fetch("/api/admin/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: img.key, contentType: img.contentType }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `server said ${res.status}`);
          if (!data.exists) {
            const put = await fetch(data.uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": img.contentType },
              // Uint8Array<ArrayBufferLike> vs BlobPart's Uint8Array<ArrayBuffer>
              // is a TS strictness mismatch, not a real runtime concern — these
              // buffers are always plain ArrayBuffers (built by OffscreenCanvas
              // or read from the zip), never SharedArrayBuffer-backed.
              body: new Blob([img.buffer as BlobPart]),
            });
            if (!put.ok) throw new Error(`upload failed (${put.status})`);
          }
        } catch {
          failed.push(img);
        } finally {
          done++;
          setUploadProgress({ done, total: images.length });
        }
      });

      if (failed.length > 0) {
        setFailedImages(failed);
        setErrorMessage(
          `Couldn't upload ${failed.length} of ${images.length} image${images.length === 1 ? "" : "s"}. Nothing has been saved yet — safe to retry.`
        );
        setStage("error");
        return;
      }

      setStage("saving");
      try {
        const res = await fetch("/api/admin/save-catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ products: summary?.finalProducts || [] }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `server said ${res.status}`);
        setDoneCount({ total: data.count, added: summary?.counts.new || 0 });
        setStage("done");
        onCatalogUpdated?.();
      } catch (err) {
        setErrorMessage(
          `Images uploaded fine, but saving the catalogue failed: ${err instanceof Error ? err.message : String(err)}. Your images are safe — just try saving again.`
        );
        setStage("error");
      }
    },
    [summary, onCatalogUpdated]
  );

  const handleConfirm = useCallback(() => {
    if (!summary) return;
    uploadBatch(summary.imagesToUpload);
  }, [summary, uploadBatch]);

  const handleRetry = useCallback(() => {
    // If we have specific failed images, only retry those. If the failure
    // was at the save step (no failedImages recorded), just retry saving —
    // never re-upload images that already succeeded.
    if (failedImages.length > 0) {
      uploadBatch(failedImages);
    } else if (summary) {
      setStage("saving");
      (async () => {
        try {
          const res = await fetch("/api/admin/save-catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ products: summary.finalProducts }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `server said ${res.status}`);
          setDoneCount({ total: data.count, added: summary.counts.new });
          setStage("done");
          onCatalogUpdated?.();
        } catch (err) {
          setErrorMessage(`Still couldn't save: ${err instanceof Error ? err.message : String(err)}`);
          setStage("error");
        }
      })();
    } else {
      reset();
    }
  }, [failedImages, summary, uploadBatch, reset, onCatalogUpdated]);

  const handleFileChosen = useCallback(
    (file: File | undefined) => {
      if (file) startParsing(file);
    },
    [startParsing]
  );

  return (
    <Card title="Update product catalogue">
      {stage === "idle" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFileChosen(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`tap flex flex-col items-center gap-3 rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragOver ? "border-primary bg-surface-container-low" : "border-outline-variant hover:border-primary"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              handleFileChosen(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Upload className="h-8 w-8 text-outline-variant" />
          <p className="text-body-lg text-primary">Drop the updated Quotation items Library.xlsx here</p>
          <p className="text-body-md text-on-surface-variant">or tap to choose the file</p>
          <p className="mt-2 text-label-caps text-on-surface-variant">The file stays on this device — nothing is sent until you confirm.</p>
        </div>
      )}

      {stage === "working" && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <FileSpreadsheet className="h-8 w-8 animate-pulse text-primary" />
          <p className="text-body-lg text-primary">{phaseLabel}</p>
          {sheetProgress && (
            <p className="text-body-md text-on-surface-variant">
              Reading sheet {sheetProgress.current} of {sheetProgress.total}
            </p>
          )}
          {imageProgress && imageProgress.total > 0 && (
            <p className="text-body-md text-on-surface-variant">
              Checking photo {imageProgress.done} of {imageProgress.total}
            </p>
          )}
          <GhostButton onClick={reset}>Cancel</GhostButton>
        </div>
      )}

      {stage === "summary" && summary && (
        <div className="flex flex-col gap-4">
          <div className="text-center">
            <p className="text-headline-sm font-semibold text-primary">
              {summary.counts.total.toLocaleString()} products found
            </p>
          </div>
          <div className="flex flex-col gap-1 border-y border-outline-variant py-3">
            <Row l="New products" r={summary.counts.new.toLocaleString()} />
            <Row l="Price changes" r={summary.counts.changed.toLocaleString()} />
            <Row l="Unchanged" r={summary.counts.unchanged.toLocaleString()} />
            <Row l="Removed from the file" r={summary.counts.removed.toLocaleString()} />
          </div>
          <div className="flex flex-col gap-1">
            <Row l="Price conflicts found" r={summary.conflicts.length.toLocaleString()} />
            <Row l="Products with no price" r={summary.missingPriceCount.toLocaleString()} />
          </div>
          <p className="text-body-md text-on-surface-variant">
            {summary.imagesToUploadCount === 0
              ? "No new photos need uploading."
              : `Only ${summary.imagesToUploadCount.toLocaleString()} image${summary.imagesToUploadCount === 1 ? "" : "s"} need${
                  summary.imagesToUploadCount === 1 ? "s" : ""
                } uploading (about ${fmtBytes(summary.imagesToUploadBytes)})`}
          </p>

          {summary.counts.removed > 0 && (
            <p className="flex items-start gap-2 text-body-md text-secondary">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {summary.counts.removed} product{summary.counts.removed === 1 ? "" : "s"} missing from this file will be kept as-is,
              not deleted.
            </p>
          )}
          {summary.skippedSheets.filter((s) => !s.reason.includes("excluded by name")).length > 0 && (
            <p className="flex items-start gap-2 text-body-md text-error">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {summary.skippedSheets.filter((s) => !s.reason.includes("excluded by name")).length} sheet(s) couldn&apos;t be read —
              check these manually:{" "}
              {summary.skippedSheets
                .filter((s) => !s.reason.includes("excluded by name"))
                .map((s) => s.name)
                .join(", ")}
            </p>
          )}
          {summary.unsupportedFormats.length > 0 && (
            <p className="flex items-start gap-2 text-body-md text-secondary">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {summary.unsupportedFormats.length} image{summary.unsupportedFormats.length === 1 ? "" : "s"} couldn&apos;t be
              auto-compressed and will upload as-is — worth replacing with a real photo later.
            </p>
          )}

          <div className="flex gap-gutter">
            <SecondaryButton onClick={reset}>Cancel</SecondaryButton>
            <PrimaryButton onClick={handleConfirm}>Update catalogue</PrimaryButton>
          </div>
        </div>
      )}

      {(stage === "uploading" || stage === "saving") && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <Upload className="h-8 w-8 animate-pulse text-primary" />
          {stage === "uploading" ? (
            <>
              <p className="text-body-lg text-primary">Uploading photos…</p>
              <p className="tnum text-body-md text-on-surface-variant">
                {uploadProgress.done} of {uploadProgress.total}
              </p>
              <div className="h-2 w-full max-w-[240px] overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${uploadProgress.total ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%` }}
                />
              </div>
            </>
          ) : (
            <p className="text-body-lg text-primary">Saving the catalogue…</p>
          )}
          <p className="text-label-caps text-on-surface-variant">Don&apos;t close this tab.</p>
        </div>
      )}

      {stage === "done" && doneCount && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-on-tertiary-container" />
          <p className="text-body-lg text-primary">
            Catalogue updated. {doneCount.total.toLocaleString()} products, {doneCount.added.toLocaleString()} new.
          </p>
          <p className="text-body-md text-on-surface-variant">The app will pick this up automatically within a minute or two.</p>
          <GhostButton onClick={reset}>Update again</GhostButton>
        </div>
      )}

      {stage === "error" && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <X className="h-8 w-8 text-error" />
          <p className="text-body-lg text-primary">{errorMessage}</p>
          <div className="flex gap-gutter">
            <SecondaryButton onClick={reset}>Start over</SecondaryButton>
            {(failedImages.length > 0 || summary) && <PrimaryButton onClick={handleRetry}>Retry</PrimaryButton>}
          </div>
        </div>
      )}
    </Card>
  );
}
