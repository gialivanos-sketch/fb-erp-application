"use client";
import { useState, useEffect } from "react";
import { useApp } from "@/lib/context";
import { PageHeader } from "@/components/shared";
import { RoleGuard } from "@/components/RoleGuard";
import * as db from "@/lib/supabaseData";
import { setCachedBusinessName } from "@/lib/useBusinessName";
import type { BusinessProfile } from "@/lib/types";

// Uploaded logos are stored as a base64 data URL directly in the
// business_profile.logo_data_url column (simplest option — no Supabase
// Storage bucket/policies to set up). This caps the ORIGINAL file size
// before encoding; base64 adds ~33% on top, so 900KB in keeps the
// stored text comfortably small.
const MAX_LOGO_BYTES = 900 * 1024;

const EMPTY_PROFILE: BusinessProfile = {
  name: "",
  address: "",
  phone: "",
  email: "",
  taxId: "",
  logoDataUrl: null,
};

export default function BusinessProfilePage() {
  const { locale } = useApp();

  const [profile, setProfile] = useState<BusinessProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [logoError, setLogoError] = useState("");

  // ── Επιχειρήσεις (μία ενεργή κάθε φορά) ──
  const [businesses, setBusinesses] = useState<db.BusinessRow[] | null | undefined>(undefined);
  const [showSwitch, setShowSwitch] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [newBiz, setNewBiz] = useState({ name: "", address: "", phone: "", email: "", taxId: "" });
  const [copySku, setCopySku] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [switchErr, setSwitchErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    db.fetchBusinessProfile()
      .then((p) => {
        if (!cancelled && p) setProfile(p);
      })
      .catch((err) => {
        if (!cancelled) {
          setSavedMsg({
            kind: "err",
            text: (locale === "gr" ? "Αποτυχία φόρτωσης: " : "Failed to load: ") + String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    db.fetchBusinesses().then(setBusinesses).catch(() => setBusinesses(null));
  }, []);

  const activeBiz = businesses?.find(b => b.isActive) ?? null;
  const gr = locale === "gr";

  async function deactivateAndCreate() {
    if (!activeBiz) return;
    setSwitchErr("");
    if (confirmName.trim().toUpperCase() !== activeBiz.name.trim().toUpperCase()) {
      setSwitchErr(gr ? "Γράψε ακριβώς το όνομα της τρέχουσας επιχείρησης για επιβεβαίωση." : "Type the current business name exactly to confirm.");
      return;
    }
    if (!newBiz.name.trim()) {
      setSwitchErr(gr ? "Συμπλήρωσε την επωνυμία της νέας επιχείρησης." : "Enter the new business name.");
      return;
    }
    setSwitching(true);
    try {
      const id = await db.createBusiness({ ...newBiz, name: newBiz.name.trim() });
      await db.activateBusiness(id, copySku ? activeBiz.id : null);
      window.location.reload();
    } catch (err) {
      setSwitchErr((gr ? "Αποτυχία: " : "Failed: ") + String((err as { message?: string })?.message ?? err));
      setSwitching(false);
    }
  }

  async function reactivate(b: db.BusinessRow) {
    if (!confirm(gr
      ? `Ενεργοποίηση «${b.name}»;\n\nΗ «${activeBiz?.name ?? ""}» θα απενεργοποιηθεί (τα δεδομένα της μένουν). Η αλλαγή ισχύει για όλους τους χρήστες.`
      : `Activate "${b.name}"? The current business will be deactivated (its data is kept). Applies to all users.`)) return;
    setSwitching(true);
    try {
      await db.activateBusiness(b.id, null);
      window.location.reload();
    } catch (err) {
      alert((gr ? "Αποτυχία: " : "Failed: ") + String((err as { message?: string })?.message ?? err));
      setSwitching(false);
    }
  }

  function updateField(field: keyof BusinessProfile, value: string) {
    setProfile((prev) => ({ ...prev, [field]: value }));
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLogoError("");
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLogoError(locale === "gr" ? "Το αρχείο πρέπει να είναι εικόνα (PNG, JPG κ.λπ.)." : "The file must be an image (PNG, JPG, etc.).");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(
        locale === "gr"
          ? `Η εικόνα είναι πολύ μεγάλη (μέγιστο ${Math.round(MAX_LOGO_BYTES / 1024)}KB). Δοκιμάστε μια μικρότερη/συμπιεσμένη εικόνα.`
          : `The image is too large (max ${Math.round(MAX_LOGO_BYTES / 1024)}KB). Try a smaller/compressed image.`
      );
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProfile((prev) => ({ ...prev, logoDataUrl: String(reader.result) }));
    };
    reader.onerror = () => {
      setLogoError(locale === "gr" ? "Αποτυχία ανάγνωσης εικόνας." : "Failed to read the image.");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function removeLogo() {
    setProfile((prev) => ({ ...prev, logoDataUrl: null }));
    setLogoError("");
  }

  async function handleSave() {
    setSaving(true);
    setSavedMsg(null);
    try {
      await db.saveBusinessProfile(profile);
      setCachedBusinessName(profile.name);
      setSavedMsg({ kind: "ok", text: locale === "gr" ? "✅ Τα στοιχεία αποθηκεύτηκαν!" : "✅ Saved!" });
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (err) {
      setSavedMsg({
        kind: "err",
        text: (locale === "gr" ? "⚠️ Αποτυχία αποθήκευσης: " : "⚠️ Failed to save: ") + String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <RoleGuard adminOnly>
      <PageHeader
        title={locale === "gr" ? "Καρτέλα Επιχείρησης" : "Business Profile"}
        subtitle={
          locale === "gr"
            ? "Τα στοιχεία σας εδώ εμφανίζονται στο εκτυπώσιμο Δελτίο Παραγγελίας και στο email παραγγελίας προς τους προμηθευτές."
            : "This information appears on the printable Purchase Order and in the order email sent to suppliers."
        }
      />

      {savedMsg && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm font-medium border ${
            savedMsg.kind === "ok"
              ? "bg-emerald-50 border-emerald-300 text-emerald-800"
              : "bg-red-50 border-red-300 text-red-800"
          }`}
        >
          {savedMsg.text}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">
          {locale === "gr" ? "Φόρτωση…" : "Loading…"}
        </div>
      ) : (
        <div className="erp-card max-w-2xl">
          <div className="erp-card-header">
            {locale === "gr" ? "Στοιχεία Επιχείρησης" : "Company Details"}
          </div>
          <div className="erp-card-body space-y-4 p-4">
            <div>
              <label className="erp-label">{locale === "gr" ? "Επωνυμία" : "Business Name"}</label>
              <input
                type="text"
                className="erp-input"
                value={profile.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder={locale === "gr" ? "π.χ. Εστιατόριο Ο Γιάννης" : "e.g. The Restaurant Co."}
              />
            </div>

            <div>
              <label className="erp-label">{locale === "gr" ? "Διεύθυνση" : "Address"}</label>
              <textarea
                className="erp-input"
                rows={2}
                value={profile.address}
                onChange={(e) => updateField("address", e.target.value)}
                placeholder={locale === "gr" ? "Οδός, αριθμός, πόλη, Τ.Κ." : "Street, number, city, postal code"}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="erp-label">{locale === "gr" ? "Τηλέφωνο" : "Phone"}</label>
                <input
                  type="text"
                  className="erp-input"
                  value={profile.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  placeholder="210 1234567"
                />
              </div>
              <div>
                <label className="erp-label">Email</label>
                <input
                  type="email"
                  className="erp-input"
                  value={profile.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  placeholder="info@example.gr"
                />
              </div>
            </div>

            <div>
              <label className="erp-label">{locale === "gr" ? "ΑΦΜ" : "Tax ID"}</label>
              <input
                type="text"
                className="erp-input max-w-xs"
                value={profile.taxId}
                onChange={(e) => updateField("taxId", e.target.value)}
                placeholder="123456789"
              />
            </div>

            <div>
              <label className="erp-label">{locale === "gr" ? "Λογότυπο" : "Logo"}</label>
              <div className="flex items-center gap-4">
                {profile.logoDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.logoDataUrl}
                    alt={locale === "gr" ? "Λογότυπο" : "Logo"}
                    className="h-16 w-auto max-w-[140px] object-contain border border-slate-200 rounded-lg p-1 bg-white"
                  />
                ) : (
                  <div className="h-16 w-28 flex items-center justify-center border border-dashed border-slate-300 rounded-lg text-slate-300 text-xs">
                    {locale === "gr" ? "Χωρίς λογότυπο" : "No logo"}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <label className="erp-btn-secondary text-xs px-3 py-1.5 cursor-pointer inline-block w-fit">
                    {locale === "gr" ? "📤 Ανέβασμα εικόνας" : "📤 Upload image"}
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                  </label>
                  {profile.logoDataUrl && (
                    <button onClick={removeLogo} className="erp-btn-ghost text-xs px-3 py-1.5 w-fit">
                      ✕ {locale === "gr" ? "Αφαίρεση" : "Remove"}
                    </button>
                  )}
                </div>
              </div>
              {logoError && <div className="text-xs text-red-600 mt-2">{logoError}</div>}
              <div className="text-xs text-slate-400 mt-2">
                {locale === "gr"
                  ? `Συνιστώμενο: εικόνα PNG με διαφανές φόντο, έως ${Math.round(MAX_LOGO_BYTES / 1024)}KB.`
                  : `Recommended: a PNG with a transparent background, up to ${Math.round(MAX_LOGO_BYTES / 1024)}KB.`}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button onClick={handleSave} disabled={saving} className="erp-btn-primary">
                {saving ? "…" : "💾"} {locale === "gr" ? "Αποθήκευση" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Επιχειρήσεις ── */}
      {businesses === null && (
        <div className="erp-card max-w-2xl mt-6 p-4 text-sm text-amber-800 bg-amber-50 border-amber-300">
          {gr
            ? "Η διαχείριση πολλών επιχειρήσεων δεν έχει ενεργοποιηθεί ακόμα στη βάση (χρειάζεται μία φορά το SQL «migration_multi_business.sql»)."
            : "Multi-business is not enabled in the database yet (run migration_multi_business.sql once)."}
        </div>
      )}
      {businesses && businesses.length > 0 && (
        <div className="erp-card max-w-2xl mt-6">
          <div className="erp-card-header">🏢 {gr ? "Επιχειρήσεις" : "Businesses"}</div>
          <div className="p-4 space-y-3 text-sm">
            <p className="text-slate-500">
              {gr
                ? "Μία επιχείρηση είναι ενεργή κάθε φορά. Προμηθευτές, προσφορές, παραγγελίες, χρεώσεις/πληρωμές, ομαδοποίηση SKU και απογραφές ανήκουν στην επιχείρηση. Συνταγές, μενού και υλικά είναι κοινά. Τίποτα δεν σβήνεται — μια απενεργοποιημένη επιχείρηση μπορεί να ξαναενεργοποιηθεί για να δεις τα δεδομένα της."
                : "One business is active at a time. Suppliers, quotes, orders, payments, SKU groups and stock counts belong to the business; recipes, menus and ingredients are shared. Nothing is deleted."}
            </p>
            <table className="erp-table">
              <thead><tr><th>{gr ? "Επωνυμία" : "Name"}</th><th>{gr ? "Κατάσταση" : "Status"}</th><th></th></tr></thead>
              <tbody>
                {businesses.map(b => (
                  <tr key={b.id}>
                    <td className="font-medium">{b.name}</td>
                    <td>
                      {b.isActive
                        ? <span className="text-emerald-700 font-semibold">● {gr ? "Ενεργή" : "Active"}</span>
                        : <span className="text-slate-400">○ {gr ? "Ανενεργή" : "Inactive"}{b.deactivatedAt ? ` ${gr ? "από" : "since"} ${new Date(b.deactivatedAt).toLocaleDateString("el-GR")}` : ""}</span>}
                    </td>
                    <td className="text-right">
                      {!b.isActive && (
                        <button onClick={() => reactivate(b)} disabled={switching} className="erp-btn-secondary text-xs px-2 py-1">
                          ↺ {gr ? "Ενεργοποίηση" : "Activate"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!showSwitch ? (
              <button onClick={() => { setShowSwitch(true); setSwitchErr(""); }} className="erp-btn-danger">
                ⏻ {gr ? "Απενεργοποίηση επιχείρησης & έναρξη νέας" : "Deactivate business & start a new one"}
              </button>
            ) : (
              <div className="border border-red-200 bg-red-50/50 rounded-lg p-4 space-y-3">
                <div className="font-semibold text-red-700">
                  ⏻ {gr ? `Απενεργοποίηση «${activeBiz?.name ?? ""}»` : `Deactivate "${activeBiz?.name ?? ""}"`}
                </div>
                <p className="text-slate-600">
                  {gr
                    ? "Η εφαρμογή θα ξεκινήσει με άδειους προμηθευτές, προσφορές, παραγγελίες και πληρωμές για τη νέα επιχείρηση. Συνταγές και μενού μένουν. Τα δεδομένα της τρέχουσας επιχείρησης ΔΕΝ σβήνονται."
                    : "The app will start with empty suppliers, quotes, orders and payments for the new business. Recipes and menus stay. Current data is NOT deleted."}
                </p>
                <div>
                  <label className="erp-label">{gr ? `Για επιβεβαίωση γράψε: ${activeBiz?.name ?? ""}` : `To confirm type: ${activeBiz?.name ?? ""}`}</label>
                  <input className="erp-input" value={confirmName} onChange={e => setConfirmName(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="erp-label">{gr ? "Επωνυμία νέας επιχείρησης" : "New business name"}</label>
                    <input className="erp-input" value={newBiz.name} onChange={e => setNewBiz({ ...newBiz, name: e.target.value })} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="erp-label">{gr ? "Διεύθυνση" : "Address"}</label>
                    <input className="erp-input" value={newBiz.address} onChange={e => setNewBiz({ ...newBiz, address: e.target.value })} />
                  </div>
                  <div><label className="erp-label">{gr ? "Τηλέφωνο" : "Phone"}</label><input className="erp-input" value={newBiz.phone} onChange={e => setNewBiz({ ...newBiz, phone: e.target.value })} /></div>
                  <div><label className="erp-label">Email</label><input className="erp-input" value={newBiz.email} onChange={e => setNewBiz({ ...newBiz, email: e.target.value })} /></div>
                  <div><label className="erp-label">{gr ? "ΑΦΜ" : "Tax ID"}</label><input className="erp-input" value={newBiz.taxId} onChange={e => setNewBiz({ ...newBiz, taxId: e.target.value })} /></div>
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={copySku} onChange={e => setCopySku(e.target.checked)} />
                  {gr ? "Αντιγραφή της Ομαδοποίησης Ειδών (SKU) στη νέα επιχείρηση" : "Copy SKU grouping to the new business"}
                </label>
                {switchErr && <div className="text-red-700">{switchErr}</div>}
                <div className="flex gap-2">
                  <button onClick={deactivateAndCreate} disabled={switching} className="erp-btn-danger">
                    {switching ? "…" : "⏻"} {gr ? "Απενεργοποίηση & έναρξη νέας" : "Deactivate & start new"}
                  </button>
                  <button onClick={() => setShowSwitch(false)} disabled={switching} className="erp-btn-ghost">{gr ? "Ακύρωση" : "Cancel"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </RoleGuard>
  );
}
