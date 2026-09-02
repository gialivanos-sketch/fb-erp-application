"use client";
import { useState, useEffect } from "react";
import { useApp } from "@/lib/context";
import { PageHeader } from "@/components/shared";
import { RoleGuard } from "@/components/RoleGuard";
import * as db from "@/lib/supabaseData";
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
    </RoleGuard>
  );
}
