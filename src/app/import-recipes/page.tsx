"use client";

import { useState, useRef } from "react";

// ----------------------------------------------------------------
// /import-recipes — Import recipes from xlsm-extracted JSON.
//
// Workflow:
//  1. User uploads the extracted recipes JSON (or uses the embedded data).
//  2. Page shows preview: total recipes, sample list.
//  3. User clicks "Έναρξη Εισαγωγής" → batched POST to /api/import-recipes.
//  4. Progress bar + live stats.
//  5. Summary: created / skipped / unmatched ingredients list.
// ----------------------------------------------------------------

type XlsmRecipeIngredient = { name: string; qty: number | string; unit: string };
type XlsmRecipe = {
  name: string;
  portions: number | string;
  instructions: string | null;
  allergens: string[];
  ingredients: XlsmRecipeIngredient[];
};

type BatchResult = {
  created: number;
  skipped: number;
  errors: string[];
  unmatchedIngredients: string[];
  unmatchedCount: number;
  batchStart: number;
  batchEnd: number;
  total: number;
  isDone: boolean;
};

const BATCH_SIZE = 15;

export default function ImportRecipesPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [recipes, setRecipes] = useState<XlsmRecipe[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalCreated, setTotalCreated] = useState(0);
  const [totalSkipped, setTotalSkipped] = useState(0);
  const [allErrors, setAllErrors] = useState<string[]>([]);
  const [allUnmatched, setAllUnmatched] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(false);
  const [skipExisting, setSkipExisting] = useState(true);
  const [statusMsg, setStatusMsg] = useState("");

  // ---- File loading ----
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadError(null);
    setRecipes(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(data)) throw new Error("Αναμένεται JSON array");
        setRecipes(data as XlsmRecipe[]);
      } catch (err) {
        setLoadError(`Σφάλμα ανάγνωσης: ${String(err)}`);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  // ---- Import ----
  async function startImport() {
    if (!recipes) return;
    setRunning(true);
    setDone(false);
    setProgress(0);
    setTotalCreated(0);
    setTotalSkipped(0);
    setAllErrors([]);
    setAllUnmatched(new Set());

    let batchStart = 0;
    let accCreated = 0;
    let accSkipped = 0;
    const accErrors: string[] = [];
    const accUnmatched = new Set<string>();

    while (batchStart < recipes.length) {
      setStatusMsg(`Εισαγωγή ${batchStart + 1}–${Math.min(batchStart + BATCH_SIZE, recipes.length)} από ${recipes.length}…`);

      // Timeout after 25s to avoid hanging on a stuck batch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      let res: Response;
      try {
        res = await fetch("/api/import-recipes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipes, batchStart, batchSize: BATCH_SIZE, skipExisting }),
          signal: controller.signal,
        });
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        // Timeout or network error — skip this batch and continue
        accErrors.push(`Batch ${batchStart}: timeout ή σφάλμα δικτύου — παράλειψη`);
        batchStart += BATCH_SIZE;
        setProgress(Math.round((batchStart / recipes.length) * 100));
        setAllErrors([...accErrors]);
        continue;
      }
      clearTimeout(timeoutId);

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        accErrors.push(`Batch ${batchStart}: ${j.error || res.statusText}`);
        batchStart += BATCH_SIZE;
        continue;
      }

      const result: BatchResult = await res.json();
      accCreated += result.created;
      accSkipped += result.skipped;
      accErrors.push(...result.errors);
      result.unmatchedIngredients.forEach((u) => accUnmatched.add(u));

      setProgress(Math.round((result.batchEnd / result.total) * 100));
      setTotalCreated(accCreated);
      setTotalSkipped(accSkipped);
      setAllErrors([...accErrors]);
      setAllUnmatched(new Set(accUnmatched));

      if (result.isDone) break;
      batchStart = result.batchEnd;
    }

    setStatusMsg("");
    setRunning(false);
    setDone(true);
  }

  const withIngredients = recipes ? recipes.filter((r) => r.ingredients.length > 0).length : 0;
  const withInstructions = recipes ? recipes.filter((r) => r.instructions).length : 0;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-white rounded-xl shadow p-6">
          <h1 className="text-2xl font-bold text-gray-800 mb-1">📥 Εισαγωγή Συνταγών</h1>
          <p className="text-sm text-gray-500">
            Ανέβασε το αρχείο <code className="bg-gray-100 px-1 rounded">recipes_data.json</code>{" "}
            που εξήχθη από το xlsm αρχείο, και εισήγαγε τις συνταγές στην εφαρμογή.
          </p>
        </div>

        {/* Step 1: Upload */}
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="font-semibold text-gray-700 text-lg">Βήμα 1 — Φόρτωση αρχείου JSON</h2>

          <div
            className="border-2 border-dashed border-blue-200 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition"
            onClick={() => fileRef.current?.click()}
          >
            <div className="text-4xl mb-2">📂</div>
            <p className="text-gray-500 text-sm">Κλικ για επιλογή αρχείου <strong>recipes_data.json</strong></p>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
          </div>

          {loadError && (
            <div className="bg-red-50 text-red-700 rounded-lg p-3 text-sm">{loadError}</div>
          )}

          {recipes && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
              <div className="font-semibold text-green-800">✅ Αρχείο φορτώθηκε</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Συνολικές συνταγές" value={recipes.length} />
                <Stat label="Με υλικά" value={withIngredients} />
                <Stat label="Με τεχνικό οδηγό" value={withInstructions} />
                <Stat label="Χωρίς υλικά" value={recipes.length - withIngredients} color="yellow" />
              </div>

              {/* Sample */}
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-800">
                  Δείγμα πρώτων 10 συνταγών…
                </summary>
                <div className="mt-2 space-y-1 text-xs">
                  {recipes.slice(0, 10).map((r, i) => (
                    <div key={i} className="flex gap-2 text-gray-700">
                      <span className="w-6 text-gray-400 shrink-0">{i + 1}.</span>
                      <span className="font-medium">{r.name}</span>
                      <span className="text-gray-400">· {r.ingredients.length} υλικά</span>
                      {r.allergens.length > 0 && (
                        <span className="text-orange-500">· {r.allergens.join(", ")}</span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>

        {/* Step 2: Configure & Run */}
        {recipes && !done && (
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h2 className="font-semibold text-gray-700 text-lg">Βήμα 2 — Ρυθμίσεις εισαγωγής</h2>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={skipExisting}
                onChange={(e) => setSkipExisting(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-gray-700">
                Παράλειψη συνταγών που υπάρχουν ήδη (βάσει ονόματος)
              </span>
            </label>

            <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
              <strong>Σημείωση για τιμές:</strong> Οι τιμές θα τεθούν σε 0.
              Η εφαρμογή θα τις υπολογίσει αυτόματα όταν ανοίξεις κάθε συνταγή,
              αντιστοιχίζοντας τα υλικά με τα δεδομένα παραγγελιών.
            </div>

            {running ? (
              <div className="space-y-3">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>{statusMsg}</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-blue-500 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex gap-4 text-sm">
                  <span className="text-green-600">✅ Εισήχθησαν: <strong>{totalCreated}</strong></span>
                  <span className="text-gray-500">⏭ Παραλείφθηκαν: <strong>{totalSkipped}</strong></span>
                  {allErrors.length > 0 && (
                    <span className="text-red-600">❌ Σφάλματα: <strong>{allErrors.length}</strong></span>
                  )}
                </div>
              </div>
            ) : (
              <button
                onClick={startImport}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition"
              >
                🚀 Έναρξη Εισαγωγής ({recipes.length} συνταγές)
              </button>
            )}
          </div>
        )}

        {/* Step 3: Results */}
        {done && (
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h2 className="font-semibold text-gray-700 text-lg">✅ Εισαγωγή ολοκληρώθηκε</h2>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-green-50 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-green-700">{totalCreated}</div>
                <div className="text-sm text-green-600 mt-1">Δημιουργήθηκαν</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-gray-600">{totalSkipped}</div>
                <div className="text-sm text-gray-500 mt-1">Παραλείφθηκαν</div>
              </div>
              <div className={`${allUnmatched.size > 0 ? "bg-yellow-50" : "bg-green-50"} rounded-lg p-4 text-center`}>
                <div className={`text-3xl font-bold ${allUnmatched.size > 0 ? "text-yellow-700" : "text-green-700"}`}>
                  {allUnmatched.size}
                </div>
                <div className={`text-sm mt-1 ${allUnmatched.size > 0 ? "text-yellow-600" : "text-green-600"}`}>
                  Υλικά χωρίς αντιστοίχιση
                </div>
              </div>
            </div>

            {allErrors.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm text-red-600 font-medium">
                  ❌ {allErrors.length} σφάλματα (κλικ για λεπτομέρειες)
                </summary>
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto text-xs text-red-600 bg-red-50 rounded p-3">
                  {allErrors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              </details>
            )}

            {allUnmatched.size > 0 && (
              <div>
                <div className="text-sm font-medium text-yellow-800 mb-2">
                  ⚠️ {allUnmatched.size} υλικά δεν αντιστοιχίστηκαν με υπάρχοντα υλικά της εφαρμογής.
                  Θα εμφανίζονται με <code className="bg-gray-100 px-1 rounded">ingredient_id = null</code> στη ΒΔ.
                  Μπορείς να τα συνδέσεις χειροκίνητα από τη φόρμα κάθε συνταγής, ή να εισάγεις προσφορές
                  προμηθευτών για να δημιουργηθούν αυτόματα.
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-yellow-700">
                    Δείξε τη λίστα μη-αντιστοιχισμένων υλικών…
                  </summary>
                  <div className="mt-2 max-h-60 overflow-y-auto text-xs bg-yellow-50 rounded p-3 space-y-0.5">
                    {Array.from(allUnmatched).sort().map((u, i) => (
                      <div key={i} className="text-yellow-800">{u}</div>
                    ))}
                  </div>
                </details>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <a
                href="/recipe"
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 px-4 rounded-lg transition"
              >
                Πήγαινε στις Συνταγές →
              </a>
              <button
                onClick={() => {
                  setDone(false);
                  setRecipes(null);
                  setProgress(0);
                  setTotalCreated(0);
                  setTotalSkipped(0);
                  setAllErrors([]);
                  setAllUnmatched(new Set());
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold py-2 px-4 rounded-lg transition"
              >
                Νέα εισαγωγή
              </button>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="font-semibold text-gray-700 mb-3">📋 Οδηγίες χρήσης</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
            <li>
              <strong>Εξαγωγή JSON:</strong> Εκτέλεσε το Python script{" "}
              <code className="bg-gray-100 px-1 rounded text-xs">scripts/extract_recipes.py</code>{" "}
              για να εξάγεις τα δεδομένα από το <code className="bg-gray-100 px-1 rounded text-xs">Copy_of_Recipes_Management_ENRICHED.xlsm</code>.
            </li>
            <li>
              <strong>Ανέβασε</strong> το αρχείο <code className="bg-gray-100 px-1 rounded text-xs">recipes_data.json</code> που δημιουργήθηκε.
            </li>
            <li>
              <strong>Έλεγξε</strong> το preview και ξεκίνα την εισαγωγή.
            </li>
            <li>
              <strong>Μετά την εισαγωγή:</strong> Τα υλικά χωρίς αντιστοίχιση έχουν{" "}
              <code className="bg-gray-100 px-1 rounded text-xs">ingredient_id = null</code>.
              Άνοιξε κάθε συνταγή για να συνδέσεις τα υλικά χειροκίνητα, ή εισήγαγε προσφορές
              προμηθευτών (Αρχείο → Εισαγωγή Προσφοράς) για να δημιουργηθούν αυτόματα.
            </li>
          </ol>
        </div>

      </div>
    </div>
  );
}

function Stat({ label, value, color = "blue" }: { label: string; value: number; color?: "blue" | "yellow" | "green" }) {
  const colors = {
    blue: "bg-blue-50 text-blue-700",
    yellow: "bg-yellow-50 text-yellow-700",
    green: "bg-green-50 text-green-700",
  };
  return (
    <div className={`${colors[color]} rounded-lg p-3 text-center`}>
      <div className="text-2xl font-bold">{value.toLocaleString("el-GR")}</div>
      <div className="text-xs mt-0.5 opacity-80">{label}</div>
    </div>
  );
}
