import { useState, useEffect, useRef, useCallback } from "react";

// ── API ────────────────────────────────────────────────────────────────────
async function callClaudeFast(prompt) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  return (data.content?.find(b => b.type === "text")?.text || "[]").replace(/```json|```/g, "").trim();
}

async function callClaude(prompt) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  return (data.content?.find(b => b.type === "text")?.text || "[]").replace(/```json|```/g, "").trim();
}


// ── SUPABASE CONFIG ────────────────────────────────────────────────────────
const SUPABASE_URL = "https://xjpqnyonanfkyniygsrh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_1k0xyVXKU7sQl9iW-Byo4Q_W10QDxVH";

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      ...options.headers,
    },
  });
  return res.json();
}

async function signInWithGoogle() {
  const redirectUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(window.location.origin + "?auth=callback")}&scopes=${encodeURIComponent("openid email profile https://www.googleapis.com/auth/calendar.readonly")}`;
  window.location.href = redirectUrl;
}

async function signOut() {
  const token = localStorage.getItem("unmute_access_token");
  if (token) {
    await supabaseRequest("/auth/v1/logout", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
    });
  }
  localStorage.removeItem("unmute_access_token");
  localStorage.removeItem("unmute_refresh_token");
  localStorage.removeItem("unmute_user");
  localStorage.removeItem("unmute_mkt_onboarded");
  localStorage.removeItem("unmute_mkt_profile");
  window.location.reload();
}

async function getSession() {
  const token = localStorage.getItem("unmute_access_token");
  if (!token) return null;
  try {
    const data = await supabaseRequest("/auth/v1/user", {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (data.id) return { user: data, access_token: token };
    return null;
  } catch { return null; }
}

async function handleAuthCallback() {
  const hash = window.location.hash;
  if (!hash) return null;
  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken) {
    localStorage.setItem("unmute_access_token", accessToken);
    if (refreshToken) localStorage.setItem("unmute_refresh_token", refreshToken);
    window.history.replaceState({}, document.title, window.location.pathname);
    return accessToken;
  }
  return null;
}

async function saveProfile(userId, profile) {
  try {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsert_profile", userId, profile }),
    });
  } catch(e) { console.error("Save profile error:", e); }
}

async function fetchCalendar(accessToken) {
  try {
    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });
    const data = await res.json();
    return data.events || [];
  } catch(e) { console.error("Calendar error:", e); return []; }
}

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const LANGUAGES = [
  { label: "English", code: "en-US", flag: "🇬🇧" },
  { label: "Hebrew",  code: "he-IL", flag: "🇮🇱" },
  { label: "French",  code: "fr-FR", flag: "🇫🇷" },
  { label: "Spanish", code: "es-ES", flag: "🇪🇸" },
  { label: "Arabic",  code: "ar-SA", flag: "🇸🇦" },
  { label: "German",  code: "de-DE", flag: "🇩🇪" },
];

const MARKETING_ROLES = [
  { id: "cmo", label: "CMO / VP Marketing", icon: "📣", skills: ["Brand strategy", "Budget planning & defence", "Executive communication", "Go-to-market strategy", "Agency management", "Marketing ROI & attribution", "Team leadership", "Stakeholder management", "Competitive positioning", "Marketing mix strategy"] },
  { id: "paid-media", label: "Paid Media Manager", icon: "🎯", skills: ["Google Ads campaign management", "Meta Ads strategy", "Programmatic advertising", "Campaign performance analysis", "Bid strategy & optimisation", "Audience targeting", "Creative testing", "Budget allocation & pacing", "Cross-channel attribution", "ROAS & efficiency metrics"] },
  { id: "performance", label: "Performance Marketing", icon: "📈", skills: ["CAC & LTV optimisation", "Funnel analysis", "A/B testing & experimentation", "Incrementality testing", "Multi-touch attribution", "Marketing Mix Modelling", "Growth strategy", "Conversion rate optimisation", "Paid & organic integration", "Data-driven decision making"] },
  { id: "analyst", label: "Marketing Analyst", icon: "📊", skills: ["Marketing Mix Modelling (MMM)", "Incrementality testing", "Multi-touch attribution", "Campaign performance reporting", "Dashboard & data visualisation", "A/B testing & experimentation", "Audience insights", "Budget efficiency analysis", "Predictive modelling", "Stakeholder reporting"] },
  { id: "social", label: "Social Media Manager", icon: "📱", skills: ["Organic social strategy", "Paid social advertising", "Community management", "Content planning & calendars", "Influencer marketing", "Platform algorithm knowledge", "Brand voice & tone", "Social analytics & reporting", "Trend identification", "Video & short-form content"] },
  { id: "growth", label: "Head of Growth", icon: "🚀", skills: ["Growth strategy & roadmap", "CAC & LTV optimisation", "Product-led growth", "Retention & lifecycle marketing", "Funnel optimisation", "Experimentation frameworks", "Cross-functional collaboration", "Data-driven decision making", "Channel diversification", "Revenue forecasting"] },
  { id: "product-marketing", label: "Product Marketing Manager", icon: "📢", skills: ["Product positioning & messaging", "Go-to-market strategy", "Competitive intelligence", "Launch planning & execution", "Sales enablement", "Customer research & insights", "Feature adoption", "Pricing strategy", "Win/loss analysis", "Content marketing"] },
  { id: "director", label: "Marketing Director", icon: "🏆", skills: ["Marketing strategy", "Budget management", "Team leadership", "Agency & partner management", "Executive reporting", "Brand management", "Campaign oversight", "Stakeholder communication", "Performance management", "Market analysis"] },
];

const PLATFORMS = [
  { id: "google", label: "Google Ads", icon: "🔍" },
  { id: "meta", label: "Meta (Facebook/Instagram)", icon: "📘" },
  { id: "tiktok", label: "TikTok Ads", icon: "🎵" },
  { id: "linkedin", label: "LinkedIn Ads", icon: "💼" },
  { id: "youtube", label: "YouTube Ads", icon: "▶️" },
  { id: "programmatic", label: "Programmatic / DV360", icon: "🖥️" },
  { id: "amazon", label: "Amazon Ads", icon: "📦" },
  { id: "pinterest", label: "Pinterest Ads", icon: "📌" },
  { id: "snapchat", label: "Snapchat Ads", icon: "👻" },
  { id: "twitter", label: "Twitter / X Ads", icon: "🐦" },
  { id: "apple", label: "Apple Search Ads", icon: "🍎" },
  { id: "email", label: "Email Marketing", icon: "📧" },
  { id: "seo", label: "SEO / Organic", icon: "🌱" },
  { id: "influencer", label: "Influencer / Creator", icon: "⭐" },
];

const MEETING_TYPES = [
  "Budget review / planning",
  "Campaign performance review",
  "Agency briefing / review",
  "Channel strategy session",
  "Executive marketing update",
  "Media planning session",
  "Attribution & measurement review",
  "Creative briefing",
  "Competitor analysis session",
  "Cross-functional team call",
];

const COMMUNICATION_STYLES = [
  { id: "data-driven", label: "Data-driven", icon: "📊", desc: "Back everything with numbers and evidence" },
  { id: "strategic", label: "Strategic", icon: "🗺️", desc: "Big picture, direction and long-term thinking" },
  { id: "collaborative", label: "Collaborative", icon: "🤝", desc: "Build consensus, acknowledge others views" },
  { id: "direct", label: "Direct & assertive", icon: "⚡", desc: "Say it straight, no fluff" },
  { id: "diplomatic", label: "Diplomatic", icon: "🕊️", desc: "Tactful, careful with relationships" },
  { id: "adaptive", label: "Adaptive", icon: "🌊", desc: "Read the room and match the energy" },
];

const DEFAULT_PROFILE = {
  name: "", role: "", roleId: "", platforms: [], expertise: [],
  company: "", jobContext: "", meetingObjective: "", typicalAudience: "",
  communicationStyle: "",
  meetingType: "Campaign performance review", language: LANGUAGES[0],
};

// ── PROMPTS ────────────────────────────────────────────────────────────────
function buildLivePrompt(profile, transcript, goal, language, prepContext) {
  const translateNote = language.code !== "en-US" ? `Transcript may be in ${language.label}. Translate to English first then generate suggestions.` : "";
  const styleGuide = { "data-driven": "Back suggestions with specific numbers and evidence.", "strategic": "Frame around big picture direction and long-term impact.", "collaborative": "Build consensus and acknowledge others views.", "direct": "Short, plain, assertive — no hedging.", "diplomatic": "Tactful ways to make points without friction.", "adaptive": "Match the energy and tone of the room." }[profile.communicationStyle] || "Be confident and clear.";
  const platformContext = profile.platforms.length > 0 ? `Active platforms: ${profile.platforms.join(", ")}. Draw on specific knowledge of these platforms — their attribution models, recent changes, algorithm updates, and best practices.` : "";

  return `You are a real-time AI co-pilot for a marketing professional. Suggest what they should say RIGHT NOW.

