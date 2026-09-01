"use client";
import { useState, useMemo } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard, Badge } from "@/components/shared";
import type { PrepListItem } from "@/lib/types";

export default function PrepListPage() {
  const { t, locale, data } = useLanguage();
  // Local-only overrides layered on top of the prep list — mirrors the
  // original page's behavior of not persisting toggle/override edits.
  // Keyed by prep item id so edits survive the underlying data changing
  // (e.g. a realtime update from another device).
  const [preppedOverrides, setPreppedOverrides] = useState<Record<number, boolean>>({});
  const [manualOverrides, setManualOverrides] = useState<Record<number, string>>({});

  const prepItems: PrepListItem[] = useMemo(() => data.prepLists.map((p) => {
    const preppedOverride = preppedOverrides[p.id];
    const manualOverride = manualOverrides[p.id];
    const isPrepped = preppedOverride !== undefined ? preppedOverride : p.isPrepped;
    const manual = manualOverride !== undefined ? manualOverride : p.manualOverride;
    const needed = Number(p.quantityNeeded);
    return {
      ...p,
      isPrepped,
      manualOverride: manual,
      portionCalculation: manual && Number(manual) > 0 && needed > 0
        ? String(Math.round(Number(manual) / (needed / (Number(p.quantityNeeded) || 1))))
        : p.portionCalculation,
    };
  }), [data.prepLists, preppedOverrides, manualOverrides]);

  function togglePrep(id: number) {
    const current = prepItems.find(p => p.id === id);
    setPreppedOverrides(prev => ({ ...prev, [id]: !(current?.isPrepped ?? false) }));
  }

  function updateManual(id: number, value: number) {
    setManualOverrides(prev => ({ ...prev, [id]: String(value) }));
  }

  const preppedCount = prepItems.filter(p => p?.isPrepped).length;
  const totalNeeded = prepItems.reduce((s, p) => s + Number(p?.quantityNeeded ?? 0), 0);
  const totalManual = prepItems.reduce((s, p) => s + Number(p?.manualOverride || 0), 0);

  // Group by recipe
  const grouped = prepItems.reduce((acc, item) => {
    if (!item) return acc;
    if (!acc[item.recipeName]) acc[item.recipeName] = [];
    acc[item.recipeName].push(item);
    return acc;
  }, {} as Record<string, PrepListItem[]>);

  return (
    <div>
      <PageHeader title={t("headerPrepList")} subtitle="Experience-Based Mise en Place / Prep List">
        <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Σύνολο Prep Items" : "Total Prep Items"} value={prepItems.length} color="blue" icon="🔪" />
        <KpiCard label={locale === "gr" ? "Ολοκληρωμένα" : "Completed"} value={`${preppedCount}/${prepItems.length}`} color="green" icon="✅" />
        <KpiCard label={locale === "gr" ? "Σύνολο Ποσοτήτων" : "Total Quantities"} value={`${totalNeeded.toFixed(2)} kg`} color="amber" icon="📐" />
        <KpiCard label={locale === "gr" ? "Χειροκίνητα Batch" : "Manual Batches"} value={`${totalManual.toFixed(2)} kg`} color="purple" icon="🎯" />
      </div>

      {Object.entries(grouped).length === 0 ? (
        <div className="erp-card p-12 text-center text-slate-400">
          <div className="text-4xl mb-3">🔪</div>
          <p>{locale === "gr" ? "Δεν υπάρχουν Prep Items" : "No prep items available"}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([recipeName, items]) => (
            <div key={recipeName} className="erp-card">
              <div className="erp-card-header">
                <h3 className="font-semibold flex items-center gap-2">
                  👨‍🍳 {recipeName}
                  <Badge color={items.every(i => i?.isPrepped) ? "green" : "amber"}>
                    {items.filter(i => i?.isPrepped).length}/{items.length}
                  </Badge>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="erp-table">
                  <thead>
                    <tr>
                      <th>{t("fieldProduct")}</th>
                      <th>{locale === "gr" ? "Απαιτούμενη Ποσότητα" : "Required Quantity"}</th>
                      <th>{t("fieldUnit")}</th>
                      <th>{t("fieldRequiresPrep")}</th>
                      <th>{t("fieldManualOverride")}</th>
                      <th>{t("fieldPortionCalc")}</th>
                      <th>{locale === "gr" ? "Κατάσταση" : "Status"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={item?.id ?? `prep-${idx}`}>
                        <td className="font-medium">{item?.ingredientName ?? "—"}</td>
                        <td>{Number(item?.quantityNeeded ?? 0).toFixed(3)}</td>
                        <td>{item?.unit ?? "—"}</td>
                        <td>
                          <button onClick={() => item?.id && togglePrep(item.id)} className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${item?.isPrepped ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-600"}`}>
                            {item?.isPrepped ? (locale === "gr" ? "✅ Ολοκληρώθηκε" : "✅ Done") : (locale === "gr" ? "⬜ Αναμονή" : "⬜ Pending")}
                          </button>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <input type="number" value={item?.manualOverride || ""} onChange={e => item?.id && updateManual(item.id, Number(e.target.value))}
                              className="erp-input w-24 text-sm py-1" step="0.01" placeholder="kg" />
                            <span className="text-xs text-slate-400">{item?.unit}</span>
                          </div>
                        </td>
                        <td>
                          {Number(item?.manualOverride) > 0 ? (
                            <Badge color="blue">
                              ≈ {Math.round(Number(item?.manualOverride) / (Number(item?.quantityNeeded) / (Number(item?.quantityNeeded) || 1)))} {locale === "gr" ? "μερίδες" : "portions"}
                            </Badge>
                          ) : "—"}
                        </td>
                        <td>
                          <Badge color={item?.isPrepped ? "green" : "amber"}>
                            {item?.isPrepped ? "✓" : "⏳"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
