import { useState, useEffect, useRef, useCallback } from "react";

const API_KEY = import.meta.env.VITE_ANTHROPIC_KEY;

// ── Languages ──────────────────────────────────────────────────────────────
const LANGUAGES = [
  { label: "English", code: "en-US", flag: "🇬🇧" },
  { label: "Hebrew",  code: "he-IL", flag: "🇮🇱" },
  { label: "French",  code: "fr-FR", flag: "🇫🇷" },
  { label: "Spanish", code: "es-ES", flag: "🇪🇸" },
  { label: "Arabic",  code: "ar-SA", flag: "🇸🇦" },
  { label: "German",  code: "de-DE", flag: "🇩🇪" },
];

const MEETING_TYPES = [
  "Weekly team / standup",
  "Management / leadership meeting",
  "Client presentation",
  "Budget review",
  "Strategy planning",
  "Sales call",
  "Performance review",
  "Board meeting",
];

const ROLE_PACKS = [
  {
    id: "cmo",
    label: "CMO / Marketing Leader",
    icon: "📣",
    skills: [
      "Brand strategy", "Paid media strategy (Meta, Google)", "Campaign performance analysis",
      "Marketing ROI & budget optimisation", "Stakeholder communication", "Media Mix Modelling (MMM)",
      "Content marketing", "Social media strategy", "Go-to-market strategy", "Team leadership",
    ],
  },
  {
    id: "sales",
    label: "Sales Manager",
    icon: "🤝",
    skills: [
      "Objection handling", "Pipeline management", "Negotiation & closing",
      "CRM & lifecycle marketing", "Revenue forecasting", "Client relationship management",
      "Presentation & pitching", "Competitive positioning", "Upselling & cross-selling", "Sales strategy",
    ],
  },
  {
    id: "data",
    label: "Data / Analytics",
    icon: "📊",
    skills: [
      "Data-driven decision making", "A/B testing & experimentation", "Incrementality testing & measurement",
      "Media Mix Modelling (MMM)", "Multi-touch attribution", "Campaign performance analysis",
      "Statistical modelling", "Dashboard & reporting", "Programmatic advertising", "Marketing ROI & budget optimisation",
    ],
  },
  {
    id: "product",
    label: "Product Manager",
    icon: "🚀",
    skills: [
      "Product roadmap planning", "Stakeholder management", "User research & discovery",
      "Agile & sprint planning", "Prioritisation frameworks", "Go-to-market strategy",
      "Data-driven decision making", "Cross-functional collaboration", "OKR setting", "Presentation & pitching",
    ],
  },
  {
    id: "finance",
    label: "Finance / CFO",
    icon: "💰",
    skills: [
      "Budget planning & forecasting", "Financial modelling", "ROI & payback analysis",
      "Risk management", "Cost optimisation", "Stakeholder communication",
      "P&L management", "Investment appraisal", "Compliance & governance", "Strategic planning",
    ],
  },
  {
    id: "consultant",
    label: "Consultant",
    icon: "🏗️",
    skills: [
      "Client relationship management", "Problem solving & frameworks", "Presentation & pitching",
      "Strategic planning", "Stakeholder communication", "Workshop facilitation",
      "Change management", "Data analysis", "Project management", "Executive communication",
    ],
  },
  {
    id: "hr",
    label: "HR / People",
    icon: "👥",
    skills: [
      "Talent acquisition", "Performance management", "Employee engagement",
      "Culture & values", "Learning & development", "Stakeholder communication",
      "Conflict resolution", "Diversity & inclusion", "Compensation & benefits", "Organisational design",
    ],
  },
  {
    id: "other",
    label: "Other / General",
    icon: "✨",
    skills: [
      "Stakeholder communication", "Project management", "Presentation & pitching",
      "Strategic planning", "Leadership & team management", "Problem solving",
      "Data-driven decision making", "Negotiation", "Change management", "Executive communication",
    ],
  },
];

const ALL_SKILLS = [...new Set(ROLE_PACKS.flatMap(r => r.skills))].sort();

const DEFAULT_PROFILE = {
  name: "",
  role: "",
  expertise: [],
  meetingType: "Management / leadership meeting",
  language: LANGUAGES[0],
  tone: "Confident, data-backed, strategic",
};

// ── Claude call ────────────────────────────────────────────────────────────
async function callClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const raw = data.content?.find((b) => b.type === "text")?.text || "[]";
  return raw.replace(/```json|```/g, "").trim();
}

// ── Prompts ────────────────────────────────────────────────────────────────
function buildLivePrompt(profile, transcript, goal, language, prepContext) {
  const translateNote = language.code !== "en-US"
    ? `The transcript may be in ${language.label}. Translate it to English first, then generate suggestions.` : "";
  return `You are a real-time meeting co-pilot for a senior professional. Suggest sharp, immediately usable talking points.

PROFESSIONAL PROFILE:
Name: ${profile.name}
Role: ${profile.role}
Expertise: ${profile.expertise.join(", ")}
Tone: ${profile.tone}
Meeting type: ${profile.meetingType}
${goal ? `Session goal: ${goal}` : ""}
${prepContext ? `Pre-meeting context: ${prepContext}` : ""}
${translateNote}

LAST 90 SECONDS OF CONVERSATION:
"${transcript}"

Generate 3 highly relevant suggestions the person can use RIGHT NOW. Each must be:
- Directly tied to something just said
- Grounded in their professional expertise where relevant
- Short and speakable (1-2 sentences max)
- All output in English

Respond ONLY with a JSON array, no markdown, no preamble:
[
  { "type": "Talking Point", "text": "..." },
  { "type": "Rebuttal", "text": "..." },
  { "type": "Data Insight", "text": "..." }
]
Types: Talking Point | Rebuttal | Data Insight | Question | Idea | Reframe | Close`;
}

