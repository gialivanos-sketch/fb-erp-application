"use client";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard, Badge } from "@/components/shared";

export default function MenuArchivePage() {
  const { t, locale, data } = useLanguage();
  const menus = data.menus;

  const fmt = (n: number) => `€${n.toFixed(2)}`;

  return (
    <div>
      <PageHeader title={t("headerMenuArchive")} subtitle="Menu Directory Archive / Αρχείο Μενού">
        <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Σύνολο Μενού" : "Total Menus"} value={menus.length} color="blue" icon="📚" />
        <KpiCard label={locale === "gr" ? "Ενεργά" : "Active"} value={menus.filter(m => m?.status === "active").length} color="green" icon="✅" />
        <KpiCard label={locale === "gr" ? "Μέσο Περιθώριο" : "Avg Margin"} value={`${menus.length > 0 ? (menus.reduce((s, m) => s + Number(m?.avgProfitMargin ?? 0), 0) / menus.length).toFixed(1) : 0}%`} color="purple" icon="📈" />
      </div>

      <div className="erp-card">
        <div className="overflow-x-auto">
          <table className="erp-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t("fieldMenuTitle")}</th>
                <th>{locale === "gr" ? "Συνταγές" : "Recipes"}</th>
                <th>{locale === "gr" ? "Μερίδες" : "Portions"}</th>
                <th>{locale === "gr" ? "Κόστος" : "Cost"}</th>
                <th>{t("fieldProfitMargin")}</th>
                <th>{t("fieldStatus")}</th>
                <th>{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {menus.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">{t("noData")}</td></tr> :
                menus.map((m, idx) => (
                  <tr key={m?.id ?? `menu-${idx}`}>
                    <td className="text-xs text-slate-400">{m?.id ?? "—"}</td>
                    <td>
                      <div className="font-medium">{m?.title ?? "—"}</div>
                      {m?.titleEn && <div className="text-xs text-slate-400">{m.titleEn}</div>}
                      <div className="text-[10px] text-slate-300 mt-1">
                        {(m?.recipes || []).map(r => r?.recipeName).join(", ")}
                      </div>
                    </td>
                    <td><Badge color="blue">{m?.totalRecipes ?? 0}</Badge></td>
                    <td>{m?.totalPortions ?? 0}</td>
                    <td className="font-semibold">{fmt(Number(m?.totalFoodCost ?? 0))}</td>
                    <td><Badge color={Number(m?.avgProfitMargin ?? 0) >= 60 ? "green" : "amber"}>{m?.avgProfitMargin}%</Badge></td>
                    <td><Badge color={m?.status === "active" ? "green" : "grey"}>{m?.status ?? "—"}</Badge></td>
                    <td>
                      <div className="flex gap-1">
                        <a href="/menu-planner" className="erp-btn-secondary text-xs px-2 py-1">📂 {t("btnOpen")}</a>
                        <a href="/consumption" className="erp-btn-secondary text-xs px-2 py-1">📊 {t("btnRun")}</a>
                        <button onClick={() => window.print()} className="erp-btn-secondary text-xs px-2 py-1">🖨️</button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