PROFILE:
Name: ${profile.name}
Role: ${profile.role}${profile.company ? " at " + profile.company : ""}
${profile.company ? "Company intelligence: Draw on everything you know about " + profile.company + " — their industry, business model, products, competitors and marketing context." : ""}
${platformContext}
Expertise: ${profile.expertise.join(", ")}
Communication style: ${styleGuide}
${profile.jobContext ? "Background: " + profile.jobContext : ""}
${profile.meetingObjective ? "Typically trying to: " + profile.meetingObjective : ""}
${goal ? "Session goal: " + goal : ""}
${prepContext ? "Pre-meeting context: " + prepContext : ""}
${translateNote}

LAST 90 SECONDS:
"${transcript}"

RULES:
1. Respond ONLY to what was just said — never force platform or expertise references if irrelevant
2. Match their communication style
3. 1-2 sentences max per suggestion
4. All output in English

Respond ONLY with a JSON array:
[
  { "type": "Talking Point", "text": "..." },
  { "type": "Rebuttal", "text": "..." },
  { "type": "Question", "text": "..." }
]
Types: Talking Point | Rebuttal | Data Insight | Question | Idea | Reframe | Close`;
}

function buildPrepPrompt(profile, topic, attendees, goal, concerns, data) {
  const styleGuide = { "data-driven": "Back every point with specific numbers.", "strategic": "Focus on big picture and long-term.", "collaborative": "Build consensus, acknowledge others.", "direct": "Short and assertive — no hedging.", "diplomatic": "Tactful, avoid friction.", "adaptive": "Vary by who is in the room." }[profile.communicationStyle] || "Be confident and clear.";
  const platformContext = profile.platforms.length > 0 ? `The user actively works on: ${profile.platforms.join(", ")}.` : "";

  return `You are preparing a marketing professional for an important meeting.

PROFILE:
Name: ${profile.name}
Role: ${profile.role}${profile.company ? " at " + profile.company : ""}
${profile.company ? "Company intelligence: Draw on everything you know about " + profile.company + " to make talking points specific and credible." : ""}
${platformContext}
Expertise: ${profile.expertise.join(", ")}
Style: ${styleGuide}
${profile.jobContext ? "Background: " + profile.jobContext : ""}

MEETING:
Topic: ${topic}
Goal: ${goal}
Attendees: ${attendees}
Expected concerns: ${concerns}
${data ? "Data / context: " + data : ""}

Generate a concise marketing-focused pre-meeting brief. Keep every point SHORT — one punchy sentence max. No paragraphs.

IMPORTANT: Include an Industry Pulse section with 2-3 current marketing industry developments (privacy changes, AI in advertising, platform updates, cookie deprecation, measurement shifts, algorithm changes) that are directly relevant to the meeting topic and the platforms they use. These should feel timely and show the person is across the latest.

Respond ONLY with a JSON array:
[
  { "type": "Opening", "points": ["..."], "note": "when to use" },
  { "type": "Key Arguments", "points": ["...", "...", "..."], "note": "lead with these" },
  { "type": "Data Points", "points": ["...", "..."], "note": "have these ready" },
  { "type": "Industry Pulse", "points": ["Recent development relevant to meeting...", "Another trend or change..."], "note": "show you are across the latest" },
  { "type": "Anticipated Objection", "points": ["..."], "note": "be ready for this" },
  { "type": "Rebuttal", "points": ["...", "..."], "note": "fire back with this" },
  { "type": "Close / Ask", "points": ["..."], "note": "end on this" }
]`;
}

function buildSummaryPrompt(profile, transcript, goal, prepTopic, prepAttendees) {
  return `You are debriefing a marketing professional after a meeting.

PROFILE:
Name: ${profile.name}
Role: ${profile.role}${profile.company ? " at " + profile.company : ""}
${profile.company ? "Company context: Use knowledge of " + profile.company + " to make lessons specific." : ""}
Platforms: ${profile.platforms.join(", ")}
Expertise: ${profile.expertise.join(", ")}

MEETING:
Topic: ${prepTopic || "Not specified"}
Attendees: ${prepAttendees || "Not specified"}
Goal: ${goal || "Not specified"}

TRANSCRIPT:
"${transcript.map(t => t.text).join(" ")}"

