import { verifyUser } from "./_verify.js";

// Industry Pulse: searches the web for genuinely recent news relevant to the
// meeting, the user's platforms and their company's industry, and returns
// 3 items with real source links. Uses Claude's server-side web search tool,
// which must be enabled for the organisation in the Claude Console.
export const config = { maxDuration: 60 };

const MODEL = "claude-sonnet-4-6";
const clip = (v, n) => String(v || "").slice(0, n);
// Compare links loosely (ignore tracking params, fragments and trailing slashes)
const normUrl = (u) => String(u || "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const topic = clip(body.topic, 300);
  if (!topic.trim()) return res.status(400).json({ error: "Missing meeting topic" });
  const goal = clip(body.goal, 300);
  const role = clip(body.role, 120);
  const company = clip(body.company, 120);
  const platforms = (Array.isArray(body.platforms) ? body.platforms : []).slice(0, 12).map(p => clip(p, 40));
  const expertise = (Array.isArray(body.expertise) ? body.expertise : []).slice(0, 12).map(p => clip(p, 60));
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const prompt = `Today is ${today}. You are briefing ${role || "a marketing professional"}${company ? " at " + company : ""} a few minutes before a meeting.

Meeting topic: ${topic}
${goal ? "Their goal: " + goal : ""}
${platforms.length ? "Platforms they use: " + platforms.join(", ") : ""}
${expertise.length ? "Their expertise: " + expertise.join(", ") : ""}

Use web search to find the 3 most useful RECENT news developments for this meeting: ideally from the last 30 days, never older than 90 days. Prioritise, in order:
1. News directly about the meeting topic
2. Changes to the platforms they use (ad products, measurement, policy, algorithm changes)
3. News about ${company ? company + "'s industry, competitors or market conditions" : "their industry"} that affects marketing (e.g. regulation, market conditions)

Rules:
- Only include developments you actually found in search results, and use the exact URL of the article you found.
- Skip evergreen explainers, opinion pieces without news, and anything older than 90 days.
- Be concrete: what happened, and why it matters for THIS meeting.

Respond ONLY with a JSON array of 3 items, nothing else:
[{"headline": "what happened, max 14 words", "why": "why it matters for this meeting, max 18 words", "source": "publication name", "url": "https://...", "date": "e.g. 18 Nov 2026"}]`;

  try {
    let messages = [{ role: "user", content: prompt }];
    let data;
    const resultUrls = new Set();

    // The API may pause long search turns (stop_reason "pause_turn"); continue up to twice.
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          messages,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
        }),
      });
      data = await r.json();
      if (!r.ok) {
        console.error("Pulse API error:", r.status, data);
        const msg = data?.error?.message || "";
        const error = /web search/i.test(msg) && /enable|disabled|not allowed|permission/i.test(msg)
          ? "Web search isn't enabled for your Anthropic organisation. Turn it on in the Claude Console (Settings → Privacy)."
          : "Couldn't fetch the latest news.";
        return res.status(502).json({ error });
      }
      for (const block of data.content || []) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const item of block.content) if (item.url) resultUrls.add(normUrl(item.url));
        }
      }
      if (data.stop_reason !== "pause_turn") break;
      messages = [{ role: "user", content: prompt }, { role: "assistant", content: data.content }];
    }

    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const start = text.indexOf("["), end = text.lastIndexOf("]");
    let items = [];
    try { items = JSON.parse(text.slice(start, end + 1)); } catch { items = []; }

    // Keep only items whose link really came from the search results
    const clean = (Array.isArray(items) ? items : [])
      .filter(i => i && i.headline && typeof i.url === "string" && /^https?:\/\//.test(i.url) && resultUrls.has(normUrl(i.url)))
      .slice(0, 3)
      .map(i => ({
        headline: clip(i.headline, 160),
        why: clip(i.why, 200),
        source: clip(i.source, 60),
        url: i.url,
        date: clip(i.date, 30),
      }));

    if (clean.length === 0) return res.status(502).json({ error: "No recent news found for this topic." });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ items: clean });
  } catch (error) {
    console.error("Pulse error:", error);
    return res.status(500).json({ error: "Couldn't fetch the latest news." });
  }
}
