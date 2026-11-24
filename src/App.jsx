import { useState, useEffect, useRef, useCallback } from "react";
import { meetingAudioSupported, micTranscriptionSupported, getMicStream, pickMeetingAudio, stopStream, streamIsLive, MeetingTranscriber, formatTranscript } from "./meetingAudio.js";

// ── API ────────────────────────────────────────────────────────────────────
async function callModel(model, maxTokens, prompt, fallback) {
  const res = await authedFetch("/api/chat", {
    method: "POST",
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || data?.error || `API error ${res.status}`);
  return (data.content?.find(b => b.type === "text")?.text || fallback).replace(/```json|```/g, "").trim();
}

const callClaudeFast = (prompt) => callModel("claude-haiku-4-5-20251001", 600, prompt, "[]");
const callClaude = (prompt) => callModel("claude-sonnet-4-6", 1200, prompt, "[]");
// Higher token limit for summaries (long transcripts need room)
const callClaudeLong = (prompt) => callModel("claude-sonnet-4-6", 3000, prompt, "{}");

// Resilient JSON parse — tolerates truncated responses by repairing/extracting
function safeParse(raw) {
  try { return JSON.parse(raw); } catch (e) {}
  // Try to extract the largest valid JSON object/array substring
  const firstBrace = raw.search(/[\{\[]/);
  if (firstBrace === -1) throw new Error("No JSON found");
  let sliced = raw.slice(firstBrace);
  // Attempt to close common truncations by trimming to last complete element
  for (let end = sliced.length; end > 0; end--) {
    const candidate = sliced.slice(0, end);
    try { return JSON.parse(candidate); } catch (e) {}
    // Try closing dangling brackets/braces
    const opens = (candidate.match(/[\{\[]/g) || []).length;
    const closes = (candidate.match(/[\}\]]/g) || []).length;
    if (opens > closes) {
      let repaired = candidate.replace(/,\s*$/, "");
      repaired += "]}".repeat(1);
      try { return JSON.parse(repaired); } catch (e) {}
    }
  }
  throw new Error("Could not parse JSON");
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

// ── SESSION TOKENS ─────────────────────────────────────────────────────────
// Supabase access tokens expire after ~1 hour. These helpers refresh them
// automatically so long meetings don't start failing mid-call.
function tokenExpiresSoon(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return !payload.exp || payload.exp * 1000 - Date.now() < 60000;
  } catch { return true; }
}

async function refreshSession() {
  const refreshToken = localStorage.getItem("unmute_refresh_token");
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.access_token) return null;
    localStorage.setItem("unmute_access_token", data.access_token);
    if (data.refresh_token) localStorage.setItem("unmute_refresh_token", data.refresh_token);
    return data.access_token;
  } catch { return null; }
}

let refreshInFlight = null;
async function getAccessToken() {
  const token = localStorage.getItem("unmute_access_token");
  if (token && !tokenExpiresSoon(token)) return token;
  if (!refreshInFlight) refreshInFlight = refreshSession().finally(() => { refreshInFlight = null; });
  return (await refreshInFlight) || token;
}

// fetch() for our own /api endpoints, with the signed-in user's token attached
async function authedFetch(url, options = {}) {
  const token = await getAccessToken();
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    },
  });
}

// ── EMAIL AUTH (Supabase) ──────────────────────────────────────────────────
function authRedirect() {
  return window.location.hostname === "localhost" ? "http://localhost:3000" : "https://app.meetunmute.com";
}

function storeSession(data) {
  localStorage.setItem("unmute_access_token", data.access_token);
  if (data.refresh_token) localStorage.setItem("unmute_refresh_token", data.refresh_token);
}

function friendlyAuthError(data, fallback) {
  const raw = data?.msg || data?.error_description || data?.message || data?.error || "";
  if (/invalid login credentials/i.test(raw)) return "That email and password don't match. Try again or reset your password.";
  if (/email not confirmed/i.test(raw)) return "Please confirm your email first. Check your inbox for the link we sent.";
  if (/already registered|already exists/i.test(raw)) return "There's already an account with that email. Try signing in instead.";
  if (/rate limit|too many/i.test(raw)) return "Too many attempts. Please wait a few minutes and try again.";
  if (/password/i.test(raw) && /(short|least|weak)/i.test(raw)) return "Please choose a stronger password (at least 8 characters).";
  return raw || fallback;
}

async function supabaseAuthPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// Returns { signedIn: true } if the account is usable straight away,
// or { signedIn: false } if a confirmation email was sent.
async function signUpWithEmail(name, email, password) {
  const { ok, data } = await supabaseAuthPost(`/signup?redirect_to=${encodeURIComponent(authRedirect())}`, {
    email, password, data: { name },
  });
  if (!ok) throw new Error(friendlyAuthError(data, "Could not create your account. Please try again."));
  if (data.access_token) { storeSession(data); return { signedIn: true }; }
  return { signedIn: false };
}

async function signInWithEmail(email, password) {
  const { ok, data } = await supabaseAuthPost("/token?grant_type=password", { email, password });
  if (!ok || !data.access_token) throw new Error(friendlyAuthError(data, "Could not sign you in. Please try again."));
  storeSession(data);
}

async function sendPasswordReset(email) {
  const { ok, data } = await supabaseAuthPost(`/recover?redirect_to=${encodeURIComponent(authRedirect())}`, { email });
  if (!ok) throw new Error(friendlyAuthError(data, "Could not send the reset email. Please try again."));
}

async function updatePassword(password) {
  const token = await getAccessToken();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyAuthError(data, "Could not update your password. Please try again."));
}

