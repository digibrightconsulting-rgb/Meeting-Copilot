// Shared helper: checks the caller's Supabase access token and returns the user.
// Files starting with "_" in /api are not exposed as endpoints on Vercel.

const cache = new Map(); // token -> { user, until }
const CACHE_MS = 5 * 60 * 1000;

export async function verifyUser(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return null;

  const hit = cache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;

  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) return null;
    const user = await r.json();
    if (!user?.id) return null;

    if (cache.size > 500) cache.clear();
    cache.set(token, { user, until: Date.now() + CACHE_MS });
    return user;
  } catch {
    return null;
  }
}
