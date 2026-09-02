"use client";
import { useState, useEffect, useMemo } from "react";
import { useApp } from "@/lib/context";
import { PageHeader, FilterBar, Badge, KpiCard } from "@/components/shared";
import * as db from "@/lib/supabaseData";
import type { ProductSkuMapEntry } from "@/lib/supabaseData";

interface SkuGroup {
  sku: string;
  finalGroup: string;
  entries: ProductSkuMapEntry[];
}

export default function SkuMappingPage() {
  const { locale, data } = useApp();
  const supplierProducts = data.supplierProducts;

  const [entries, setEntries] = useState<ProductSkuMapEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  // New-SKU quick-create form
  const [newProductName, setNewProductName] = useState("");
  const [newSku, setNewSku] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [creating, setCreating] = useState(false);

  async function loadData() {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await db.fetchProductSkuMap();
      setEntries(rows);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups: SkuGroup[] = useMemo(() => {
    const bySku = new Map<string, SkuGroup>();
    for (const e of entries) {
      let g = bySku.get(e.sku);
      if (!g) {
        g = { sku: e.sku, finalGroup: e.finalGroup, entries: [] };
        bySku.set(e.sku, g);
      }
      g.entries.push(e);
    }
    return [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  }, [entries]);

  const mappedNameSet = useMemo(() => new Set(entries.map((e) => e.productName)), [entries]);

  const unmappedProducts = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const p of supplierProducts) {
      if (mappedNameSet.has(p.productName) || seen.has(p.productName)) continue;
      seen.add(p.productName);
      list.push(p.productName);
    }
    return list.sort((a, b) => a.localeCompare(b, "el"));
  }, [supplierProducts, mappedNameSet]);

  const skuOptions = useMemo(
    () => groups.map((g) => ({ sku: g.sku, label: `${g.sku} — ${g.finalGroup}` })),
    [groups]
  );

  // Label -> sku code lookup, used by the lightweight search-as-you-type inputs
  // (a shared <datalist> + <input> instead of one big <select> per row — with
  // hundreds of rows x hundreds of SKUs, per-row <select> elements freeze the page).
  const skuLabelToCode = useMemo(() => new Map(skuOptions.map((o) => [o.label, o.sku])), [skuOptions]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.sku.toLowerCase().includes(q) ||
        g.finalGroup.toLowerCase().includes(q) ||
        g.entries.some((e) => e.productName.toLowerCase().includes(q))
    );
  }, [groups, search]);

  const filteredUnmapped = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return unmappedProducts;
    return unmappedProducts.filter((n) => n.toLowerCase().includes(q));
  }, [unmappedProducts, search]);

  function flash(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(""), 2500);
  }

  async function handleAssignToExisting(productName: string, sku: string) {
    const group = groups.find((g) => g.sku === sku);
    if (!group) return;
    try {
      await db.createProductSkuMapEntry({ productName, sku, finalGroup: group.finalGroup });
      await loadData();
      flash(locale === "gr" ? `✅ «${productName}» προστέθηκε στο ${sku}` : `✅ "${productName}" added to ${sku}`);
    } catch (err) {
      flash((locale === "gr" ? "⚠️ Αποτυχία: " : "⚠️ Failed: ") + String(err));
    }
  }

  async function handleMove(entry: ProductSkuMapEntry, newSkuValue: string) {
    if (!newSkuValue || newSkuValue === entry.sku) return;
    const group = groups.find((g) => g.sku === newSkuValue);
    if (!group) return;
    setBusyId(entry.id);
    try {
      await db.updateProductSkuMapEntry(entry.id, { sku: newSkuValue, finalGroup: group.finalGroup });
      await loadData();
      flash(locale === "gr" ? `✅ Μετακινήθηκε στο ${newSkuValue}` : `✅ Moved to ${newSkuValue}`);
    } catch (err) {
      flash((locale === "gr" ? "⚠️ Αποτυχία: " : "⚠️ Failed: ") + String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(entry: ProductSkuMapEntry) {
    setBusyId(entry.id);
    try {
      await db.deleteProductSkuMapEntry(entry.id);
      await loadData();
      flash(locale === "gr" ? "✅ Αφαιρέθηκε — έγινε ξανά μη αντιστοιχισμένο" : "✅ Removed — back to unmapped");
    } catch (err) {
      flash((locale === "gr" ? "⚠️ Αποτυχία: " : "⚠️ Failed: ") + String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRenameGroup(sku: string, currentLabel: string, newValue: string) {
    const trimmed = newValue.trim();
    if (!trimmed || trimmed === currentLabel) return;
    try {
      await db.renameSkuGroup(sku, trimmed);
      await loadData();
    } catch (err) {
      flash((locale === "gr" ? "⚠️ Αποτυχία: " : "⚠️ Failed: ") + String(err));
    }
  }

  async function handleCreateNew() {
    if (!newProductName.trim() || !newSku.trim() || !newGroup.trim()) return;
    setCreating(true);
    try {
      await db.createProductSkuMapEntry({
        productName: newProductName.trim(), sku: newSku.trim(), finalGroup: newGroup.trim(),
      });
      await loadData();
      flash(locale === "gr" ? "✅ Νέο SKU δημιουργήθηκε" : "✅ New SKU created");
      setNewProductName("");
      setNewSku("");
      setNewGroup("");
    } catch (err) {
      flash((locale === "gr" ? "⚠️ Αποτυχία: " : "⚠️ Failed: ") + String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={locale === "gr" ? "Ομαδοποίηση Ειδών (SKU)" : "SKU Grouping"}
        subtitle={
          locale === "gr"
            ? "Ποια ονόματα προϊόντων (όπως εμφανίζονται στις παραγγελίες/προσφορές) ανήκουν στο ίδιο SKU"
            : "Which raw product names (as they appear in orders/quotes) belong under the same SKU"
        }
      />

      {msg && <div className="mb-4 p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg text-sm">{msg}</div>}
      {loadError && <div className="mb-4 p-3 bg-red-50 border border-red-300 text-red-800 rounded-lg text-sm">⚠️ {loadError}</div>}

      {/* One shared list of SKU options, reused by every search-as-you-type input below */}
      <datalist id="all-sku-options">
        {skuOptions.map((o) => (
          <option key={o.sku} value={o.label} />
        ))}
      </datalist>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label={locale === "gr" ? "SKU" : "SKUs"} value={groups.length} color="blue" icon="🏷️" />
        <KpiCard label={locale === "gr" ? "Αντιστοιχισμένα Προϊόντα" : "Mapped Products"} value={entries.length} color="green" icon="✅" />
        <KpiCard label={locale === "gr" ? "Μη Αντιστοιχισμένα" : "Unmapped"} value={unmappedProducts.length} color="amber" icon="❓" />
      </div>

      <FilterBar onClear={() => setSearch("")} clearLabel={locale === "gr" ? "Καθαρισμός" : "Clear"}>
        <div>
          <label className="erp-label">{locale === "gr" ? "Αναζήτηση (SKU, ομάδα ή προϊόν)" : "Search (SKU, group, or product)"}</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-input"
            placeholder={locale === "gr" ? "π.χ. ντομάτα, SKU-0348..." : "e.g. tomato, SKU-0348..."}
          />
        </div>
      </FilterBar>

      {/* Quick create */}
      <div className="erp-card mb-6">
        <div className="erp-card-header">
          <h3 className="font-semibold">➕ {locale === "gr" ? "Νέο SKU" : "New SKU"}</h3>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="erp-label">{locale === "gr" ? "Όνομα προϊόντος" : "Product name"}</label>
            <input
              list="unmapped-products-list"
              type="text"
              value={newProductName}
              onChange={(e) => setNewProductName(e.target.value)}
              className="erp-input"
              placeholder={locale === "gr" ? "π.χ. Ντομάτα Α" : "e.g. Tomato A"}
            />
            <datalist id="unmapped-products-list">
              {unmappedProducts.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="erp-label">SKU</label>
            <input type="text" value={newSku} onChange={(e) => setNewSku(e.target.value)} className="erp-input" placeholder="SKU-0999" />
          </div>
          <div>
            <label className="erp-label">{locale === "gr" ? "Όνομα Ομάδας" : "Group Name"}</label>
            <input
              type="text"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              className="erp-input"
              placeholder={locale === "gr" ? "π.χ. Ντομάτα" : "e.g. Tomato"}
            />
          </div>
          <button
            onClick={handleCreateNew}
            disabled={creating || !newProductName.trim() || !newSku.trim() || !newGroup.trim()}
            className="erp-btn-success"
          >
            {creating ? "…" : "➕"} {locale === "gr" ? "Δημιουργία" : "Create"}
          </button>
        </div>
      </div>

      {/* Unmapped products */}
      {filteredUnmapped.length > 0 && (
        <div className="erp-card mb-6">
          <div className="erp-card-header flex items-center justify-between">
            <h3 className="font-semibold">❓ {locale === "gr" ? "Μη Αντιστοιχισμένα Προϊόντα" : "Unmapped Products"}</h3>
            <Badge color="amber">{filteredUnmapped.length}</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>{locale === "gr" ? "Προϊόν" : "Product"}</th>
                  <th>{locale === "gr" ? "Αντιστοίχιση σε υπάρχον SKU" : "Assign to existing SKU"}</th>
                </tr>
              </thead>
              <tbody>
                {filteredUnmapped.map((name) => (
                  <UnmappedRow key={name} name={name} skuLabelToCode={skuLabelToCode} locale={locale} onAssign={handleAssignToExisting} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SKU groups */}
      <div className="erp-card">
        <div className="erp-card-header flex items-center justify-between">
          <h3 className="font-semibold">🏷️ {locale === "gr" ? "Ομάδες SKU" : "SKU Groups"}</h3>
          <Badge color="blue">{filteredGroups.length}</Badge>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400">{locale === "gr" ? "Φόρτωση..." : "Loading..."}</div>
        ) : filteredGroups.length === 0 ? (
          <div className="p-8 text-center text-slate-400">{locale === "gr" ? "Δεν βρέθηκαν αποτελέσματα" : "No results"}</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredGroups.map((g) => (
              <div key={g.sku} className="p-4">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <Badge color="blue">{g.sku}</Badge>
                  <input
                    key={`${g.sku}-${g.finalGroup}`}
                    type="text"
                    defaultValue={g.finalGroup}
                    onBlur={(e) => handleRenameGroup(g.sku, g.finalGroup, e.target.value)}
                    className="erp-input font-semibold flex-1 min-w-[180px]"
                  />
                  <Badge color="grey">
                    {g.entries.length} {locale === "gr" ? "προϊόντα" : "products"}
                  </Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="erp-table">
                    <tbody>
                      {g.entries.map((e) => (
                        <tr key={e.id}>
                          <td className="text-sm">{e.productName}</td>
                          <td className="w-64">
                            <MoveToSkuInput
                              entry={e}
                              skuLabelToCode={skuLabelToCode}
                              locale={locale}
                              busy={busyId === e.id}
                              onMove={handleMove}
                            />
                          </td>
                          <td className="w-10">
                            <button onClick={() => handleRemove(e)} disabled={busyId === e.id} className="text-red-400 hover:text-red-600 text-sm">
                              ✕
                            </button>
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
    </div>
  );
}

function UnmappedRow({
  name,
  skuLabelToCode,
  locale,
  onAssign,
}: {
  name: string;
  skuLabelToCode: Map<string, string>;
  locale: string;
  onAssign: (productName: string, sku: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const resolvedSku = skuLabelToCode.get(typed.trim());
  return (
    <tr>
      <td className="text-sm">{name}</td>
      <td className="flex items-center gap-2 py-2">
        <input
          type="text"
          list="all-sku-options"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="erp-input text-xs"
          placeholder={locale === "gr" ? "Πληκτρολόγησε SKU ή όνομα ομάδας..." : "Type SKU or group name..."}
        />
        <button
          onClick={() => {
            if (resolvedSku) {
              onAssign(name, resolvedSku);
              setTyped("");
            }
          }}
          disabled={!resolvedSku}
          className="erp-btn-primary text-xs px-3 py-1"
        >
          {locale === "gr" ? "Αντιστοίχιση" : "Assign"}
        </button>
      </td>
    </tr>
  );
}

function MoveToSkuInput({
  entry,
  skuLabelToCode,
  locale,
  busy,
  onMove,
}: {
  entry: ProductSkuMapEntry;
  skuLabelToCode: Map<string, string>;
  locale: string;
  busy: boolean;
  onMove: (entry: ProductSkuMapEntry, newSku: string) => void;
}) {
  const [typed, setTyped] = useState("");

  function commit() {
    const code = skuLabelToCode.get(typed.trim());
    if (code && code !== entry.sku) {
      onMove(entry, code);
    }
    setTyped("");
  }

  return (
    <input
      type="text"
      list="all-sku-options"
      value={typed}
      disabled={busy}
      onChange={(e) => setTyped(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder={locale === "gr" ? "Μετακίνηση σε άλλο SKU..." : "Move to another SKU..."}
      className="erp-input text-xs"
    />
  );
}
