import { verifyUser } from "./_verify.js";

// Company lookup for onboarding: searches the web for the user's company and
// returns a short "company card" the user confirms or edits. Uses Claude's web
// search tool (same Console setting as the Industry Pulse).
export const config = { maxDuration: 60 };

const clip = (v, n) => String(v || "").slice(0, n);
const list = (v, n, each = 80) => (Array.isArray(v) ? v : []).slice(0, n).map(x => clip(x, each)).filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ error: "Invalid JSON" }); }

  const company = clip(body.company, 120).trim();
  const website = clip(body.website, 200).trim();
  const title = clip(body.title, 120).trim();
  if (!company) return res.status(400).json({ error: "Missing company name" });

  const prompt = `Look up this company using web search and write a short factual card about it for a marketing assistant.

Company: ${company}
${website ? "Website: " + website : ""}
${title ? "(The user works there as: " + title + ")" : ""}

Find: what the company does, its main products, where it operates, who its customers are, any regulation that affects how it can market (e.g. financial, gambling, health, alcohol rules), main competitors, and anything that shapes its marketing (e.g. app-first, B2B sales-led, seasonal).

Rules: only state things you found or are confident about. Keep every field short. If you can't identify the company with confidence, set "confident" to false.

Respond ONLY with JSON:
{"confident": true, "name": "official name", "summary": "one sentence: what they do and for whom", "industry": "e.g. Fintech, online investing", "products": ["..."], "markets": ["countries/regions"], "customers": "who they sell to, one line", "regulation": "one or two short sentences, or empty if none notable", "competitors": ["..."], "marketingContext": "one line on what shapes their marketing"}`;

  try {
    let messages = [{ role: "user", content: prompt }];
    let data;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          messages,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        }),
      });
      data = await r.json();
      if (!r.ok) {
        console.error("Company lookup error:", r.status, data);
        return res.status(502).json({ error: "Couldn't look up your company." });
      }
      if (data.stop_reason !== "pause_turn") break;
      messages = [{ role: "user", content: prompt }, { role: "assistant", content: data.content }];
    }
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    let card;
    try { card = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { card = null; }
    if (!card || !card.summary) return res.status(502).json({ error: "Couldn't find details for that company." });
    return res.status(200).json({
      card: {
        confident: card.confident !== false,
        name: clip(card.name || company, 120),
        summary: clip(card.summary, 400),
        industry: clip(card.industry, 120),
        products: list(card.products, 8),
        markets: list(card.markets, 10, 60),
        customers: clip(card.customers, 200),
        regulation: clip(card.regulation, 500),
        competitors: list(card.competitors, 8, 60),
        marketingContext: clip(card.marketingContext, 400),
      },
    });
  } catch (error) {
    console.error("Company lookup error:", error);
    return res.status(500).json({ error: "Couldn't look up your company." });
  }
}
