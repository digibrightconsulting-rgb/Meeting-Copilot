import { verifyUser } from "./_verify.js";

// Gives a signed-in user a short-lived Deepgram token so the browser can stream
// meeting audio for transcription without ever seeing our Deepgram API key.
// The token only needs to be valid when the connection opens; the stream then
// stays open for the rest of the meeting.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });

  if (!process.env.DEEPGRAM_API_KEY) {
    return res.status(503).json({ error: "Meeting audio isn't set up yet (missing DEEPGRAM_API_KEY)." });
  }

  try {
    const r = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        "Authorization": `Token ${process.env.DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: 30 }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) {
      console.error("Deepgram grant failed:", r.status, data);
      return res.status(502).json({ error: "Could not start meeting transcription." });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ access_token: data.access_token });
  } catch (error) {
    console.error("Deepgram grant error:", error);
    return res.status(500).json({ error: "Could not start meeting transcription." });
  }
}
