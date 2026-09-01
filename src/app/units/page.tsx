"use client";
import { useState } from "react";
import { useLanguage } from "@/lib/context";
import { PageHeader, KpiCard, Badge } from "@/components/shared";

interface Unit { id: number; name: string; nameEn: string; abbreviation: string; baseUnit: string; conversionFactor: string; description: string; }

const DEFAULT_UNITS: Unit[] = [
  { id: 1, name: "Κιλό", nameEn: "Kilogram", abbreviation: "kg", baseUnit: "kg", conversionFactor: "1", description: "Βασική μονάδα βάρους" },
  { id: 2, name: "Γραμμάριο", nameEn: "Gram", abbreviation: "g", baseUnit: "kg", conversionFactor: "0.001", description: "1000g = 1kg" },
  { id: 3, name: "Λίτρο", nameEn: "Liter", abbreviation: "L", baseUnit: "L", conversionFactor: "1", description: "Βασική μονάδα όγκου" },
  { id: 4, name: "Μιλιλίτρο", nameEn: "Milliliter", abbreviation: "ml", baseUnit: "L", conversionFactor: "0.001", description: "1000ml = 1L" },
  { id: 5, name: "Τεμάχιο", nameEn: "Piece", abbreviation: "pcs", baseUnit: "pcs", conversionFactor: "1", description: "Μονάδα αντικειμένων" },
  { id: 6, name: "Μπουκάλι", nameEn: "Bottle", abbreviation: "btl", baseUnit: "pcs", conversionFactor: "1", description: "Ένα μπουκάλι" },
  { id: 7, name: "Κουτί", nameEn: "Box/Carton", abbreviation: "box", baseUnit: "pcs", conversionFactor: "1", description: "Μια συσκευασία" },
  { id: 8, name: "Σακούλα", nameEn: "Sack", abbreviation: "sack", baseUnit: "kg", conversionFactor: "25", description: "25kg σακούλα" },
];

export default function UnitsPage() {
  const { t, locale } = useLanguage();
  const [units] = useState<Unit[]>(DEFAULT_UNITS);

  return (
    <div>
      <PageHeader title={t("headerUnits")} subtitle="Πίνακες Μονάδων & Μετατροπών / Units & Conversion Dictionary">
        <button onClick={() => window.print()} className="erp-btn-secondary">🖨️ {t("btnPrint")}</button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "Σύνολο Μονάδων" : "Total Units"} value={units.length} color="blue" icon="⚖️" />
        <KpiCard label={locale === "gr" ? "Βασικές Μονάδες" : "Base Units"} value={[...new Set(units.map(u => u.baseUnit))].length} color="green" icon="📐" />
        <KpiCard label={locale === "gr" ? "Μετατροπές" : "Conversions"} value={units.filter(u => u.conversionFactor !== "1").length} color="purple" icon="🔄" />
      </div>

      <div className="erp-card mb-6">
        <div className="erp-card-header"><h3 className="font-semibold">⚖️ {locale === "gr" ? "Βάση Μονάδων" : "Unit Base"}</h3></div>
        <div className="overflow-x-auto">
          <table className="erp-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{locale === "gr" ? "Ονομασία (GR)" : "Name (GR)"}</th>
                <th>{locale === "gr" ? "Ονομασία (EN)" : "Name (EN)"}</th>
                <th>{locale === "gr" ? "Σύμβολο" : "Abbreviation"}</th>
                <th>{locale === "gr" ? "Βασική Μονάδα" : "Base Unit"}</th>
                <th>{t("fieldConversionFactor")}</th>
                <th>{t("fieldDescription")}</th>
              </tr>
            </thead>
            <tbody>
              {units.map(u => (
                <tr key={u.id}>
                  <td className="text-xs text-slate-400">{u.id}</td>
                  <td className="font-medium">{u.name}</td>
                  <td className="text-slate-500">{u.nameEn}</td>
                  <td><Badge color="blue">{u.abbreviation}</Badge></td>
                  <td><Badge color="grey">{u.baseUnit}</Badge></td>
                  <td className="font-mono text-sm">{u.conversionFactor}</td>
                  <td className="text-sm text-slate-500">{u.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Conversion Examples */}
      <div className="erp-card">
        <div className="erp-card-header"><h3 className="font-semibold">🔄 {locale === "gr" ? "Παραδείγματα Μετατροπής" : "Conversion Examples"}</h3></div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { from: "1 Item", to: "20 Pieces", icon: "📦" },
              { from: "1 Item", to: "120 Grams", icon: "🧈" },
              { from: "1 Item", to: "250 Grams", icon: "🧀" },
              { from: "1000 Grams", to: "1 Kilogram", icon: "⚖️" },
              { from: "1000 Milliliters", to: "1 Liter", icon: "💧" },
              { from: "1 Sack", to: "25 Kilograms", icon: "🌾" },
            ].map((c, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <span className="text-2xl">{c.icon}</span>
                <div>
                  <div className="text-sm font-medium">{c.from}</div>
                  <div className="text-xs text-slate-400">= {c.to}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