Respond ONLY with a JSON object:
{
  "summary": [{ "point": "..." }],
  "your_contribution": [{ "type": "Strength", "text": "..." }, { "type": "Missed Opportunity", "text": "..." }],
  "lessons": [{ "title": "...", "text": "..." }],
  "next_meeting_prep": [{ "action": "..." }]
}`;
}

// ── TYPE STYLES ────────────────────────────────────────────────────────────
const TYPE_STYLES = {
  "Talking Point":   { border: "#16a34a", bg: "#f0fdf4", badge: "#dcfce7", badgeText: "#15803d" },
  "Key Arguments":   { border: "#16a34a", bg: "#f0fdf4", badge: "#dcfce7", badgeText: "#15803d" },
  "Key Argument":    { border: "#16a34a", bg: "#f0fdf4", badge: "#dcfce7", badgeText: "#15803d" },
  "Opening":         { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8" },
  "Rebuttal":        { border: "#dc2626", bg: "#fef2f2", badge: "#fee2e2", badgeText: "#b91c1c" },
  "Rebuttals":       { border: "#dc2626", bg: "#fef2f2", badge: "#fee2e2", badgeText: "#b91c1c" },
  "Data Points":     { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8" },
  "Data Point":      { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8" },
  "Data Insight":    { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8" },
  "Industry Pulse":  { border: "#7c3aed", bg: "#f5f3ff", badge: "#ede9fe", badgeText: "#6d28d9" },
  "Anticipated Objection": { border: "#d97706", bg: "#fffbeb", badge: "#fef3c7", badgeText: "#b45309" },
  "Question":        { border: "#7c3aed", bg: "#f5f3ff", badge: "#ede9fe", badgeText: "#6d28d9" },
  "Idea":            { border: "#0891b2", bg: "#ecfeff", badge: "#cffafe", badgeText: "#0e7490" },
  "Reframe":         { border: "#0891b2", bg: "#ecfeff", badge: "#cffafe", badgeText: "#0e7490" },
  "Close / Ask":     { border: "#d97706", bg: "#fffbeb", badge: "#fef3c7", badgeText: "#b45309" },
  "Close":           { border: "#d97706", bg: "#fffbeb", badge: "#fef3c7", badgeText: "#b45309" },
};
const DEFAULT_STYLE = { border: "#94a3b8", bg: "#f8fafc", badge: "#f1f5f9", badgeText: "#475569" };

// ── SUGGESTION CARD ────────────────────────────────────────────────────────
function SuggestionCard({ item, index, showNote }) {
  const [copied, setCopied] = useState(false);
  const s = TYPE_STYLES[item.type] || DEFAULT_STYLE;
  const textToCopy = item.points ? "• " + item.points.join("\n• ") : item.text;
  const copy = () => { navigator.clipboard.writeText(textToCopy); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div style={{ background: s.bg, border: "1px solid #e5e7eb", borderLeft: `4px solid ${s.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10, animation: `slideIn 0.25s ease ${index * 0.06}s both`, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <span style={{ background: s.badge, color: s.badgeText, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", fontFamily: "monospace", padding: "2px 8px", borderRadius: 4 }}>{item.type}</span>
        {item.type === "Industry Pulse" && <span style={{ fontSize: 10, color: "#7c3aed", fontFamily: "monospace" }}>⚡ latest trends</span>}
        <button onClick={copy} style={{ marginLeft: "auto", background: "white", border: "1px solid #d1d5db", color: "#6b7280", borderRadius: 5, padding: "2px 9px", fontSize: 11, cursor: "pointer", fontFamily: "monospace" }}>{copied ? "✓ Copied" : "Copy"}</button>
      </div>
      {item.points ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {item.points.map((pt, i) => <li key={i} style={{ color: "#1f2937", fontSize: 13, lineHeight: 1.55, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 500 }}>{pt}</li>)}
        </ul>
      ) : (
        <p style={{ margin: 0, color: "#1f2937", fontSize: 13.5, lineHeight: 1.65, fontFamily: "'Georgia', serif" }}>{item.text}</p>
      )}
      {showNote && item.note && <p style={{ margin: "8px 0 0", color: "#9ca3af", fontSize: 11, fontFamily: "monospace", borderTop: "1px solid #e5e7eb", paddingTop: 7 }}>↳ {item.note}</p>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, multiline, rows = 3 }) {
  const [local, setLocal] = useState(value);
  const base = { width: "100%", background: "white", border: "1px solid #DDD6FE", borderRadius: 8, color: "#1E1033", padding: "10px 14px", fontSize: 14, outline: "none", fontFamily: "'Plus Jakarta Sans', sans-serif", marginTop: 6 };
  return (
    <div style={{ marginBottom: 15 }}>
      <label style={{ fontSize: 12, color: "#6D28D9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{label}</label>
      {multiline ? <textarea value={local} onChange={e => setLocal(e.target.value)} onBlur={() => onChange(local)} placeholder={placeholder} rows={rows} style={{ ...base, resize: "vertical" }} /> : <input value={local} onChange={e => setLocal(e.target.value)} onBlur={() => onChange(local)} placeholder={placeholder} style={base} />}
    </div>
  );
}

// ── ONBOARDING ─────────────────────────────────────────────────────────────
function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [customSkill, setCustomSkill] = useState("");
  const [consentGiven, setConsentGiven] = useState(false);
  const totalSteps = 8;

  const update = (key, val) => setProfile(p => ({ ...p, [key]: val }));

  const togglePlatform = (id) => setProfile(p => ({ ...p, platforms: p.platforms.includes(id) ? p.platforms.filter(x => x !== id) : [...p.platforms, id] }));
  const toggleSkill = (skill) => setProfile(p => ({ ...p, expertise: p.expertise.includes(skill) ? p.expertise.filter(s => s !== skill) : [...p.expertise, skill] }));
  const addCustomSkill = () => { if (!customSkill.trim() || profile.expertise.includes(customSkill.trim())) return; setProfile(p => ({ ...p, expertise: [...p.expertise, customSkill.trim()] })); setCustomSkill(""); };

  const selectRole = (r) => setProfile(p => ({ ...p, roleId: r.id, role: r.label, expertise: [...r.skills] }));

  const canNext = () => {
    if (step === 1) return profile.name.trim() && profile.role.trim();
    if (step === 2) return profile.roleId !== "";
    if (step === 3) return profile.platforms.length > 0;
    if (step === 7) return consentGiven;
    return true;
  };

  const finish = () => {
    try {
      const profileStr = JSON.stringify(profile);
      localStorage.setItem("unmute_mkt_profile", profileStr);
      localStorage.setItem("unmute_mkt_onboarded", "true");
    } catch(e) {
      console.error("Storage error:", e);
    }
    window.location.href = window.location.href;
  };

  const Progress = () => {
    const phase = step <= 3 ? "Setting up your profile…" : step <= 6 ? "Personalising your suggestions…" : "Almost ready…";
    return (
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
          {Array.from({ length: totalSteps }).map((_, i) => <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? "#6D28D9" : "#EDE9FE", transition: "background 0.3s" }} />)}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: "#9B8FC0", fontFamily: "monospace" }}>{phase}</span>
          <span style={{ fontSize: 11, color: "#C4B5FD", fontFamily: "monospace" }}>{step + 1} of {totalSteps}</span>
        </div>
      </div>
    );
  };

  const NavButtons = ({ nextLabel = "Continue →", onNext, disabled }) => (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28 }}>
      {step > 0 ? <button onClick={() => setStep(s => s - 1)} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 13, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>← Back</button> : <div />}
      <button onClick={onNext || (() => setStep(s => s + 1))} disabled={disabled ?? !canNext()} style={{ background: (disabled ?? !canNext()) ? "#F5F3FF" : "#6D28D9", color: (disabled ?? !canNext()) ? "#C4B5FD" : "white", border: "none", borderRadius: 10, padding: "14px 32px", fontSize: 15, fontWeight: 600, cursor: (disabled ?? !canNext()) ? "not-allowed" : "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", boxShadow: (disabled ?? !canNext()) ? "none" : "0 2px 8px rgba(109,40,217,0.3)" }}>{nextLabel}</button>
    </div>
  );

  const Card = ({ children }) => (
    <div style={{ background: "white", borderRadius: 18, padding: "40px 48px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 640 }}>
      {children}
    </div>
  );

  const H2 = ({ children }) => <h2 style={{ margin: "0 0 8px", fontSize: 26, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>{children}</h2>;
  const Sub = ({ children }) => <p style={{ margin: "0 0 22px", color: "#6b7280", fontSize: 14, lineHeight: 1.6 }}>{children}</p>;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 60%, #E0D9F5 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@700;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        @keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box} input,textarea{outline:none} button{cursor:pointer;transition:all .15s} textarea{resize:vertical}
        input::placeholder,textarea::placeholder{color:#9ca3af}
      `}</style>

      <div style={{ width: "100%", maxWidth: 640 }}>

        {/* Step 0 — Welcome */}
        {step === 0 && (
          <Card>
            <Progress />
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ width: 70, height: 70, background: "#3B0764", borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, margin: "0 auto 20px", boxShadow: "0 4px 20px rgba(59,7,100,0.35)" }}>📣</div>
              <H2>Unmute for Marketers</H2>
              <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14, lineHeight: 1.7 }}>Your AI co-pilot for every Zoom, Meet, and Teams call. Real-time talking points, rebuttals, and marketing insights — tailored to your platforms and role — right when the conversation needs it.</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 8 }}>
              {[{ icon: "🎯", label: "Platform-aware", desc: "Knows Google, Meta, TikTok and more" }, { icon: "⚡", label: "Industry Pulse", desc: "Latest marketing trends in every brief" }, { icon: "🎙️", label: "Sounds like you", desc: "Learns your voice and communication style" }].map(f => (
                <div key={f.label} style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "16px 12px", textAlign: "center" }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>{f.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: "#3B0764", marginBottom: 4 }}>{f.label}</div>
                  <div style={{ fontSize: 11, color: "#9B8FC0", lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              ))}
            </div>
            <NavButtons nextLabel="Get Started →" disabled={false} />
          </Card>
        )}

        {/* Step 1 — Name & Role */}
        {step === 1 && (
          <Card>
            <Progress />
            <H2>Tell us about yourself</H2>
            <Sub>This helps Unmute tailor every suggestion to your specific marketing role.</Sub>
            <Field label="Your Name *" value={profile.name} onChange={v => update("name", v)} placeholder="e.g. Sarah" />
            <Field label="Your Job Title *" value={profile.role} onChange={v => update("role", v)} placeholder="e.g. Head of Paid Media" />
            <NavButtons />
          </Card>
        )}

        {/* Step 2 — Marketing Role */}
        {step === 2 && (
          <Card>
            <Progress />
            <H2>What best describes your role?</H2>
            <Sub>We will pre-load the most relevant marketing skills — customise them in the next step.</Sub>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
              {MARKETING_ROLES.map(r => (
                <button key={r.id} onClick={() => selectRole(r)} style={{ background: profile.roleId === r.id ? "#F5F3FF" : "white", color: profile.roleId === r.id ? "#5B21B6" : "#374151", border: profile.roleId === r.id ? "2px solid #6D28D9" : "2px solid #E4DCFB", borderRadius: 12, padding: "16px 18px", fontSize: 14, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: profile.roleId === r.id ? 700 : 500, display: "flex", alignItems: "center", gap: 10, textAlign: "left", transition: "all 0.15s" }}>
                  <span style={{ fontSize: 20 }}>{r.icon}</span>
                  <span>{r.label}</span>
                  {profile.roleId === r.id && <span style={{ marginLeft: "auto", color: "#6D28D9" }}>✓</span>}
                </button>
              ))}
            </div>
            <NavButtons disabled={!profile.roleId} />
          </Card>
        )}

        {/* Step 3 — Platforms */}
        {step === 3 && (
          <Card>
            <Progress />
            <H2>Which platforms do you work with?</H2>
            <Sub>Select all that apply — Unmute will reference platform-specific knowledge in your suggestions.</Sub>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              {PLATFORMS.map(p => (
                <button key={p.id} onClick={() => togglePlatform(p.label)} style={{ background: profile.platforms.includes(p.label) ? "#EDE9FE" : "#FAFAFA", color: profile.platforms.includes(p.label) ? "#5B21B6" : "#374151", border: profile.platforms.includes(p.label) ? "1.5px solid #C4B5FD" : "1.5px solid #E4DCFB", borderRadius: 10, padding: "12px 14px", fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: profile.platforms.includes(p.label) ? 600 : 400, display: "flex", alignItems: "center", gap: 8, textAlign: "left" }}>
                  <span style={{ fontSize: 18 }}>{p.icon}</span>
                  <span style={{ flex: 1 }}>{p.label}</span>
                  {profile.platforms.includes(p.label) && <span style={{ color: "#6D28D9", fontSize: 13 }}>✓</span>}
                </button>
              ))}
            </div>
            {profile.platforms.length > 0 && <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6D28D9", fontFamily: "monospace" }}>✓ {profile.platforms.length} platform{profile.platforms.length !== 1 ? "s" : ""} selected</p>}
            <NavButtons disabled={profile.platforms.length === 0} />
          </Card>
        )}

        {/* Step 4 — Expertise */}
        {step === 4 && (
          <Card>
            <Progress />
            <H2>Your areas of expertise</H2>
            <Sub>Pre-loaded from your role — add or remove anything to match your actual expertise.</Sub>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {[...new Set([...MARKETING_ROLES.flatMap(r => r.skills)])].sort().map(skill => (
                <button key={skill} onClick={() => toggleSkill(skill)} style={{ background: profile.expertise.includes(skill) ? "#EDE9FE" : "#FAFAFA", color: profile.expertise.includes(skill) ? "#5B21B6" : "#374151", border: profile.expertise.includes(skill) ? "1px solid #C4B5FD" : "1px solid #E4DCFB", borderRadius: 20, padding: "8px 15px", fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: profile.expertise.includes(skill) ? 600 : 400 }}>
                  {profile.expertise.includes(skill) ? "✓ " : ""}{skill}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={customSkill} onChange={e => setCustomSkill(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addCustomSkill(); }} placeholder="Add your own skill…" style={{ flex: 1, background: "white", border: "1px solid #DDD6FE", borderRadius: 8, color: "#1E1033", padding: "9px 12px", fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif" }} />
              <button onClick={addCustomSkill} style={{ background: "#6D28D9", color: "white", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Add</button>
            </div>
            {profile.expertise.length > 0 && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#6D28D9", fontFamily: "monospace" }}>✓ {profile.expertise.length} skills selected</p>}
            <NavButtons />
          </Card>
        )}

        {/* Step 5 — Company & Work Context */}
        {step === 5 && (
          <Card>
            <Progress />
            <H2>Tell us about your work</H2>
            <Sub>The more context you give, the more relevant your suggestions will be.</Sub>
            <Field label="Company / Organisation" value={profile.company || ""} onChange={v => update("company", v)} placeholder="e.g. eToro, Unilever, Digibright" />
            <Field label="What do you do day to day?" value={profile.jobContext || ""} onChange={v => update("jobContext", v)} placeholder="e.g. I manage paid media across Meta and Google, run incrementality tests, and report performance to senior stakeholders." multiline rows={3} />
            <Field label="What are you typically trying to achieve in meetings?" value={profile.meetingObjective || ""} onChange={v => update("meetingObjective", v)} placeholder="e.g. Get budget approved, defend channel performance, influence media strategy." multiline rows={2} />
            <Field label="Who do you typically meet with?" value={profile.typicalAudience || ""} onChange={v => update("typicalAudience", v)} placeholder="e.g. CMO, CFO, agency partners, cross-functional teams" />
            <div style={{ marginTop: 18 }}>
              <label style={{ fontSize: 12, color: "#6D28D9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, display: "block", marginBottom: 10 }}>How do you want to come across?</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {COMMUNICATION_STYLES.map(style => (
                  <button key={style.id} onClick={() => update("communicationStyle", style.id)} style={{ background: profile.communicationStyle === style.id ? "#F5F3FF" : "white", border: profile.communicationStyle === style.id ? "2px solid #6D28D9" : "2px solid #E4DCFB", borderRadius: 10, padding: "14px 14px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{style.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: profile.communicationStyle === style.id ? "#5B21B6" : "#1E1033", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{style.label}</div>
                      <div style={{ fontSize: 12, color: "#9B8FC0", lineHeight: 1.4, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{style.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <NavButtons disabled={false} />
          </Card>
        )}

        {/* Step 6 — Meeting Type */}
        {step === 6 && (
          <Card>
            <Progress />
            <H2>What type of calls do you attend most?</H2>
            <Sub>This sets the default context so suggestions are always relevant to your meeting type.</Sub>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {MEETING_TYPES.map(type => (
                <button key={type} onClick={() => update("meetingType", type)} style={{ background: profile.meetingType === type ? "#6D28D9" : "white", color: profile.meetingType === type ? "white" : "#374151", border: profile.meetingType === type ? "2px solid #6D28D9" : "2px solid #E4DCFB", borderRadius: 10, padding: "12px 16px", fontSize: 13, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: profile.meetingType === type ? 600 : 400, textAlign: "left" }}>
                  {profile.meetingType === type ? "✓ " : ""}{type}
                </button>
              ))}
            </div>
            <NavButtons disabled={false} />
          </Card>
        )}

        {/* Step 7 — Language */}
        {step === 7 && (
          <Card>
            <Progress />
            <H2>What language are your meetings in?</H2>
            <Sub>On international video calls? Unmute listens in your meeting language and delivers all suggestions in English.</Sub>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {LANGUAGES.map(l => (
                <button key={l.code} onClick={() => update("language", l)} style={{ background: profile.language.code === l.code ? "#6D28D9" : "white", color: profile.language.code === l.code ? "white" : "#374151", border: profile.language.code === l.code ? "2px solid #6D28D9" : "2px solid #E4DCFB", borderRadius: 10, padding: "12px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: profile.language.code === l.code ? 600 : 400, display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                  <span style={{ fontSize: 18 }}>{l.flag}</span><span>{l.label}</span>
                </button>
              ))}
            </div>
            <NavButtons disabled={false} />
          </Card>
        )}

        {/* Step 8 — Tutorial + Consent */}
        {step === 8 && (
          <Card>
            <Progress />
            <h2 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>How it works</h2>
            <p style={{ margin: "0 0 22px", color: "#6b7280", fontSize: 14 }}>A quick guide before you jump in.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 8 }}>
              {[
                { icon: "⚙", color: "#2563eb", bg: "#eff6ff", title: "Before the call — Prep tab", desc: "Enter the meeting topic, who is on the call, and your goal. Click Generate and get a full brief — talking points, industry pulse, likely objections, and your close." },
                { icon: "●", color: "#6D28D9", bg: "#F5F3FF", title: "During the call — Live tab", desc: "Open Unmute alongside your Zoom or Meet tab. Click Start Listening and AI suggestions appear in real time as people speak — platform-aware and tailored to you." },
                { icon: "💬", color: "#7c3aed", bg: "#f5f3ff", title: "Ask AI anything", desc: "Use the Ask AI bar at the bottom to instantly ask anything mid-call — How do I respond to that budget objection? What is a strong data point on Meta attribution? — get an expert answer in seconds." },
                { icon: "📋", color: "#d97706", bg: "#fffbeb", title: "Copy any suggestion", desc: "Each card has a Copy button. Paste it into your notes or use it as a script for what to say next." },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: item.bg, border: "1px solid #f3f4f6", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: item.color, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{item.icon}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#111827", marginBottom: 4 }}>{item.title}</div>
                    <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.65 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 12, padding: "16px 18px", marginTop: 16 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={consentGiven} onChange={e => setConsentGiven(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: "#6D28D9", flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
                  I understand that Unmute listens to my meeting audio in real time. <strong>Audio is never recorded or stored.</strong> I am responsible for ensuring compliance with local recording consent laws. I agree to the <a href="https://meetunmute.com/terms.html" target="_blank" style={{ color: "#6D28D9" }}>Terms of Service</a> and <a href="https://meetunmute.com/privacy.html" target="_blank" style={{ color: "#6D28D9" }}>Privacy Policy</a>.
                </span>
              </label>
            </div>
            <NavButtons nextLabel="Let's go! ⚡" onNext={finish} disabled={!consentGiven} />
          </Card>
        )}

      </div>
    </div>
  );
}


// ── AUTH SCREEN ────────────────────────────────────────────────────────────
function AuthScreen() {
  const [loading, setLoading] = useState(false);

  return (
    <div style={{ height: "100vh", background: "linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 60%, #E0D9F5 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@700;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box}
      `}</style>
      <div style={{ background: "white", borderRadius: 20, padding: "48px", maxWidth: 440, width: "100%", textAlign: "center", boxShadow: "0 8px 40px rgba(109,40,217,0.12)", animation: "slideIn 0.3s ease" }}>
        <div style={{ width: 64, height: 64, background: "#3B0764", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 20px", boxShadow: "0 4px 20px rgba(59,7,100,0.35)" }}>📣</div>
        <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 28, fontWeight: 900, color: "#3B0764", margin: "0 0 8px", letterSpacing: "-0.02em" }}>Unmute</h1>
        <p style={{ color: "#9B8FC0", fontSize: 13, margin: "0 0 8px", fontStyle: "italic" }}>for Marketers</p>
        <p style={{ color: "#6b7280", fontSize: 14, lineHeight: 1.6, margin: "0 0 32px" }}>Your AI co-pilot for every Zoom, Meet, and Teams call. Real-time talking points tailored to your marketing role.</p>

        <button
          onClick={() => { setLoading(true); signInWithGoogle(); }}
          disabled={loading}
          style={{ width: "100%", background: loading ? "#F5F3FF" : "white", border: "1.5px solid #DDD6FE", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, color: "#1E1033", fontFamily: "'Plus Jakarta Sans', sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", transition: "all 0.15s", marginBottom: 16 }}
        >
          {loading ? (
            <div style={{ width: 20, height: 20, border: "2px solid #6D28D9", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          )}
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>

        <p style={{ fontSize: 11, color: "#C4B5FD", lineHeight: 1.6 }}>
          By continuing you agree to our <a href="https://meetunmute.com/terms.html" target="_blank" style={{ color: "#6D28D9" }}>Terms</a> and <a href="https://meetunmute.com/privacy.html" target="_blank" style={{ color: "#6D28D9" }}>Privacy Policy</a>. Audio is never recorded or stored.
        </p>
      </div>
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [onboarded, setOnboarded] = useState(false);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function init() {
      // Handle OAuth callback
      await handleAuthCallback();

      // Check session
      const session = await getSession();
      if (session) {
        setUser(session.user);
        // Load profile from localStorage first for speed
        const saved = localStorage.getItem("unmute_mkt_profile");
        const done = localStorage.getItem("unmute_mkt_onboarded");
        if (done && saved) {
          try { setProfile(JSON.parse(saved)); setOnboarded(true); } catch {}
        }
      }
      setReady(true);
    }
    init();
  }, []);

  const handleOnboardingComplete = async (p) => {
    localStorage.setItem("unmute_mkt_profile", JSON.stringify(p));
    localStorage.setItem("unmute_mkt_onboarded", "true");
    if (user) await saveProfile(user.id, p);
    window.location.reload();
  };

  if (!ready) return (
    <div style={{ height: "100vh", background: "#F5F3FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 40, height: 40, border: "3px solid #6D28D9", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 16px" }} />
        <p style={{ color: "#9B8FC0", fontFamily: "monospace", fontSize: 13 }}>Loading Unmute…</p>
      </div>
    </div>
  );

  if (!user) return <AuthScreen />;
  if (!onboarded) return <Onboarding onComplete={handleOnboardingComplete} />;
  return <MeetingApp profile={profile} user={user} onEditProfile={() => { localStorage.removeItem("unmute_mkt_onboarded"); window.location.reload(); }} />;
}

// ── MEETING APP ────────────────────────────────────────────────────────────
function MeetingApp({ profile, user, onEditProfile }) {
  const [mode, setMode] = useState("prep");
  const [language, setLanguage] = useState(profile.language || LANGUAGES[0]);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [sessionConsentGiven, setSessionConsentGiven] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const [prepTopic, setPrepTopic] = useState("");
  const [prepAttendees, setPrepAttendees] = useState("");
  const [prepGoal, setPrepGoal] = useState("");
  const [prepConcerns, setPrepConcerns] = useState("");
  const [prepData, setPrepData] = useState("");
  const [prepPoints, setPrepPoints] = useState([]);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepError, setPrepError] = useState("");
  const [savedMeetings, setSavedMeetings] = useState(() => { try { return JSON.parse(localStorage.getItem("unmute_mkt_meetings") || "[]"); } catch { return []; } });
  const [showPlanner, setShowPlanner] = useState(false);

  const [sessionGoal, setSessionGoal] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [liveSuggestions, setLiveSuggestions] = useState([]);
  const [liveStatus, setLiveStatus] = useState("idle");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [liveError, setLiveError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  const recognitionRef = useRef(null);
  const transcriptRef = useRef([]);
  const debounceRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [transcript]);

  const generatePrep = async () => {
    if (!prepTopic.trim()) { setPrepError("Please enter a meeting topic."); return; }
    setPrepLoading(true); setPrepError("");
    try {
      const raw = await callClaude(buildPrepPrompt(profile, prepTopic, prepAttendees, prepGoal, prepConcerns, prepData));
      setPrepPoints(JSON.parse(raw));
      if (prepGoal) setSessionGoal(prepGoal);
    } catch (e) { setPrepError("Error generating brief. Try again."); console.error(e); }
    setPrepLoading(false);
  };

  const saveMeeting = () => {
    if (!prepTopic.trim()) return;
    const m = { id: Date.now(), savedAt: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), topic: prepTopic, attendees: prepAttendees, goal: prepGoal, concerns: prepConcerns, data: prepData };
    const updated = [m, ...savedMeetings].slice(0, 10);
    setSavedMeetings(updated);
    localStorage.setItem("unmute_mkt_meetings", JSON.stringify(updated));
  };

  const loadMeeting = (m) => { setPrepTopic(m.topic); setPrepAttendees(m.attendees); setPrepGoal(m.goal); setPrepConcerns(m.concerns); setPrepData(m.data); setShowPlanner(false); };
  const deleteMeeting = (id) => { const u = savedMeetings.filter(m => m.id !== id); setSavedMeetings(u); localStorage.setItem("unmute_mkt_meetings", JSON.stringify(u)); };

  const loadCalendarEvents = async () => {
    const token = localStorage.getItem("unmute_access_token");
    if (!token) return;
    setCalendarLoading(true);
    const events = await fetchCalendar(token);
    setCalendarEvents(events);
    setCalendarLoading(false);
    setShowCalendar(true);
  };

  const loadEventToPrep = (event) => {
    setPrepTopic(event.title);
    setPrepAttendees(event.attendees || "");
    setShowCalendar(false);
  };

  const fetchLiveSuggestions = useCallback(async () => {
    const recent = transcriptRef.current.slice(-15).map(t => t.text).join(" ");
    if (recent.trim().length < 20) return;
    setLiveStatus("thinking");
    try {
      const prepContext = prepTopic ? `Meeting: ${prepTopic}. Goal: ${prepGoal}` : "";
      const raw = await callClaudeFast(buildLivePrompt(profile, recent, sessionGoal, language, prepContext));
      setLiveSuggestions(JSON.parse(raw));
      setLastUpdated(new Date());
      setLiveStatus("listening");
    } catch (e) { console.error(e); setLiveStatus("error"); setLiveError("Could not fetch suggestions."); }
  }, [sessionGoal, language, prepTopic, prepGoal, profile]);

  const triggerDebounced = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchLiveSuggestions, 18000);
  }, [fetchLiveSuggestions]);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setLiveError("Use Chrome for voice recognition."); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = language.code;
    r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) { setTranscript(prev => [...prev, { id: Date.now() + Math.random(), text: e.results[i][0].transcript.trim() }]); triggerDebounced(); } } };
    r.onerror = (e) => { if (e.error !== "no-speech") { setLiveError(`Mic: ${e.error}`); setLiveStatus("error"); } };
    r.onend = () => { if (recognitionRef.current) r.start(); };
    r.start(); recognitionRef.current = r; setIsListening(true); setLiveStatus("listening"); setLiveError("");
  }, [language, triggerDebounced]);

  const endMeeting = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.onend = null; recognitionRef.current.stop(); recognitionRef.current = null; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsListening(false); setLiveStatus("idle");
    if (transcriptRef.current.length > 0) {
      setMode("summary"); setSummary(null); setSummaryLoading(true); setSummaryError("");
      callClaude(buildSummaryPrompt(profile, transcriptRef.current, sessionGoal, prepTopic, prepAttendees))
        .then(raw => { setSummary(JSON.parse(raw.replace(/```json|```/g, "").trim())); setSummaryLoading(false); })
        .catch(e => { console.error(e); setSummaryError("Error generating summary."); setSummaryLoading(false); });
    }
  }, [profile, sessionGoal, prepTopic, prepAttendees]);

  const generateSummary = async () => {
    if (transcript.length === 0) { setSummaryError("No transcript yet — run a live session first."); return; }
    setSummaryLoading(true); setSummaryError("");
    try { const raw = await callClaude(buildSummaryPrompt(profile, transcript, sessionGoal, prepTopic, prepAttendees)); setSummary(JSON.parse(raw)); } catch (e) { setSummaryError("Error generating summary."); console.error(e); }
    setSummaryLoading(false);
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim(); setChatInput("");
    setChatHistory(prev => [...prev, { role: "user", text: userMsg }]);
    setChatLoading(true);
    try {
      const recentTranscript = transcriptRef.current.slice(-10).map(t => t.text).join(" ");
      const historyText = chatHistory.slice(-6).map(m => `${m.role === "user" ? "You" : "AI"}: ${m.text}`).join("\n");
      const prompt = `You are a real-time AI assistant for a ${profile.role}${profile.company ? " at " + profile.company : ""} on a marketing video call.\n${profile.company ? "Draw on your knowledge of " + profile.company + " — their industry, products, competitors and business model." : ""}\nPlatforms they use: ${profile.platforms.join(", ")}\nExpertise: ${profile.expertise.join(", ")}\nRecent transcript: "${recentTranscript || "No transcript yet"}"\n${historyText ? "Chat history:\n" + historyText : ""}\n\nQuestion: ${userMsg}\n\nAnswer in 1-3 sentences. Reference platform-specific knowledge only if directly relevant. No preamble.`;
      const raw = await callClaudeFast(prompt);
      const cleanResponse = raw.replace(/^\[|\]$/g, "").replace(/^"|"$/g, "").trim();
      setChatHistory(prev => [...prev, { role: "ai", text: cleanResponse }]);
    } catch (e) { console.error(e); setChatHistory(prev => [...prev, { role: "ai", text: "Could not get a response. Try again." }]); }
    setChatLoading(false);
  };

  const clearSession = () => { setTranscript([]); setLiveSuggestions([]); setLastUpdated(null); setLiveStatus(isListening ? "listening" : "idle"); };
  const statusInfo = { idle: { color: "#9ca3af", label: "Ready" }, listening: { color: "#16a34a", label: "Listening" }, thinking: { color: "#d97706", label: "Analysing…" }, error: { color: "#dc2626", label: "Error" } };

  return (
    <div style={{ height: "100vh", background: "#F5F3FF", fontFamily: "'Plus Jakarta Sans', 'Helvetica Neue', sans-serif", color: "#1E1033", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@700;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        @keyframes slideIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#f3f4f6} ::-webkit-scrollbar-thumb{background:#C4B5FD;border-radius:2px}
        input,textarea{outline:none} button{cursor:pointer;transition:all .15s} button:hover{opacity:.85} textarea{resize:vertical}
        input::placeholder,textarea::placeholder{color:#9B8FC0}
      `}</style>

      {/* Header */}
      <div style={{ background: "#3B0764", padding: "0 22px", height: 56, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginRight: 6 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontFamily: "'Fraunces', Georgia, serif", fontWeight: 700, color: "white" }}>U</div>
          <div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 700, fontSize: 15, color: "white", letterSpacing: "-0.01em", lineHeight: 1.2 }}>Unmute</div>
            <div style={{ fontSize: 9, color: "rgba(196,181,253,0.8)", letterSpacing: "0.05em" }}>for Marketers</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.1)", borderRadius: 20, padding: "3px 10px", fontSize: 11, color: "rgba(196,181,253,0.9)" }}>
          📣 {profile.name} · {profile.role}
        </div>
        {profile.platforms.length > 0 && (
          <div style={{ display: "flex", gap: 4 }}>
            {profile.platforms.slice(0, 4).map((p, i) => { const pl = PLATFORMS.find(x => x.label === p); return pl ? <span key={i} title={p} style={{ fontSize: 14 }}>{pl.icon}</span> : null; })}
            {profile.platforms.length > 4 && <span style={{ fontSize: 10, color: "rgba(196,181,253,0.6)", fontFamily: "monospace" }}>+{profile.platforms.length - 4}</span>}
          </div>
        )}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.1)", borderRadius: 9, padding: 3, gap: 2, marginLeft: 8 }}>
          {[{ key: "prep", label: "Prep" }, { key: "live", label: "Live" }, { key: "summary", label: "Summary" }].map(({ key, label }) => (
            <button key={key} onClick={() => setMode(key)} style={{ background: mode === key ? "rgba(255,255,255,0.18)" : "transparent", border: "none", color: mode === key ? "white" : "rgba(196,181,253,0.7)", borderRadius: 7, padding: "5px 14px", fontSize: 12, fontWeight: mode === key ? 600 : 400, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{label}</button>
          ))}
        </div>
        {mode === "live" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.1)", borderRadius: 20, padding: "4px 12px" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusInfo[liveStatus].color, animation: ["listening","thinking"].includes(liveStatus) ? `pulse ${liveStatus === "thinking" ? "0.6s" : "2s"} infinite` : "none" }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.9)", fontWeight: 500 }}>{statusInfo[liveStatus].label}</span>
            {lastUpdated && <span style={{ fontSize: 10, color: "rgba(196,181,253,0.6)", marginLeft: 2 }}>· {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          </div>
        )}
        <div style={{ marginLeft: "auto", position: "relative" }}>
          <button onClick={() => setShowLangMenu(p => !p)} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.9)", borderRadius: 8, padding: "5px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 7 }}>
            <span>{language.flag}</span><span style={{ fontWeight: 500 }}>{language.label}</span><span style={{ fontSize: 9, color: "rgba(196,181,253,0.6)" }}>▼</span>
          </button>
          {showLangMenu && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "white", border: "1px solid #DDD6FE", borderRadius: 10, overflow: "hidden", zIndex: 100, minWidth: 160, boxShadow: "0 8px 32px rgba(59,7,100,0.2)" }}>
              {LANGUAGES.map(l => (
                <button key={l.code} onClick={() => { setLanguage(l); setShowLangMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: language.code === l.code ? "#F5F3FF" : "white", border: "none", color: language.code === l.code ? "#6D28D9" : "#374151", padding: "10px 15px", fontSize: 13, textAlign: "left", fontWeight: language.code === l.code ? 600 : 400 }}>
                  <span>{l.flag}</span><span>{l.label}</span>{language.code === l.code && <span style={{ marginLeft: "auto", color: "#6D28D9" }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={onEditProfile} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.85)", borderRadius: 8, padding: "5px 12px", fontSize: 12 }}>Edit Profile</button>
        <button onClick={signOut} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(196,181,253,0.7)", borderRadius: 8, padding: "5px 12px", fontSize: 11 }}>Sign out</button>
        {mode === "live" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={clearSession} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.7)", borderRadius: 8, padding: "5px 12px", fontSize: 12 }}>Clear</button>
            <button onClick={isListening ? endMeeting : (sessionConsentGiven ? startListening : () => setShowConsentModal(true))} style={{ background: isListening ? "#FEE2E2" : "#EDE9FE", border: `1px solid ${isListening ? "#FCA5A5" : "#C4B5FD"}`, color: isListening ? "#DC2626" : "#6D28D9", borderRadius: 8, padding: "5px 16px", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: isListening ? 8 : 9, height: isListening ? 8 : 9, borderRadius: isListening ? 2 : "50%", background: isListening ? "#DC2626" : "#6D28D9", animation: isListening ? "pulse 1.2s infinite" : "none" }} />
              {isListening ? "End Meeting" : "Start Listening"}
            </button>
          </div>
        )}
      </div>

      {/* PREP MODE */}
      {mode === "prep" && (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "420px 1fr", overflow: "hidden" }}>
          <div style={{ background: "white", borderRight: "1px solid #DDD6FE", overflowY: "auto", padding: "24px 26px" }}>
            <div style={{ marginBottom: 20 }}>
              <button onClick={() => setShowPlanner(p => !p)} style={{ width: "100%", background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "#5B21B6", fontSize: 13, fontWeight: 600 }}>
                <span>📅</span><span>Planned Meetings</span>
                <span style={{ marginLeft: "auto", background: "#EDE9FE", color: "#6D28D9", fontSize: 10, fontFamily: "monospace", fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>{savedMeetings.length}</span>
                <span style={{ fontSize: 10, color: "#9B8FC0" }}>{showPlanner ? "▲" : "▼"}</span>
              </button>
              {showPlanner && (
                <div style={{ border: "1px solid #DDD6FE", borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
                  {savedMeetings.length === 0 ? <div style={{ padding: "14px", textAlign: "center", color: "#C4B5FD", fontSize: 12, fontStyle: "italic" }}>No saved meetings yet.</div> : savedMeetings.map((m, i) => (
                    <div key={m.id} style={{ padding: "10px 14px", borderBottom: i < savedMeetings.length - 1 ? "1px solid #F5F3FF" : "none", display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#3B0764", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.topic}</div>
                        <div style={{ fontSize: 11, color: "#9B8FC0", fontFamily: "monospace" }}>{m.savedAt}</div>
                      </div>
                      <button onClick={() => loadMeeting(m)} style={{ background: "#6D28D9", border: "none", color: "white", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Load</button>
                      <button onClick={() => deleteMeeting(m.id)} style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#DC2626", borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Google Calendar sync */}
            <div style={{ marginBottom: 16 }}>
              <button onClick={loadCalendarEvents} disabled={calendarLoading} style={{ width: "100%", background: showCalendar ? "#EDE9FE" : "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "#5B21B6", fontSize: 13, fontWeight: 600 }}>
                <span>📅</span>
                <span>{calendarLoading ? "Loading calendar…" : "Today's Meetings"}</span>
                {calendarLoading && <div style={{ width: 12, height: 12, border: "2px solid #6D28D9", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", marginLeft: 4 }} />}
                <span style={{ marginLeft: "auto", fontSize: 10, color: "#9B8FC0" }}>{showCalendar ? "▲" : "▼"}</span>
              </button>
              {showCalendar && (
                <div style={{ border: "1px solid #DDD6FE", borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
                  {calendarEvents.length === 0 ? (
                    <div style={{ padding: "16px 14px", textAlign: "center", color: "#C4B5FD", fontSize: 12, fontStyle: "italic" }}>
                      No meetings found for today.
                    </div>
                  ) : calendarEvents.map((event, i) => {
                    const time = event.start ? new Date(event.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                    return (
                      <div key={event.id} style={{ padding: "10px 14px", borderBottom: i < calendarEvents.length - 1 ? "1px solid #F5F3FF" : "none", display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flexShrink: 0, textAlign: "center", minWidth: 44 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#6D28D9", fontFamily: "monospace" }}>{time}</div>
                          {event.isOnline && <div style={{ fontSize: 9, color: "#10B981", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>online</div>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#3B0764", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{event.title}</div>
                          {event.attendees && <div style={{ fontSize: 11, color: "#9B8FC0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{event.attendees}</div>}
                        </div>
                        <button onClick={() => loadEventToPrep(event)} style={{ background: "#6D28D9", border: "none", color: "white", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>→ Prep</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Meeting Brief Builder</h2>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Generate a personalised brief — includes an Industry Pulse with the latest marketing trends relevant to your meeting.</p>
            </div>
            <Field label="Meeting Topic *" value={prepTopic} onChange={setPrepTopic} placeholder="e.g. Q3 Paid Media Budget Review" />
            <Field label="Attendees & Their Roles" value={prepAttendees} onChange={setPrepAttendees} placeholder="e.g. CMO (Sarah), CFO (James), Head of Performance (Tom)" multiline rows={2} />
            <Field label="Your Goal" value={prepGoal} onChange={setPrepGoal} placeholder="e.g. Get sign-off on Meta budget increase for Q3" />
            <Field label="Expected Topics / Concerns" value={prepConcerns} onChange={setPrepConcerns} placeholder="e.g. ROAS decline, Meta attribution, competitor spend" multiline rows={2} />
            <Field label="Data / Context to Reference" value={prepData} onChange={setPrepData} placeholder="e.g. Meta ROAS up 18% QoQ, Google CPA down 12% since smart bidding switch" multiline rows={2} />
            {prepError && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#dc2626", fontSize: 12, fontFamily: "monospace" }}>⚠ {prepError}</div>}
            <button onClick={generatePrep} disabled={prepLoading} style={{ width: "100%", background: "#6D28D9", border: "none", color: "white", borderRadius: 10, padding: "13px", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, boxShadow: "0 2px 8px rgba(109,40,217,0.3)" }}>
              {prepLoading ? <><div style={{ width: 14, height: 14, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />Generating Brief + Industry Pulse…</> : "⚡ Generate Meeting Brief"}
            </button>
            {prepTopic.trim() && <button onClick={saveMeeting} style={{ width: "100%", marginTop: 10, background: "white", border: "1px solid #DDD6FE", color: "#5B21B6", borderRadius: 10, padding: "11px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>📅 Save for Later</button>}
            {prepPoints.length > 0 && <button onClick={() => setMode("live")} style={{ width: "100%", marginTop: 10, background: "#F5F3FF", border: "1px solid #C4B5FD", color: "#6D28D9", borderRadius: 10, padding: "12px", fontSize: 13, fontWeight: 600 }}>→ Enter Live Mode</button>}
          </div>
          <div style={{ overflowY: "auto", padding: "24px 26px", background: "#F5F3FF" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Your Talking Points</h2>
              {prepPoints.length > 0 && <span style={{ background: "#EDE9FE", color: "#6D28D9", fontSize: 11, fontWeight: 700, fontFamily: "monospace", padding: "2px 9px", borderRadius: 20 }}>{prepPoints.length} cards</span>}
            </div>
            {prepPoints.length === 0 && !prepLoading && <div style={{ background: "white", border: "1px solid #DDD6FE", borderRadius: 12, padding: "32px 24px", textAlign: "center", color: "#9ca3af" }}><div style={{ fontSize: 32, marginBottom: 12 }}>📋</div><p style={{ margin: 0, fontSize: 13, lineHeight: 1.8 }}>Fill in the form and click Generate —<br />your brief will include an Industry Pulse section<br />with the latest relevant marketing trends.</p></div>}
            {prepLoading && <div style={{ background: "white", border: "1px solid #DDD6FE", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}><div style={{ width: 24, height: 24, border: "3px solid #6D28D9", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 14px" }} /><p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Building your brief + scanning industry trends…</p></div>}
            {prepPoints.map((p, i) => <SuggestionCard key={i} item={p} index={i} showNote={true} />)}
          </div>
        </div>
      )}

      {/* LIVE MODE */}
      {mode === "live" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ background: "#F5F3FF", borderBottom: "1px solid #DDD6FE", padding: "9px 22px", display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: "#6D28D9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, whiteSpace: "nowrap" }}>Goal</span>
            <input value={sessionGoal} onChange={e => setSessionGoal(e.target.value)} placeholder="Set your goal for this meeting…" style={{ flex: 1, background: "white", border: "1px solid #DDD6FE", borderRadius: 8, color: "#1E1033", padding: "7px 12px", fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif" }} />
            {language.code !== "en-US" && <div style={{ background: "#EDE9FE", border: "1px solid #C4B5FD", borderRadius: 7, padding: "5px 12px", fontSize: 11, color: "#5B21B6", fontFamily: "monospace", whiteSpace: "nowrap", fontWeight: 600 }}>{language.flag} → 🇬🇧 auto-translate on</div>}
          </div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", overflow: "hidden", minHeight: 0 }}>
            <div style={{ background: "white", borderRight: "1px solid #DDD6FE", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ background: "#F5F3FF", padding: "11px 20px", borderBottom: "1px solid #DDD6FE", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563eb" }} />
                <span style={{ fontSize: 11, color: "#5B21B6", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Pre-Meeting Brief</span>
                <span style={{ marginLeft: "auto", background: "#EDE9FE", color: "#6D28D9", fontSize: 10, fontFamily: "monospace", fontWeight: 700, padding: "1px 8px", borderRadius: 10 }}>{prepPoints.length} pts</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
                {prepPoints.length === 0 ? <div style={{ color: "#C4B5FD", fontSize: 12, fontStyle: "italic", textAlign: "center", paddingTop: 24, lineHeight: 1.8 }}><div style={{ fontSize: 28, marginBottom: 10 }}>📝</div>No brief yet — go to Prep tab.</div> : prepPoints.map((p, i) => <SuggestionCard key={i} item={p} index={i} showNote={true} />)}
              </div>
            </div>
            <div style={{ background: "#F5F3FF", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ background: "white", padding: "11px 20px", borderBottom: "1px solid #DDD6FE", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a", animation: isListening ? "pulse 2s infinite" : "none" }} />
                <span style={{ fontSize: 11, color: "#5B21B6", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Live Suggestions</span>
                {liveStatus === "thinking" && <div style={{ width: 12, height: 12, border: "2px solid #7C3AED", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", marginLeft: 2 }} />}
                <button onClick={fetchLiveSuggestions} disabled={transcript.length === 0} style={{ marginLeft: "auto", background: "#EDE9FE", border: "1px solid #C4B5FD", color: "#6D28D9", borderRadius: 7, padding: "4px 11px", fontSize: 11, fontFamily: "monospace", fontWeight: 600, opacity: transcript.length === 0 ? 0.35 : 1 }}>↻ Refresh</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
                {liveSuggestions.length === 0 && liveStatus !== "thinking" && <div style={{ color: "#C4B5FD", fontSize: 12, fontStyle: "italic", textAlign: "center", paddingTop: 24, lineHeight: 1.8 }}><div style={{ fontSize: 28, marginBottom: 10 }}>💬</div>{transcript.length > 0 ? "Click ↻ Refresh or wait ~18s." : "Start listening to get real-time suggestions."}</div>}
                {liveSuggestions.map((s, i) => <SuggestionCard key={i} item={s} index={i} showNote={false} />)}
                {liveError && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#dc2626", fontSize: 12, fontFamily: "monospace" }}>⚠ {liveError}</div>}
              </div>
            </div>
          </div>
          <div style={{ background: "white", borderTop: "1px solid #DDD6FE", flexShrink: 0 }}>
            {chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === "ai" && (
              <div style={{ padding: "10px 22px", background: "#F5F3FF", borderBottom: "1px solid #DDD6FE", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#3B0764", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "white", fontWeight: 700, flexShrink: 0, marginTop: 1 }}>U</div>
                <p style={{ margin: 0, fontSize: 13, color: "#1E1033", lineHeight: 1.55, fontFamily: "'Georgia', serif", flex: 1 }}>{chatHistory[chatHistory.length - 1].text}</p>
              </div>
            )}
            <div style={{ padding: "10px 22px", display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#6D28D9" }} />
                <span style={{ fontSize: 11, color: "#6D28D9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>Ask AI</span>
              </div>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") sendChat(); }} placeholder="Ask anything — e.g. How do I respond to that Meta attribution objection?" style={{ flex: 1, background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 9, color: "#1E1033", padding: "9px 14px", fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif", outline: "none" }} />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{ background: "#6D28D9", border: "none", color: "white", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 600, opacity: chatLoading || !chatInput.trim() ? 0.45 : 1, display: "flex", alignItems: "center", gap: 6, boxShadow: "0 2px 8px rgba(109,40,217,0.25)" }}>
                {chatLoading ? <div style={{ width: 13, height: 13, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> : "Send →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUMMARY MODE */}
      {mode === "summary" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", maxWidth: 900, margin: "0 auto", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div>
              <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Meeting Summary</h2>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>{transcript.length > 0 ? `Based on ${transcript.length} transcript segments` : "Run a live session first"}</p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {summary && <button onClick={() => navigator.clipboard.writeText(JSON.stringify(summary, null, 2))} style={{ background: "white", border: "1px solid #DDD6FE", color: "#374151", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500 }}>Copy All</button>}
              <button onClick={generateSummary} disabled={summaryLoading || transcript.length === 0} style={{ background: summaryLoading || transcript.length === 0 ? "#F5F3FF" : "#6D28D9", border: "none", color: summaryLoading || transcript.length === 0 ? "#9B8FC0" : "white", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                {summaryLoading ? <><div style={{ width: 13, height: 13, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />Generating…</> : "⚡ Generate Summary"}
              </button>
            </div>
          </div>
          {summaryError && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "12px 16px", marginBottom: 20, color: "#dc2626", fontSize: 13 }}>⚠ {summaryError}</div>}
          {!summary && !summaryLoading && <div style={{ background: "white", border: "1px solid #DDD6FE", borderRadius: 14, padding: "48px 32px", textAlign: "center", color: "#9ca3af" }}><div style={{ fontSize: 40, marginBottom: 14 }}>📋</div><p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#374151" }}>{transcript.length > 0 ? "Click Generate Summary to get your debrief." : "Complete a live session first."}</p></div>}
          {summaryLoading && <div style={{ background: "white", border: "1px solid #DDD6FE", borderRadius: 14, padding: "48px 32px", textAlign: "center" }}><div style={{ width: 28, height: 28, border: "3px solid #6D28D9", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 16px" }} /><p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Analysing your meeting…</p></div>}
          {summary && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 32 }}>
              <div style={{ background: "white", border: "1px solid #DDD6FE", borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #EDE9FE", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📌</div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>What Was Discussed</span>
                </div>
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {summary.summary.map((s, i) => <div key={i} style={{ display: "flex", gap: 12 }}><div style={{ width: 22, height: 22, borderRadius: "50%", background: "#EDE9FE", color: "#6D28D9", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div><p style={{ margin: 0, fontSize: 13.5, color: "#374151", lineHeight: 1.6 }}>{s.point}</p></div>)}
                </div>
              </div>
              <div style={{ background: "white", border: "1px solid #DDD6FE", borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #EDE9FE", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🎯</div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Your Contribution</span>
                </div>
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {summary.your_contribution.map((c, i) => { const isStrength = c.type === "Strength"; return <div key={i} style={{ background: isStrength ? "#f0fdf4" : "#fffbeb", border: `1px solid ${isStrength ? "#86efac" : "#fde68a"}`, borderLeft: `4px solid ${isStrength ? "#16a34a" : "#d97706"}`, borderRadius: 10, padding: "12px 14px" }}><span style={{ background: isStrength ? "#dcfce7" : "#fef3c7", color: isStrength ? "#15803d" : "#b45309", fontSize: 10, fontWeight: 700, fontFamily: "monospace", textTransform: "uppercase", padding: "2px 8px", borderRadius: 4 }}>{c.type}</span><p style={{ margin: "8px 0 0", fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{c.text}</p></div>; })}
                </div>
              </div>
              <div style={{ background: "white", border: "1px solid #DDD6FE", borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #EDE9FE", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>💡</div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Lessons for Next Time</span>
                </div>
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {summary.lessons.map((l, i) => <div key={i} style={{ borderLeft: "4px solid #6D28D9", background: "#F5F3FF", borderRadius: "0 10px 10px 0", padding: "12px 14px" }}><p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13, color: "#4C1D95" }}>{l.title}</p><p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{l.text}</p></div>)}
                </div>
              </div>
              <div style={{ background: "white", border: "1px solid #DDD6FE", borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #EDE9FE", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🚀</div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Prep for Next Meeting</span>
                </div>
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {summary.next_meeting_prep.map((n, i) => <div key={i} style={{ display: "flex", gap: 12 }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: "#6D28D9", flexShrink: 0, marginTop: 6 }} /><p style={{ margin: 0, fontSize: 13.5, color: "#374151", lineHeight: 1.6 }}>{n.action}</p></div>)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Consent Modal */}
      {showConsentModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "white", borderRadius: 16, padding: "32px", maxWidth: 480, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.2)", animation: "slideIn 0.2s ease" }}>
            <div style={{ width: 48, height: 48, background: "#F5F3FF", border: "1px solid #C4B5FD", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginBottom: 16 }}>🎙️</div>
            <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#3B0764" }}>Before you start listening</h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6b7280", lineHeight: 1.7 }}>Unmute will listen to your meeting audio in real time. Please confirm:</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {["🔒 Audio is processed in real time and never recorded or stored", "⚖️ I am responsible for complying with local recording consent laws", "👥 I will inform meeting participants where required", "🤖 Suggestions are AI-generated — use with professional judgement"].map((item, i) => (
                <div key={i} style={{ background: "#F5F3FF", border: "1px solid #EDE9FE", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#374151" }}>{item}</div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowConsentModal(false)} style={{ flex: 1, background: "white", border: "1px solid #DDD6FE", color: "#6b7280", borderRadius: 9, padding: "11px", fontSize: 13, fontWeight: 600 }}>Cancel</button>
              <button onClick={() => { setSessionConsentGiven(true); setShowConsentModal(false); startListening(); }} style={{ flex: 2, background: "#6D28D9", border: "none", color: "white", borderRadius: 9, padding: "11px", fontSize: 13, fontWeight: 600, boxShadow: "0 2px 8px rgba(109,40,217,0.3)" }}>✓ Confirm & Start Listening</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
