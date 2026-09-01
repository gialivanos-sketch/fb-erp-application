"use client";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard } from "@/components/shared";

export default function InventoryArchivePage() {
  const { t, locale, data } = useLanguage();
  const snapshots = data.inventorySnapshots;

  const latestValue = snapshots.length > 0 ? Number(snapshots[0].recordedValue) : 0;
  const totalVariance = snapshots.reduce((s, snap) => s + Number(snap?.deltaVariance || 0), 0);
  const fmt = (n: number) => `€${n.toLocaleString("el-GR", { minimumFractionDigits: 2 })}`;

  return (
    <div>
      <PageHeader title={t("headerInventoryArchive")} subtitle="Ιστορικό Αποθήκευσης Απογραφής">
        <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Τελευταία Αξία" : "Latest Value"} value={fmt(latestValue)} color="blue" icon="📦" />
        <KpiCard label={locale === "gr" ? "Σύνολο Αποκλίσεων" : "Total Variance"} value={fmt(totalVariance)} color={totalVariance < 0 ? "red" : "green"} icon="📉" />
        <KpiCard label={locale === "gr" ? "Αριθμός Απογραφών" : "Snapshot Count"} value={snapshots.length} color="purple" icon="📊" />
      </div>

      <div className="erp-card">
        <div className="erp-card-header">
          <h3 className="font-semibold">📅 {locale === "gr" ? "Ιστορικό Απογραφών" : "Snapshot History"}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="erp-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{locale === "gr" ? "Ημερομηνία" : "Date"}</th>
                <th>{locale === "gr" ? "Μήνας" : "Month"}</th>
                <th>{locale === "gr" ? "Τελευταία Αξία Αποθέματος" : "Last Recorded Value"}</th>
                <th>{locale === "gr" ? "Προηγούμενη Αξία" : "Previous Value"}</th>
                <th>{locale === "gr" ? "Διαφορά" : "Delta Variance"}</th>
                <th>{t("fieldNotes")}</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-slate-400">{t("noData")}</td></tr> :
                snapshots.map((snap, idx) => (
                  <tr key={snap?.id ?? `snap-${idx}`}>
                    <td className="text-xs text-slate-400">{snap?.id ?? "—"}</td>
                    <td className="text-sm">{snap?.snapshotDate ?? "—"}</td>
                    <td className="font-medium">{snap?.monthLabel || "—"}</td>
                    <td className="font-semibold">{fmt(Number(snap?.recordedValue ?? 0))}</td>
                    <td className="text-slate-500">{fmt(Number(snap?.previousValue ?? 0))}</td>
                    <td className={`font-semibold ${Number(snap?.deltaVariance ?? 0) < 0 ? "text-red-600" : Number(snap?.deltaVariance ?? 0) > 0 ? "text-emerald-600" : ""}`}>
                      {Number(snap?.deltaVariance ?? 0) > 0 ? "+" : ""}{fmt(Number(snap?.deltaVariance ?? 0))}
                    </td>
                    <td className="text-sm text-slate-500">{snap?.notes || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