function buildPrepPrompt(profile, topic, attendees, goal, concerns, data) {
  return `You are preparing a ${profile.role} for an important meeting.

PROFESSIONAL PROFILE:
Name: ${profile.name}
Role: ${profile.role}
Expertise: ${profile.expertise.join(", ")}
Tone: ${profile.tone}

MEETING DETAILS:
Topic: ${topic}
Goal: ${goal}
Attendees: ${attendees}
Expected topics / concerns: ${concerns}
${data ? `Relevant data / context: ${data}` : ""}

Generate a structured pre-meeting brief with talking points.

Respond ONLY with a JSON array, no markdown, no preamble:
[
  { "type": "Opening",               "text": "...", "note": "when to use this" },
  { "type": "Key Argument",          "text": "...", "note": "when to use this" },
  { "type": "Key Argument",          "text": "...", "note": "when to use this" },
  { "type": "Data Point",            "text": "...", "note": "when to use this" },
  { "type": "Anticipated Objection", "text": "...", "note": "likely from who" },
  { "type": "Rebuttal",              "text": "...", "note": "response to above" },
  { "type": "Close / Ask",           "text": "...", "note": "what you want to walk away with" }
]`;
}

function buildSummaryPrompt(profile, transcript, goal, prepTopic, prepAttendees) {
  const fullText = transcript.map(t => t.text).join(" ");
  return `You are debriefing a ${profile.role} after a meeting. Analyse the transcript and produce a structured post-meeting summary tailored to their profile.

PROFESSIONAL PROFILE:
Name: ${profile.name}
Role: ${profile.role}
Expertise: ${profile.expertise.join(", ")}
Tone: ${profile.tone}

MEETING CONTEXT:
Topic: ${prepTopic || "Not specified"}
Attendees: ${prepAttendees || "Not specified"}
Goal: ${goal || "Not specified"}

FULL MEETING TRANSCRIPT:
"${fullText}"

Produce a structured debrief. Respond ONLY with a JSON object, no markdown, no preamble:
{
  "summary": [
    { "point": "Key topic or decision discussed..." },
    { "point": "..." }
  ],
  "your_contribution": [
    { "type": "Strength", "text": "Something they handled well or could have said..." },
    { "type": "Missed Opportunity", "text": "A moment they could have added more value..." }
  ],
  "lessons": [
    { "title": "Lesson title", "text": "Actionable takeaway for next time, grounded in their expertise..." },
    { "title": "...", "text": "..." }
  ],
  "next_meeting_prep": [
    { "action": "Specific thing to research, prepare, or bring to the next similar meeting..." },
    { "action": "..." }
  ]
}`;
}


