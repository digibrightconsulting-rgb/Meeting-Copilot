import { verifyUser } from "./_verify.js";

// Only these models can be called, each with a hard ceiling on output tokens.
const ALLOWED_MODELS = {
  "claude-haiku-4-5-20251001": 800,
  "claude-sonnet-4-6": 3000,
};
const MAX_MESSAGES = 20;
const MAX_INPUT_CHARS = 60000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Signed-in Unmute users only
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { model, max_tokens, messages } = body;

  if (!ALLOWED_MODELS[model]) {
    return res.status(400).json({ error: "Model not allowed" });
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: "Invalid messages" });
  }
  if (JSON.stringify(messages).length > MAX_INPUT_CHARS) {
    return res.status(413).json({ error: "Request too large" });
  }

  const cappedTokens = Math.min(Math.max(Number(max_tokens) || 600, 1), ALLOWED_MODELS[model]);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      // Forward only the fields we allow — nothing else from the client
      body: JSON.stringify({ model, max_tokens: cappedTokens, messages }),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({ error: "API call failed" });
  }
}
