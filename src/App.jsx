import { useState, useEffect, useRef, useCallback } from "react";

// API calls go through backend — key never exposed in frontend

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
  "Weekly team standup",
  "Management / leadership call",
  "Client video call",
  "Budget / finance review",
  "Strategy & planning session",
  "Sales call / demo",
  "Performance review",
  "Cross-functional team call",
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
      "Agency management", "Marketing attribution", "Executive reporting",
    ],
  },
  {
    id: "paid-media",
    label: "Paid Media Specialist",
    icon: "🎯",
    skills: [
      "Paid media strategy (Meta, Google)", "Programmatic advertising", "Campaign performance analysis",
      "Incrementality testing & measurement", "Media Mix Modelling (MMM)", "Multi-touch attribution",
      "Marketing ROI & budget optimisation", "A/B testing & experimentation", "Audience targeting",
      "Bid strategy & optimisation", "Creative testing", "Dashboard & reporting",
    ],
  },
  {
    id: "social",
    label: "Social Media Manager",
    icon: "📱",
    skills: [
      "Social media strategy", "Content planning & calendars", "Community management",
      "Influencer marketing", "Organic reach & engagement", "Paid social advertising",
      "Social analytics & reporting", "Brand voice & tone", "Trend identification",
      "Platform algorithm knowledge", "Video & short-form content", "Campaign management",
    ],
  },
  {
    id: "product-marketing",
    label: "Product Marketing Manager",
    icon: "📢",
    skills: [
      "Product positioning & messaging", "Go-to-market strategy", "Competitive intelligence",
      "Customer research & insights", "Launch planning & execution", "Sales enablement",
      "Stakeholder communication", "Content marketing", "Pricing strategy",
      "Win/loss analysis", "Feature adoption", "Cross-functional collaboration",
    ],
  },
  {
    id: "sales-manager",
    label: "Sales Manager",
    icon: "🤝",
    skills: [
      "Team management & coaching", "Pipeline management", "Revenue forecasting",
      "Sales strategy", "Objection handling", "CRM management",
      "Performance reporting", "Negotiation & closing", "Client relationship management",
      "Competitive positioning", "Quota setting", "Sales process optimisation",
    ],
  },
  {
    id: "sales-rep",
    label: "Sales Rep / Account Executive",
    icon: "💼",
    skills: [
      "Objection handling", "Discovery & qualification", "Demo & presentation skills",
      "Negotiation & closing", "Prospecting & cold outreach", "CRM & lifecycle marketing",
      "Competitive positioning", "Upselling & cross-selling", "Client relationship management",
      "Proposal writing", "Follow-up strategy", "Value-based selling",
    ],
  },
  {
    id: "data",
    label: "Data Analyst",
    icon: "📊",
    skills: [
      "Data analysis & interpretation", "Dashboard & reporting", "SQL & data querying",
      "A/B testing & experimentation", "Statistical modelling", "Data visualisation",
      "Business intelligence", "Data-driven decision making", "KPI definition & tracking",
      "Python / R analysis", "Insight communication", "Stakeholder reporting",
    ],
  },
  {
    id: "product",
    label: "Product Manager",
    icon: "🚀",
    skills: [
      "Product roadmap planning", "Stakeholder management", "User research & discovery",
      "Agile & sprint planning", "Prioritisation frameworks", "Go-to-market strategy",
      "Data-driven decision making", "Cross-functional collaboration", "OKR setting",
      "Presentation & pitching", "Feature scoping", "Customer feedback analysis",
    ],
  },
  {
    id: "lawyer-corporate",
    label: "Lawyer — Corporate",
    icon: "⚖️",
    skills: [
      "Contract negotiation & drafting", "M&A advisory", "Corporate governance",
      "Due diligence", "Shareholder agreements", "Regulatory compliance",
      "Risk assessment", "Board advisory", "Restructuring & insolvency",
      "Investment & fundraising", "IP & commercial agreements", "Client advisory",
    ],
  },
  {
    id: "lawyer-employment",
    label: "Lawyer — Employment",
    icon: "⚖️",
    skills: [
      "Employment contract advice", "Tribunal representation", "Redundancy & restructuring",
      "Discrimination & harassment claims", "TUPE transfers", "Disciplinary & grievance procedures",
      "Settlement agreements", "Policy drafting", "Workplace investigations",
      "Executive exits", "Trade union relations", "Employment legislation compliance",
    ],
  },
  {
    id: "lawyer-commercial",
    label: "Lawyer — Commercial / Litigation",
    icon: "⚖️",
    skills: [
      "Commercial contract negotiation", "Dispute resolution", "Litigation strategy",
      "Mediation & arbitration", "Intellectual property disputes", "Regulatory investigations",
      "Evidence & disclosure", "Client advisory", "Risk & liability assessment",
      "Cross-border disputes", "Injunctions & remedies", "Settlement negotiation",
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
  company: "",
  jobContext: "",
  meetingObjective: "",
  typicalAudience: "",
  communicationStyle: "",
  writingSample: "",
  meetingType: "Management / leadership meeting",
  language: LANGUAGES[0],
  tone: "Confident, data-backed, strategic",
};

const COMMUNICATION_STYLES = [
  { id: "data-driven", label: "Data-driven", icon: "📊", desc: "Back points with numbers and evidence" },
  { id: "strategic", label: "Strategic", icon: "🗺️", desc: "Big picture, direction and long-term thinking" },
  { id: "collaborative", label: "Collaborative", icon: "🤝", desc: "Build consensus, acknowledge others' views" },
  { id: "direct", label: "Direct & assertive", icon: "⚡", desc: "Say it straight, no fluff" },
  { id: "diplomatic", label: "Diplomatic", icon: "🕊️", desc: "Tactful, careful with relationships" },
  { id: "adaptive", label: "Adaptive", icon: "🌊", desc: "Read the room and match the energy" },
];

// ── Claude call ────────────────────────────────────────────────────────────
// Cheap model for real-time suggestions (live + Ask AI)
async function callClaudeFast(prompt) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const raw = data.content?.find((b) => b.type === "text")?.text || "[]";
  return raw.replace(/```json|```/g, "").trim();
}