// Live Industry Pulse: real, recent news found by web search (see api/pulse.js)
async function fetchIndustryPulse(profile, topic, goal) {
  const res = await authedFetch("/api/pulse", {
    method: "POST",
    body: JSON.stringify({ topic, goal, role: profile.role, company: profile.company, platforms: profile.platforms, expertise: profile.expertise }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.items) || data.items.length === 0) throw new Error(data.error || "No recent news found.");
  return data.items;
}

// Short-lived Deepgram token for live transcription (mic and meeting audio)
async function getTranscriptionToken() {
  const res = await authedFetch("/api/stt-token", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error || "Could not start live transcription.");
  return data.access_token;
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
  let token = await getAccessToken();
  if (!token) return null;
  try {
    let data = await supabaseRequest("/auth/v1/user", {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!data.id) {
      // Token rejected — try once with a refreshed token before giving up
      token = await refreshSession();
      if (!token) return null;
      data = await supabaseRequest("/auth/v1/user", {
        headers: { "Authorization": `Bearer ${token}` },
      });
    }
    if (data.id) return { user: data, access_token: token };
    return null;
  } catch { return null; }
}

// Handles the links in confirmation / password-reset emails, which land on the
// app with the session (or an error) in the URL hash.
function handleAuthCallback() {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return {};
  const params = new URLSearchParams(hash.substring(1));
  const clearHash = () => window.history.replaceState({}, document.title, window.location.pathname);
  const error = params.get("error_description") || params.get("error");
  if (error) {
    clearHash();
    return { error: /expired|invalid/i.test(error) ? "That link has expired or was already used. Please request a new one." : error.replace(/\+/g, " ") };
  }
  const accessToken = params.get("access_token");
  if (accessToken) {
    storeSession({ access_token: accessToken, refresh_token: params.get("refresh_token") });
    clearHash();
    return { type: params.get("type") };
  }
  return {};
}

async function saveProfile(userId, profile) {
  try {
    await authedFetch("/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "upsert_profile", userId, profile }),
    });
  } catch(e) { console.error("Save profile error:", e); }
}

// How often live suggestions are requested (see triggerDebounced in MeetingApp)
// Live mode: ideas & questions refresh at most every ~20s; talking points are
// slower still (see TALKING_POINTS_TIMING) so the screen stays readable.
const SUGGESTION_TIMING = {
  live:      { quietMs: 5000, maxWaitMs: 25000, minGapMs: 20000 },
  boardroom: { quietMs: 4000, maxWaitMs: 12000, minGapMs: 8000 },
};

const TALKING_POINTS_TIMING = {
  minGapMs: 60000,     // never more often than once a minute
  minNewWords: 60,     // ...and only after a meaningful amount of new conversation
  firstAfterWords: 40, // first set once there's enough to understand the topic
};

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
function profileBackground(profile) {
  return [
    `Role: ${profile.role}${profile.company ? " at " + profile.company : ""}`,
    profile.expertise?.length ? `Expertise: ${profile.expertise.join(", ")}` : "",
    profile.platforms?.length ? `Platforms they know deeply: ${profile.platforms.join(", ")}` : "",
    profile.jobContext ? `Their work: ${profile.jobContext}` : "",
    profile.typicalAudience ? `Who they usually meet with: ${profile.typicalAudience}` : "",
    profile.meetingObjective ? `What they want from meetings: ${profile.meetingObjective}` : "",
  ].filter(Boolean).join("\n");
}

// Deep, slow-changing talking points that let the user add real value
function buildTalkingPointsPrompt(profile, transcript, goal, language, prepContext, previous) {
  const translateNote = language.code !== "en-US" ? `The conversation may be in ${language.label}. Understand it in the original language, but write in English.` : "";
  const speakerNote = transcript.includes("Them: ") ? `"You:" lines are ${profile.name || "the user"}; "Them:" lines are the other people.` : "";
  const prev = previous?.topic ? `\nCURRENT TALKING POINTS ON SCREEN (topic: "${previous.topic}"):\n${previous.points.map(p => "- " + p.headline).join("\n")}\n` : "";

  return `You are a senior advisor sitting beside ${profile.name || "a marketing professional"} in a live meeting. Your job: help them make a contribution that shows real depth and moves the discussion forward.

WHO THEY ARE (lean on this, it's what makes their contribution credible):
${profileBackground(profile)}
${goal ? "Their goal for this meeting: " + goal : ""}
${prepContext ? "Planned agenda: " + prepContext : ""}

CONVERSATION SO FAR (most recent last):
"""
${transcript}
"""
${speakerNote}
${translateNote}
${prev}
THINK FIRST (don't output this): What is actually being discussed? What is the underlying question, tension or decision behind it? What does the room seem to be missing that someone with their experience would know?

THEN write 2 talking points that:
- Get to the core of the issue, not surface-level observations or generic tips.
- Draw directly on their role, expertise and platforms. This is what lets THEM add value others in the room can't.
- Are substantive: a framework, a trade-off, a lesson from their domain, a reframe, or a concrete recommendation.
- Never invent statistics or claims about their company's own data or results.

${previous?.topic ? `If the discussion is still on the same topic and the current talking points are still the right ones, respond with exactly {"changed": false}. Only replace them when the conversation has genuinely moved on or you have clearly better points.` : ""}

Respond ONLY with JSON:
{"changed": true, "topic": "what's being discussed, max 8 words", "points": [
  {"headline": "the point in max 10 words", "detail": "2-3 sentences they could actually say, in natural spoken English", "angle": "max 15 words: why this lands coming from them (tie to their experience)"},
  {"headline": "...", "detail": "...", "angle": "..."}
]}`;
}

// Quick ideas and questions that can change more often
function buildQuickPrompt(profile, transcript, language, topic, avoid) {
  const translateNote = language.code !== "en-US" ? `The conversation may be in ${language.label}; write in English.` : "";
  const speakerNote = transcript.includes("Them: ") ? `"You:" lines are ${profile.name || "the user"}; "Them:" lines are the other people.` : "";
  return `You help ${profile.role}${profile.company ? " at " + profile.company : ""} during a live meeting${topic ? ` about "${topic}"` : ""}.

LATEST CONVERSATION (most recent last):
"""
${transcript}
"""
${speakerNote}
${translateNote}

Give 2 quick IDEAS (a suggestion, angle or example they could raise) and 2 QUESTIONS (smart questions they could ask the room), all about what was JUST discussed.
- Short: ideas max 22 words, questions max 18 words. Natural spoken English.
- No invented statistics.
${avoid.length ? `- Don't repeat or rephrase any of these already shown:\n${avoid.map(a => "  • " + a).join("\n")}` : ""}

Respond ONLY with JSON: {"ideas": ["...", "..."], "questions": ["...", "..."]}`;
}

function buildPrepPrompt(profile, topic, attendees, goal, concerns, data) {
  const styleGuide = { "data-driven": "Evidence-led, but only cite numbers that are provided below or are well-known public facts.", "strategic": "Focus on big picture and long-term.", "collaborative": "Build consensus, acknowledge others.", "direct": "Short and assertive — no hedging.", "diplomatic": "Tactful, avoid friction.", "adaptive": "Vary by who is in the room." }[profile.communicationStyle] || "Be confident and clear.";

  return `You are preparing a marketing professional for a meeting. Write a quick-glance brief they can scan in 30 seconds before and during the call: headlines and reminders, not an essay.

WHO THEY ARE:
${profile.name}, ${profile.role}${profile.company ? " at " + profile.company : ""}
${profile.platforms?.length ? "Works with: " + profile.platforms.join(", ") : ""}
${profile.expertise?.length ? "Expertise: " + profile.expertise.join(", ") : ""}
${profile.jobContext ? "Background: " + profile.jobContext : ""}
Style: ${styleGuide}

THE MEETING:
Topic: ${topic}
${goal ? "Their goal: " + goal : ""}
${attendees ? "Attendees: " + attendees : ""}
${concerns ? "Expected concerns: " + concerns : ""}
${data ? "Facts / data they provided: " + data : ""}

HOW TO WRITE IT:
- Headlines, not detail. Each point is a reminder of what matters: max 15 words, one line.
- Keep it broad and balanced. Cover the whole topic; don't go deep on one sub-area. If the topic has several themes, touch each.
- NEVER invent statistics, percentages, benchmarks or claims about their company's own data or performance. Only use numbers from "Facts / data they provided". Otherwise speak qualitatively.
- Industry Pulse comes first: 3 notable, real developments in marketing, advertising or measurement relevant to this meeting and their platforms. Only include things you are confident actually happened; avoid exact dates unless certain. One line each, saying what changed and why it matters.

Respond ONLY with a JSON array in exactly this order:
[
  { "type": "Industry Pulse", "points": ["...", "...", "..."], "note": "open with one of these" },
  { "type": "Key Messages", "points": ["...", "...", "..."], "note": "the 3 things to land" },
  { "type": "Questions to Ask", "points": ["...", "..."], "note": "to steer the discussion" },
  { "type": "Watch-outs", "points": ["Likely pushback → short response", "..."], "note": "be ready for these" },
  { "type": "Close / Ask", "points": ["..."], "note": "end on this" }
]`;
}


// ── BOARDROOM PROMPT — expertise radar, not talking points ─────────────────
function buildBoardroomPrompt(profile, transcript, alreadyCovered) {
  return `You are an expert co-pilot listening to a live meeting on behalf of one specific person. Your job is NOT to tell them what to say. Your job is to spot moments where the discussion touches THEIR area of deep expertise, and give them substance.

THE PERSON YOU SERVE:
Name: ${profile.name}
Role: ${profile.role}${profile.company ? " at " + profile.company : ""}
${profile.company ? "Company: Use what you know about " + profile.company + " — their product, industry, business model, and likely priorities." : ""}
Deep expertise: ${profile.expertise.join(", ")}
${profile.platforms && profile.platforms.length ? "Platforms/tools they work with daily: " + profile.platforms.join(", ") : ""}
${profile.jobContext ? "What they actually do: " + profile.jobContext : ""}

RECENT CONVERSATION (verbatim):
"${transcript}"

${alreadyCovered && alreadyCovered.length ? `ALREADY SURFACED (do not repeat these topics): ${alreadyCovered.join(" | ")}` : ""}

YOUR TASK:
Scan the conversation for specific things that intersect with this person's expertise — a technology, a proposal, an integration, a metric, a claim, a requirement, a vendor ask, a technical term. For each one that genuinely matters to them, produce a card.

Card types:
- "Explain" — a technical concept, product, or requirement was mentioned. Explain what it actually involves at a level useful to an EXPERT, not a beginner. Include concrete specifics: requirements, implications, how it works, what it typically entails.
- "Ask" — a sharp, specific question they could put to the room that only someone with their expertise would think to ask. Must be pointed and concrete, not generic.
- "Matters" — why what was just said has consequences for their company, their measurement, their budget, their roadmap, or their risk.

ABSOLUTE RULES:
1. Every card MUST include a "trigger" field quoting the actual words from the conversation that prompted it. If you cannot quote a real trigger, do not create the card.
2. Only surface things inside or adjacent to their stated expertise. If the conversation is about something outside their domain, return fewer cards or an empty array.
3. Return an EMPTY ARRAY [] if nothing in this segment genuinely touches their expertise. Silence is better than noise. Do NOT invent relevance.
4. Write for an expert. Assume they already know the fundamentals of their own field. Give them the specific detail, not the textbook definition.
5. Maximum 3 cards. Often 1 or 2 is correct. Often zero is correct.
6. "text" should be 1-3 punchy sentences. Concrete over vague.

Respond ONLY with a JSON array, no markdown:
[
  { "type": "Explain", "trigger": "exact words from the conversation", "title": "Short label", "text": "The substance." },
  { "type": "Ask", "trigger": "exact words", "title": "Short label", "text": "The question to ask." }
]`;
}

function buildSummaryPrompt(profile, transcript, goal, prepTopic, prepAttendees, pins = []) {
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
${pins.length ? "Items the user PINNED during the meeting as important (make sure the summary and follow-ups reflect these):\n" + pins.map(p => `- [${p.kind}] ${p.text}`).join("\n") : ""}
Goal: ${goal || "Not specified"}

TRANSCRIPT:
"${formatTranscript(transcript)}"

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
  "Key Messages":    { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8" },
  "Questions to Ask":{ border: "#0891b2", bg: "#ecfeff", badge: "#cffafe", badgeText: "#0e7490" },
  "Watch-outs":      { border: "#d97706", bg: "#fffbeb", badge: "#fef3c7", badgeText: "#b45309" },
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
  const textToCopy = item.points ? "• " + item.points.map((pt, i) => item.sources?.[i]?.url ? `${pt} (${item.sources[i].url})` : pt).join("\n• ") : item.text;
  const copy = () => { navigator.clipboard.writeText(textToCopy); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div style={{ background: s.bg, border: "1px solid #e5e7eb", borderLeft: `4px solid ${s.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10, animation: `slideIn 0.25s ease ${index * 0.06}s both`, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <span style={{ background: s.badge, color: s.badgeText, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", fontFamily: "monospace", padding: "2px 8px", borderRadius: 4 }}>{item.type}</span>
        {item.type === "Industry Pulse" && (
          <span style={{ fontSize: 10, color: item.pulseState === "fallback" ? "#9ca3af" : "#7c3aed", fontFamily: "monospace" }} title={item.pulseError || ""}>
            {item.pulseState === "loading" ? "🔎 searching today's news…" : item.pulseState === "live" ? "🔎 live news" : item.pulseState === "fallback" ? "AI knowledge, may be dated" : "⚡ latest trends"}
          </span>
        )}
        <button onClick={copy} style={{ marginLeft: "auto", background: "white", border: "1px solid #d1d5db", color: "#6b7280", borderRadius: 5, padding: "2px 9px", fontSize: 11, cursor: "pointer", fontFamily: "monospace" }}>{copied ? "✓ Copied" : "Copy"}</button>
      </div>
      {item.points ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
          {item.points.map((pt, i) => (
            <li key={i} style={{ color: "#1f2937", fontSize: 13, lineHeight: 1.55, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 500, opacity: item.pulseState === "loading" ? 0.45 : 1 }}>
              {pt}
              {item.sources?.[i]?.url && (
                <a href={item.sources[i].url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginLeft: 6, fontSize: 11, color: "#7c3aed", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
                  {item.sources[i].label || "source"} ↗
                </a>
              )}
            </li>
          ))}
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

// Isolated skill input so typing doesn't re-render the whole onboarding tree
function SkillAdder({ onAdd }) {
  const [val, setVal] = useState("");
  const add = () => { const t = val.trim(); if (!t) return; onAdd(t); setVal(""); };
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        placeholder="Add your own skill…"
        style={{ flex: 1, background: "white", border: "1px solid #DDD6FE", borderRadius: 8, color: "#1E1033", padding: "9px 12px", fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      />
      <button onClick={add} style={{ background: "#6D28D9", color: "white", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Add</button>
    </div>
  );
}

// ── MEETING SETUP GUIDE (onboarding + live screen) ───────────────────────
const SETUP_GUIDES = {
  meet: {
    label: "Google Meet",
    icon: "🟢",
    intro: "Google Meet always runs in your browser, so it works straight away.",
    sections: [
      {
        title: "In Chrome",
        steps: [
          "Join your Meet call in a Chrome tab.",
          "Open Unmute in a separate tab or window, go to Live and press Start Listening.",
          "Click 🔊 Hear the meeting.",
          "In Chrome's share window, open the Chrome tab section and pick your Meet tab.",
          "Make sure \"Also share tab audio\" is switched on, then click Share.",
        ],
      },
    ],
  },
  zoom: {
    label: "Zoom",
    icon: "🔵",
    intro: "Easiest in the browser. The Zoom desktop app also works on Windows.",
    sections: [
      {
        title: "Zoom in the browser (recommended)",
        steps: [
          "Open the Zoom invite link. If the Zoom app tries to open, cancel it and click \"Join from your browser\".",
          "In Unmute, go to Live, press Start Listening, then click 🔊 Hear the meeting.",
          "Pick the Zoom tab and switch on \"Also share tab audio\", then click Share.",
        ],
      },
      {
        title: "Zoom desktop app (Windows)",
        steps: [
          "In Unmute, press Start Listening, then click 🔊 Hear the meeting.",
          "Choose \"Entire screen\" and switch on \"Also share system audio\", then click Share.",
        ],
        note: "On a Mac, Chrome usually can't share system audio from desktop apps. Join from your browser instead.",
      },
    ],
  },
  teams: {
    label: "Microsoft Teams",
    icon: "🟣",
    intro: "Easiest in the browser. The Teams desktop app also works on Windows.",
    sections: [
      {
        title: "Teams in the browser (recommended)",
        steps: [
          "Open the Teams meeting link and choose \"Continue on this browser\" (or use teams.microsoft.com in Chrome).",
          "In Unmute, go to Live, press Start Listening, then click 🔊 Hear the meeting.",
          "Pick the Teams tab and switch on \"Also share tab audio\", then click Share.",
        ],
      },
      {
        title: "Teams desktop app (Windows)",
        steps: [
          "In Unmute, press Start Listening, then click 🔊 Hear the meeting.",
          "Choose \"Entire screen\" and switch on \"Also share system audio\", then click Share.",
        ],
        note: "On a Mac, Chrome usually can't share system audio from desktop apps. Join from your browser instead.",
      },
    ],
  },
};

const SETUP_TIPS = [
  { icon: "🎧", text: "Wear headphones. Otherwise your microphone also picks up the other people and some lines may appear twice." },
  { icon: "✅", text: "You'll know it's working when the green \"Hearing the meeting\" badge shows and lines marked THEM appear in the live transcript." },
  { icon: "⏹", text: "Clicking \"Stop sharing\" in Chrome's bar stops Unmute hearing the meeting. Click 🔊 Hear the meeting to reconnect." },
  { icon: "💻", text: "Use Chrome on a laptop or desktop. On your phone, use Boardroom mode for in-person meetings." },
];

function MeetingSetupGuide() {
  const [tab, setTab] = useState("meet");
  const guide = SETUP_GUIDES[tab];
  return (
    <div style={{ textAlign: "left" }}>
      <div style={{ display: "flex", gap: 6, background: "#F5F3FF", borderRadius: 10, padding: 4, marginBottom: 16 }}>
        {Object.entries(SETUP_GUIDES).map(([key, g]) => (
          <button key={key} onClick={() => setTab(key)} style={{ flex: 1, background: tab === key ? "white" : "transparent", border: "none", borderRadius: 8, padding: "9px 6px", fontSize: 13, fontWeight: tab === key ? 700 : 500, color: tab === key ? "#3B0764" : "#7C6BA8", boxShadow: tab === key ? "0 1px 4px rgba(59,7,100,0.12)" : "none", cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", whiteSpace: "nowrap" }}>
            <span style={{ marginRight: 5 }}>{g.icon}</span>{g.label}
          </button>
        ))}
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>{guide.intro}</p>
      {guide.sections.map((sec, i) => (
        <div key={i} style={{ border: "1px solid #EDE9FE", borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#3B0764", marginBottom: 10 }}>{sec.title}</div>
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {sec.steps.map((st, j) => (
              <li key={j} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: j === sec.steps.length - 1 ? 0 : 8 }}>
                <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: "50%", background: "#6D28D9", color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{j + 1}</span>
                <span style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{st}</span>
              </li>
            ))}
          </ol>
          {sec.note && <div style={{ marginTop: 10, fontSize: 12.5, color: "#6b7280", lineHeight: 1.55, background: "#F9FAFB", borderRadius: 8, padding: "8px 10px" }}>🍎 {sec.note}</div>}
        </div>
      ))}
      <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "12px 16px", marginTop: 4 }}>
        {SETUP_TIPS.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 10, fontSize: 12.5, color: "#78350F", lineHeight: 1.55, marginBottom: i === SETUP_TIPS.length - 1 ? 0 : 7 }}>
            <span style={{ flexShrink: 0 }}>{t.icon}</span><span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SetupGuideModal({ onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,16,51,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 200 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 18, padding: "28px 30px", width: "100%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 12px 48px rgba(59,7,100,0.3)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Use Unmute in your calls</h2>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "#F5F3FF", border: "none", borderRadius: 8, width: 30, height: 30, fontSize: 16, color: "#6D28D9", cursor: "pointer" }}>×</button>
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>Unmute hears you through your microphone. To hear the other people too, share your meeting's audio once at the start of each call.</p>
        <MeetingSetupGuide />
      </div>
    </div>
  );
}

function AccountMenu({ name, role, onGuide, onEditProfile, onSignOut }) {
  const [open, setOpen] = useState(false);
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const item = { display: "block", width: "100%", textAlign: "left", background: "white", border: "none", padding: "10px 16px", fontSize: 13, color: "#374151", cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" };
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button onClick={() => setOpen(o => !o)} title={`${name} · ${role}`} aria-label="Account menu" style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.2)", color: "white", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>{initial}</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }} />
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", background: "white", border: "1px solid #DDD6FE", borderRadius: 12, overflow: "hidden", zIndex: 100, minWidth: 220, boxShadow: "0 8px 32px rgba(59,7,100,0.2)" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #F3F0FF" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#1E1033" }}>{name}</div>
              <div style={{ fontSize: 12, color: "#9B8FC0" }}>{role}</div>
            </div>
            <button style={item} onClick={() => { setOpen(false); onGuide(); }}>🎧 How to use in Zoom, Meet & Teams</button>
            <button style={item} onClick={() => { setOpen(false); onEditProfile(); }}>✏️ Edit profile</button>
            <button style={{ ...item, color: "#B91C1C", borderTop: "1px solid #F3F0FF" }} onClick={() => { setOpen(false); onSignOut(); }}>Sign out</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── ONBOARDING ─────────────────────────────────────────────────────────────
function Onboarding({ onComplete, initialName = "" }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({ ...DEFAULT_PROFILE, name: initialName });
  const [consentGiven, setConsentGiven] = useState(false);
  const totalSteps = 10;

  const update = (key, val) => setProfile(p => ({ ...p, [key]: val }));

  const togglePlatform = (id) => setProfile(p => ({ ...p, platforms: p.platforms.includes(id) ? p.platforms.filter(x => x !== id) : [...p.platforms, id] }));
  const toggleSkill = (skill) => setProfile(p => ({ ...p, expertise: p.expertise.includes(skill) ? p.expertise.filter(s => s !== skill) : [...p.expertise, skill] }));

  const selectRole = (r) => setProfile(p => ({ ...p, roleId: r.id, role: r.label, expertise: [...r.skills] }));

  const canNext = () => {
    if (step === 1) return profile.name.trim() && profile.role.trim();
    if (step === 2) return profile.roleId !== "";
    if (step === 3) return profile.platforms.length > 0;
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
    const phase = step <= 3 ? "Setting up your profile…" : step <= 6 ? "Personalising your suggestions…" : step === 8 ? "Using Unmute in your calls…" : "Almost ready…";
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
            <SkillAdder onAdd={(skill) => { if (!profile.expertise.includes(skill)) setProfile(p => ({ ...p, expertise: [...p.expertise, skill] })); }} />
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

        {/* Step 8 — Using Unmute with Meet / Zoom / Teams */}
        {step === 8 && (
          <Card>
            <Progress />
            <H2>Using Unmute in your calls</H2>
            <Sub>Unmute hears you through your microphone. To hear the other people too, you share your meeting's audio once at the start of each call. Pick the app you use most. You can find this guide again later in the menu at the top right.</Sub>
            <MeetingSetupGuide />
            <NavButtons disabled={false} />
          </Card>
        )}

        {/* Step 9 — Tutorial + Consent */}
        {step === 9 && (
          <Card>
            <Progress />
            <h2 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>How it works</h2>
            <p style={{ margin: "0 0 22px", color: "#6b7280", fontSize: 14 }}>A quick guide before you jump in.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 8 }}>
              {[
                { icon: "⚙", color: "#2563eb", bg: "#eff6ff", title: "Before the call — Prep tab", desc: "Enter the meeting topic, who is on the call, and your goal. Click Generate and get a full brief — talking points, industry pulse, likely objections, and your close." },
                { icon: "●", color: "#6D28D9", bg: "#F5F3FF", title: "During the call — Live tab", desc: "Open Unmute alongside your Zoom, Meet or Teams call. Click Start Listening, then 🔊 Hear the meeting so Unmute hears everyone. AI suggestions appear in real time as people speak — platform-aware and tailored to you." },
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
const authInput = { width: "100%", border: "1.5px solid #DDD6FE", borderRadius: 10, padding: "12px 14px", fontSize: 14, color: "#1E1033", fontFamily: "'Plus Jakarta Sans', sans-serif", outline: "none", background: "white" };
const authLabel = { display: "block", fontSize: 12, fontWeight: 600, color: "#5B21B6", margin: "0 0 6px" };
const authPrimary = (busy) => ({ width: "100%", background: busy ? "#A78BFA" : "#6D28D9", border: "none", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", color: "white", fontFamily: "'Plus Jakarta Sans', sans-serif", boxShadow: "0 4px 14px rgba(109,40,217,0.25)", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 });
const authLink = { background: "none", border: "none", padding: 0, color: "#6D28D9", fontWeight: 600, cursor: "pointer", fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif" };

function AuthShell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 60%, #E0D9F5 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@700;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box}
        .auth-input:focus{border-color:#7C3AED !important; box-shadow:0 0 0 3px rgba(124,58,237,0.12)}
      `}</style>
      <div style={{ background: "white", borderRadius: 20, padding: "40px 40px 32px", maxWidth: 440, width: "100%", textAlign: "center", boxShadow: "0 8px 40px rgba(109,40,217,0.12)", animation: "slideIn 0.3s ease" }}>
        <div style={{ width: 64, height: 64, background: "#3B0764", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 18px", boxShadow: "0 4px 20px rgba(59,7,100,0.35)" }}>📣</div>
        <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 28, fontWeight: 900, color: "#3B0764", margin: "0 0 6px", letterSpacing: "-0.02em" }}>Unmute</h1>
        <p style={{ color: "#9B8FC0", fontSize: 13, margin: "0 0 24px", fontStyle: "italic" }}>for Marketers</p>
        {children}
      </div>
    </div>
  );
}

function AuthMessage({ kind, children }) {
  if (!children) return null;
  const err = kind === "error";
  return <div style={{ background: err ? "#FEF2F2" : "#F0FDF4", border: `1px solid ${err ? "#FCA5A5" : "#86EFAC"}`, color: err ? "#B91C1C" : "#166534", borderRadius: 10, padding: "10px 12px", fontSize: 13, lineHeight: 1.5, textAlign: "left", marginBottom: 14 }}>{children}</div>;
}

function Spinner() {
  return <div style={{ width: 18, height: 18, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />;
}

function AuthScreen({ initialError = "" }) {
  const [mode, setMode] = useState("signup"); // signup | signin | forgot | checkEmail | resetSent
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  const switchTo = (m) => { setMode(m); setError(""); setPassword(""); };
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const cleanEmail = email.trim().toLowerCase();
    if (mode === "signup" && !name.trim()) return setError("Please enter your name.");
    if (!validEmail) return setError("Please enter a valid email address.");
    if (mode !== "forgot" && password.length < 8) return setError("Your password needs at least 8 characters.");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { signedIn } = await signUpWithEmail(name.trim(), cleanEmail, password);
        if (signedIn) { window.location.reload(); return; }
        setMode("checkEmail");
      } else if (mode === "signin") {
        await signInWithEmail(cleanEmail, password);
        window.location.reload();
        return;
      } else if (mode === "forgot") {
        await sendPasswordReset(cleanEmail);
        setMode("resetSent");
      }
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  if (mode === "checkEmail" || mode === "resetSent") {
    return (
      <AuthShell>
        <div style={{ fontSize: 36, marginBottom: 10 }}>✉️</div>
        <h2 style={{ fontSize: 18, color: "#3B0764", margin: "0 0 10px" }}>Check your email</h2>
        <p style={{ color: "#6b7280", fontSize: 14, lineHeight: 1.6, margin: "0 0 22px" }}>
          {mode === "checkEmail"
            ? <>We've sent a confirmation link to <strong style={{ color: "#3B0764" }}>{email.trim()}</strong>. Click it to activate your account and you'll be taken straight into Unmute.</>
            : <>If there's an account for <strong style={{ color: "#3B0764" }}>{email.trim()}</strong>, we've sent a link to reset your password.</>}
        </p>
        <p style={{ color: "#9B8FC0", fontSize: 12, margin: "0 0 18px" }}>Can't see it? Check your spam folder.</p>
        <button style={authLink} onClick={() => switchTo("signin")}>Back to sign in</button>
      </AuthShell>
    );
  }

  const titles = {
    signup: ["Create your account", "Real-time talking points for every Zoom, Meet and Teams call, tailored to your marketing role."],
    signin: ["Welcome back", "Sign in to your Unmute account."],
    forgot: ["Reset your password", "Enter your email and we'll send you a link to choose a new password."],
  };
  const buttonText = { signup: "Create account", signin: "Sign in", forgot: "Send reset link" }[mode];

  return (
    <AuthShell>
      <h2 style={{ fontSize: 18, color: "#3B0764", margin: "0 0 6px" }}>{titles[mode][0]}</h2>
      <p style={{ color: "#6b7280", fontSize: 13, lineHeight: 1.6, margin: "0 0 22px" }}>{titles[mode][1]}</p>
      <AuthMessage kind="error">{error}</AuthMessage>
      <form onSubmit={submit} noValidate style={{ textAlign: "left" }}>
        {mode === "signup" && (
          <div style={{ marginBottom: 14 }}>
            <label style={authLabel} htmlFor="auth-name">Name</label>
            <input id="auth-name" className="auth-input" style={authInput} value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Your full name" />
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <label style={authLabel} htmlFor="auth-email">Work email</label>
          <input id="auth-email" className="auth-input" style={authInput} type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" />
        </div>
        {mode !== "forgot" && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <label style={authLabel} htmlFor="auth-password">Password</label>
              {mode === "signin" && <button type="button" style={{ ...authLink, fontSize: 12, fontWeight: 500 }} onClick={() => switchTo("forgot")}>Forgot password?</button>}
            </div>
            <input id="auth-password" className="auth-input" style={authInput} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} />
          </div>
        )}
        <button type="submit" disabled={busy} style={authPrimary(busy)}>
          {busy && <Spinner />}{busy ? "Please wait…" : buttonText}
        </button>
      </form>

      <p style={{ fontSize: 13, color: "#6b7280", margin: "18px 0 0" }}>
        {mode === "signup" && <>Already have an account? <button style={authLink} onClick={() => switchTo("signin")}>Sign in</button></>}
        {mode === "signin" && <>New to Unmute? <button style={authLink} onClick={() => switchTo("signup")}>Create an account</button></>}
        {mode === "forgot" && <button style={authLink} onClick={() => switchTo("signin")}>Back to sign in</button>}
      </p>

      {mode === "signup" && (
        <p style={{ fontSize: 11, color: "#A78BFA", lineHeight: 1.6, margin: "16px 0 0" }}>
          By creating an account you agree to our <a href="https://meetunmute.com/terms.html" target="_blank" rel="noreferrer" style={{ color: "#6D28D9" }}>Terms</a> and <a href="https://meetunmute.com/privacy.html" target="_blank" rel="noreferrer" style={{ color: "#6D28D9" }}>Privacy Policy</a>. Audio is never recorded or stored.
        </p>
      )}
    </AuthShell>
  );
}

// Shown when someone arrives from a "reset your password" email
function SetNewPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("Your password needs at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try { await updatePassword(password); onDone(); }
    catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <AuthShell>
      <h2 style={{ fontSize: 18, color: "#3B0764", margin: "0 0 6px" }}>Choose a new password</h2>
      <p style={{ color: "#6b7280", fontSize: 13, lineHeight: 1.6, margin: "0 0 22px" }}>You'll use this to sign in from now on.</p>
      <AuthMessage kind="error">{error}</AuthMessage>
      <form onSubmit={submit} noValidate style={{ textAlign: "left" }}>
        <div style={{ marginBottom: 14 }}>
          <label style={authLabel} htmlFor="new-password">New password</label>
          <input id="new-password" className="auth-input" style={authInput} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={authLabel} htmlFor="confirm-password">Confirm new password</label>
          <input id="confirm-password" className="auth-input" style={authInput} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" placeholder="Type it again" />
        </div>
        <button type="submit" disabled={busy} style={authPrimary(busy)}>
          {busy && <Spinner />}{busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </AuthShell>
  );
}

// ── LIVE SESSION: meeting audio button + transcript ──────────────────────
function MeetingAudioControl(props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
      <MeetingAudioButton {...props} />
      <button onClick={props.onHelp} title="How to use Unmute with Zoom, Meet or Teams" style={{ background: "none", border: "none", color: "#6D28D9", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 0, whiteSpace: "nowrap", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>How?</button>
    </div>
  );
}

function MeetingAudioButton({ status, isListening, onConnect, onDisconnect }) {
  const chip = { display: "flex", alignItems: "center", gap: 7, borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", fontFamily: "'Plus Jakarta Sans', sans-serif" };
  if (status === "connected") {
    return (
      <div style={{ ...chip, background: "#DCFCE7", border: "1px solid #86EFAC", color: "#166534" }} title="Unmute is transcribing the other people on the call">
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#16a34a", animation: "pulse 2s infinite" }} />
        Hearing the meeting
        <button onClick={onDisconnect} style={{ background: "none", border: "none", color: "#166534", cursor: "pointer", fontSize: 12, padding: 0, marginLeft: 2, textDecoration: "underline" }}>Stop</button>
      </div>
    );
  }
  if (status === "picking" || status === "connecting") {
    return <div style={{ ...chip, background: "#EDE9FE", border: "1px solid #C4B5FD", color: "#5B21B6" }}>{status === "picking" ? "Choose your meeting tab…" : "Connecting to meeting audio…"}</div>;
  }
  if (status === "paused") {
    return <div style={{ ...chip, background: "#F3F4F6", border: "1px solid #D1D5DB", color: "#4B5563" }} title="Resumes when you press Start Listening">Meeting audio paused</div>;
  }
  return (
    <button
      onClick={onConnect}
      disabled={!isListening}
      title={isListening ? "Pick your Zoom, Meet or Teams tab so Unmute can hear the other people" : "Start listening first"}
      style={{ ...chip, background: isListening ? "#6D28D9" : "#EDE9FE", border: `1px solid ${isListening ? "#6D28D9" : "#DDD6FE"}`, color: isListening ? "white" : "#A78BFA", cursor: isListening ? "pointer" : "not-allowed" }}
    >
      🔊 Hear the meeting
    </button>
  );
}

function LiveTranscript({ entries, scrollRef, isListening, meetingAudioOn }) {
  const [open, setOpen] = useState(true);
  const recent = entries.slice(-40);
  return (
    <div style={{ background: "white", borderTop: "1px solid #DDD6FE", flexShrink: 0 }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "#FAFAFF", border: "none", borderBottom: open ? "1px solid #EDE9FE" : "none", padding: "7px 22px", cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <span style={{ fontSize: 11, color: "#6D28D9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>Live transcript</span>
        <span style={{ fontSize: 11, color: "#9B8FC0" }}>{meetingAudioOn ? "You + the meeting" : "Your microphone only"}</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#A78BFA" }}>{open ? "Hide ▾" : "Show ▸"}</span>
      </button>
      {open && (
        <div ref={scrollRef} style={{ maxHeight: 120, overflowY: "auto", padding: "8px 22px 10px", fontSize: 12.5, lineHeight: 1.55 }}>
          {recent.length === 0
            ? <div style={{ color: "#C4B5FD", fontStyle: "italic" }}>{isListening ? "Listening… what's said will appear here." : "Press Start Listening to begin."}</div>
            : recent.map(e => (
              <div key={e.id} style={{ display: "flex", gap: 8, marginBottom: 2 }}>
                <span style={{ flexShrink: 0, width: 40, fontSize: 10.5, fontWeight: 700, color: e.speaker === "them" ? "#B45309" : "#6D28D9", fontFamily: "monospace", paddingTop: 2 }}>{e.speaker === "them" ? "THEM" : "YOU"}</span>
                <span style={{ color: "#1E1033" }}>{e.text}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ── LIVE BOARD COMPONENTS ─────────────────────────────────────────────────
const panelHeader = { padding: "10px 18px", borderBottom: "1px solid #EDE9FE", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, background: "white" };
const panelTitle = { fontSize: 11, color: "#5B21B6", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 };
const smallBtn = { background: "#F5F3FF", border: "1px solid #DDD6FE", color: "#6D28D9", borderRadius: 7, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", whiteSpace: "nowrap" };
const timeLabel = (d) => d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

function Spin({ color = "#7C3AED" }) {
  return <div style={{ width: 12, height: 12, border: `2px solid ${color}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />;
}

function PinButton({ pinned, onClick }) {
  return (
    <button onClick={onClick} disabled={pinned} title={pinned ? "Pinned" : "Pin to your board"} aria-label={pinned ? "Pinned" : "Pin"}
      style={{ background: pinned ? "#FEF3C7" : "white", border: `1px solid ${pinned ? "#FCD34D" : "#E5E7EB"}`, borderRadius: 7, padding: "3px 8px", fontSize: 12, cursor: pinned ? "default" : "pointer", flexShrink: 0, color: pinned ? "#92400E" : "#6b7280", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      📌{pinned ? " Pinned" : ""}
    </button>
  );
}

function PendingNote({ show, what }) {
  if (!show) return null;
  return <div style={{ margin: "0 0 10px", background: "#EDE9FE", color: "#5B21B6", fontSize: 11.5, fontWeight: 600, borderRadius: 8, padding: "6px 10px" }}>New {what} ready. They'll appear when you move your mouse away.</div>;
}

function TalkingPointsPanel({ talking, loading, isListening, hasTranscript, pending, onHover, onRefresh, onPin, pinnedTexts }) {
  return (
    <div onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ textAlign: "left", background: "#FAFAFF", borderRight: "1px solid #DDD6FE", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={panelHeader}>
        <span style={{ fontSize: 14 }}>🎯</span>
        <span style={panelTitle}>Talking points</span>
        {loading && <Spin />}
        {talking?.at && <span style={{ fontSize: 10.5, color: "#A78BFA" }}>updated {timeLabel(talking.at)}</span>}
        <button onClick={onRefresh} disabled={!hasTranscript || loading} style={{ ...smallBtn, marginLeft: "auto", opacity: !hasTranscript || loading ? 0.5 : 1 }}>↻ New points</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
        <PendingNote show={pending} what="talking points" />
        {talking?.topic && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#3B0764", color: "white", borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 600, marginBottom: 14 }}>
            <span style={{ opacity: 0.7, fontWeight: 500 }}>Now discussing:</span> {talking.topic}
          </div>
        )}
        {!talking && (
          <div style={{ color: "#A78BFA", fontSize: 13, textAlign: "center", paddingTop: 40, lineHeight: 1.7 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🎯</div>
            {loading ? "Understanding the conversation…" : isListening ? "Your talking points will appear once Unmute understands what's being discussed (usually within a minute)." : "Press Start Listening to begin."}
          </div>
        )}
        {talking?.points.map((pt, i) => (
          <div key={pt.id || i} style={{ background: "white", border: "1px solid #E9E5FB", borderLeft: "4px solid #6D28D9", borderRadius: 12, padding: "16px 18px", marginBottom: 14, boxShadow: "0 1px 4px rgba(59,7,100,0.06)", animation: "slideIn 0.3s ease both" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#1E1033", lineHeight: 1.35, flex: 1 }}>{pt.headline}</div>
              <PinButton pinned={pinnedTexts.includes(`${pt.headline}: ${pt.detail}`)} onClick={() => onPin(pt)} />
            </div>
            <p style={{ margin: 0, fontSize: 14, color: "#374151", lineHeight: 1.65 }}>{pt.detail}</p>
            {pt.angle && <div style={{ marginTop: 10, fontSize: 12, color: "#6D28D9", background: "#F5F3FF", borderRadius: 8, padding: "6px 10px", lineHeight: 1.5 }}>Your angle: {pt.angle}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickPanel({ title, icon, accent, kind, items, at, loading, pending, onHover, onRefresh, onPin, pinnedTexts, hasTranscript }) {
  return (
    <div onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ textAlign: "left", display: "flex", flexDirection: "column", minHeight: 0, borderBottom: kind === "Idea" ? "1px solid #DDD6FE" : "none", background: "#F5F3FF" }}>
      <div style={panelHeader}>
        <span style={{ fontSize: 13 }}>{icon}</span>
        <span style={{ ...panelTitle, color: accent }}>{title}</span>
        {loading && <Spin color={accent} />}
        {at && <span style={{ fontSize: 10.5, color: "#A78BFA" }}>{timeLabel(at)}</span>}
        {kind === "Idea" && <button onClick={onRefresh} disabled={!hasTranscript || loading} style={{ ...smallBtn, marginLeft: "auto", opacity: !hasTranscript || loading ? 0.5 : 1 }}>↻ Refresh</button>}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        <PendingNote show={pending} what={kind === "Idea" ? "ideas" : "questions"} />
        {items.length === 0 && <div style={{ color: "#C4B5FD", fontSize: 12, fontStyle: "italic", textAlign: "center", paddingTop: 16 }}>{kind === "Idea" ? "Ideas" : "Questions"} will appear as people talk.</div>}
        {items.map((t, i) => (
          <div key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "white", border: "1px solid #E9E5FB", borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: "11px 12px", marginBottom: 9, animation: `slideIn 0.25s ease ${i * 0.05}s both` }}>
            <span style={{ flex: 1, fontSize: 13.5, color: "#1F2937", lineHeight: 1.55 }}>{t}</span>
            <PinButton pinned={pinnedTexts.includes(t)} onClick={() => onPin(t)} />
          </div>
        ))}
      </div>
    </div>
  );
}

const PIN_COLORS = { "Idea": "#FEF9C3", "Question": "#CFFAFE", "Talking point": "#EDE9FE" };
const PIN_TILTS = [-1.2, 0.8, -0.5, 1.1, -0.9, 0.4];

function PinBoard({ pins, onUnpin }) {
  return (
    <div style={{ textAlign: "left", background: "#FFFDF5", display: "flex", flexDirection: "column", minHeight: 0, borderLeft: "1px solid #F3E8C9" }}>
      <div style={{ ...panelHeader, background: "#FFFBEB", borderBottom: "1px solid #F3E8C9" }}>
        <span style={{ fontSize: 13 }}>📌</span>
        <span style={{ ...panelTitle, color: "#92400E" }}>Pinned</span>
        {pins.length > 0 && <span style={{ marginLeft: "auto", background: "#FEF3C7", color: "#92400E", fontSize: 10.5, fontWeight: 700, borderRadius: 10, padding: "1px 8px" }}>{pins.length}</span>}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 20px" }}>
        {pins.length === 0 && (
          <div style={{ color: "#B45309", opacity: 0.7, fontSize: 12.5, textAlign: "center", paddingTop: 24, lineHeight: 1.7 }}>
            Click 📌 on any idea, question or talking point to keep it here for later in the meeting.
          </div>
        )}
        {pins.map((p, i) => (
          <div key={p.id} style={{ position: "relative", background: PIN_COLORS[p.kind] || "#FEF9C3", borderRadius: 4, padding: "12px 12px 10px", marginBottom: 14, boxShadow: "0 3px 8px rgba(120,53,15,0.12)", transform: `rotate(${PIN_TILTS[i % PIN_TILTS.length]}deg)` }}>
            <button onClick={() => onUnpin(p.id)} title="Unpin" aria-label="Unpin" style={{ position: "absolute", top: 4, right: 6, background: "none", border: "none", fontSize: 15, color: "#92400E", cursor: "pointer", opacity: 0.6, lineHeight: 1 }}>×</button>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#78350F", opacity: 0.75, marginBottom: 5 }}>{p.kind} · {timeLabel(p.at)}</div>
            <div style={{ fontSize: 13, color: "#1F2937", lineHeight: 1.5, paddingRight: 10 }}>{p.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BriefDrawer({ points, onClose, onGoToPrep }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,16,51,0.3)", zIndex: 150 }}>
      <div onClick={e => e.stopPropagation()} style={{ textAlign: "left", position: "absolute", top: 0, left: 0, bottom: 0, width: "min(460px, 92vw)", background: "white", boxShadow: "8px 0 32px rgba(59,7,100,0.2)", display: "flex", flexDirection: "column", animation: "slideIn 0.2s ease" }}>
        <div style={{ ...panelHeader, padding: "14px 18px" }}>
          <span style={{ fontSize: 14 }}>📝</span>
          <span style={panelTitle}>Pre-meeting brief</span>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "#F5F3FF", border: "none", borderRadius: 8, width: 28, height: 28, fontSize: 15, color: "#6D28D9", cursor: "pointer" }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {points.length === 0
            ? <div style={{ color: "#A78BFA", fontSize: 13, textAlign: "center", paddingTop: 30, lineHeight: 1.7 }}>No brief yet.<br /><button onClick={onGoToPrep} style={{ ...smallBtn, marginTop: 10 }}>Go to Prep</button></div>
            : points.map((p, i) => <SuggestionCard key={i} item={p} index={i} showNote={true} />)}
        </div>
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
  const [authError, setAuthError] = useState("");
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    async function init() {
      // Handle links from confirmation / password-reset emails
      const callback = handleAuthCallback();
      if (callback.error) setAuthError(callback.error);
      if (callback.type === "recovery") setRecovering(true);

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

  if (!user) return <AuthScreen initialError={authError} />;
  if (recovering) return <SetNewPasswordScreen onDone={() => setRecovering(false)} />;
  if (!onboarded) return <Onboarding onComplete={handleOnboardingComplete} initialName={user.user_metadata?.name || ""} />;
  return <MeetingApp profile={profile} user={user} onEditProfile={() => { localStorage.removeItem("unmute_mkt_onboarded"); window.location.reload(); }} />;
}

// ── MEETING APP ────────────────────────────────────────────────────────────
function MeetingApp({ profile, user, onEditProfile }) {
  const [mode, setMode] = useState("hub");
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 820);
  const [viewWidth, setViewWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1440);
  const [showGuide, setShowGuide] = useState(false);
  const shouldListenRef = useRef(false);
  const [language, setLanguage] = useState(profile.language || LANGUAGES[0]);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [sessionConsentGiven, setSessionConsentGiven] = useState(false);
  const [boardroomMode, setBoardroomMode] = useState(false);
  const [boardroomCards, setBoardroomCards] = useState([]);
  const [pinnedCards, setPinnedCards] = useState([]);
  const coveredRef = useRef([]);

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
  // Live board: deep talking points (slow), quick ideas & questions, pinned notes
  const [talking, setTalking] = useState(null);         // { topic, points: [{headline, detail, angle}], at }
  const [talkingLoading, setTalkingLoading] = useState(false);
  const [quick, setQuick] = useState({ ideas: [], questions: [], at: null });
  const [quickLoading, setQuickLoading] = useState(false);
  const [pins, setPins] = useState(() => { try { return JSON.parse(localStorage.getItem("unmute_pins") || "[]"); } catch { return []; } });
  const [showBrief, setShowBrief] = useState(false);
  const [pendingFlags, setPendingFlags] = useState({ talking: false, quick: false });
  const hoverRef = useRef({ talking: false, quick: false });
  const pendingRef = useRef({ talking: null, quick: null });
  const talkingRef = useRef(null);
  const quickRef = useRef({ ideas: [], questions: [] });
  const pinsRef = useRef([]);
  const talkingInFlightRef = useRef(false);
  const talkingMetaRef = useRef({ lastAt: 0, lastLen: 0 });
  const [liveStatus, setLiveStatus] = useState("idle");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [liveError, setLiveError] = useState("");
  const [meetingAudioStatus, setMeetingAudioStatus] = useState("off"); // off | picking | connecting | connected | error
  const meetingStreamRef = useRef(null);
  const meetingTranscriberRef = useRef(null);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  const recognitionRef = useRef(null);
  const micStreamRef = useRef(null);
  const micTranscriberRef = useRef(null);
  const transcriptRef = useRef([]);
  const debounceRef = useRef(null);
  const runFetchRef = useRef(null);
  const timingRef = useRef(SUGGESTION_TIMING.live);
  const scheduleRef = useRef(() => {});
  const inFlightRef = useRef(false);
  const rerunRef = useRef(false);
  const lastSentLenRef = useRef(0);
  const lastFiredAtRef = useRef(0);
  const firstPendingAtRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    const onResize = () => { setIsMobile(window.innerWidth < 820); setViewWidth(window.innerWidth); };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => { window.removeEventListener("resize", onResize); window.removeEventListener("orientationchange", onResize); };
  }, []);

  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [transcript]);

  const prepRunRef = useRef(0);
  const generatePrep = async () => {
    if (!prepTopic.trim()) { setPrepError("Please enter a meeting topic."); return; }
    const run = ++prepRunRef.current;
    setPrepLoading(true); setPrepError("");
    // Start the live news search straight away; it's slower than the brief
    const pulsePromise = fetchIndustryPulse(profile, prepTopic, prepGoal);
    pulsePromise.catch(() => {}); // handled below
    try {
      const raw = await callClaude(buildPrepPrompt(profile, prepTopic, prepAttendees, prepGoal, prepConcerns, prepData));
      if (run !== prepRunRef.current) return;
      const cards = safeParse(raw).map(c => c.type === "Industry Pulse" ? { ...c, pulseState: "loading" } : c);
      setPrepPoints(cards);
      if (prepGoal) setSessionGoal(prepGoal);
    } catch (e) {
      if (run === prepRunRef.current) { setPrepError("Error generating brief. Try again."); setPrepLoading(false); }
      console.error(e); return;
    }
    setPrepLoading(false);

    // Swap in the live news when it arrives; fall back to the AI's own pulse if search fails
    try {
      const items = await pulsePromise;
      if (run !== prepRunRef.current) return;
      setPrepPoints(prev => prev.map(c => c.type !== "Industry Pulse" ? c : {
        ...c,
        pulseState: "live",
        points: items.map(i => i.why ? `${i.headline} — ${i.why}` : i.headline),
        sources: items.map(i => ({ label: [i.source, i.date].filter(Boolean).join(", "), url: i.url })),
        note: "open with one of these",
      }));
    } catch (e) {
      if (run !== prepRunRef.current) return;
      console.warn("Industry Pulse search failed:", e.message);
      setPrepPoints(prev => prev.map(c => c.type === "Industry Pulse" ? { ...c, pulseState: "fallback", pulseError: e.message } : c));
    }
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

  // ── Live board updates ──────────────────────────────────────────────────
  useEffect(() => { talkingRef.current = talking; }, [talking]);
  useEffect(() => { quickRef.current = quick; }, [quick]);
  useEffect(() => { pinsRef.current = pins; try { localStorage.setItem("unmute_pins", JSON.stringify(pins)); } catch { /* storage full/blocked */ } }, [pins]);

  // Don't change a panel while the user is reading it (mouse over it): hold the
  // update and apply it when they move away.
  const applyOrHold = (panel, apply) => {
    if (hoverRef.current[panel]) {
      pendingRef.current[panel] = apply;
      setPendingFlags(f => ({ ...f, [panel]: true }));
    } else apply();
  };
  const setHover = (panel, on) => {
    hoverRef.current[panel] = on;
    if (!on && pendingRef.current[panel]) {
      const apply = pendingRef.current[panel];
      pendingRef.current[panel] = null;
      setPendingFlags(f => ({ ...f, [panel]: false }));
      apply();
    }
  };

  const wordCount = (entries) => entries.reduce((n, e) => n + e.text.split(/\s+/).filter(Boolean).length, 0);

  const fetchTalkingPoints = useCallback(async ({ force = false } = {}) => {
    if (talkingInFlightRef.current) return;
    const all = transcriptRef.current;
    if (wordCount(all) < 15) return;
    talkingInFlightRef.current = true;
    talkingMetaRef.current = { lastAt: Date.now(), lastLen: all.length };
    setTalkingLoading(true);
    try {
      const prepContext = prepTopic ? `${prepTopic}${prepGoal ? ". Goal: " + prepGoal : ""}` : "";
      const previous = force ? null : talkingRef.current;
      const raw = await callClaude(buildTalkingPointsPrompt(profile, formatTranscript(all.slice(-40)), sessionGoal, language, prepContext, previous));
      const data = safeParse(raw);
      if (data && data.changed !== false && Array.isArray(data.points) && data.points.length) {
        const next = { topic: data.topic || "", points: data.points.slice(0, 2).map(p => ({ ...p, id: Date.now() + Math.random() })), at: new Date() };
        applyOrHold("talking", () => setTalking(next));
      } else if (talkingRef.current) {
        applyOrHold("talking", () => setTalking(t => t ? { ...t, at: new Date() } : t));
      }
    } catch (e) { console.error("Talking points error:", e); }
    talkingInFlightRef.current = false;
    setTalkingLoading(false);
  }, [profile, sessionGoal, language, prepTopic, prepGoal]);

  const fetchQuick = useCallback(async () => {
    const recent = formatTranscript(transcriptRef.current.slice(-15));
    if (recent.trim().length < 20) return;
    setQuickLoading(true); setLiveStatus("thinking");
    try {
      const avoid = [...quickRef.current.ideas, ...quickRef.current.questions, ...pinsRef.current.map(p => p.text)].slice(-14);
      const raw = await callClaudeFast(buildQuickPrompt(profile, recent, language, talkingRef.current?.topic, avoid));
      const data = safeParse(raw);
      if (data && (data.ideas?.length || data.questions?.length)) {
        const next = { ideas: (data.ideas || []).slice(0, 2), questions: (data.questions || []).slice(0, 2), at: new Date() };
        applyOrHold("quick", () => setQuick(next));
        setLastUpdated(new Date());
      }
      setLiveStatus("listening");
    } catch (e) { console.error(e); setLiveStatus("error"); setLiveError("Could not fetch suggestions."); }
    setQuickLoading(false);
  }, [profile, language]);

  // One "round" of live updates: quick ideas/questions every time, deep talking
  // points only when enough time AND enough new conversation has passed.
  const fetchLiveSuggestions = useCallback(async () => {
    const all = transcriptRef.current;
    const { lastAt, lastLen } = talkingMetaRef.current;
    const newWords = wordCount(all.slice(lastLen));
    const due = !talkingRef.current
      ? wordCount(all) >= TALKING_POINTS_TIMING.firstAfterWords
      : Date.now() - lastAt >= TALKING_POINTS_TIMING.minGapMs && newWords >= TALKING_POINTS_TIMING.minNewWords;
    if (due) fetchTalkingPoints();
    await fetchQuick();
  }, [fetchQuick, fetchTalkingPoints]);

  const pinItem = (kind, text, extra = {}) => {
    setPins(prev => prev.some(p => p.text === text) ? prev : [{ id: Date.now() + Math.random(), kind, text, at: new Date().toISOString(), ...extra }, ...prev]);
  };
  const unpinItem = (id) => setPins(prev => prev.filter(p => p.id !== id));

  const fetchBoardroomCards = useCallback(async () => {
    const recent = formatTranscript(transcriptRef.current.slice(-25));
    if (recent.trim().length < 40) return;
    setLiveStatus("thinking");
    try {
      const raw = await callClaudeFast(buildBoardroomPrompt(profile, recent, coveredRef.current.slice(-8)));
      const cards = safeParse(raw);
      if (Array.isArray(cards) && cards.length > 0) {
        const stamped = cards.map(c => ({ ...c, id: Date.now() + Math.random(), at: new Date() }));
        coveredRef.current = [...coveredRef.current, ...cards.map(c => c.title)].slice(-12);
        setBoardroomCards(prev => [...stamped, ...prev].slice(0, 20));
      }
      setLastUpdated(new Date());
      setLiveStatus("listening");
    } catch (e) { console.error(e); setLiveStatus("listening"); }
  }, [profile]);

  // ── Suggestion timing ──────────────────────────────────────────────────
  // Old behaviour: wait for 12s of silence (each new sentence reset the timer),
  // so in a busy meeting suggestions only arrived after the moment had passed.
  // New behaviour: fire after a short pause, OR at least every few seconds while
  // people keep talking. Only one request runs at a time; if speech arrives while
  // one is in flight, another runs as soon as it finishes.

  const fireSuggestions = useCallback(async () => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    if (inFlightRef.current) { rerunRef.current = true; return; }
    const len = transcriptRef.current.length;
    if (len === lastSentLenRef.current) return; // nothing new since last request
    inFlightRef.current = true;
    lastFiredAtRef.current = Date.now();
    firstPendingAtRef.current = null;
    lastSentLenRef.current = len;
    try { await runFetchRef.current(); }
    finally {
      inFlightRef.current = false;
      if (rerunRef.current) { rerunRef.current = false; scheduleRef.current(); }
    }
  }, []);

  const triggerDebounced = useCallback(() => {
    const now = Date.now();
    const { quietMs, maxWaitMs, minGapMs } = timingRef.current;
    if (!firstPendingAtRef.current) firstPendingAtRef.current = now;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const untilMaxWait = Math.max(0, maxWaitMs - (now - firstPendingAtRef.current));
    const untilMinGap = Math.max(0, minGapMs - (now - lastFiredAtRef.current));
    const wait = Math.max(Math.min(quietMs, untilMaxWait), untilMinGap);
    debounceRef.current = setTimeout(fireSuggestions, wait);
  }, [fireSuggestions]);

  // Keep refs pointing at the latest functions/timing so the speech handler
  // (created once when listening starts) always uses the current mode.
  useEffect(() => {
    runFetchRef.current = boardroomMode ? fetchBoardroomCards : fetchLiveSuggestions;
    timingRef.current = boardroomMode ? SUGGESTION_TIMING.boardroom : SUGGESTION_TIMING.live;
    scheduleRef.current = triggerDebounced;
  }, [boardroomMode, fetchBoardroomCards, fetchLiveSuggestions, triggerDebounced]);

  // ── Meeting audio (the other people on the call) ──────────────────────
  const stopMeetingTranscriber = () => {
    if (meetingTranscriberRef.current) { meetingTranscriberRef.current.stop(); meetingTranscriberRef.current = null; }
  };

  const startMeetingTranscriber = useCallback((stream) => {
    if (meetingTranscriberRef.current) meetingTranscriberRef.current.stop();
    const transcriber = new MeetingTranscriber({
      stream,
      languageCode: language.code,
      getToken: getTranscriptionToken,
      onFinal: (text) => {
        const entry = { id: Date.now() + Math.random(), text, speaker: "them" };
        transcriptRef.current = [...transcriptRef.current, entry];
        setTranscript(prev => [...prev, entry]);
        scheduleRef.current();
      },
      onStatus: (status, message) => {
        if (meetingTranscriberRef.current !== transcriber) return;
        setMeetingAudioStatus(status);
        if (status === "error") setLiveError(message);
      },
    });
    meetingTranscriberRef.current = transcriber;
    transcriber.start();
  }, [language]);

  const disconnectMeetingAudio = useCallback(() => {
    stopMeetingTranscriber();
    stopStream(meetingStreamRef.current);
    meetingStreamRef.current = null;
    setMeetingAudioStatus("off");
  }, []);

  const connectMeetingAudio = async () => {
    setLiveError("");
    setMeetingAudioStatus("picking");
    try {
      const stream = await pickMeetingAudio();
      stopStream(meetingStreamRef.current);
      meetingStreamRef.current = stream;
      // If the user clicks Chrome's "Stop sharing", switch meeting audio off
      stream.getTracks().forEach(t => t.addEventListener("ended", () => {
        if (meetingStreamRef.current === stream) disconnectMeetingAudio();
      }));
      startMeetingTranscriber(stream);
    } catch (err) {
      setMeetingAudioStatus("off");
      if (err?.message === "NO_AUDIO") {
        setLiveError("No audio was shared. Click \"Hear the meeting\" again, pick your meeting tab and switch on \"Also share tab audio\".");
      } else if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
        setLiveError("Couldn't connect to the meeting audio. Please try again.");
      }
    }
  };

  // Stop everything when leaving the page
  useEffect(() => () => {
    stopMeetingTranscriber(); stopStream(meetingStreamRef.current);
    if (micTranscriberRef.current) micTranscriberRef.current.stop();
    stopStream(micStreamRef.current);
  }, []);

  const pauseListening = () => {
    stopMeetingTranscriber(); // keep the shared tab so Start resumes without re-picking
    if (streamIsLive(meetingStreamRef.current)) setMeetingAudioStatus("paused");
    shouldListenRef.current = false;
    stopMic();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsListening(false);
    setLiveStatus("idle");
  };

  const togglePin = (card) => {
    setPinnedCards(prev => prev.some(p => p.id === card.id)
      ? prev.filter(p => p.id !== card.id)
      : [card, ...prev]);
  };

  // ── Microphone ──────────────────────────────────────────────────────────
  // Preferred: stream the mic to Deepgram (accurate, good with Hebrew/Arabic,
  // doesn't depend on Chrome's Google speech servers). Fallback: Chrome's
  // built-in Web Speech API, which now reconnects itself after network blips.
  const addMicEntry = (text) => {
    const entry = { id: Date.now() + Math.random(), text, speaker: "you" };
    transcriptRef.current = [...transcriptRef.current, entry];
    setTranscript(prev => [...prev, entry]);
    scheduleRef.current();
  };

  const stopMic = () => {
    if (micTranscriberRef.current) { const t = micTranscriberRef.current; micTranscriberRef.current = null; t.stop(); }
    stopStream(micStreamRef.current); micStreamRef.current = null;
    if (recognitionRef.current) { recognitionRef.current.onend = null; recognitionRef.current.stop(); recognitionRef.current = null; }
  };

  const startWebSpeech = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setLiveError("Your browser doesn't support voice recognition. Please use Chrome."); setLiveStatus("error"); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = language.code;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          const text = e.results[i][0].transcript.trim();
          if (text && text !== "-") addMicEntry(text);
        }
      }
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "network") { setLiveError("Microphone connection dropped. Reconnecting…"); return; } // onend restarts it
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setLiveError("Unmute can't use your microphone. Allow microphone access in Chrome's address bar and try again.");
        setLiveStatus("error");
        return;
      }
      setLiveError(`Microphone problem (${e.error}). Reconnecting…`);
    };
    r.onstart = () => setLiveError(prev => (prev.startsWith("Microphone connection dropped") || prev.startsWith("Microphone problem")) ? "" : prev);
    r.onend = () => {
      // Only restart if we are genuinely still meant to be listening.
      // Prevents a runaway restart loop (which causes repeated Android chimes).
      if (shouldListenRef.current && recognitionRef.current === r) {
        setTimeout(() => { if (shouldListenRef.current && recognitionRef.current === r) { try { r.start(); } catch { /* already started */ } } }, 600);
      }
    };
    recognitionRef.current = r;
    try { r.start(); } catch { /* already started */ }
  }, [language]);

  const startListening = useCallback(async () => {
    shouldListenRef.current = true;
    setIsListening(true); setLiveStatus("listening"); setLiveError("");

    let usingDeepgram = false;
    if (micTranscriptionSupported()) {
      try {
        const micStream = await getMicStream();
        if (!shouldListenRef.current) { stopStream(micStream); return; }
        micStreamRef.current = micStream;
        const transcriber = new MeetingTranscriber({
          stream: micStream,
          languageCode: language.code,
          getToken: getTranscriptionToken,
          retryHint: "Switched to Chrome's built-in speech recognition.",
          onFinal: addMicEntry,
          onStatus: (status, message) => {
            if (micTranscriberRef.current !== transcriber) return;
            if (status === "error") {
              // Couldn't use Deepgram for the mic: fall back so the user still gets suggestions
              micTranscriberRef.current = null;
              stopStream(micStreamRef.current); micStreamRef.current = null;
              setLiveError(`${message} Using Chrome's built-in speech recognition for your microphone instead.`);
              if (shouldListenRef.current) startWebSpeech();
            }
          },
        });
        micTranscriberRef.current = transcriber;
        transcriber.start();
        usingDeepgram = true;
      } catch (err) {
        if (err?.name === "NotAllowedError") {
          shouldListenRef.current = false;
          setIsListening(false); setLiveStatus("error");
          setLiveError("Unmute can't use your microphone. Allow microphone access in Chrome's address bar and try again.");
          return;
        }
      }
    }
    if (!usingDeepgram) startWebSpeech();
    if (streamIsLive(meetingStreamRef.current) && !meetingTranscriberRef.current) startMeetingTranscriber(meetingStreamRef.current);
  }, [language, startMeetingTranscriber, startWebSpeech]);

  const endMeeting = useCallback(() => {
    shouldListenRef.current = false;
    disconnectMeetingAudio();
    stopMic();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsListening(false); setLiveStatus("idle");
    if (transcriptRef.current.length > 0) {
      setMode("summary"); setSummary(null); setSummaryLoading(true); setSummaryError("");
      callClaudeLong(buildSummaryPrompt(profile, transcriptRef.current, sessionGoal, prepTopic, prepAttendees))
        .then(raw => { setSummary(safeParse(raw)); setSummaryLoading(false); })
        .catch(e => { console.error(e); setSummaryError("Error generating summary. Please try again."); setSummaryLoading(false); });
    }
  }, [profile, sessionGoal, prepTopic, prepAttendees, disconnectMeetingAudio]);

  const generateSummary = async () => {
    if (transcript.length === 0) { setSummaryError("No transcript yet — run a live session first."); return; }
    setSummaryLoading(true); setSummaryError("");
    try { const raw = await callClaudeLong(buildSummaryPrompt(profile, transcript, sessionGoal, prepTopic, prepAttendees, pins)); setSummary(safeParse(raw)); } catch (e) { setSummaryError("Error generating summary. Please try again."); console.error(e); }
    setSummaryLoading(false);
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim(); setChatInput("");
    setChatHistory(prev => [...prev, { role: "user", text: userMsg }]);
    setChatLoading(true);
    try {
      const recentTranscript = formatTranscript(transcriptRef.current.slice(-10));
      const historyText = chatHistory.slice(-6).map(m => `${m.role === "user" ? "You" : "AI"}: ${m.text}`).join("\n");
      const prompt = `You are a real-time AI assistant for a ${profile.role}${profile.company ? " at " + profile.company : ""} on a marketing video call.\n${profile.company ? "Draw on your knowledge of " + profile.company + " — their industry, products, competitors and business model." : ""}\nPlatforms they use: ${profile.platforms.join(", ")}\nExpertise: ${profile.expertise.join(", ")}\nRecent transcript: "${recentTranscript || "No transcript yet"}"\n${historyText ? "Chat history:\n" + historyText : ""}\n\nQuestion: ${userMsg}\n\nAnswer in 1-3 sentences. Reference platform-specific knowledge only if directly relevant. No preamble.`;
      const raw = await callClaudeFast(prompt);
      const cleanResponse = raw.replace(/^\[|\]$/g, "").replace(/^"|"$/g, "").trim();
      setChatHistory(prev => [...prev, { role: "ai", text: cleanResponse }]);
    } catch (e) { console.error(e); setChatHistory(prev => [...prev, { role: "ai", text: "Could not get a response. Try again." }]); }
    setChatLoading(false);
  };

  const clearSession = () => { transcriptRef.current = []; lastSentLenRef.current = 0; firstPendingAtRef.current = null; setTranscript([]); setTalking(null); setQuick({ ideas: [], questions: [], at: null }); setPins([]); talkingMetaRef.current = { lastAt: 0, lastLen: 0 }; setLastUpdated(null); setLiveStatus(isListening ? "listening" : "idle"); };
  const statusInfo = { idle: { color: "#9ca3af", label: "Ready" }, listening: { color: "#16a34a", label: "Listening" }, thinking: { color: "#d97706", label: "Analysing…" }, error: { color: "#dc2626", label: "Error" } };

  // ── BOARDROOM MODE — full screen, minimal, mobile-first ──────────────────
  if (boardroomMode) {
    const CARD_META = {
      Explain: { color: "#A78BFA", bg: "rgba(167,139,250,0.10)", label: "WHAT IT MEANS" },
      Ask:     { color: "#5EEAD4", bg: "rgba(94,234,212,0.10)",  label: "ASK THIS" },
      Matters: { color: "#FCD34D", bg: "rgba(252,211,77,0.10)",  label: "WHY IT MATTERS" },
    };
    const allCards = [...pinnedCards.map(c => ({ ...c, pinned: true })), ...boardroomCards.filter(c => !pinnedCards.some(p => p.id === c.id))];

    return (
      <div style={{ position: "fixed", inset: 0, background: "#0F0518", color: "white", fontFamily: "'Plus Jakarta Sans', sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
          @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}
          @keyframes spin{to{transform:rotate(360deg)}}
          @keyframes cardIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
          *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
          ::-webkit-scrollbar{width:0;display:none}
        `}</style>

        {/* Minimal bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: isListening ? (liveStatus === "thinking" ? "#FCD34D" : "#4ADE80") : "#6B7280", animation: isListening ? "pulse 2s infinite" : "none", flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: "monospace", letterSpacing: "0.06em" }}>
            {isListening ? (liveStatus === "thinking" ? "THINKING" : "LISTENING") : "PAUSED"}
          </span>
          <button
            onClick={() => { if (isListening) { pauseListening(); } else if (sessionConsentGiven) { startListening(); } else { setShowConsentModal(true); } }}
            style={{ marginLeft: "auto", background: isListening ? "rgba(255,255,255,0.07)" : "#6D28D9", border: "none", color: "white", borderRadius: 20, padding: "8px 18px", fontSize: 13, fontWeight: 600 }}
          >
            {isListening ? "Pause" : "Start"}
          </button>
          <button onClick={() => fetchBoardroomCards()} style={{ background: "rgba(255,255,255,0.07)", border: "none", color: "rgba(255,255,255,0.65)", borderRadius: 20, padding: "8px 14px", fontSize: 13 }}>↻</button>
          <button onClick={() => setBoardroomMode(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 20, padding: "0 4px", lineHeight: 1 }}>✕</button>
        </div>

        {/* Cards */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 28px", WebkitOverflowScrolling: "touch" }}>
          {allCards.length === 0 && (
            <div style={{ textAlign: "center", paddingTop: "22vh", color: "rgba(255,255,255,0.22)" }}>
              <div style={{ fontSize: 40, marginBottom: 14 }}>👂</div>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, padding: "0 24px" }}>
                {isListening
                  ? "Listening for anything in your area of expertise…"
                  : "Tap Start. Put the phone on the table."}
              </p>
            </div>
          )}

          {allCards.map((card) => {
            const meta = CARD_META[card.type] || CARD_META.Explain;
            const isPinned = pinnedCards.some(p => p.id === card.id);
            return (
              <div key={card.id} style={{ background: meta.bg, border: `1px solid ${isPinned ? meta.color : "rgba(255,255,255,0.08)"}`, borderLeft: `4px solid ${meta.color}`, borderRadius: 14, padding: "16px 16px 14px", marginBottom: 12, animation: "cardIn 0.25s ease" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: meta.color, fontFamily: "monospace" }}>{meta.label}</span>
                  <button onClick={() => togglePin(card)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 16, opacity: isPinned ? 1 : 0.28, padding: "2px 4px", lineHeight: 1 }}>📌</button>
                </div>
                {card.title && <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 7, lineHeight: 1.3 }}>{card.title}</div>}
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: "rgba(255,255,255,0.92)" }}>{card.text}</p>
                {card.trigger && (
                  <p style={{ margin: "11px 0 0", fontSize: 12, color: "rgba(255,255,255,0.32)", fontStyle: "italic", borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 9, lineHeight: 1.45 }}>
                    ↳ “{card.trigger}”
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Consent modal (boardroom) */}
        {showConsentModal && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div style={{ background: "#1A0A2E", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: 26, maxWidth: 400, width: "100%" }}>
              <div style={{ fontSize: 30, marginBottom: 12 }}>🎙️</div>
              <h3 style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 700 }}>Before you start</h3>
              <p style={{ margin: "0 0 18px", fontSize: 14, color: "rgba(255,255,255,0.6)", lineHeight: 1.65 }}>
                Audio is processed live and never recorded or stored. You are responsible for complying with local recording consent laws and informing participants where required.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setShowConsentModal(false)} style={{ flex: 1, background: "rgba(255,255,255,0.07)", border: "none", color: "rgba(255,255,255,0.6)", borderRadius: 10, padding: 13, fontSize: 14, fontWeight: 600 }}>Cancel</button>
                <button onClick={() => { setSessionConsentGiven(true); setShowConsentModal(false); startListening(); }} style={{ flex: 2, background: "#6D28D9", border: "none", color: "white", borderRadius: 10, padding: 13, fontSize: 14, fontWeight: 600 }}>Confirm & Start</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── HUB — the home screen you land on ────────────────────────────────────
  if (mode === "hub") {
    const tiles = [
      { key: "boardroom", icon: "📱", title: "Boardroom", desc: "Phone on the table. Live insight in your field.", primary: true, go: () => setBoardroomMode(true) },
      { key: "prep",      icon: "📋", title: "Prep a Meeting", desc: "Build a brief before you walk in.", go: () => setMode("prep") },
      { key: "live",      icon: "💻", title: "Desktop Live", desc: "Full split-screen view for video calls.", go: () => setMode("live") },
      { key: "summary",   icon: "📊", title: "Last Summary", desc: summary ? "View your latest debrief." : "No debrief yet.", go: () => setMode("summary") },
    ];

    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #F5F3FF 0%, #EDE9FE 100%)", fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#1E1033", padding: "0 0 40px" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@700;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
          @keyframes spin{to{transform:rotate(360deg)}}
          *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        `}</style>

        {/* Slim bar */}
        <div style={{ background: "#3B0764", padding: "14px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Fraunces', Georgia, serif", fontWeight: 700, color: "white", fontSize: 15, flexShrink: 0 }}>U</div>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 700, fontSize: 17, color: "white" }}>Unmute</div>
          <button onClick={onEditProfile} style={{ marginLeft: "auto", background: "rgba(255,255,255,0.1)", border: "none", color: "rgba(255,255,255,0.8)", borderRadius: 8, padding: "7px 12px", fontSize: 12 }}>Profile</button>
          <button onClick={signOut} style={{ background: "none", border: "none", color: "rgba(196,181,253,0.55)", fontSize: 12, padding: "7px 4px" }}>Sign out</button>
        </div>

        <div style={{ maxWidth: 620, margin: "0 auto", padding: "28px 18px 0" }}>
          <p style={{ margin: "0 0 4px", fontSize: 13, color: "#9B8FC0", fontFamily: "monospace", letterSpacing: "0.05em" }}>
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}
          </p>
          <h1 style={{ margin: "0 0 4px", fontFamily: "'Fraunces', Georgia, serif", fontSize: 30, fontWeight: 900, color: "#3B0764", letterSpacing: "-0.02em" }}>
            Hi {profile.name ? profile.name.split(" ")[0] : "there"}
          </h1>
          <p style={{ margin: "0 0 26px", fontSize: 14, color: "#6b7280" }}>{profile.role}{profile.company ? ` · ${profile.company}` : ""}</p>

          <div style={{ display: "grid", gap: 12 }}>
            {tiles.map(t => (
              <button key={t.key} onClick={t.go} style={{
                width: "100%", textAlign: "left", cursor: "pointer",
                background: t.primary ? "#3B0764" : "white",
                border: t.primary ? "none" : "1px solid #DDD6FE",
                borderRadius: 16, padding: "20px 20px",
                display: "flex", alignItems: "center", gap: 16,
                boxShadow: t.primary ? "0 8px 24px rgba(59,7,100,0.28)" : "0 1px 3px rgba(0,0,0,0.04)",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}>
                <div style={{ fontSize: 28, flexShrink: 0 }}>{t.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: t.primary ? "white" : "#3B0764", marginBottom: 3 }}>{t.title}</div>
                  <div style={{ fontSize: 13, color: t.primary ? "rgba(196,181,253,0.85)" : "#9B8FC0", lineHeight: 1.45 }}>{t.desc}</div>
                </div>
                <div style={{ fontSize: 20, color: t.primary ? "rgba(255,255,255,0.5)" : "#C4B5FD", flexShrink: 0 }}>›</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

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
      <div style={{ background: "#3B0764", padding: isMobile ? "10px 12px" : "0 22px", minHeight: 56, display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, flexShrink: 0, flexWrap: isMobile ? "wrap" : "nowrap" }}>
        <button onClick={() => setMode("hub")} style={{ background: "rgba(255,255,255,0.12)", border: "none", color: "white", borderRadius: 8, width: 34, height: 34, fontSize: 17, flexShrink: 0, lineHeight: 1 }}>‹</button>
        <div style={{ display: isMobile ? "none" : "flex", alignItems: "center", gap: 9, marginRight: 6, flexShrink: 0, whiteSpace: "nowrap" }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontFamily: "'Fraunces', Georgia, serif", fontWeight: 700, color: "white" }}>U</div>
          <div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 700, fontSize: 15, color: "white", letterSpacing: "-0.01em", lineHeight: 1.2 }}>Unmute</div>
            <div style={{ fontSize: 9, color: "rgba(196,181,253,0.8)", letterSpacing: "0.05em" }}>for Marketers</div>
          </div>
        </div>
        {profile.platforms.length > 0 && viewWidth >= 1360 && (
          <div style={{ display: "flex", gap: 4 }}>
            {profile.platforms.slice(0, 4).map((p, i) => { const pl = PLATFORMS.find(x => x.label === p); return pl ? <span key={i} title={p} style={{ fontSize: 14 }}>{pl.icon}</span> : null; })}
            {profile.platforms.length > 4 && <span style={{ fontSize: 10, color: "rgba(196,181,253,0.6)", fontFamily: "monospace" }}>+{profile.platforms.length - 4}</span>}
          </div>
        )}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.1)", borderRadius: 9, padding: 3, gap: 2, marginLeft: isMobile ? 0 : 8, flexShrink: 0 }}>
          {[{ key: "prep", label: "Prep" }, { key: "live", label: "Live" }, { key: "summary", label: "Summary" }].map(({ key, label }) => (
            <button key={key} onClick={() => setMode(key)} style={{ background: mode === key ? "rgba(255,255,255,0.18)" : "transparent", border: "none", color: mode === key ? "white" : "rgba(196,181,253,0.7)", borderRadius: 7, padding: "5px 14px", fontSize: 12, fontWeight: mode === key ? 600 : 400, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{label}</button>
          ))}
        </div>
        {mode === "live" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.1)", borderRadius: 20, padding: "4px 12px", flexShrink: 0, whiteSpace: "nowrap" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusInfo[liveStatus].color, animation: ["listening","thinking"].includes(liveStatus) ? `pulse ${liveStatus === "thinking" ? "0.6s" : "2s"} infinite` : "none" }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.9)", fontWeight: 500 }}>{statusInfo[liveStatus].label}</span>
            {lastUpdated && viewWidth >= 1200 && <span style={{ fontSize: 10, color: "rgba(196,181,253,0.6)", marginLeft: 2 }}>· {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          </div>
        )}
        <div style={{ marginLeft: "auto", position: "relative", display: isMobile ? "none" : "block", flexShrink: 0 }}>
          <button onClick={() => setShowLangMenu(p => !p)} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.9)", borderRadius: 8, padding: "5px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
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
        <button onClick={() => setBoardroomMode(true)} style={{ background: "#7C3AED", border: "none", color: "white", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, marginLeft: isMobile ? "auto" : 0, flexShrink: 0, whiteSpace: "nowrap" }}>📱 Boardroom</button>
        {mode === "live" && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={clearSession} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.7)", borderRadius: 8, padding: "5px 12px", fontSize: 12, whiteSpace: "nowrap" }}>Clear</button>
            <button onClick={isListening ? endMeeting : (sessionConsentGiven ? startListening : () => setShowConsentModal(true))} style={{ background: isListening ? "#FEE2E2" : "#EDE9FE", border: `1px solid ${isListening ? "#FCA5A5" : "#C4B5FD"}`, color: isListening ? "#DC2626" : "#6D28D9", borderRadius: 8, padding: "5px 16px", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 , whiteSpace: "nowrap", flexShrink: 0}}>
              <div style={{ width: isListening ? 8 : 9, height: isListening ? 8 : 9, borderRadius: isListening ? 2 : "50%", background: isListening ? "#DC2626" : "#6D28D9", animation: isListening ? "pulse 1.2s infinite" : "none" }} />
              {isListening ? "End Meeting" : "Start Listening"}
            </button>
          </div>
        )}
        <AccountMenu name={profile.name} role={profile.role} onGuide={() => setShowGuide(true)} onEditProfile={onEditProfile} onSignOut={signOut} />
      </div>
      {showGuide && <SetupGuideModal onClose={() => setShowGuide(false)} />}

      {/* PREP MODE */}
      {mode === "prep" && (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "420px 1fr", overflow: "auto" }}>
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
            <button onClick={() => setShowBrief(true)} title="Open your pre-meeting brief" style={{ background: "white", border: "1px solid #C4B5FD", color: "#5B21B6", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              📝 Brief{prepPoints.length ? "" : " (empty)"}
            </button>
            {!isMobile && meetingAudioSupported() && (
              <MeetingAudioControl status={meetingAudioStatus} isListening={isListening} onConnect={connectMeetingAudio} onDisconnect={disconnectMeetingAudio} onHelp={() => setShowGuide(true)} />
            )}
          </div>
          {liveError && <div style={{ background: "#fef2f2", borderBottom: "1px solid #fca5a5", padding: "8px 22px", color: "#b91c1c", fontSize: 12, flexShrink: 0 }}>⚠ {liveError}</div>}
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.35fr) minmax(0, 1fr) 280px", overflow: isMobile ? "auto" : "hidden", minHeight: 0 }}>
            <TalkingPointsPanel
              talking={talking} loading={talkingLoading} isListening={isListening} hasTranscript={transcript.length > 0}
              pending={pendingFlags.talking} onHover={on => setHover("talking", on)}
              onRefresh={() => fetchTalkingPoints({ force: true })}
              onPin={(pt) => pinItem("Talking point", `${pt.headline}: ${pt.detail}`)}
              pinnedTexts={pins.map(p => p.text)}
            />
            <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", minHeight: 0, borderRight: isMobile ? "none" : "1px solid #DDD6FE" }}>
              <QuickPanel
                title="Ideas" icon="💡" accent="#d97706" kind="Idea" items={quick.ideas} at={quick.at} loading={quickLoading}
                pending={pendingFlags.quick} onHover={on => setHover("quick", on)} onRefresh={fetchQuick}
                onPin={(t) => pinItem("Idea", t)} pinnedTexts={pins.map(p => p.text)} hasTranscript={transcript.length > 0}
              />
              <QuickPanel
                title="Questions" icon="❓" accent="#0891b2" kind="Question" items={quick.questions} at={quick.at} loading={quickLoading}
                pending={pendingFlags.quick} onHover={on => setHover("quick", on)} onRefresh={fetchQuick}
                onPin={(t) => pinItem("Question", t)} pinnedTexts={pins.map(p => p.text)} hasTranscript={transcript.length > 0}
              />
            </div>
            <PinBoard pins={pins} onUnpin={unpinItem} />
          </div>
          {showBrief && <BriefDrawer points={prepPoints} onClose={() => setShowBrief(false)} onGoToPrep={() => { setShowBrief(false); setMode("prep"); }} />}
          <LiveTranscript entries={transcript} scrollRef={scrollRef} isListening={isListening} meetingAudioOn={meetingAudioStatus === "connected"} />
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