// ── Card styles ────────────────────────────────────────────────────────────
const TYPE_STYLES = {
  "Talking Point":         { border: "#16a34a", bg: "#f0fdf4", badge: "#dcfce7", badgeText: "#15803d" },
  "Key Argument":          { border: "#16a34a", bg: "#f0fdf4", badge: "#dcfce7", badgeText: "#15803d" },
  "Opening":               { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8" },
  "Rebuttal":              { border: "#dc2626", bg: "#fef2f2", badge: "#fee2e2", badgeText: "#b91c1c" },
  "Data Point":            { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8" },
  "Data Insight":          { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8" },
  "Anticipated Objection": { border: "#d97706", bg: "#fffbeb", badge: "#fef3c7", badgeText: "#b45309" },
  "Question":              { border: "#7c3aed", bg: "#f5f3ff", badge: "#ede9fe", badgeText: "#6d28d9" },
  "Idea":                  { border: "#0891b2", bg: "#ecfeff", badge: "#cffafe", badgeText: "#0e7490" },
  "Reframe":               { border: "#0891b2", bg: "#ecfeff", badge: "#cffafe", badgeText: "#0e7490" },
  "Close / Ask":           { border: "#d97706", bg: "#fffbeb", badge: "#fef3c7", badgeText: "#b45309" },
  "Close":                 { border: "#d97706", bg: "#fffbeb", badge: "#fef3c7", badgeText: "#b45309" },
};
const DEFAULT_STYLE = { border: "#94a3b8", bg: "#f8fafc", badge: "#f1f5f9", badgeText: "#475569" };

function SuggestionCard({ item, index, showNote }) {
  const [copied, setCopied] = useState(false);
  const s = TYPE_STYLES[item.type] || DEFAULT_STYLE;
  const copy = () => { navigator.clipboard.writeText(item.text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div style={{ background: s.bg, border: "1px solid #e5e7eb", borderLeft: `4px solid ${s.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10, animation: `slideIn 0.25s ease ${index * 0.06}s both`, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <span style={{ background: s.badge, color: s.badgeText, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", fontFamily: "monospace", padding: "2px 8px", borderRadius: 4 }}>{item.type}</span>
        <button onClick={copy} style={{ marginLeft: "auto", background: "white", border: "1px solid #d1d5db", color: "#6b7280", borderRadius: 5, padding: "2px 9px", fontSize: 11, cursor: "pointer", fontFamily: "monospace" }}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <p style={{ margin: 0, color: "#1f2937", fontSize: 13.5, lineHeight: 1.65, fontFamily: "'Georgia', serif" }}>{item.text}</p>
      {showNote && item.note && <p style={{ margin: "8px 0 0", color: "#9ca3af", fontSize: 11, fontFamily: "monospace", borderTop: "1px solid #e5e7eb", paddingTop: 7 }}>↳ {item.note}</p>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, multiline, rows = 3 }) {
  const [local, setLocal] = useState(value);
  const base = { width: "100%", background: "white", border: "1px solid #d1d5db", borderRadius: 8, color: "#1f2937", padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: "'DM Sans', sans-serif", marginTop: 5 };
  return (
    <div style={{ marginBottom: 15 }}>
      <label style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{label}</label>
      {multiline
        ? <textarea value={local} onChange={e => setLocal(e.target.value)} onBlur={() => onChange(local)} placeholder={placeholder} rows={rows} style={{ ...base, resize: "vertical" }} />
        : <input value={local} onChange={e => setLocal(e.target.value)} onBlur={() => onChange(local)} placeholder={placeholder} style={base} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════════════════════
function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [customSkill, setCustomSkill] = useState("");
  const [selectedRole, setSelectedRole] = useState(null);
  const [consentGiven, setConsentGiven] = useState(false);

  const totalSteps = 7;

  const update = (key, val) => setProfile(p => ({ ...p, [key]: val }));

  const toggleSkill = (skill) => {
    setProfile(p => ({
      ...p,
      expertise: p.expertise.includes(skill)
        ? p.expertise.filter(s => s !== skill)
        : [...p.expertise, skill],
    }));
  };

  const addCustomSkill = () => {
    if (!customSkill.trim()) return;
    if (!profile.expertise.includes(customSkill.trim())) {
      setProfile(p => ({ ...p, expertise: [...p.expertise, customSkill.trim()] }));
    }
    setCustomSkill("");
  };

  const selectRolePack = (pack) => {
    setSelectedRole(pack.id);
    setProfile(p => ({ ...p, expertise: [...pack.skills] }));
  };

  const canNext = () => {
    if (step === 1) return profile.name.trim() && profile.role.trim();
    if (step === 2) return selectedRole !== null;
    if (step === 6) return consentGiven;
    return true;
  };

  const finish = () => {
    localStorage.setItem("copilot_profile", JSON.stringify(profile));
    localStorage.setItem("copilot_onboarded", "true");
    onComplete(profile);
  };

  const btnStyle = (active) => ({
    background: active ? "#16a34a" : "white",
    color: active ? "white" : "#374151",
    border: active ? "2px solid #16a34a" : "2px solid #e5e7eb",
    borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif", fontWeight: active ? 600 : 400,
    transition: "all 0.15s",
  });

  const Progress = ({ step, total }) => (
    <div style={{ display: "flex", gap: 6, marginBottom: 32 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? "#16a34a" : "#e5e7eb", transition: "background 0.3s" }} />
      ))}
    </div>
  );

  const NavButtons = ({ nextLabel = "Continue →", onNext, disabled }) => (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28 }}>
      {step > 0
        ? <button onClick={() => setStep(s => s - 1)} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>← Back</button>
        : <div />}
      <button onClick={onNext || (() => setStep(s => s + 1))} disabled={disabled ?? !canNext()} style={{
        background: (disabled ?? !canNext()) ? "#f3f4f6" : "#16a34a",
        color: (disabled ?? !canNext()) ? "#9ca3af" : "white",
        border: "none", borderRadius: 10, padding: "12px 28px",
        fontSize: 14, fontWeight: 600, cursor: (disabled ?? !canNext()) ? "not-allowed" : "pointer",
        fontFamily: "'DM Sans', sans-serif", boxShadow: (disabled ?? !canNext()) ? "none" : "0 2px 8px rgba(22,163,74,0.3)",
        transition: "all 0.15s",
      }}>{nextLabel}</button>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0fdf4 0%, #eff6ff 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        @keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box}
        input,textarea{outline:none}
        button{cursor:pointer;transition:all .15s}
        input::placeholder,textarea::placeholder{color:#9ca3af}
      `}</style>

      <div style={{ width: "100%", maxWidth: 560 }}>

        {/* Step 0 — Welcome */}
        {step === 0 && (
          <div key={step} style={{ background: "white", borderRadius: 16, padding: "36px 40px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 560, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ width: 64, height: 64, background: "#16a34a", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 20px", boxShadow: "0 4px 16px rgba(22,163,74,0.3)" }}>⚡</div>
              <h1 style={{ margin: "0 0 10px", fontSize: 26, fontWeight: 700, color: "#111827", letterSpacing: "-0.02em" }}>Welcome to Meeting Co‑Pilot</h1>
              <p style={{ margin: 0, color: "#6b7280", fontSize: 14, lineHeight: 1.7 }}>Your AI-powered meeting assistant that listens to conversations and gives you real-time talking points, rebuttals, and insights — tailored to your profession.</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 8 }}>
              {[
                { icon: "🎯", label: "Prep", desc: "Generate talking points before the meeting" },
                { icon: "⚡", label: "Live", desc: "Real-time suggestions as the conversation unfolds" },
                { icon: "🌍", label: "Multilingual", desc: "Works in Hebrew, French, Spanish & more" },
              ].map(f => (
                <div key={f.label} style={{ background: "#f9fafb", border: "1px solid #f3f4f6", borderRadius: 10, padding: "14px 12px", textAlign: "center" }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{f.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: "#111827", marginBottom: 4 }}>{f.label}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              ))}
            </div>
            <NavButtons nextLabel="Get Started →" disabled={false} />
          </div>
        )}

        {/* Step 1 — Name & Role */}
        {step === 1 && (
          <div key={step} style={{ background: "white", borderRadius: 16, padding: "36px 40px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 560, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#111827" }}>Tell us about yourself</h2>
            <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 13 }}>This helps personalise your talking points to your role and expertise.</p>
            <Field label="Your Name *" value={profile.name} onChange={v => update("name", v)} placeholder="e.g. Shad" />
            <Field label="Your Job Title / Role *" value={profile.role} onChange={v => update("role", v)} placeholder="e.g. Paid Media & Marketing Measurement Analyst" />
            <Field label="Preferred Tone" value={profile.tone} onChange={v => update("tone", v)} placeholder="e.g. Confident, data-backed, strategic" />
            <NavButtons />
          </div>
        )}

        {/* Step 2 — Role Type */}
        {step === 2 && (
          <div key={step} style={{ background: "white", borderRadius: 16, padding: "36px 40px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 560, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#111827" }}>What best describes your role?</h2>
            <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>We'll pre-load the most relevant skills for your role — you can customise them in the next step.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
              {ROLE_PACKS.map(pack => (
                <button key={pack.id} onClick={() => selectRolePack(pack)} style={{
                  background: selectedRole === pack.id ? "#f0fdf4" : "#f9fafb",
                  color: selectedRole === pack.id ? "#15803d" : "#374151",
                  border: selectedRole === pack.id ? "2px solid #16a34a" : "2px solid #e5e7eb",
                  borderRadius: 12, padding: "14px 16px", fontSize: 13,
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: selectedRole === pack.id ? 700 : 500,
                  display: "flex", alignItems: "center", gap: 10,
                  textAlign: "left", transition: "all 0.15s",
                }}>
                  <span style={{ fontSize: 20 }}>{pack.icon}</span>
                  <span>{pack.label}</span>
                  {selectedRole === pack.id && <span style={{ marginLeft: "auto", color: "#16a34a" }}>✓</span>}
                </button>
              ))}
            </div>
            {selectedRole && (
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "#16a34a", fontFamily: "monospace" }}>
                ✓ {ROLE_PACKS.find(r => r.id === selectedRole)?.skills.length} skills pre-loaded — customise them next
              </p>
            )}
            <NavButtons disabled={!selectedRole} />
          </div>
        )}

        {/* Step 3 — Expertise */}
        {step === 3 && (
          <div key={step} style={{ background: "white", borderRadius: 16, padding: "36px 40px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 560, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#111827" }}>Your areas of expertise</h2>
            <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>We've pre-selected skills based on your role — add or remove anything to match your expertise.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {ALL_SKILLS.map(skill => (
                <button key={skill} onClick={() => toggleSkill(skill)} style={{
                  background: profile.expertise.includes(skill) ? "#dcfce7" : "#f9fafb",
                  color: profile.expertise.includes(skill) ? "#15803d" : "#374151",
                  border: profile.expertise.includes(skill) ? "1px solid #86efac" : "1px solid #e5e7eb",
                  borderRadius: 20, padding: "6px 13px", fontSize: 12, fontFamily: "'DM Sans', sans-serif",
                  fontWeight: profile.expertise.includes(skill) ? 600 : 400,
                }}>
                  {profile.expertise.includes(skill) ? "✓ " : ""}{skill}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={customSkill} onChange={e => setCustomSkill(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addCustomSkill(); }} placeholder="Add your own skill…" style={{ flex: 1, background: "white", border: "1px solid #d1d5db", borderRadius: 8, color: "#1f2937", padding: "8px 12px", fontSize: 13, fontFamily: "'DM Sans', sans-serif" }} />
              <button onClick={addCustomSkill} style={{ background: "#16a34a", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>Add</button>
            </div>
            {profile.expertise.length > 0 && (
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "#16a34a", fontFamily: "monospace" }}>✓ {profile.expertise.length} skill{profile.expertise.length !== 1 ? "s" : ""} selected</p>
            )}
            <NavButtons />
          </div>
        )}

        {/* Step 4 — Meeting Type */}
        {step === 4 && (
          <div key={step} style={{ background: "white", borderRadius: 16, padding: "36px 40px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 560, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#111827" }}>What type of meetings do you mostly attend?</h2>
            <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>This sets the default context for your suggestions.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
              {MEETING_TYPES.map(type => (
                <button key={type} onClick={() => update("meetingType", type)} style={btnStyle(profile.meetingType === type)}>
                  {profile.meetingType === type ? "✓ " : ""}{type}
                </button>
              ))}
            </div>
            <NavButtons disabled={false} />
          </div>
        )}

        {/* Step 5 — Language */}
        {step === 5 && (
          <div key={step} style={{ background: "white", borderRadius: 16, padding: "36px 40px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 560, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#111827" }}>What language are your meetings in?</h2>
            <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>Co-Pilot will listen in this language and always give suggestions in English.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}>
              {LANGUAGES.map(lang => (
                <button key={lang.code} onClick={() => update("language", lang)} style={{
                  ...btnStyle(profile.language.code === lang.code),
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}>
                  <span style={{ fontSize: 18 }}>{lang.flag}</span>
                  <span>{lang.label}</span>
                </button>
              ))}
            </div>
            <NavButtons disabled={false} />
          </div>
        )}

        {/* Step 6 — Tutorial */}
        {step === 6 && (
          <div key={step} style={{ background: "white", borderRadius: 16, padding: "36px 40px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 560, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#111827" }}>How it works</h2>
            <p style={{ margin: "0 0 22px", color: "#6b7280", fontSize: 13 }}>A quick guide before you jump in.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 8 }}>
              {[
                { icon: "⚙", color: "#2563eb", bg: "#eff6ff", title: "Before the meeting — Prep tab", desc: "Enter the meeting topic, who's attending, your goal, and any data you want to reference. Click Generate and get a full personalised brief with talking points, anticipated objections, and a close." },
                { icon: "●", color: "#16a34a", bg: "#f0fdf4", title: "During the meeting — Live tab", desc: "Click Start Listening and your mic picks up the conversation. Every ~18 seconds, AI suggestions appear on the right. Hit ↻ Refresh any time for instant suggestions." },
                { icon: "✍", color: "#7c3aed", bg: "#f5f3ff", title: "Manual input", desc: "Not using the mic? Just type or paste what was just said in the box at the bottom and hit Add — suggestions will fire immediately." },
                { icon: "📋", color: "#d97706", bg: "#fffbeb", title: "Copy any suggestion", desc: "Each card has a Copy button. Paste it into your notes or use it as a script for what to say next." },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: item.bg, border: "1px solid #f3f4f6", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: item.color, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{item.icon}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#111827", marginBottom: 3 }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 18px", marginTop: 16 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={e => setConsentGiven(e.target.checked)}
                  style={{ marginTop: 2, width: 16, height: 16, accentColor: "#16a34a", flexShrink: 0 }}
                />
                <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.6 }}>
                  I understand that Unmute listens to my meeting audio in real time to generate suggestions. <strong>Audio is never recorded or stored.</strong> I am responsible for ensuring compliance with local recording consent laws in my jurisdiction, and for informing meeting participants where required. I have read and agree to the <a href="https://meetunmute.com/terms" target="_blank" style={{ color: "#16a34a" }}>Terms of Service</a> and <a href="https://meetunmute.com/privacy" target="_blank" style={{ color: "#16a34a" }}>Privacy Policy</a>.
                </span>
              </label>
            </div>
            <NavButtons nextLabel="Let's go! ⚡" onNext={finish} disabled={!consentGiven} />
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [onboarded, setOnboarded] = useState(false);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem("copilot_onboarded");
    const saved = localStorage.getItem("copilot_profile");
    if (done && saved) {
      setProfile(JSON.parse(saved));
      setOnboarded(true);
    }
    setAppReady(true);
  }, []);

  const handleOnboardingComplete = (p) => {
    setProfile(p);
    setOnboarded(true);
  };

  if (!appReady) return null;
  if (!onboarded) return <Onboarding onComplete={handleOnboardingComplete} />;
  return <MeetingApp profile={profile} onEditProfile={() => { localStorage.removeItem("copilot_onboarded"); window.location.reload(); }} />;
}

