"use client";
import { useState } from "react";
import { useApp } from "@/lib/context";
import { RoleGuard } from "@/components/RoleGuard";
import type { Department, Unit } from "@/lib/types";
import * as db from "@/lib/supabaseData";

// ── helpers ──────────────────────────────────────────────────
function Btn({
  children, onClick, variant = "primary", disabled, className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "danger" | "ghost" | "success";
  disabled?: boolean;
  className?: string;
}) {
  const base = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const v = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white",
    danger: "bg-red-600 hover:bg-red-700 text-white",
    success: "bg-emerald-600 hover:bg-emerald-700 text-white",
    ghost: "border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700",
  };
  return (
    <button className={`${base} ${v[variant]} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

const inp = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none";

// ── Department tab ────────────────────────────────────────────
function DepartmentsTab() {
  const { data, refreshAll } = useApp();
  const [allDepts, setAllDepts] = useState<Department[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);

  // Form state
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState({ name: "", nameEn: "", isActive: true });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Load all (including inactive) for admin view
  async function loadAll() {
    setLoadingAll(true);
    try {
      const d = await db.fetchAllDepartments();
      setAllDepts(d);
    } finally {
      setLoadingAll(false);
    }
  }

  // Show all departments (active from context + inactive if loaded)
  const displayed = allDepts ?? (data.departments ?? []);

  function openNew() {
    setEditing(null);
    setForm({ name: "", nameEn: "", isActive: true });
    setErr(null);
  }

  function openEdit(dept: Department) {
    setEditing(dept);
    setForm({ name: dept.name, nameEn: dept.nameEn ?? "", isActive: dept.isActive });
    setErr(null);
  }

  async function handleSave() {
    if (!form.name.trim()) { setErr("Το όνομα είναι υποχρεωτικό"); return; }
    setSaving(true);
    setErr(null);
    try {
      await db.upsertDepartment({
        id: editing?.id,
        name: form.name.trim(),
        nameEn: form.nameEn.trim() || null,
        isActive: form.isActive,
      });
      await refreshAll();
      const d = await db.fetchAllDepartments();
      setAllDepts(d);
      setEditing(null);
      setForm({ name: "", nameEn: "", isActive: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Σφάλμα αποθήκευσης");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setDeleting(true);
    try {
      await db.deleteDepartment(id);
      await refreshAll();
      const d = await db.fetchAllDepartments();
      setAllDepts(d);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Σφάλμα διαγραφής");
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Τμήματα</h2>
          <p className="text-sm text-gray-500 mt-0.5">Διαχείριση τμημάτων — εμφανίζονται στα δελτία εσωτερικής διακίνησης</p>
        </div>
        <div className="flex gap-2">
          {!allDepts && (
            <Btn variant="ghost" onClick={loadAll} disabled={loadingAll}>
              {loadingAll ? "..." : "👁 Εμφάνιση ανενεργών"}
            </Btn>
          )}
          <Btn onClick={openNew}>+ Νέο Τμήμα</Btn>
        </div>
      </div>

      {/* Inline form */}
      {(editing !== null || form.name !== "" || err) && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-5">
          <h3 className="text-sm font-bold text-blue-800 dark:text-blue-300 mb-3">
            {editing ? `Επεξεργασία: ${editing.name}` : "Νέο Τμήμα"}
          </h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Όνομα (ΕΛ) *">
              <input className={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="π.χ. Κουζίνα" />
            </Field>
            <Field label="Όνομα (EN)">
              <input className={inp} value={form.nameEn} onChange={e => setForm(f => ({ ...f, nameEn: e.target.value }))} placeholder="e.g. Kitchen" />
            </Field>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              Ενεργό
            </label>
          </div>
          {err && <p className="text-red-500 text-sm mb-2">{err}</p>}
          <div className="flex gap-2">
            <Btn onClick={handleSave} disabled={saving}>{saving ? "Αποθήκευση..." : "💾 Αποθήκευση"}</Btn>
            <Btn variant="ghost" onClick={() => { setEditing(null); setForm({ name: "", nameEn: "", isActive: true }); setErr(null); }}>Ακύρωση</Btn>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Διαγραφή Τμήματος</h3>
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-5">Η ενέργεια δεν αναιρείται. Τα δελτία που έχουν ήδη χρησιμοποιήσει αυτό το τμήμα δεν επηρεάζονται.</p>
            <div className="flex gap-3 justify-end">
              <Btn variant="ghost" onClick={() => setDeleteId(null)}>Ακύρωση</Btn>
              <Btn variant="danger" onClick={() => handleDelete(deleteId)} disabled={deleting}>{deleting ? "..." : "Διαγραφή"}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <th className="text-left px-4 py-3">Όνομα</th>
              <th className="text-left px-4 py-3">English</th>
              <th className="text-center px-4 py-3">Κατάσταση</th>
              <th className="px-4 py-3 w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {displayed.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-8 text-gray-400">Δεν υπάρχουν τμήματα</td></tr>
            ) : displayed.map(dept => (
              <tr key={dept.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 ${!dept.isActive ? "opacity-50" : ""}`}>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{dept.name}</td>
                <td className="px-4 py-3 text-gray-500">{dept.nameEn ?? "—"}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${dept.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"}`}>
                    {dept.isActive ? "Ενεργό" : "Ανενεργό"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 justify-end">
                    <Btn variant="ghost" onClick={() => openEdit(dept)}>✏️</Btn>
                    <Btn variant="danger" onClick={() => setDeleteId(dept.id)}>🗑</Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Units tab ─────────────────────────────────────────────────
function UnitsTab() {
  const { data, refreshAll } = useApp();
  const units: Unit[] = data.units ?? [];

  const [editing, setEditing] = useState<Unit | null>(null);
  const [form, setForm] = useState({ name: "", nameEn: "", abbreviation: "", baseUnit: "", conversionFactor: "1", description: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openNew() {
    setEditing(null);
    setForm({ name: "", nameEn: "", abbreviation: "", baseUnit: "", conversionFactor: "1", description: "" });
    setErr(null);
  }

  function openEdit(u: Unit) {
    setEditing(u);
    setForm({ name: u.name, nameEn: u.nameEn ?? "", abbreviation: u.abbreviation, baseUnit: u.baseUnit ?? "", conversionFactor: u.conversionFactor ?? "1", description: u.description ?? "" });
    setErr(null);
  }

  async function handleSave() {
    if (!form.name.trim()) { setErr("Το όνομα είναι υποχρεωτικό"); return; }
    if (!form.abbreviation.trim()) { setErr("Η συντομογραφία είναι υποχρεωτική"); return; }
    setSaving(true);
    setErr(null);
    try {
      await db.upsertUnit({
        id: editing?.id,
        name: form.name.trim(),
        nameEn: form.nameEn.trim() || null,
        abbreviation: form.abbreviation.trim(),
        baseUnit: form.baseUnit.trim() || null,
        conversionFactor: form.conversionFactor || "1",
        description: form.description.trim() || null,
      });
      await refreshAll();
      setEditing(null);
      setForm({ name: "", nameEn: "", abbreviation: "", baseUnit: "", conversionFactor: "1", description: "" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Σφάλμα αποθήκευσης");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setDeleting(true);
    try {
      await db.deleteUnit(id);
      await refreshAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Σφάλμα διαγραφής");
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Μονάδες Μέτρησης</h2>
          <p className="text-sm text-gray-500 mt-0.5">Μονάδες που χρησιμοποιούνται σε υλικά, συνταγές και παραγγελίες</p>
        </div>
        <Btn onClick={openNew}>+ Νέα Μονάδα</Btn>
      </div>

      {/* Inline form */}
      {(editing !== null || form.name !== "" || err) && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-5">
          <h3 className="text-sm font-bold text-blue-800 dark:text-blue-300 mb-3">
            {editing ? `Επεξεργασία: ${editing.name}` : "Νέα Μονάδα"}
          </h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Όνομα (ΕΛ) *">
              <input className={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="π.χ. Κιλό" />
            </Field>
            <Field label="Όνομα (EN)">
              <input className={inp} value={form.nameEn} onChange={e => setForm(f => ({ ...f, nameEn: e.target.value }))} placeholder="e.g. Kilogram" />
            </Field>
            <Field label="Συντομογραφία *">
              <input className={inp} value={form.abbreviation} onChange={e => setForm(f => ({ ...f, abbreviation: e.target.value }))} placeholder="π.χ. kg" />
            </Field>
            <Field label="Βασική Μονάδα">
              <input className={inp} value={form.baseUnit} onChange={e => setForm(f => ({ ...f, baseUnit: e.target.value }))} placeholder="π.χ. g (αν αυτή μετατρέπεται)" />
            </Field>
            <Field label="Συντελεστής Μετατροπής">
              <input className={inp} type="number" step="0.001" value={form.conversionFactor} onChange={e => setForm(f => ({ ...f, conversionFactor: e.target.value }))} placeholder="1" />
            </Field>
            <Field label="Περιγραφή">
              <input className={inp} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Προαιρετική σημείωση" />
            </Field>
          </div>
          {err && <p className="text-red-500 text-sm mb-2">{err}</p>}
          <div className="flex gap-2">
            <Btn onClick={handleSave} disabled={saving}>{saving ? "Αποθήκευση..." : "💾 Αποθήκευση"}</Btn>
            <Btn variant="ghost" onClick={() => { setEditing(null); setForm({ name: "", nameEn: "", abbreviation: "", baseUnit: "", conversionFactor: "1", description: "" }); setErr(null); }}>Ακύρωση</Btn>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Διαγραφή Μονάδας</h3>
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-5">Προσοχή: αν η μονάδα χρησιμοποιείται σε υλικά ή συνταγές, ενδέχεται να εμφανιστεί σφάλμα.</p>
            <div className="flex gap-3 justify-end">
              <Btn variant="ghost" onClick={() => setDeleteId(null)}>Ακύρωση</Btn>
              <Btn variant="danger" onClick={() => handleDelete(deleteId)} disabled={deleting}>{deleting ? "..." : "Διαγραφή"}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <th className="text-left px-4 py-3">Όνομα</th>
              <th className="text-left px-4 py-3">English</th>
              <th className="text-left px-4 py-3">Συντομ.</th>
              <th className="text-left px-4 py-3">Βάση → Συντελεστής</th>
              <th className="text-left px-4 py-3">Περιγραφή</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {units.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400">Δεν υπάρχουν μονάδες</td></tr>
            ) : units.map(u => (
              <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{u.name}</td>
                <td className="px-4 py-3 text-gray-500">{u.nameEn ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded text-xs font-mono font-semibold">{u.abbreviation}</span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {u.baseUnit ? `${u.abbreviation} → ${u.baseUnit} × ${u.conversionFactor}` : "—"}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{u.description ?? "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 justify-end">
                    <Btn variant="ghost" onClick={() => openEdit(u)}>✏️</Btn>
                    <Btn variant="danger" onClick={() => setDeleteId(u.id)}>🗑</Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Meal Types reference tab ──────────────────────────────────
function ReferenceTab() {
  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-5">Σταθερές Αναφοράς</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Board Types */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wide">Τύποι Διατροφής (Board Types)</h3>
          <div className="space-y-2">
            {[
              { code: "BB", label: "Bed & Breakfast", desc: "Πρωινό" },
              { code: "HB", label: "Half Board", desc: "Πρωινό + Δείπνο" },
              { code: "FB", label: "Full Board", desc: "Πρωινό + Μεσημεριανό + Δείπνο" },
              { code: "AI", label: "All Inclusive", desc: "Όλα Περιλαμβάνονται" },
            ].map(b => (
              <div key={b.code} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-mono font-bold text-xs px-2 py-1 rounded">{b.code}</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{b.label}</span>
                </div>
                <span className="text-xs text-gray-500">{b.desc}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">Σταθερές τιμές — δεν επεξεργάζονται</p>
        </div>

        {/* Meal Types */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wide">Γεύματα (Meal Types)</h3>
          <div className="space-y-2">
            {[
              { code: "breakfast", label: "Πρωινό", en: "Breakfast" },
              { code: "lunch", label: "Μεσημεριανό", en: "Lunch" },
              { code: "dinner", label: "Δείπνο", en: "Dinner" },
            ].map(m => (
              <div key={m.code} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-mono text-xs px-2 py-1 rounded">{m.code}</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{m.label}</span>
                </div>
                <span className="text-xs text-gray-500">{m.en}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">Σταθερές τιμές — δεν επεξεργάζονται</p>
        </div>

        {/* Roles */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wide">Ρόλοι Χρηστών</h3>
          <div className="space-y-2">
            {[
              { code: "admin", label: "Διαχειριστής", desc: "Πλήρης πρόσβαση" },
              { code: "chef", label: "Σεφ / Κουζίνα", desc: "Συνταγές, Μενού, Μπουφέ" },
              { code: "storekeeper", label: "Αποθηκάριος", desc: "Παραγγελίες, Αποθέματα, Διακίνηση" },
            ].map(r => (
              <div key={r.code} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-mono text-xs px-2 py-1 rounded">{r.code}</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{r.label}</span>
                </div>
                <span className="text-xs text-gray-500">{r.desc}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">Αλλαγή ρόλου → Διαχείριση Χρηστών</p>
        </div>

        {/* Transfer statuses */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wide">Καταστάσεις Διακίνησης</h3>
          <div className="space-y-2">
            {[
              { code: "pending", label: "Εκκρεμεί", desc: "Δελτίο δημιουργήθηκε" },
              { code: "completed", label: "Ολοκληρώθηκε", desc: "Παραδόθηκε" },
              { code: "cancelled", label: "Ακυρώθηκε", desc: "Δεν εκτελέστηκε" },
            ].map(s => (
              <div key={s.code} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-mono text-xs px-2 py-1 rounded">{s.code}</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{s.label}</span>
                </div>
                <span className="text-xs text-gray-500">{s.desc}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">Σταθερές τιμές — δεν επεξεργάζονται</p>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
const TABS = [
  { id: "departments", label: "🏢 Τμήματα" },
  { id: "units", label: "⚖️ Μονάδες" },
  { id: "reference", label: "📖 Αναφορά" },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState("departments");

  return (
    <RoleGuard adminOnly>
      <div className="p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">⚙️ Admin Panel</h1>
          <p className="text-sm text-gray-500 mt-1">Αυτόνομη διαχείριση παραμέτρων — προσθέστε ή επεξεργαστείτε δεδομένα χωρίς να χρειαστείτε βοήθεια</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-6 w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "departments" && <DepartmentsTab />}
        {activeTab === "units" && <UnitsTab />}
        {activeTab === "reference" && <ReferenceTab />}
      </div>
    </RoleGuard>
  );
}
