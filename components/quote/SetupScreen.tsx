"use client";

import { Database, Download, ClipboardList, History as HistoryIcon, Trash2 } from "lucide-react";
import { Card, IconButton, SecondaryButton, Empty } from "./ui";
import { AdminCredentialsCard } from "./AdminCredentialsCard";
import { CatalogUpdateCard } from "@/components/admin/CatalogUpdateCard";
import {
  missingSkusToCsv,
  money,
  quotationTotal,
  type MissingSkuEntry,
  type Quotation,
} from "@/lib/quote-types";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function downloadMissingSkusCsv(entries: MissingSkuEntry[]) {
  const csv = missingSkusToCsv(entries);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `missing-skus-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SetupScreen({
  catalogCount,
  missingSkus,
  onRemoveMissingSku,
  historyList,
  activeId,
  onOpenHistory,
  isAdmin,
  onCredentialsChanged,
  onCatalogUpdated,
}: {
  catalogCount: number;
  missingSkus: MissingSkuEntry[];
  onRemoveMissingSku: (sku: string, date: string) => void;
  historyList: Quotation[];
  activeId: string;
  onOpenHistory: (q: Quotation) => void;
  isAdmin: boolean;
  onCredentialsChanged: () => void;
  onCatalogUpdated: () => void;
}) {
  return (
    <main className="flex flex-col gap-5 px-margin-mobile py-6 pb-24">
      <Card title="Product library">
        <div className="flex items-center gap-2.5">
          <Database className={`h-4 w-4 ${catalogCount ? "text-on-tertiary-container" : "text-on-surface-variant"}`} />
          <span className="text-body-md text-primary">
            {catalogCount ? (
              <>
                <b>{catalogCount.toLocaleString()}</b> products loaded
              </>
            ) : (
              "Loading catalogue…"
            )}
          </span>
        </div>
        <p className="mt-2.5 text-body-md text-on-surface-variant">
          Synced automatically from the catalogue on R2.{" "}
          {isAdmin ? "Manage it below." : "Log in as admin to manage it."}
        </p>
      </Card>

      {isAdmin && <CatalogUpdateCard onCatalogUpdated={onCatalogUpdated} />}

      {isAdmin && <AdminCredentialsCard onChanged={onCredentialsChanged} />}

      <Card title="History">
        {historyList.length === 0 ? (
          <Empty icon={HistoryIcon} title="Nothing yet" body="Quotations show up here once they have at least one item." />
        ) : (
          <div className="flex flex-col gap-2">
            {historyList.map((q) => {
              const isCurrent = q.id === activeId;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => onOpenHistory(q)}
                  className="tap w-full rounded border border-outline-variant bg-surface-container-low p-3 text-left hover:border-primary"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-body-md font-medium text-primary">
                          {q.customer.trim() || "Untitled"}
                        </span>
                        {isCurrent && (
                          <span className="shrink-0 rounded bg-tertiary-fixed px-1.5 py-0.5 text-[10px] text-on-tertiary-container">
                            Current
                          </span>
                        )}
                      </div>
                      <div className="truncate text-label-caps text-on-surface-variant">
                        {[q.project, q.date, q.ref].filter((s) => s && s.trim()).join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tnum text-price-sm font-medium text-primary">{money(quotationTotal(q))}</div>
                      <div className="text-label-caps text-on-surface-variant">
                        {q.items.length} item{q.items.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Missing from price list">
        {missingSkus.length === 0 ? (
          <Empty
            icon={ClipboardList}
            title="Nothing logged yet"
            body='Scanned tags for products not in the catalogue show up here when you use "Use details from the tag".'
          />
        ) : (
          <>
            <p className="mb-3 text-body-md text-on-surface-variant">
              {missingSkus.length} product{missingSkus.length === 1 ? "" : "s"} seen in the showroom but not yet in the price
              list. Add these to the source spreadsheet.
            </p>
            <div className="mb-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
              {[...missingSkus].reverse().map((m, i) => (
                <div key={`${m.sku || "nosku"}-${m.date}-${i}`} className="rounded border border-outline-variant bg-surface-container-low p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="tnum text-body-md font-medium text-primary">{m.sku || "(no code read)"}</div>
                      <div className="line-clamp-2 text-label-caps text-on-surface-variant">{m.desc}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tnum text-price-sm font-medium text-primary">{money(m.price)}</div>
                      <div className="text-label-caps text-on-surface-variant">
                        seen {m.count || 1}× · {formatDate(m.date)}
                      </div>
                    </div>
                    <IconButton onClick={() => onRemoveMissingSku(m.sku, m.date)} tone="error" label="Remove from missing list">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
            <SecondaryButton onClick={() => downloadMissingSkusCsv(missingSkus)}>
              <Download className="h-4 w-4" /> Download CSV
            </SecondaryButton>
          </>
        )}
      </Card>
    </main>
  );
}
