"use client";
import { useState, useRef, useEffect } from "react";
import { useLanguage } from "@/lib/context";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const QUICK_PROMPTS_GR = [
  "Ποιες είναι οι πιο ακριβές μου συνταγές;",
  "Σύγκρινε το κόστος υλικών ανά μερίδα",
  "Ποια υλικά έχουν μηδενικό κόστος;",
  "Δώσε μου tips για μείωση food cost",
];

export default function ClaudeChat() {
  const { data, locale } = useLanguage();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  function buildContext(): string {
    const recipes = data.recipes || [];
    const totalRecipes = recipes.length;
    const totalIngredients = (data.ingredients || []).length;
    const topCostRecipes = [...recipes]
      .sort((a, b) => Number(b.totalRawMaterialCost) - Number(a.totalRawMaterialCost))
      .slice(0, 5)
      .map((r) => `${r.name}: €${Number(r.totalRawMaterialCost).toFixed(2)}`)
      .join(", ");

    return [
      `Συνολικές Συνταγές: ${totalRecipes}`,
      `Συνολικά Υλικά: ${totalIngredients}`,
      `Top 5 Ακριβότερες Συνταγές: ${topCostRecipes || "—"}`,
    ].join("\n");
  }

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;

    const newMessages: Message[] = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          context: buildContext(),
        }),
      });
      const { text: reply, error } = await res.json();
      if (error) throw new Error(error);
      setMessages([...newMessages, { role: "assistant", content: reply }]);
    } catch (err) {
      setMessages([...newMessages, { role: "assistant", content: `❌ Σφάλμα: ${String(err)}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xl flex items-center justify-center text-2xl transition-all"
        title="Claude AI Assistant"
      >
        {open ? "✕" : "✦"}
      </button>

      {/* Chat Panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-2rem)] h-[520px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-indigo-600 text-white px-4 py-3 flex items-center justify-between">
            <div>
              <div className="font-bold text-sm">✦ Claude AI</div>
              <div className="text-xs text-indigo-200">F&B ERP Assistant</div>
            </div>
            <button
              onClick={() => setMessages([])}
              className="text-xs text-indigo-200 hover:text-white"
              title={locale === "gr" ? "Καθαρισμός" : "Clear"}
            >
              🗑️
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 text-center mb-3">
                  {locale === "gr" ? "Ρώτησέ με για τα δεδομένα σου" : "Ask me about your data"}
                </p>
                {QUICK_PROMPTS_GR.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="w-full text-left text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg px-3 py-2 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-slate-100 text-slate-800 rounded-bl-sm"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-3 py-2 text-xs text-slate-500">
                  <span className="animate-pulse">✦ Σκέφτομαι…</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-100 p-3 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder={locale === "gr" ? "Ρώτησέ με κάτι…" : "Ask me something…"}
              className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl px-3 py-2 text-xs font-bold transition-colors"
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}
