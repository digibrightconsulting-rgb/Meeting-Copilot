 export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const { action, ...data } = body;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    if (action === "upsert_profile") {
      const { userId, profile } = data;
      const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Prefer": "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          id: userId,
          name: profile.name,
          role: profile.role,
          role_id: profile.roleId,
          company: profile.company,
          platforms: profile.platforms,
          expertise: profile.expertise,
          job_context: profile.jobContext,
          meeting_objective: profile.meetingObjective,
          typical_audience: profile.typicalAudience,
          communication_style: profile.communicationStyle,
          meeting_type: profile.meetingType,
          language: profile.language,
          updated_at: new Date().toISOString(),
        }),
      });
      const result = await response.json();
      return res.status(200).json({ success: true, data: result });
    }

    if (action === "get_profile") {
      const { userId } = data;
      const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`, {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      });
      const result = await response.json();
      return res.status(200).json({ success: true, data: result[0] || null });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (error) {
    console.error("Auth API error:", error);
    return res.status(500).json({ error: error.message });
  }
}