// ══════════════════════════════════════════════════════════════════════════
// MEETING APP
// ══════════════════════════════════════════════════════════════════════════
function MeetingApp({ profile, onEditProfile }) {
  const [mode, setMode] = useState("prep");
  const [language, setLanguage] = useState(profile.language || LANGUAGES[0]);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [sessionConsentGiven, setSessionConsentGiven] = useState(false);

  const [prepTopic, setPrepTopic]       = useState("");
  const [prepAttendees, setPrepAttendees] = useState("");
  const [prepGoal, setPrepGoal]         = useState("");
  const [prepConcerns, setPrepConcerns] = useState("");
  const [prepData, setPrepData]         = useState("");
  const [prepPoints, setPrepPoints]     = useState([]);
  const [prepLoading, setPrepLoading]   = useState(false);
  const [prepError, setPrepError]       = useState("");

  const [sessionGoal, setSessionGoal]         = useState("");
  const [isListening, setIsListening]         = useState(false);
  const [transcript, setTranscript]           = useState([]);
  const [liveSuggestions, setLiveSuggestions] = useState([]);
  const [liveStatus, setLiveStatus]           = useState("idle");
  const [lastUpdated, setLastUpdated]         = useState(null);
  const [manualText, setManualText]           = useState("");
  const [liveError, setLiveError]             = useState("");
  const [summary, setSummary]               = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError]     = useState("");

  const recognitionRef = useRef(null);
  const transcriptRef  = useRef([]);
  const debounceRef    = useRef(null);
  const scrollRef      = useRef(null);

  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [transcript]);

  const generatePrep = async () => {
    if (!prepTopic.trim()) { setPrepError("Please enter a meeting topic."); return; }
    setPrepLoading(true); setPrepError("");
    try {
      const raw = await callClaude(buildPrepPrompt(profile, prepTopic, prepAttendees, prepGoal, prepConcerns, prepData));
      setPrepPoints(JSON.parse(raw));
      if (prepGoal) setSessionGoal(prepGoal);
    } catch (e) { setPrepError("Error generating brief. Check API key."); console.error(e); }
    setPrepLoading(false);
  };

  const fetchLiveSuggestions = useCallback(async () => {
    const recent = transcriptRef.current.slice(-15).map(t => t.text).join(" ");
    if (recent.trim().length < 20) return;
    setLiveStatus("thinking");
    try {
      const prepContext = prepTopic ? `Meeting: ${prepTopic}. Goal: ${prepGoal}` : "";
      const raw = await callClaude(buildLivePrompt(profile, recent, sessionGoal, language, prepContext));
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
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          setTranscript(prev => [...prev, { id: Date.now() + Math.random(), text: e.results[i][0].transcript.trim() }]);
          triggerDebounced();
        }
      }
    };
    r.onerror = (e) => { if (e.error !== "no-speech") { setLiveError(`Mic: ${e.error}`); setLiveStatus("error"); } };
    r.onend = () => { if (recognitionRef.current) r.start(); };
    r.start();
    recognitionRef.current = r;
    setIsListening(true); setLiveStatus("listening"); setLiveError("");
  }, [language, triggerDebounced]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.onend = null; recognitionRef.current.stop(); recognitionRef.current = null; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsListening(false); setLiveStatus("idle");
  }, []);

  const endMeeting = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.onend = null; recognitionRef.current.stop(); recognitionRef.current = null; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsListening(false); setLiveStatus("idle");
    if (transcriptRef.current.length > 0) {
      setMode("summary");
      setSummary(null);
      setSummaryLoading(true);
      setSummaryError("");
      callClaude(buildSummaryPrompt(profile, transcriptRef.current, sessionGoal, prepTopic, prepAttendees))
        .then(raw => {
          setSummary(JSON.parse(raw.replace(/```json|```/g, "").trim()));
          setSummaryLoading(false);
        })
        .catch(e => {
          console.error(e);
          setSummaryError("Error generating summary. Try again.");
          setSummaryLoading(false);
        });
    }
  }, [profile, sessionGoal, prepTopic, prepAttendees]);

  const addManual = () => {
    if (!manualText.trim()) return;
    setTranscript(prev => [...prev, { id: Date.now(), text: manualText.trim() }]);
    setManualText(""); fetchLiveSuggestions();
  };

  const clearSession = () => { setTranscript([]); setLiveSuggestions([]); setLastUpdated(null); setLiveStatus(isListening ? "listening" : "idle"); };

  const generateSummary = async () => {
    if (transcript.length === 0) { setSummaryError("No transcript yet — run a live session first."); return; }
    setSummaryLoading(true); setSummaryError("");
    try {
      const raw = await callClaude(buildSummaryPrompt(profile, transcript, sessionGoal, prepTopic, prepAttendees));
      setSummary(JSON.parse(raw));
    } catch (e) { setSummaryError("Error generating summary. Try again."); console.error(e); }
    setSummaryLoading(false);
  };

  const statusInfo = { idle: { color: "#9ca3af", label: "Ready" }, listening: { color: "#16a34a", label: "Listening" }, thinking: { color: "#d97706", label: "Analysing…" }, error: { color: "#dc2626", label: "Error" } };

  return (
    <div style={{ height: "100vh", background: "#f9fafb", fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", color: "#111827", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        @keyframes slideIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#f3f4f6}
        ::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:2px}
        input,textarea{outline:none}
        button{cursor:pointer;transition:all .15s}
        button:hover{opacity:.85}
        textarea{resize:vertical}
        input::placeholder,textarea::placeholder{color:#9ca3af}
      `}</style>

      {/* Header */}
      <div style={{ background: "white", borderBottom: "1px solid #e5e7eb", padding: "11px 22px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginRight: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, boxShadow: "0 2px 6px rgba(22,163,74,0.3)" }}>⚡</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em", color: "#111827", lineHeight: 1.2 }}>Meeting Co‑Pilot</div>
            <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>{profile.name} · {profile.role}</div>
          </div>
        </div>

        <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 9, padding: 3, border: "1px solid #e5e7eb", gap: 2 }}>
          {[{ key: "prep", label: "⚙  Prep" }, { key: "live", label: "●  Live" }, { key: "summary", label: "📋  Summary" }].map(({ key, label }) => (
            <button key={key} onClick={() => setMode(key)} style={{ background: mode === key ? "white" : "transparent", border: "none", boxShadow: mode === key ? "0 1px 3px rgba(0,0,0,0.1)" : "none", color: mode === key ? "#111827" : "#6b7280", borderRadius: 7, padding: "6px 18px", fontSize: 12, fontWeight: mode === key ? 600 : 400 }}>{label}</button>
          ))}
        </div>

        {mode === "live" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 20, padding: "4px 12px" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusInfo[liveStatus].color, animation: ["listening","thinking"].includes(liveStatus) ? `pulse ${liveStatus === "thinking" ? "0.6s" : "2s"} infinite` : "none" }} />
            <span style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>{statusInfo[liveStatus].label}</span>
            {lastUpdated && <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace", marginLeft: 2 }}>· {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          </div>
        )}

        {/* Language */}
        <div style={{ marginLeft: "auto", position: "relative" }}>
          <button onClick={() => setShowLangMenu(p => !p)} style={{ background: "white", border: "1px solid #d1d5db", color: "#374151", borderRadius: 8, padding: "6px 13px", fontSize: 12, display: "flex", alignItems: "center", gap: 7, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
            <span>{language.flag}</span><span style={{ fontFamily: "monospace", fontWeight: 500 }}>{language.label}</span><span style={{ fontSize: 9, color: "#9ca3af" }}>▼</span>
          </button>
          {showLangMenu && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "white", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", zIndex: 100, minWidth: 160, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
              {LANGUAGES.map(l => (
                <button key={l.code} onClick={() => { setLanguage(l); setShowLangMenu(false); if (isListening) stopListening(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: language.code === l.code ? "#f0fdf4" : "white", border: "none", color: language.code === l.code ? "#15803d" : "#374151", padding: "10px 15px", fontSize: 13, textAlign: "left", fontWeight: language.code === l.code ? 600 : 400 }}>
                  <span>{l.flag}</span><span>{l.label}</span>{language.code === l.code && <span style={{ marginLeft: "auto" }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Edit profile */}
        <button onClick={onEditProfile} style={{ background: "white", border: "1px solid #d1d5db", color: "#6b7280", borderRadius: 8, padding: "6px 13px", fontSize: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
          Edit Profile
        </button>

        {mode === "live" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={clearSession} style={{ background: "white", border: "1px solid #d1d5db", color: "#6b7280", borderRadius: 8, padding: "6px 14px", fontSize: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>Clear</button>
            <button onClick={isListening ? endMeeting : (sessionConsentGiven ? startListening : () => setShowConsentModal(true))} style={{ background: isListening ? "#fef2f2" : "#f0fdf4", border: `1px solid ${isListening ? "#fca5a5" : "#86efac"}`, color: isListening ? "#dc2626" : "#16a34a", borderRadius: 8, padding: "6px 16px", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 7, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
              <div style={{ width: isListening ? 8 : 9, height: isListening ? 8 : 9, borderRadius: isListening ? 2 : "50%", background: isListening ? "#dc2626" : "#16a34a", animation: isListening ? "pulse 1.2s infinite" : "none" }} />
              {isListening ? "End Meeting" : "Start Listening"}
            </button>
          </div>
        )}
      </div>

      {/* PREP MODE */}
      {mode === "prep" && (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "420px 1fr", overflow: "hidden" }}>
          <div style={{ background: "white", borderRight: "1px solid #e5e7eb", overflowY: "auto", padding: "24px 26px" }}>
            <div style={{ marginBottom: 22 }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#111827" }}>Meeting Brief Builder</h2>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Fill in the details and generate personalised talking points before your meeting.</p>
            </div>
            <Field label="Meeting Topic *"             value={prepTopic}     onChange={setPrepTopic}     placeholder="e.g. Q3 Marketing Budget Review" />
            <Field label="Attendees & Their Roles"     value={prepAttendees} onChange={setPrepAttendees} placeholder="e.g. CMO (Sarah), CFO (James), Head of Brand (Tom)" multiline rows={2} />
            <Field label="Your Goal for This Meeting"  value={prepGoal}      onChange={setPrepGoal}      placeholder="e.g. Get sign-off on Q3 incrementality testing budget" />
            <Field label="Expected Topics / Concerns"  value={prepConcerns}  onChange={setPrepConcerns}  placeholder="e.g. Budget cuts, ROI of measurement tools, channel performance" multiline rows={3} />
            <Field label="Data / Context to Reference" value={prepData}      onChange={setPrepData}      placeholder="e.g. MMM showed paid social drove 34% incremental revenue last quarter" multiline rows={3} />
            {prepError && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#dc2626", fontSize: 12, fontFamily: "monospace" }}>⚠ {prepError}</div>}
            <button onClick={generatePrep} disabled={prepLoading} style={{ width: "100%", background: "#16a34a", border: "none", color: "white", borderRadius: 10, padding: "13px", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, boxShadow: "0 2px 8px rgba(22,163,74,0.3)" }}>
              {prepLoading ? <><div style={{ width: 14, height: 14, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />Generating Brief…</> : "⚡  Generate Meeting Brief"}
            </button>
            {prepPoints.length > 0 && <button onClick={() => setMode("live")} style={{ width: "100%", marginTop: 10, background: "#eff6ff", border: "1px solid #93c5fd", color: "#1d4ed8", borderRadius: 10, padding: "12px", fontSize: 13, fontWeight: 600 }}>→ Enter Live Mode</button>}
          </div>
          <div style={{ overflowY: "auto", padding: "24px 26px", background: "#f9fafb" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>Your Talking Points</h2>
              {prepPoints.length > 0 && <span style={{ background: "#dcfce7", color: "#15803d", fontSize: 11, fontWeight: 700, fontFamily: "monospace", padding: "2px 9px", borderRadius: 20 }}>{prepPoints.length} cards</span>}
            </div>
            {prepPoints.length === 0 && !prepLoading && <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: "32px 24px", textAlign: "center", color: "#9ca3af" }}><div style={{ fontSize: 32, marginBottom: 12 }}>📋</div><p style={{ margin: 0, fontSize: 13, lineHeight: 1.8 }}>Fill in the form and click Generate —<br />your personalised brief will appear here.</p></div>}
            {prepLoading && <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}><div style={{ width: 24, height: 24, border: "3px solid #16a34a", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 14px" }} /><p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Building your brief…</p></div>}
            {prepPoints.map((p, i) => <SuggestionCard key={i} item={p} index={i} showNote={true} />)}
          </div>
        </div>
      )}


      {/* SUMMARY MODE */}
      {mode === "summary" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", maxWidth: 900, margin: "0 auto", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div>
              <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "#111827" }}>Meeting Summary</h2>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>{transcript.length > 0 ? `Based on ${transcript.length} transcript segments` : "Run a live session first to generate a summary"}</p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {summary && (
                <button onClick={() => {
                  const text = [
                    "MEETING SUMMARY",
                    "================",
                    "",
                    "KEY POINTS:",
                    ...summary.summary.map(s => `• ${s.point}`),
                    "",
                    "YOUR CONTRIBUTION:",
                    ...summary.your_contribution.map(c => `[${c.type}] ${c.text}`),
                    "",
                    "LESSONS FOR NEXT TIME:",
                    ...summary.lessons.map(l => `• ${l.title}: ${l.text}`),
                    "",
                    "PREP FOR NEXT MEETING:",
                    ...summary.next_meeting_prep.map(n => `• ${n.action}`),
                  ].join("\n");
                  navigator.clipboard.writeText(text);
                }} style={{ background: "white", border: "1px solid #d1d5db", color: "#374151", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500 }}>
                  Copy All
                </button>
              )}
              <button onClick={generateSummary} disabled={summaryLoading || transcript.length === 0} style={{ background: summaryLoading || transcript.length === 0 ? "#f3f4f6" : "#16a34a", border: "none", color: summaryLoading || transcript.length === 0 ? "#9ca3af" : "white", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, boxShadow: summaryLoading || transcript.length === 0 ? "none" : "0 2px 8px rgba(22,163,74,0.3)" }}>
                {summaryLoading ? <><div style={{ width: 13, height: 13, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />Generating…</> : "⚡ Generate Summary"}
              </button>
            </div>
          </div>

          {summaryError && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "12px 16px", marginBottom: 20, color: "#dc2626", fontSize: 13 }}>⚠ {summaryError}</div>}

          {!summary && !summaryLoading && (
            <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, padding: "48px 32px", textAlign: "center", color: "#9ca3af" }}>
              <div style={{ fontSize: 40, marginBottom: 14 }}>📋</div>
              <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: "#374151" }}>No summary yet</p>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>{transcript.length > 0 ? "Click Generate Summary to get your post-meeting debrief." : "Complete a live session first, then come back here."}</p>
            </div>
          )}

          {summaryLoading && (
            <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, padding: "48px 32px", textAlign: "center" }}>
              <div style={{ width: 28, height: 28, border: "3px solid #16a34a", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 16px" }} />
              <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: "#374151" }}>Generating your summary…</p>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Analysing your meeting transcript and building your debrief.</p>
            </div>
          )}

          {summary && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {/* Meeting Summary */}
              <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📌</div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>What Was Discussed</span>
                  <span style={{ background: "#dbeafe", color: "#1d4ed8", fontSize: 10, fontFamily: "monospace", fontWeight: 700, padding: "2px 8px", borderRadius: 10, marginLeft: "auto" }}>{summary.summary.length} points</span>
                </div>
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {summary.summary.map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#eff6ff", color: "#1d4ed8", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                      <p style={{ margin: 0, fontSize: 13.5, color: "#374151", lineHeight: 1.6 }}>{s.point}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Your Contribution */}
              <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🎯</div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>Your Contribution</span>
                </div>
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {summary.your_contribution.map((c, i) => {
                    const isStrength = c.type === "Strength";
                    return (
                      <div key={i} style={{ background: isStrength ? "#f0fdf4" : "#fffbeb", border: `1px solid ${isStrength ? "#86efac" : "#fde68a"}`, borderLeft: `4px solid ${isStrength ? "#16a34a" : "#d97706"}`, borderRadius: 10, padding: "12px 14px" }}>
                        <span style={{ background: isStrength ? "#dcfce7" : "#fef3c7", color: isStrength ? "#15803d" : "#b45309", fontSize: 10, fontWeight: 700, fontFamily: "monospace", textTransform: "uppercase", padding: "2px 8px", borderRadius: 4, letterSpacing: "0.07em" }}>{c.type}</span>
                        <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#374151", lineHeight: 1.6 }}>{c.text}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Lessons */}
              <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>💡</div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>Lessons for Next Time</span>
                </div>
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {summary.lessons.map((l, i) => (
                    <div key={i} style={{ borderLeft: "4px solid #7c3aed", background: "#f5f3ff", borderRadius: "0 10px 10px 0", padding: "12px 14px" }}>
                      <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13, color: "#5b21b6" }}>{l.title}</p>
                      <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{l.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Next Meeting Prep */}
              <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", marginBottom: 32 }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🚀</div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>Prep for Next Meeting</span>
                </div>
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {summary.next_meeting_prep.map((n, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#d97706", flexShrink: 0, marginTop: 6 }} />
                      <p style={{ margin: 0, fontSize: 13.5, color: "#374151", lineHeight: 1.6 }}>{n.action}</p>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}
        </div>
      )}
      {/* LIVE MODE */}
      {mode === "live" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ background: "white", borderBottom: "1px solid #e5e7eb", padding: "9px 22px", display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, whiteSpace: "nowrap" }}>Goal</span>
            <input value={sessionGoal} onChange={e => setSessionGoal(e.target.value)} placeholder="Set your goal for this meeting…" style={{ flex: 1, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827", padding: "7px 12px", fontSize: 13, fontFamily: "'DM Sans', sans-serif" }} />
            {language.code !== "en-US" && <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 7, padding: "5px 12px", fontSize: 11, color: "#92400e", fontFamily: "monospace", whiteSpace: "nowrap", fontWeight: 600 }}>{language.flag} → 🇬🇧 auto-translate on</div>}
          </div>

          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", overflow: "hidden", minHeight: 0 }}>
            <div style={{ background: "white", borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "11px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563eb" }} />
                <span style={{ fontSize: 11, color: "#374151", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Pre-Meeting Brief</span>
                <span style={{ marginLeft: "auto", background: "#eff6ff", color: "#1d4ed8", fontSize: 10, fontFamily: "monospace", fontWeight: 700, padding: "1px 8px", borderRadius: 10 }}>{prepPoints.length} pts</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
                {prepPoints.length === 0 ? <div style={{ color: "#d1d5db", fontSize: 13, fontStyle: "italic", textAlign: "center", paddingTop: 24, lineHeight: 1.8 }}><div style={{ fontSize: 28, marginBottom: 10 }}>📝</div>No brief yet —<br />go to Prep tab to generate one.</div> : prepPoints.map((p, i) => <SuggestionCard key={i} item={p} index={i} showNote={true} />)}
              </div>
            </div>

            <div style={{ background: "#f9fafb", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ background: "white", padding: "11px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a", animation: isListening ? "pulse 2s infinite" : "none" }} />
                <span style={{ fontSize: 11, color: "#374151", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Live Suggestions</span>
                {liveStatus === "thinking" && <div style={{ width: 12, height: 12, border: "2px solid #d97706", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", marginLeft: 2 }} />}
                <button onClick={fetchLiveSuggestions} disabled={transcript.length === 0} style={{ marginLeft: "auto", background: "#f0fdf4", border: "1px solid #86efac", color: "#16a34a", borderRadius: 7, padding: "4px 11px", fontSize: 11, fontFamily: "monospace", fontWeight: 600, opacity: transcript.length === 0 ? 0.35 : 1 }}>↻ Refresh</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
                {liveSuggestions.length === 0 && liveStatus !== "thinking" && <div style={{ color: "#d1d5db", fontSize: 13, fontStyle: "italic", textAlign: "center", paddingTop: 24, lineHeight: 1.8 }}><div style={{ fontSize: 28, marginBottom: 10 }}>💬</div>{transcript.length > 0 ? "Click ↻ Refresh or wait ~18s for auto-update." : "Start listening or add transcript text below."}</div>}
                {liveSuggestions.map((s, i) => <SuggestionCard key={i} item={s} index={i} showNote={false} />)}
                {liveError && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#dc2626", fontSize: 12, fontFamily: "monospace" }}>⚠ {liveError}</div>}
              </div>
            </div>
          </div>

          <div style={{ background: "white", borderTop: "1px solid #e5e7eb", flexShrink: 0, height: 95 }}>
            <div style={{ display: "flex", height: "100%" }}>
              <div style={{ padding: "7px 12px", borderRight: "1px solid #f3f4f6", display: "flex", alignItems: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", writingMode: "vertical-rl", transform: "rotate(180deg)", fontWeight: 600 }}>Transcript</span>
              </div>
              <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "10px 16px", borderRight: "1px solid #f3f4f6" }}>
                {transcript.length === 0 ? <span style={{ color: "#d1d5db", fontSize: 12, fontStyle: "italic" }}>Live transcript will appear here as people speak…</span> : transcript.map((t, i) => (
                  <span key={t.id} style={{ color: "#374151", fontSize: 12 }}>
                    <span style={{ color: "#d1d5db", fontFamily: "monospace", fontSize: 10, marginRight: 5 }}>{String(i + 1).padStart(2, "0")}</span>{t.text}{" "}
                  </span>
                ))}
              </div>
              <div style={{ width: 280, display: "flex", gap: 8, padding: "10px 14px", alignItems: "flex-end" }}>
                <textarea value={manualText} onChange={e => setManualText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addManual(); } }} placeholder="Type / paste what was just said…" rows={3} style={{ flex: 1, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827", padding: "7px 10px", fontSize: 12, fontFamily: "'DM Sans', sans-serif", resize: "none" }} />
                <button onClick={addManual} style={{ background: "#16a34a", border: "none", color: "white", borderRadius: 8, padding: "7px 13px", fontSize: 12, fontWeight: 600, alignSelf: "flex-end", boxShadow: "0 1px 4px rgba(22,163,74,0.3)" }}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Consent Modal ── */}
      {showConsentModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "white", borderRadius: 16, padding: "32px", maxWidth: 480, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.2)", animation: "slideIn 0.2s ease" }}>
            <div style={{ width: 48, height: 48, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginBottom: 16 }}>🎙️</div>
            <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#111827" }}>Before you start listening</h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6b7280", lineHeight: 1.7 }}>
              Unmute will listen to your meeting audio in real time to generate AI suggestions. Please confirm the following:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              {[
                "🔒 Audio is processed in real time and never recorded or stored",
                "⚖️ I am responsible for complying with local recording consent laws",
                "👥 I will inform meeting participants where required by law",
                "🤖 Suggestions are AI-generated and should be used with professional judgement",
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "#f9fafb", border: "1px solid #f3f4f6", borderRadius: 8, padding: "10px 12px" }}>
                  <span style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>
            <p style={{ margin: "0 0 20px", fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
              By clicking confirm you agree to our <a href="https://meetunmute.com/terms" target="_blank" style={{ color: "#16a34a" }}>Terms of Service</a> and <a href="https://meetunmute.com/privacy" target="_blank" style={{ color: "#16a34a" }}>Privacy Policy</a>.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowConsentModal(false)} style={{ flex: 1, background: "white", border: "1px solid #e5e7eb", color: "#6b7280", borderRadius: 9, padding: "11px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={() => { setSessionConsentGiven(true); setShowConsentModal(false); startListening(); }} style={{ flex: 2, background: "#16a34a", border: "none", color: "white", borderRadius: 9, padding: "11px", fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 8px rgba(22,163,74,0.3)" }}>
                ✓ Confirm & Start Listening
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}