// Full model for prep briefs and summaries
async function callClaude(prompt) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
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
  const styleGuide = {
    "data-driven": "Back suggestions with specific numbers, evidence, or measurable outcomes.",
    "strategic": "Frame suggestions around big picture direction, priorities, and long-term impact.",
    "collaborative": "Phrase suggestions to build consensus, acknowledge others views, and invite input.",
    "direct": "Keep suggestions short, plain, and assertive — no hedging or fluff.",
    "diplomatic": "Suggest tactful ways to make points without creating friction.",
    "adaptive": "Match the energy and tone of the conversation — read what the room needs.",
  }[profile.communicationStyle] || "Be confident and clear.";

  return `You are a real-time meeting co-pilot. Suggest what this person should say RIGHT NOW based on the actual conversation.

ABOUT THIS PERSON:
Name: ${profile.name}
Role: ${profile.role}${profile.company ? " at " + profile.company : ""}
${profile.company ? "Company intelligence: Draw on everything you know about " + profile.company + " — their industry, business model, products, competitors, regulatory environment and culture — to make suggestions specific and relevant. If " + profile.company + " is not well known, use the background context instead." : ""}
Areas of expertise: ${profile.expertise.join(", ")}
Communication style: ${styleGuide}
Meeting type: ${profile.meetingType}
${profile.jobContext ? "Day to day: " + profile.jobContext : ""}
${profile.meetingObjective ? "Typically trying to: " + profile.meetingObjective : ""}
${profile.typicalAudience ? "Typical audience: " + profile.typicalAudience : ""}
${goal ? "Session goal: " + goal : ""}
${prepContext ? "Pre-meeting context: " + prepContext : ""}
${profile.writingSample ? "WRITING STYLE — mirror their vocabulary, sentence length and phrasing: \"" + profile.writingSample + "\"" : ""}
${translateNote}

LAST 90 SECONDS OF CONVERSATION:
"${transcript}"

CRITICAL RULES:
1. Respond ONLY to what was actually just said — do not force expertise if it is not relevant
2. Only reference technical expertise or company-specific knowledge if the conversation genuinely calls for it
3. Match their communication style exactly
4. Keep each suggestion short and speakable — 1-2 sentences max
5. All output in English

Generate 3 suggestions the person can use immediately.

Respond ONLY with a JSON array, no markdown, no preamble:
[
  { "type": "Talking Point", "text": "..." },
  { "type": "Rebuttal", "text": "..." },
  { "type": "Question", "text": "..." }
]
Types: Talking Point | Rebuttal | Data Insight | Question | Idea | Reframe | Close`;
}

function buildPrepPrompt(profile, topic, attendees, goal, concerns, data) {
  const prepStyleGuide = {
    "data-driven": "Back every point with specific numbers or measurable outcomes where possible.",
    "strategic": "Focus on big picture direction and long-term thinking.",
    "collaborative": "Frame points to build consensus and acknowledge others perspectives.",
    "direct": "Keep every point short and assertive — no hedging.",
    "diplomatic": "Phrase points tactfully to avoid friction while still making the case.",
    "adaptive": "Vary the style based on who is in the room and what the moment needs.",
  }[profile.communicationStyle] || "Be confident and clear.";

  return `You are preparing a ${profile.role} for an important meeting.

PROFESSIONAL PROFILE:
Name: ${profile.name}
Role: ${profile.role}${profile.company ? " at " + profile.company : ""}
${profile.company ? "Company intelligence: Draw on everything you know about " + profile.company + " — their industry, business model, products, competitors and regulatory environment — to make talking points specific and credible. If " + profile.company + " is not well known, use the background context instead." : ""}
Key expertise: ${profile.expertise.join(", ")}
Communication style: ${prepStyleGuide}
${profile.jobContext ? "Background: " + profile.jobContext : ""}
${profile.meetingObjective ? "Typically trying to achieve: " + profile.meetingObjective : ""}
${profile.typicalAudience ? "Usual audience: " + profile.typicalAudience : ""}
${profile.writingSample ? "WRITING STYLE — mirror this person natural voice in all talking points: \"" + profile.writingSample + "\"" : ""}

MEETING DETAILS:
Topic: ${topic}
Goal: ${goal}
Attendees: ${attendees}
Expected topics / concerns: ${concerns}
${data ? "Relevant data / context: " + data : ""}

Generate a concise pre-meeting brief. Keep every point SHORT — one punchy sentence max per bullet. No paragraphs.

Respond ONLY with a JSON array, no markdown, no preamble:
[
  { "type": "Opening",               "points": ["One-line opener...", "Second point if needed..."], "note": "when to use" },
  { "type": "Key Arguments",         "points": ["Argument 1 — short & sharp", "Argument 2", "Argument 3"], "note": "lead with these" },
  { "type": "Data Points",           "points": ["Specific stat or figure", "Second data point"], "note": "have these ready" },
  { "type": "Anticipated Objection", "points": ["Likely pushback..."], "note": "be ready for this" },
  { "type": "Rebuttal",              "points": ["Sharp one-line response...", "Follow-up if needed..."], "note": "fire back with this" },
  { "type": "Close / Ask",           "points": ["Specific ask — what you want to leave with"], "note": "end on this" }
]`;
}

