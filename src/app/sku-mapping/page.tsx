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

  // Bulk select-and-merge: pick several rows (unmapped products and/or
  // already-mapped entries, even from different SKU groups) that are really
  // the same item, then merge them all into one SKU in a single action —
  // instead of moving/assigning them one at a time.
  const [selectedUnmapped, setSelectedUnmapped] = useState<Set<string>>(new Set());
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<number>>(new Set());
  const [bulkTargetTyped, setBulkTargetTyped] = useState("");
  const [bulkNewSku, setBulkNewSku] = useState("");
  const [bulkNewGroup, setBulkNewGroup] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const selectedCount = selectedUnmapped.size + selectedEntryIds.size;

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

  function toggleUnmapped(name: string) {
    setSelectedUnmapped((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAllUnmapped() {
    setSelectedUnmapped((prev) => {
      const allSelected = filteredUnmapped.length > 0 && filteredUnmapped.every((n) => prev.has(n));
      if (allSelected) return new Set();
      return new Set(filteredUnmapped);
    });
  }

  function toggleEntry(id: number) {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroupAll(g: SkuGroup) {
    setSelectedEntryIds((prev) => {
      const ids = g.entries.map((e) => e.id);
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedUnmapped(new Set());
    setSelectedEntryIds(new Set());
  }

  async function handleBulkMerge(targetSku: string, targetGroup: string) {
    if (!targetSku.trim() || !targetGroup.trim()) return;
    if (selectedCount === 0) return;
    setBulkBusy(true);
    try {
      for (const id of selectedEntryIds) {
        const entry = entries.find((e) => e.id === id);
        if (entry && (entry.sku !== targetSku || entry.finalGroup !== targetGroup)) {
          await db.updateProductSkuMapEntry(entry.id, { sku: targetSku, finalGroup: targetGroup });
        }
      }
      for (const name of selectedUnmapped) {
        await db.createProductSkuMapEntry({ productName: name, sku: targetSku, finalGroup: targetGroup });
      }
      await loadData();
      clearSelection();
      setBulkTargetTyped("");
      setBulkNewSku("");
      setBulkNewGroup("");
      flash(
        locale === "gr"
          ? `✅ Συγχωνεύθηκαν ${selectedCount} στοιχεία στο ${targetSku}`
          : `✅ Merged ${selectedCount} items into ${targetSku}`
      );
    } catch (err) {
      flash((locale === "gr" ? "⚠️ Αποτυχία: " : "⚠️ Failed: ") + String(err));
    } finally {
      setBulkBusy(false);
    }
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
                  <th className="w-8">
                    <input
                      type="checkbox"
                      checked={filteredUnmapped.length > 0 && filteredUnmapped.every((n) => selectedUnmapped.has(n))}
                      onChange={toggleAllUnmapped}
                      title={locale === "gr" ? "Επιλογή όλων" : "Select all"}
                    />
                  </th>
                  <th>{locale === "gr" ? "Προϊόν" : "Product"}</th>
                  <th>{locale === "gr" ? "Αντιστοίχιση σε υπάρχον SKU" : "Assign to existing SKU"}</th>
                </tr>
              </thead>
              <tbody>
                {filteredUnmapped.map((name) => (
                  <UnmappedRow
                    key={name}
                    name={name}
                    skuLabelToCode={skuLabelToCode}
                    locale={locale}
                    onAssign={handleAssignToExisting}
                    checked={selectedUnmapped.has(name)}
                    onToggle={() => toggleUnmapped(name)}
                  />
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
                  <input
                    type="checkbox"
                    checked={g.entries.length > 0 && g.entries.every((e) => selectedEntryIds.has(e.id))}
                    onChange={() => toggleGroupAll(g)}
                    title={locale === "gr" ? "Επιλογή όλων σε αυτή την ομάδα" : "Select all in this group"}
                  />
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
                          <td className="w-8">
                            <input type="checkbox" checked={selectedEntryIds.has(e.id)} onChange={() => toggleEntry(e.id)} />
                          </td>
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

      {/* Floating bulk-merge bar: appears once anything is checked above */}
      {selectedCount > 0 && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-[560px] max-w-[95vw] max-h-[85vh] overflow-y-auto z-50 bg-white border-2 border-blue-300 shadow-2xl rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="font-bold text-lg">
              {locale === "gr" ? `✅ Επιλεγμένα: ${selectedCount}` : `✅ Selected: ${selectedCount}`}
            </div>
            <button onClick={clearSelection} className="text-slate-400 hover:text-slate-600 text-base font-medium">
              ✕ {locale === "gr" ? "Καθαρισμός" : "Clear"}
            </button>
          </div>

          <div className="mb-5">
            <label className="erp-label text-base mb-1 block">
              {locale === "gr" ? "Συγχώνευση σε υπάρχον SKU" : "Merge into existing SKU"}
            </label>
            <input
              type="text"
              list="all-sku-options"
              value={bulkTargetTyped}
              onChange={(e) => setBulkTargetTyped(e.target.value)}
              className="erp-input text-base w-full py-2.5 mb-2"
              placeholder={locale === "gr" ? "Πληκτρολόγησε SKU ή ομάδα..." : "Type SKU or group..."}
            />
            <button
              onClick={() => {
                const code = skuLabelToCode.get(bulkTargetTyped.trim());
                const g = groups.find((x) => x.sku === code);
                if (code && g) handleBulkMerge(code, g.finalGroup);
              }}
              disabled={bulkBusy || !skuLabelToCode.get(bulkTargetTyped.trim())}
              className="erp-btn-primary text-base w-full py-2.5"
            >
              {bulkBusy ? "…" : locale === "gr" ? "Συγχώνευση" : "Merge"}
            </button>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <div className="erp-label text-base mb-2 block font-bold text-slate-700">
              {locale === "gr" ? "Ή δημιουργία νέου SKU από τα επιλεγμένα" : "Or create a new SKU from selection"}
            </div>

            <label className="text-sm font-semibold text-slate-600 mb-1 block">
              {locale === "gr" ? "1. Κωδικός SKU" : "1. SKU code"}
            </label>
            <input
              type="text"
              value={bulkNewSku}
              onChange={(e) => setBulkNewSku(e.target.value)}
              className="erp-input text-base w-full py-2.5 mb-3"
              placeholder="SKU-0999"
            />

            <label className="text-sm font-semibold text-slate-600 mb-1 block">
              {locale === "gr" ? "2. Όνομα Ομάδας" : "2. Group name"}
            </label>
            <input
              type="text"
              value={bulkNewGroup}
              onChange={(e) => setBulkNewGroup(e.target.value)}
              className="erp-input text-base w-full py-2.5 mb-3"
              placeholder={locale === "gr" ? "π.χ. Πιπεριά Κίτρινη" : "e.g. Yellow Pepper"}
            />

            <button
              onClick={() => handleBulkMerge(bulkNewSku.trim(), bulkNewGroup.trim())}
              disabled={bulkBusy || !bulkNewSku.trim() || !bulkNewGroup.trim()}
              className="erp-btn-success text-base w-full py-3 font-semibold"
            >
              {bulkBusy ? "…" : "➕ "}
              {locale === "gr" ? "3. Δημιουργία & Συγχώνευση" : "3. Create & Merge"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UnmappedRow({
  name,
  skuLabelToCode,
  locale,
  onAssign,
  checked,
  onToggle,
}: {
  name: string;
  skuLabelToCode: Map<string, string>;
  locale: string;
  onAssign: (productName: string, sku: string) => void;
  checked: boolean;
  onToggle: () => void;
}) {
  const [typed, setTyped] = useState("");
  const resolvedSku = skuLabelToCode.get(typed.trim());
  return (
    <tr>
      <td className="w-8">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </td>
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
