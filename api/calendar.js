export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const { accessToken } = body;

  if (!accessToken) return res.status(400).json({ error: "No access token" });

  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${startOfDay}&timeMax=${endOfDay}&singleEvents=true&orderBy=startTime&maxResults=10`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json({ error: error.error?.message || "Calendar API error" });
    }

    const data = await response.json();

    const events = (data.items || [])
      .filter(e => e.status !== "cancelled")
      .map(e => ({
        id: e.id,
        title: e.summary || "Untitled Meeting",
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        attendees: (e.attendees || [])
          .filter(a => !a.self)
          .map(a => a.displayName || a.email)
          .join(", "),
        description: e.description || "",
        location: e.location || "",
        meetLink: e.hangoutLink || e.location || "",
        isOnline: !!(e.hangoutLink || (e.location && e.location.includes("zoom")) || (e.location && e.location.includes("meet"))),
      }));

    return res.status(200).json({ events });
  } catch (error) {
    console.error("Calendar error:", error);
    return res.status(500).json({ error: error.message });
  }
}
 