function buildSummaryPrompt(profile, transcript, goal, prepTopic, prepAttendees) {
  const fullText = transcript.map(t => t.text).join(" ");
  return `You are debriefing a ${profile.role} after a meeting. Analyse the transcript and produce a structured post-meeting summary tailored to their profile.

PROFESSIONAL PROFILE:
Name: ${profile.name}
Role: ${profile.role}${profile.company ? " at " + profile.company : ""}
${profile.company ? "Company context: Use your knowledge of " + profile.company + " to make the debrief and lessons more specific and relevant to their industry." : ""}
Expertise: ${profile.expertise.join(", ")}
Communication style: ${profile.communicationStyle || "balanced"}
${profile.jobContext ? "Background: " + profile.jobContext : ""}

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
  "Key Arguments":         { border: "#16a34a", bg: "#f0fdf4", badge: "#dcfce7", badgeText: "#15803d" },
  "Opening":               { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8" },
  "Rebuttal":              { border: "#dc2626", bg: "#fef2f2", badge: "#fee2e2", badgeText: "#b91c1c" },
  "Rebuttals":             { border: "#dc2626", bg: "#fef2f2", badge: "#fee2e2", badgeText: "#b91c1c" },
  "Data Point":            { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8" },
  "Data Points":           { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8" },
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
  const textToCopy = item.points ? item.points.join("\n• ") : item.text;
  const copy = () => { navigator.clipboard.writeText(item.points ? "• " + textToCopy : textToCopy); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div style={{ background: s.bg, border: "1px solid #e5e7eb", borderLeft: `4px solid ${s.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10, animation: `slideIn 0.25s ease ${index * 0.06}s both`, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <span style={{ background: s.badge, color: s.badgeText, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", fontFamily: "monospace", padding: "2px 8px", borderRadius: 4 }}>{item.type}</span>
        <button onClick={copy} style={{ marginLeft: "auto", background: "white", border: "1px solid #d1d5db", color: "#6b7280", borderRadius: 5, padding: "2px 9px", fontSize: 11, cursor: "pointer", fontFamily: "monospace" }}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      {item.points ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {item.points.map((pt, i) => (
            <li key={i} style={{ color: "#1f2937", fontSize: 13, lineHeight: 1.55, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 500 }}>{pt}</li>
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
  const base = { width: "100%", background: "white", border: "1px solid #d1d5db", borderRadius: 9, color: "#1f2937", padding: "11px 14px", fontSize: 15, outline: "none", fontFamily: "'Plus Jakarta Sans', sans-serif", marginTop: 6 };
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ fontSize: 12, color: "#6b7280", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{label}</label>
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

  const totalSteps = 9;

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
    if (step === 5) return profile.writingSample && profile.writingSample.trim().length > 20;
    if (step === 8) return consentGiven;
    return true;
  };

  const finish = () => {
    localStorage.setItem("copilot_profile", JSON.stringify(profile));
    localStorage.setItem("copilot_onboarded", "true");
    onComplete(profile);
  };

  const btnStyle = (active) => ({
    background: active ? "#6D28D9" : "white",
    color: active ? "white" : "#374151",
    border: active ? "2px solid #6D28D9" : "2px solid #E4DCFB",
    borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer",
    fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: active ? 600 : 400,
    transition: "all 0.15s",
  });

  const Progress = ({ step, total }) => {
    const phase = step <= 3 ? "Setting up your profile…" : step <= 7 ? "Personalising your suggestions…" : "Almost ready…";
    return (
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? "#6D28D9" : "#EDE9FE", transition: "background 0.3s" }} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#9B8FC0", fontFamily: "monospace" }}>{phase}</span>
          <span style={{ fontSize: 11, color: "#C4B5FD", fontFamily: "monospace" }}>{step + 1} of {total}</span>
        </div>
      </div>
    );
  };

  const NavButtons = ({ nextLabel = "Continue →", onNext, disabled }) => (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28 }}>
      {step > 0
        ? <button onClick={() => setStep(s => s - 1)} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>← Back</button>
        : <div />}
      <button onClick={onNext || (() => setStep(s => s + 1))} disabled={disabled ?? !canNext()} style={{
        background: (disabled ?? !canNext()) ? "#F5F3FF" : "#6D28D9",
        color: (disabled ?? !canNext()) ? "#C4B5FD" : "white",
        border: "none", borderRadius: 10, padding: "14px 32px",
        fontSize: 16, fontWeight: 600, cursor: (disabled ?? !canNext()) ? "not-allowed" : "pointer",
        fontFamily: "'Plus Jakarta Sans', sans-serif", boxShadow: (disabled ?? !canNext()) ? "none" : "0 2px 8px rgba(109,40,217,0.3)",
        transition: "all 0.15s",
      }}>{nextLabel}</button>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0fdf4 0%, #eff6ff 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,700;0,9..144,900&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        @keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box}
        input,textarea{outline:none}
        button{cursor:pointer;transition:all .15s}
        input::placeholder,textarea::placeholder{color:#9ca3af}
      `}</style>

      <div style={{ width: "100%", maxWidth: 640 }}>

        {/* Step 0 — Welcome */}
        {step === 0 && (
          <div key={step} style={{ background: "white", borderRadius: 18, padding: "40px 48px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 640, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ width: 64, height: 64, background: "#3B0764", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 20px", boxShadow: "0 4px 20px rgba(59,7,100,0.35)" }}>⚡</div>
              <h1 style={{ margin: "0 0 10px", fontSize: 26, fontWeight: 700, color: "#3B0764", letterSpacing: "-0.02em", fontFamily: "'Fraunces', Georgia, serif" }}>Welcome to Unmute</h1>
              <p style={{ margin: 0, color: "#6b7280", fontSize: 14, lineHeight: 1.7 }}>Your AI co-pilot for Zoom, Google Meet, and Teams. Get real-time talking points, rebuttals, and expert insights — tailored to your role — right as the conversation unfolds.</p>
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
          <div key={step} style={{ background: "white", borderRadius: 18, padding: "40px 48px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 640, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Tell us about yourself</h2>
            <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 15 }}>This helps Unmute tailor every suggestion to your specific role on video calls.</p>
            <Field label="Your Name *" value={profile.name} onChange={v => update("name", v)} placeholder="e.g. John" />
            <Field label="Your Job Title / Role *" value={profile.role} onChange={v => update("role", v)} placeholder="e.g. Paid Media & Marketing Measurement Analyst" />
            <NavButtons />
          </div>
        )}

        {/* Step 2 — Role Type */}
        {step === 2 && (
          <div key={step} style={{ background: "white", borderRadius: 18, padding: "40px 48px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 640, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#111827" }}>What best describes your role?</h2>
            <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 14 }}>We'll pre-load the most relevant skills for your role — so your video call suggestions are always on point.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
              {ROLE_PACKS.map(pack => (
                <button key={pack.id} onClick={() => selectRolePack(pack)} style={{
                  background: selectedRole === pack.id ? "#f0fdf4" : "#f9fafb",
                  color: selectedRole === pack.id ? "#15803d" : "#374151",
                  border: selectedRole === pack.id ? "2px solid #16a34a" : "2px solid #e5e7eb",
                  borderRadius: 12, padding: "16px 18px", fontSize: 14,
                  fontSize: "14px", fontFamily: "'Plus Jakarta Sans', sans-serif",
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
          <div key={step} style={{ background: "white", borderRadius: 18, padding: "40px 48px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 640, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#111827" }}>Your areas of expertise</h2>
            <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 14 }}>We've pre-selected skills based on your role — add or remove anything to match your expertise.</p>
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

        {/* Step 4 — Professional Profile */}
        {step === 4 && (
          <div key={step} style={{ background: "white", borderRadius: 18, padding: "40px 48px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 640, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Tell us about your work</h2>
            <p style={{ margin: "0 0 22px", color: "#6b7280", fontSize: 14 }}>The more context you give, the more personalised your suggestions will be. All fields optional but highly recommended.</p>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "#6D28D9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>Company / Organisation</label>
              <input value={profile.company || ""} onChange={e => update("company", e.target.value)} placeholder="e.g. Digibright Consulting" style={{ width: "100%", background: "white", border: "1px solid #DDD6FE", borderRadius: 8, color: "#1E1033", padding: "11px 14px", fontSize: 15, outline: "none", fontFamily: "'Plus Jakarta Sans', sans-serif", marginTop: 6 }} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "#6D28D9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>What do you do day to day?</label>
              <textarea value={profile.jobContext || ""} onChange={e => update("jobContext", e.target.value)} placeholder="e.g. I manage paid media campaigns across Meta and Google, run incrementality tests, and report MMM results to senior stakeholders and clients." rows={3} style={{ width: "100%", background: "white", border: "1px solid #DDD6FE", borderRadius: 8, color: "#1E1033", padding: "11px 14px", fontSize: 15, outline: "none", fontFamily: "'Plus Jakarta Sans', sans-serif", marginTop: 6, resize: "vertical" }} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "#6D28D9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>What are you typically trying to achieve in meetings?</label>
              <textarea value={profile.meetingObjective || ""} onChange={e => update("meetingObjective", e.target.value)} placeholder="e.g. Get budget approved, defend measurement strategy, influence senior stakeholders, present campaign results." rows={2} style={{ width: "100%", background: "white", border: "1px solid #DDD6FE", borderRadius: 8, color: "#1E1033", padding: "11px 14px", fontSize: 15, outline: "none", fontFamily: "'Plus Jakarta Sans', sans-serif", marginTop: 6, resize: "vertical" }} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "#6D28D9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>Who do you typically meet with?</label>
              <input value={profile.typicalAudience || ""} onChange={e => update("typicalAudience", e.target.value)} placeholder="e.g. CMO, CFO, clients, cross-functional teams, agency partners" style={{ width: "100%", background: "white", border: "1px solid #DDD6FE", borderRadius: 8, color: "#1E1033", padding: "11px 14px", fontSize: 15, outline: "none", fontFamily: "'Plus Jakarta Sans', sans-serif", marginTop: 6 }} />
            </div>

            <div style={{ marginTop: 18 }}>
              <label style={{ fontSize: 12, color: "#6D28D9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, display: "block", marginBottom: 10 }}>How do you want to come across in meetings?</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {COMMUNICATION_STYLES.map(style => (
                  <button key={style.id} onClick={() => update("communicationStyle", style.id)} style={{
                    background: profile.communicationStyle === style.id ? "#F5F3FF" : "white",
                    border: profile.communicationStyle === style.id ? "2px solid #6D28D9" : "2px solid #E4DCFB",
                    borderRadius: 10, padding: "14px 14px", cursor: "pointer",
                    textAlign: "left", transition: "all 0.15s",
                    display: "flex", alignItems: "flex-start", gap: 8,
                  }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{style.icon}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: profile.communicationStyle === style.id ? "#5B21B6" : "#1E1033", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{style.label}</div>
                      <div style={{ fontSize: 13, color: "#9B8FC0", lineHeight: 1.4, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{style.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "12px 14px", marginTop: 14 }}>
              <p style={{ margin: 0, fontSize: 12, color: "#5B21B6", lineHeight: 1.6 }}>
                💡 This shapes how Unmute phrases suggestions — so they sound like you, not like a generic AI.
              </p>
            </div>

            <NavButtons disabled={false} />
          </div>
        )}

        {/* Step 5 — Your Voice / Writing Sample */}
        {step === 5 && (
          <div key={step} style={{ background: "white", borderRadius: 18, padding: "40px 48px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 640, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Your voice</h2>
            <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 15, lineHeight: 1.6 }}>Paste 2-3 sentences you've actually written at work — an email, a Slack message, a report. Unmute will match your natural style in every suggestion.</p>

            <textarea
              value={profile.writingSample || ""}
              onChange={e => update("writingSample", e.target.value)}
              placeholder="e.g. Quick update on the May results — the numbers are pretty clear that UK spend is not delivering incremental return. My recommendation is we pause it and reallocate before June locks in."
              rows={5}
              style={{ width: "100%", background: "white", border: "1px solid #DDD6FE", borderRadius: 10, color: "#1E1033", padding: "14px 16px", fontSize: 14, outline: "none", fontFamily: "'Plus Jakarta Sans', sans-serif", resize: "vertical", lineHeight: 1.7 }}
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 14 }}>
              {[
                { label: "📧 Email", example: "Hey team — just wanted to flag that the Q2 numbers are in and they're looking strong. Happy to walk everyone through the highlights on Friday's call." },
                { label: "💬 Slack", example: "Quick heads up — the budget meeting got moved to 3pm. I'd recommend we align on the key numbers before then so we're all on the same page." },
                { label: "📄 Report", example: "The data shows a clear pattern across all three markets. Paid social is consistently outperforming search on incremental return, particularly in the 25-34 demographic." },
              ].map((ex, i) => (
                <button key={i} onClick={() => update("writingSample", ex.example)} style={{
                  background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 8,
                  padding: "8px 10px", cursor: "pointer", textAlign: "left", fontSize: 11,
                  color: "#5B21B6", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600,
                }}>
                  {ex.label}
                  <div style={{ fontSize: 10, color: "#9B8FC0", fontWeight: 400, marginTop: 3, lineHeight: 1.4 }}>Use this example</div>
                </button>
              ))}
            </div>

            {profile.writingSample && profile.writingSample.trim().length > 20 && (
              <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 8, padding: "10px 14px", marginTop: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>✓</span>
                <p style={{ margin: 0, fontSize: 12, color: "#5B21B6", lineHeight: 1.6 }}>
                  Got it — Unmute will match your vocabulary, sentence length, and tone in every suggestion.
                </p>
              </div>
            )}

            <NavButtons />
          </div>
        )}

        {/* Step 6 — Meeting Type */}
        {step === 6 && (
          <div key={step} style={{ background: "white", borderRadius: 18, padding: "40px 48px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 640, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#111827" }}>What type of meetings do you mostly attend?</h2>
            <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>This tells Unmute what type of video calls you attend most so suggestions are always relevant.</p>
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

        {/* Step 7 — Language */}
        {step === 7 && (
          <div key={step} style={{ background: "white", borderRadius: 18, padding: "40px 48px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 640, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#111827" }}>What language are your meetings in?</h2>
            <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>On international video calls? Unmute listens in your meeting language and delivers all suggestions in English.</p>
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

        {/* Step 8 — Tutorial */}
        {step === 8 && (
          <div key={step} style={{ background: "white", borderRadius: 18, padding: "40px 48px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 640, animation: "slideIn 0.3s ease" }}>
            <Progress step={step} total={totalSteps} />
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#111827" }}>How it works</h2>
            <p style={{ margin: "0 0 22px", color: "#6b7280", fontSize: 13 }}>A quick guide before you jump in.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 8 }}>
              {[
                { icon: "⚙", color: "#2563eb", bg: "#eff6ff", title: "Before the meeting — Prep tab", desc: "Enter the meeting topic, who's attending, your goal, and any data you want to reference. Click Generate and get a full personalised brief with talking points, anticipated objections, and a close." },
                { icon: "●", color: "#16a34a", bg: "#f0fdf4", title: "During the meeting — Live tab", desc: "Click Start Listening and your mic picks up the conversation. Every ~18 seconds, AI suggestions appear on the right. Hit ↻ Refresh any time for instant suggestions." },
                { icon: "💬", color: "#7c3aed", bg: "#f5f3ff", title: "Ask AI anything", desc: "Use the Ask AI bar at the bottom to instantly ask anything mid-call — \"How do I respond to that?\" or \"What's a strong data point here?\" — get an expert answer in seconds." },
                { icon: "📋", color: "#d97706", bg: "#fffbeb", title: "Copy any suggestion", desc: "Each card has a Copy button. Paste it into your notes or use it as a script for what to say next." },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: item.bg, border: "1px solid #f3f4f6", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: item.color, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{item.icon}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#111827", marginBottom: 4 }}>{item.title}</div>
                    <div style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.6 }}>{item.desc}</div>
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
                <span style={{ fontSize: 14, color: "#374151", lineHeight: 1.6 }}>
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
  const [showChat, setShowChat] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const [prepTopic, setPrepTopic]       = useState("");
  const [prepAttendees, setPrepAttendees] = useState("");
  const [prepGoal, setPrepGoal]         = useState("");
  const [prepConcerns, setPrepConcerns] = useState("");
  const [prepData, setPrepData]         = useState("");
  const [prepPoints, setPrepPoints]     = useState([]);
  const [prepLoading, setPrepLoading]   = useState(false);
  const [prepError, setPrepError]       = useState("");

  const [savedMeetings, setSavedMeetings] = useState(() => {
    try { return JSON.parse(localStorage.getItem("unmute_saved_meetings") || "[]"); } catch { return []; }
  });
  const [showPlanner, setShowPlanner]   = useState(false);

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

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatHistory(prev => [...prev, { role: "user", text: userMsg }]);
    setChatLoading(true);
    try {
      const recentTranscript = transcriptRef.current.slice(-10).map(t => t.text).join(" ");
      const historyText = chatHistory.slice(-6).map(m => `${m.role === "user" ? "You" : "AI"}: ${m.text}`).join("\n");
      const chatStyle = {
        "data-driven": "Use numbers and evidence in your answer.",
        "strategic": "Frame your answer around direction and priorities.",
        "collaborative": "Phrase your answer to help them bring people along.",
        "direct": "Answer directly and briefly — no fluff.",
        "diplomatic": "Answer tactfully.",
        "adaptive": "Match the tone of the question.",
      }[profile.communicationStyle] || "Be clear and confident.";
      const prompt = `You are a real-time AI assistant for a ${profile.role}${profile.company ? " at " + profile.company : ""} on a video call. ${chatStyle}\n${profile.company ? "Draw on your knowledge of " + profile.company + " — their industry, products, competitors and business model — to give relevant answers." : ""}\nExpertise: ${profile.expertise.join(", ")}\n${profile.jobContext ? "Background: " + profile.jobContext : ""}\n${profile.writingSample ? "Mirror their writing style: \"" + profile.writingSample + "\"" : ""}\nRecent transcript: "${recentTranscript || "No transcript yet"}"\n${historyText ? "Chat history:\n" + historyText : ""}\n\nQuestion: ${userMsg}\n\nAnswer in 1-3 sentences. Only use company or expertise knowledge if directly relevant. No preamble.`;
      const raw = await callClaudeFast(prompt);
      const cleanResponse = raw.replace(/^\[|\]$/g, '').replace(/^"|"$/g, '').trim();
      setChatHistory(prev => [...prev, { role: "ai", text: cleanResponse }]);
    } catch (e) {
      console.error(e);
      setChatHistory(prev => [...prev, { role: "ai", text: "Sorry, couldn't get a response. Try again." }]);
    }
    setChatLoading(false);
  };

  const saveMeeting = () => {
    if (!prepTopic.trim()) return;
    const meeting = {
      id: Date.now(),
      savedAt: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
      topic: prepTopic, attendees: prepAttendees, goal: prepGoal,
      concerns: prepConcerns, data: prepData,
    };
    const updated = [meeting, ...savedMeetings].slice(0, 10);
    setSavedMeetings(updated);
    localStorage.setItem("unmute_saved_meetings", JSON.stringify(updated));
  };

  const loadMeeting = (meeting) => {
    setPrepTopic(meeting.topic);
    setPrepAttendees(meeting.attendees);
    setPrepGoal(meeting.goal);
    setPrepConcerns(meeting.concerns);
    setPrepData(meeting.data);
    setShowPlanner(false);
  };

  const deleteMeeting = (id) => {
    const updated = savedMeetings.filter(m => m.id !== id);
    setSavedMeetings(updated);
    localStorage.setItem("unmute_saved_meetings", JSON.stringify(updated));
  };

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
    <div style={{ height: "100vh", background: "#F5F3FF", fontFamily: "'Plus Jakarta Sans', 'Helvetica Neue', sans-serif", color: "#1E1033", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,700;0,9..144,900;1,9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        @keyframes slideIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#f3f4f6}
        ::-webkit-scrollbar-thumb{background:#C4B5FD;border-radius:2px}
        input,textarea{outline:none}
        button{cursor:pointer;transition:all .15s}
        button:hover{opacity:.85}
        textarea{resize:vertical}
        input::placeholder,textarea::placeholder{color:#9B8FC0}
      `}</style>

      {/* Header */}
      <div style={{ background: "#3B0764", padding: "0 22px", height: 56, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginRight: 6 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontFamily: "'Fraunces', Georgia, serif", fontWeight: 700, color: "white" }}>U</div>
          <div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 700, fontSize: 16, color: "white", letterSpacing: "-0.01em", lineHeight: 1.2 }}>Unmute</div>
            <div style={{ fontSize: 10, color: "rgba(196,181,253,0.8)" }}>{profile.name} · {profile.role}</div>
          </div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.1)", borderRadius: 9, padding: 3, gap: 2 }}>
          {[{ key: "prep", label: "Prep" }, { key: "live", label: "Live" }, { key: "summary", label: "Summary" }].map(({ key, label }) => (
            <button key={key} onClick={() => setMode(key)} style={{ background: mode === key ? "rgba(255,255,255,0.18)" : "transparent", border: "none", color: mode === key ? "white" : "rgba(196,181,253,0.7)", borderRadius: 7, padding: "6px 16px", fontSize: 12, fontWeight: mode === key ? 600 : 400, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{label}</button>
          ))}
        </div>

        {/* Live status */}
        {mode === "live" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.1)", borderRadius: 20, padding: "4px 12px" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusInfo[liveStatus].color, animation: ["listening","thinking"].includes(liveStatus) ? `pulse ${liveStatus === "thinking" ? "0.6s" : "2s"} infinite` : "none" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", fontWeight: 500 }}>{statusInfo[liveStatus].label}</span>
            {lastUpdated && <span style={{ fontSize: 10, color: "rgba(196,181,253,0.6)", marginLeft: 2 }}>· {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          </div>
        )}

        {/* Language */}
        <div style={{ marginLeft: "auto", position: "relative" }}>
          <button onClick={() => setShowLangMenu(p => !p)} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.9)", borderRadius: 8, padding: "5px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 7 }}>
            <span>{language.flag}</span><span style={{ fontWeight: 500 }}>{language.label}</span><span style={{ fontSize: 9, color: "rgba(196,181,253,0.6)" }}>▼</span>
          </button>
          {showLangMenu && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "white", border: "1px solid #DDD6FE", borderRadius: 10, overflow: "hidden", zIndex: 100, minWidth: 160, boxShadow: "0 8px 32px rgba(59,7,100,0.2)" }}>
              {LANGUAGES.map(l => (
                <button key={l.code} onClick={() => { setLanguage(l); setShowLangMenu(false); if (isListening) stopListening(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: language.code === l.code ? "#F5F3FF" : "white", border: "none", color: language.code === l.code ? "#6D28D9" : "#374151", padding: "10px 15px", fontSize: 13, textAlign: "left", fontWeight: language.code === l.code ? 600 : 400 }}>
                  <span>{l.flag}</span><span>{l.label}</span>{language.code === l.code && <span style={{ marginLeft: "auto", color: "#6D28D9" }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Edit profile */}
        <button onClick={onEditProfile} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.85)", borderRadius: 8, padding: "5px 12px", fontSize: 12 }}>
          Edit Profile
        </button>

        {/* Live controls */}
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

            {/* Saved Meetings Planner */}
            <div style={{ marginBottom: 20 }}>
              <button onClick={() => setShowPlanner(p => !p)} style={{ width: "100%", background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "#5B21B6", fontSize: 13, fontWeight: 600 }}>
                <span>📅</span>
                <span>Planned Meetings</span>
                <span style={{ marginLeft: "auto", background: "#EDE9FE", color: "#6D28D9", fontSize: 10, fontFamily: "monospace", fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>{savedMeetings.length}</span>
                <span style={{ fontSize: 10, color: "#9B8FC0" }}>{showPlanner ? "▲" : "▼"}</span>
              </button>
              {showPlanner && (
                <div style={{ border: "1px solid #DDD6FE", borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
                  {savedMeetings.length === 0 ? (
                    <div style={{ padding: "16px 14px", textAlign: "center", color: "#C4B5FD", fontSize: 12, fontStyle: "italic" }}>
                      No saved meetings yet — save a brief below to access it before future meetings.
                    </div>
                  ) : savedMeetings.map((m, i) => (
                    <div key={m.id} style={{ padding: "10px 14px", borderBottom: i < savedMeetings.length - 1 ? "1px solid #F5F3FF" : "none", display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#3B0764", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.topic}</div>
                        <div style={{ fontSize: 11, color: "#9B8FC0", fontFamily: "monospace" }}>{m.savedAt}</div>
                      </div>
                      <button onClick={() => loadMeeting(m)} style={{ background: "#6D28D9", border: "none", color: "white", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Load</button>
                      <button onClick={() => deleteMeeting(m.id)} style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#DC2626", borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 22 }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Meeting Brief Builder</h2>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Fill in the details and generate personalised talking points before your meeting.</p>
            </div>
            <Field label="Meeting Topic *"             value={prepTopic}     onChange={setPrepTopic}     placeholder="e.g. Q3 Marketing Budget Review" />
            <Field label="Attendees & Their Roles"     value={prepAttendees} onChange={setPrepAttendees} placeholder="e.g. CMO (Sarah), CFO (James), Head of Brand (Tom)" multiline rows={2} />
            <Field label="Your Goal for This Meeting"  value={prepGoal}      onChange={setPrepGoal}      placeholder="e.g. Get sign-off on Q3 incrementality testing budget" />
            <Field label="Expected Topics / Concerns"  value={prepConcerns}  onChange={setPrepConcerns}  placeholder="e.g. Budget cuts, ROI of measurement tools, channel performance" multiline rows={3} />
            <Field label="Data / Context to Reference" value={prepData}      onChange={setPrepData}      placeholder="e.g. MMM showed paid social drove 34% incremental revenue last quarter" multiline rows={3} />
            {prepError && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#dc2626", fontSize: 12, fontFamily: "monospace" }}>⚠ {prepError}</div>}
            <button onClick={generatePrep} disabled={prepLoading} style={{ width: "100%", background: "#6D28D9", border: "none", color: "white", borderRadius: 10, padding: "13px", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, boxShadow: "0 2px 8px rgba(109,40,217,0.3)" }}>
              {prepLoading ? <><div style={{ width: 14, height: 14, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />Generating Brief…</> : "⚡  Generate Meeting Brief"}
            </button>
            {prepTopic.trim() && (
              <button onClick={saveMeeting} style={{ width: "100%", marginTop: 10, background: "white", border: "1px solid #DDD6FE", color: "#5B21B6", borderRadius: 10, padding: "11px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                📅 Save for Later
              </button>
            )}
            {prepPoints.length > 0 && <button onClick={() => setMode("live")} style={{ width: "100%", marginTop: 10, background: "#F5F3FF", border: "1px solid #C4B5FD", color: "#6D28D9", borderRadius: 10, padding: "12px", fontSize: 13, fontWeight: 600 }}>→ Enter Live Mode</button>}
          </div>
          <div style={{ overflowY: "auto", padding: "24px 26px", background: "#F5F3FF" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Your Talking Points</h2>
              {prepPoints.length > 0 && <span style={{ background: "#EDE9FE", color: "#6D28D9", fontSize: 11, fontWeight: 700, fontFamily: "monospace", padding: "2px 9px", borderRadius: 20 }}>{prepPoints.length} cards</span>}
            </div>
            {prepPoints.length === 0 && !prepLoading && <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 12, padding: "32px 24px", textAlign: "center", color: "#9B8FC0" }}><div style={{ fontSize: 32, marginBottom: 12 }}>📋</div><p style={{ margin: 0, fontSize: 13, lineHeight: 1.8 }}>Fill in the form and click Generate —<br />your personalised brief will appear here.</p></div>}
            {prepLoading && <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}><div style={{ width: 24, height: 24, border: "3px solid #6D28D9", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 14px" }} /><p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Building your brief…</p></div>}
            {prepPoints.map((p, i) => <SuggestionCard key={i} item={p} index={i} showNote={true} />)}
          </div>
        </div>
      )}


      {/* SUMMARY MODE */}
      {mode === "summary" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", maxWidth: 900, margin: "0 auto", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div>
              <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Meeting Summary</h2>
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
              <button onClick={generateSummary} disabled={summaryLoading || transcript.length === 0} style={{ background: summaryLoading || transcript.length === 0 ? "#F5F3FF" : "#6D28D9", border: "none", color: summaryLoading || transcript.length === 0 ? "#9B8FC0" : "white", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, boxShadow: summaryLoading || transcript.length === 0 ? "none" : "0 2px 8px rgba(109,40,217,0.3)" }}>
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
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#EDE9FE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📌</div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>What Was Discussed</span>
                  <span style={{ background: "#EDE9FE", color: "#6D28D9", fontSize: 10, fontFamily: "monospace", fontWeight: 700, padding: "2px 8px", borderRadius: 10, marginLeft: "auto" }}>{summary.summary.length} points</span>
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
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Your Contribution</span>
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
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Lessons for Next Time</span>
                </div>
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {summary.lessons.map((l, i) => (
                    <div key={i} style={{ borderLeft: "4px solid #6D28D9", background: "#F5F3FF", borderRadius: "0 10px 10px 0", padding: "12px 14px" }}>
                      <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13, color: "#4C1D95" }}>{l.title}</p>
                      <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{l.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Next Meeting Prep */}
              <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", marginBottom: 32 }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🚀</div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#3B0764", fontFamily: "'Fraunces', Georgia, serif" }}>Prep for Next Meeting</span>
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
          <div style={{ background: "#F5F3FF", borderBottom: "1px solid #DDD6FE", padding: "9px 22px", display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 12, color: "#6D28D9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, whiteSpace: "nowrap" }}>Goal</span>
            <input value={sessionGoal} onChange={e => setSessionGoal(e.target.value)} placeholder="Set your goal for this meeting…" style={{ flex: 1, background: "white", border: "1px solid #DDD6FE", borderRadius: 8, color: "#1E1033", padding: "7px 12px", fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif" }} />
            {language.code !== "en-US" && <div style={{ background: "#EDE9FE", border: "1px solid #C4B5FD", borderRadius: 7, padding: "5px 12px", fontSize: 11, color: "#5B21B6", fontFamily: "monospace", whiteSpace: "nowrap", fontWeight: 600 }}>{language.flag} → 🇬🇧 auto-translate on</div>}
          </div>

          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", overflow: "hidden", minHeight: 0 }}>
            <div style={{ background: "white", borderRight: "1px solid #DDD6FE", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "11px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563eb" }} />
                <span style={{ fontSize: 11, color: "#5B21B6", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Pre-Meeting Brief</span>
                <span style={{ marginLeft: "auto", background: "#EDE9FE", color: "#6D28D9", fontSize: 10, fontFamily: "monospace", fontWeight: 700, padding: "1px 8px", borderRadius: 10 }}>{prepPoints.length} pts</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
                {prepPoints.length === 0 ? <div style={{ color: "#C4B5FD", fontSize: 13, fontStyle: "italic", textAlign: "center", paddingTop: 24, lineHeight: 1.8 }}><div style={{ fontSize: 28, marginBottom: 10 }}>📝</div>No brief yet —<br />go to Prep tab to generate one.</div> : prepPoints.map((p, i) => <SuggestionCard key={i} item={p} index={i} showNote={true} />)}
              </div>
            </div>

            <div style={{ background: "#F5F3FF", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ background: "#F5F3FF", padding: "11px 20px", borderBottom: "1px solid #DDD6FE", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a", animation: isListening ? "pulse 2s infinite" : "none" }} />
                <span style={{ fontSize: 11, color: "#5B21B6", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Live Suggestions</span>
                {liveStatus === "thinking" && <div style={{ width: 12, height: 12, border: "2px solid #7C3AED", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", marginLeft: 2 }} />}
                <button onClick={fetchLiveSuggestions} disabled={transcript.length === 0} style={{ marginLeft: "auto", background: "#EDE9FE", border: "1px solid #C4B5FD", color: "#6D28D9", borderRadius: 7, padding: "4px 11px", fontSize: 11, fontFamily: "monospace", fontWeight: 600, opacity: transcript.length === 0 ? 0.35 : 1 }}>↻ Refresh</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
                {liveSuggestions.length === 0 && liveStatus !== "thinking" && <div style={{ color: "#C4B5FD", fontSize: 13, fontStyle: "italic", textAlign: "center", paddingTop: 24, lineHeight: 1.8 }}><div style={{ fontSize: 28, marginBottom: 10 }}>💬</div>{transcript.length > 0 ? "Click ↻ Refresh or wait ~18s for auto-update." : "Start listening or add transcript text below."}</div>}
                {liveSuggestions.map((s, i) => <SuggestionCard key={i} item={s} index={i} showNote={false} />)}
                {liveError && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#dc2626", fontSize: 12, fontFamily: "monospace" }}>⚠ {liveError}</div>}
              </div>
            </div>
          </div>

          {/* Ask AI Bottom Bar */}
          <div style={{ background: "white", borderTop: "1px solid #DDD6FE", flexShrink: 0 }}>
            {chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === "ai" && (
              <div style={{ padding: "10px 22px", background: "#F5F3FF", borderBottom: "1px solid #DDD6FE", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#3B0764", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "white", fontWeight: 700, flexShrink: 0, marginTop: 1 }}>U</div>
                <p style={{ margin: 0, fontSize: 13, color: "#1E1033", lineHeight: 1.55, fontFamily: "'Georgia', serif", flex: 1 }}>
                  {chatHistory[chatHistory.length - 1].text}
                </p>
              </div>
            )}
            <div style={{ padding: "10px 22px", display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#6D28D9" }} />
                <span style={{ fontSize: 12, color: "#6D28D9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>Ask AI</span>
              </div>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") sendChat(); }}
                placeholder="Ask anything — e.g. How should I respond to that objection?"
                style={{ flex: 1, background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 9, color: "#1E1033", padding: "9px 14px", fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif", outline: "none" }}
              />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{ background: "#6D28D9", border: "none", color: "white", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: chatLoading || !chatInput.trim() ? 0.45 : 1, display: "flex", alignItems: "center", gap: 6, boxShadow: "0 2px 8px rgba(109,40,217,0.25)" }}>
                {chatLoading ? <div style={{ width: 13, height: 13, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> : "Send →"}
              </button>
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