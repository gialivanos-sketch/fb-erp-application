import { NextRequest, NextResponse } from "next/server";

// Server-side route — το ANTHROPIC_API_KEY παραμένει στον server,
// δεν εκτίθεται ποτέ στο browser. Μόνο authenticated χρήστες μπορούν
// να καλέσουν αυτό το endpoint (μέσω της ίδιας της εφαρμογής).
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  try {
    const { messages, context } = await req.json();

    const systemPrompt = `Είσαι ο AI βοηθός του F&B ERP συστήματος για το NOE BEACH CLUB.
Βοηθάς με: συνταγές, κοστολόγηση, υλικά, αναλύσεις κόστους, προμηθευτές, αποθέματα.
Απαντάς πάντα στα Ελληνικά εκτός αν σου μιλήσουν Αγγλικά.
Είσαι συνοπτικός και πρακτικός — δίνεις άμεσες, χρήσιμες απαντήσεις.
${context ? `\nΤρέχοντα δεδομένα εφαρμογής:\n${context}` : ""}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: err }, { status: response.status });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
