import { useState, useEffect, useRef, useCallback } from "react";

const API_KEY = import.meta.env.VITE_ANTHROPIC_KEY;

const PROFILE = {
  role: "Paid Media & Marketing Measurement Analyst",
  expertise: [
    "Incrementality testing & measurement (INCRMNTAL)",
    "Media Mix Modelling (MMM)",
    "Multi-touch attribution",
    "Paid media strategy (Meta, Google, programmatic)",
    "Campaign performance analysis & reporting",
    "Marketing ROI & budget optimisation",
    "Data-driven decision making & stakeholder communication",
    "A/B testing & experimentation frameworks",
  ],
  meetingContext: "Weekly marketing heads meeting with C-level attendees",
  tone: "Confident, data-backed, strategic",
};

const LANGUAGES = [
  { label: "English", code: "en-US", flag: "🇬🇧" },
  { label: "Hebrew",  code: "he-IL", flag: "🇮🇱" },
  { label: "French",  code: "fr-FR", flag: "🇫🇷" },
  { label: "Spanish", code: "es-ES", flag: "🇪🇸" },
  { label: "Arabic",  code: "ar-SA", flag: "🇸🇦" },
  { label: "German",  code: "de-DE", flag: "🇩🇪" },
];

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

function buildLivePrompt(transcript, goal, language, prepContext) {
  const translateNote = language.code !== "en-US"
    ? `The transcript may be in ${language.label}. Translate it to English first, then generate suggestions.`
    : "";
  return `You are a real-time meeting co-pilot for a senior professional. Suggest sharp, immediately usable talking points.

PROFESSIONAL PROFILE:
Role: ${PROFILE.role}
Expertise: ${PROFILE.expertise.join(", ")}
Tone: ${PROFILE.tone}
Meeting type: ${PROFILE.meetingContext}
${goal ? `Session goal: ${goal}` : ""}
${prepContext ? `Pre-meeting context: ${prepContext}` : ""}
${translateNote}

LAST 90 SECONDS OF CONVERSATION:
"${transcript}"

Generate 3 highly relevant suggestions the person can use RIGHT NOW. Each must be:
- Directly tied to something just said
- Grounded in paid media / measurement expertise where relevant
- Short and speakable (1-2 sentences max)
- All output must be in English

Respond ONLY with a JSON array, no markdown, no preamble:
[
  { "type": "Talking Point", "text": "..." },
  { "type": "Rebuttal", "text": "..." },
  { "type": "Data Insight", "text": "..." }
]
Types: Talking Point | Rebuttal | Data Insight | Question | Idea | Reframe | Close`;
}

function buildPrepPrompt(topic, attendees, goal, concerns, data) {
  return `You are preparing a senior Paid Media & Marketing Measurement Analyst for an important meeting.

PROFESSIONAL PROFILE:
Role: ${PROFILE.role}
Expertise: ${PROFILE.expertise.join(", ")}
Tone: ${PROFILE.tone}

MEETING DETAILS:
Topic: ${topic}
Goal: ${goal}
Attendees: ${attendees}
Expected topics / concerns: ${concerns}
${data ? `Relevant data / context: ${data}` : ""}

Generate a structured pre-meeting brief with talking points this person should be ready to deliver.

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

// ── Light-theme card colours (left border accent) ──────────────────────────
const TYPE_STYLES = {
  "Talking Point":         { border: "#16a34a", bg: "#f0fdf4", badge: "#dcfce7", badgeText: "#15803d", dot: "#16a34a" },
  "Key Argument":          { border: "#16a34a", bg: "#f0fdf4", badge: "#dcfce7", badgeText: "#15803d", dot: "#16a34a" },
  "Opening":               { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8", dot: "#2563eb" },
  "Rebuttal":              { border: "#dc2626", bg: "#fef2f2", badge: "#fee2e2", badgeText: "#b91c1c", dot: "#dc2626" },
  "Data Point":            { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8", dot: "#2563eb" },
  "Data Insight":          { border: "#2563eb", bg: "#eff6ff", badge: "#dbeafe", badgeText: "#1d4ed8", dot: "#2563eb" },
  "Anticipated Objection": { border: "#d97706", bg: "#fffbeb", badge: "#fef3c7", badgeText: "#b45309", dot: "#d97706" },
  "Question":              { border: "#7c3aed", bg: "#f5f3ff", badge: "#ede9fe", badgeText: "#6d28d9", dot: "#7c3aed" },
  "Idea":                  { border: "#0891b2", bg: "#ecfeff", badge: "#cffafe", badgeText: "#0e7490", dot: "#0891b2" },
  "Reframe":               { border: "#0891b2", bg: "#ecfeff", badge: "#cffafe", badgeText: "#0e7490", dot: "#0891b2" },
  "Close / Ask":           { border: "#d97706", bg: "#fffbeb", badge: "#fef3c7", badgeText: "#b45309", dot: "#d97706" },
  "Close":                 { border: "#d97706", bg: "#fffbeb", badge: "#fef3c7", badgeText: "#b45309", dot: "#d97706" },
};
const DEFAULT_STYLE = { border: "#94a3b8", bg: "#f8fafc", badge: "#f1f5f9", badgeText: "#475569", dot: "#94a3b8" };

function SuggestionCard({ item, index, showNote }) {
  const [copied, setCopied] = useState(false);
  const s = TYPE_STYLES[item.type] || DEFAULT_STYLE;
  const copy = () => {
    navigator.clipboard.writeText(item.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div style={{
      background: s.bg,
      border: "1px solid #e5e7eb",
      borderLeft: `4px solid ${s.border}`,
      borderRadius: 10,
      padding: "14px 16px",
      marginBottom: 10,
      animation: `slideIn 0.25s ease ${index * 0.06}s both`,
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <span style={{
          background: s.badge, color: s.badgeText,
          fontSize: 10, fontWeight: 700, letterSpacing: "0.07em",
          textTransform: "uppercase", fontFamily: "monospace",
          padding: "2px 8px", borderRadius: 4,
        }}>{item.type}</span>
        <button onClick={copy} style={{
          marginLeft: "auto", background: "white",
          border: "1px solid #d1d5db", color: "#6b7280",
          borderRadius: 5, padding: "2px 9px", fontSize: 11,
          cursor: "pointer", fontFamily: "monospace",
        }}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <p style={{ margin: 0, color: "#1f2937", fontSize: 13.5, lineHeight: 1.65, fontFamily: "'Georgia', serif" }}>
        {item.text}
      </p>
      {showNote && item.note && (
        <p style={{ margin: "8px 0 0", color: "#9ca3af", fontSize: 11, fontFamily: "monospace", borderTop: "1px solid #e5e7eb", paddingTop: 7 }}>
          ↳ {item.note}
        </p>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, multiline, rows = 3 }) {
  const base = {
    width: "100%", background: "white", border: "1px solid #d1d5db", borderRadius: 8,
    color: "#1f2937", padding: "9px 12px", fontSize: 13, outline: "none",
    fontFamily: "'DM Sans', sans-serif", marginTop: 5,
    transition: "border-color 0.15s",
  };
  return (
    <div style={{ marginBottom: 15 }}>
      <label style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
        {label}
      </label>
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{ ...base, resize: "vertical" }} />
        : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={base} />}
    </div>
  );
}

export default function MeetingCoPilot() {
  const [mode, setMode] = useState("prep");
  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [showLangMenu, setShowLangMenu] = useState(false);

  const [prepTopic, setPrepTopic]       = useState("");
  const [prepAttendees, setPrepAttendees] = useState("");
  const [prepGoal, setPrepGoal]         = useState("");
  const [prepConcerns, setPrepConcerns] = useState("");
  const [prepData, setPrepData]         = useState("");
  const [prepPoints, setPrepPoints]     = useState([]);
  const [prepLoading, setPrepLoading]   = useState(false);
  const [prepError, setPrepError]       = useState("");

  const [sessionGoal, setSessionGoal]       = useState("");
  const [isListening, setIsListening]       = useState(false);
  const [transcript, setTranscript]         = useState([]);
  const [liveSuggestions, setLiveSuggestions] = useState([]);
  const [liveStatus, setLiveStatus]         = useState("idle");
  const [lastUpdated, setLastUpdated]       = useState(null);
  const [manualText, setManualText]         = useState("");
  const [liveError, setLiveError]           = useState("");

  const recognitionRef = useRef(null);
  const transcriptRef  = useRef([]);
  const debounceRef    = useRef(null);
  const scrollRef      = useRef(null);

  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript]);

  const generatePrep = async () => {
    if (!prepTopic.trim()) { setPrepError("Please enter a meeting topic."); return; }
    setPrepLoading(true); setPrepError("");
    try {
      const raw = await callClaude(buildPrepPrompt(prepTopic, prepAttendees, prepGoal, prepConcerns, prepData));
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
      const raw = await callClaude(buildLivePrompt(recent, sessionGoal, language, prepContext));
      setLiveSuggestions(JSON.parse(raw));
      setLastUpdated(new Date());
      setLiveStatus("listening");
    } catch (e) { console.error(e); setLiveStatus("error"); setLiveError("Could not fetch suggestions."); }
  }, [sessionGoal, language, prepTopic, prepGoal]);

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

  const addManual = () => {
    if (!manualText.trim()) return;
    setTranscript(prev => [...prev, { id: Date.now(), text: manualText.trim() }]);
    setManualText(""); fetchLiveSuggestions();
  };

  const clearSession = () => {
    setTranscript([]); setLiveSuggestions([]); setLastUpdated(null);
    setLiveStatus(isListening ? "listening" : "idle");
  };

  const statusInfo = {
    idle:      { color: "#9ca3af", label: "Ready" },
    listening: { color: "#16a34a", label: "Listening" },
    thinking:  { color: "#d97706", label: "Analysing…" },
    error:     { color: "#dc2626", label: "Error" },
  };

  return (
    <div style={{ height: "100vh", background: "#f9fafb", fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", color: "#111827", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes slideIn { from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)} }
        @keyframes pulse   { 0%,100%{opacity:1}50%{opacity:0.4} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        * { box-sizing:border-box; }
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#f3f4f6}
        ::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:2px}
        input,textarea{outline:none}
        button{cursor:pointer;transition:opacity .15s, background .15s}
        button:hover{opacity:.85}
        textarea{resize:vertical}
        input::placeholder,textarea::placeholder{color:#9ca3af}
      `}</style>

      {/* ── Header ── */}
      <div style={{ background: "white", borderBottom: "1px solid #e5e7eb", padding: "12px 22px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginRight: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, boxShadow: "0 2px 6px rgba(22,163,74,0.3)" }}>⚡</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em", color: "#111827", lineHeight: 1.2 }}>Meeting Co‑Pilot</div>
            <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>Paid Media & Measurement</div>
          </div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 9, padding: 3, border: "1px solid #e5e7eb", gap: 2 }}>
          {[{ key: "prep", label: "⚙  Prep" }, { key: "live", label: "●  Live" }].map(({ key, label }) => (
            <button key={key} onClick={() => setMode(key)} style={{
              background: mode === key ? "white" : "transparent",
              border: "none",
              boxShadow: mode === key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              color: mode === key ? "#111827" : "#6b7280",
              borderRadius: 7, padding: "6px 18px", fontSize: 12, fontWeight: mode === key ? 600 : 400,
            }}>{label}</button>
          ))}
        </div>

        {/* Live status pill */}
        {mode === "live" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 20, padding: "4px 12px" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusInfo[liveStatus].color, animation: ["listening","thinking"].includes(liveStatus) ? `pulse ${liveStatus === "thinking" ? "0.6s" : "2s"} infinite` : "none" }} />
            <span style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>{statusInfo[liveStatus].label}</span>
            {lastUpdated && <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace", marginLeft: 2 }}>· {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          </div>
        )}

        {/* Language picker */}
        <div style={{ marginLeft: "auto", position: "relative" }}>
          <button onClick={() => setShowLangMenu(p => !p)} style={{ background: "white", border: "1px solid #d1d5db", color: "#374151", borderRadius: 8, padding: "6px 13px", fontSize: 12, display: "flex", alignItems: "center", gap: 7, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
            <span>{language.flag}</span>
            <span style={{ fontFamily: "monospace", fontWeight: 500 }}>{language.label}</span>
            <span style={{ fontSize: 9, color: "#9ca3af" }}>▼</span>
          </button>
          {showLangMenu && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "white", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", zIndex: 100, minWidth: 160, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
              {LANGUAGES.map(l => (
                <button key={l.code} onClick={() => { setLanguage(l); setShowLangMenu(false); if (isListening) stopListening(); }} style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  background: language.code === l.code ? "#f0fdf4" : "white",
                  border: "none", color: language.code === l.code ? "#15803d" : "#374151",
                  padding: "10px 15px", fontSize: 13, textAlign: "left", fontWeight: language.code === l.code ? 600 : 400,
                }}>
                  <span>{l.flag}</span><span>{l.label}</span>
                  {language.code === l.code && <span style={{ marginLeft: "auto", fontSize: 12 }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Live action buttons */}
        {mode === "live" && (
          <div style={{ display: "flex", gap: 8, marginLeft: 6 }}>
            <button onClick={clearSession} style={{ background: "white", border: "1px solid #d1d5db", color: "#6b7280", borderRadius: 8, padding: "6px 14px", fontSize: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
              Clear
            </button>
            <button onClick={isListening ? stopListening : startListening} style={{
              background: isListening ? "#fef2f2" : "#f0fdf4",
              border: `1px solid ${isListening ? "#fca5a5" : "#86efac"}`,
              color: isListening ? "#dc2626" : "#16a34a",
              borderRadius: 8, padding: "6px 16px", fontSize: 12, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 7,
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}>
              <div style={{ width: isListening ? 8 : 9, height: isListening ? 8 : 9, borderRadius: isListening ? 2 : "50%", background: isListening ? "#dc2626" : "#16a34a", animation: isListening ? "pulse 1.2s infinite" : "none" }} />
              {isListening ? "Stop Listening" : "Start Listening"}
            </button>
          </div>
        )}
      </div>

      {/* ══════════════════ PREP MODE ══════════════════ */}
      {mode === "prep" && (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "420px 1fr", overflow: "hidden" }}>

          {/* Form panel */}
          <div style={{ background: "white", borderRight: "1px solid #e5e7eb", overflowY: "auto", padding: "24px 26px" }}>
            <div style={{ marginBottom: 22 }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#111827" }}>Meeting Brief Builder</h2>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Fill in the details below and generate your personalised talking points before the meeting starts.</p>
            </div>

            <Field label="Meeting Topic *"             value={prepTopic}     onChange={setPrepTopic}     placeholder="e.g. Q3 Marketing Budget Review" />
            <Field label="Attendees & Their Roles"     value={prepAttendees} onChange={setPrepAttendees} placeholder="e.g. CMO (Sarah), CFO (James), Head of Brand (Tom)" multiline rows={2} />
            <Field label="Your Goal for This Meeting"  value={prepGoal}      onChange={setPrepGoal}      placeholder="e.g. Get sign-off on Q3 incrementality testing budget" />
            <Field label="Expected Topics / Concerns"  value={prepConcerns}  onChange={setPrepConcerns}  placeholder="e.g. Budget cuts, ROI of measurement tools, channel performance" multiline rows={3} />
            <Field label="Data / Context to Reference" value={prepData}      onChange={setPrepData}      placeholder="e.g. MMM showed paid social drove 34% incremental revenue last quarter" multiline rows={3} />

            {prepError && (
              <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#dc2626", fontSize: 12, fontFamily: "monospace" }}>
                ⚠ {prepError}
              </div>
            )}

            <button onClick={generatePrep} disabled={prepLoading} style={{
              width: "100%", background: "#16a34a", border: "none",
              color: "white", borderRadius: 10, padding: "13px", fontSize: 14, fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
              boxShadow: "0 2px 8px rgba(22,163,74,0.3)",
            }}>
              {prepLoading
                ? <><div style={{ width: 14, height: 14, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />Generating Brief…</>
                : "⚡  Generate Meeting Brief"}
            </button>

            {prepPoints.length > 0 && (
              <button onClick={() => setMode("live")} style={{
                width: "100%", marginTop: 10, background: "#eff6ff",
                border: "1px solid #93c5fd", color: "#1d4ed8",
                borderRadius: 10, padding: "12px", fontSize: 13, fontWeight: 600,
              }}>
                → Enter Live Mode
              </button>
            )}
          </div>

          {/* Results panel */}
          <div style={{ overflowY: "auto", padding: "24px 26px", background: "#f9fafb" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>Your Talking Points</h2>
              {prepPoints.length > 0 && (
                <span style={{ background: "#dcfce7", color: "#15803d", fontSize: 11, fontWeight: 700, fontFamily: "monospace", padding: "2px 9px", borderRadius: 20 }}>
                  {prepPoints.length} cards
                </span>
              )}
            </div>

            {prepPoints.length === 0 && !prepLoading && (
              <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: "32px 24px", textAlign: "center", color: "#9ca3af" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.8 }}>Fill in the form and click Generate —<br />your personalised brief will appear here.</p>
              </div>
            )}
            {prepLoading && (
              <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}>
                <div style={{ width: 24, height: 24, border: "3px solid #16a34a", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 14px" }} />
                <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Building your brief…</p>
              </div>
            )}
            {prepPoints.map((p, i) => <SuggestionCard key={i} item={p} index={i} showNote={true} />)}
          </div>
        </div>
      )}

      {/* ══════════════════ LIVE MODE ══════════════════ */}
      {mode === "live" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Goal bar */}
          <div style={{ background: "white", borderBottom: "1px solid #e5e7eb", padding: "9px 22px", display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, whiteSpace: "nowrap" }}>Goal</span>
            <input value={sessionGoal} onChange={e => setSessionGoal(e.target.value)} placeholder="Set your goal for this meeting…" style={{
              flex: 1, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8,
              color: "#111827", padding: "7px 12px", fontSize: 13, fontFamily: "'DM Sans', sans-serif",
            }} />
            {language.code !== "en-US" && (
              <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 7, padding: "5px 12px", fontSize: 11, color: "#92400e", fontFamily: "monospace", whiteSpace: "nowrap", fontWeight: 600 }}>
                {language.flag} → 🇬🇧 auto-translate on
              </div>
            )}
          </div>

          {/* Two panels */}
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", overflow: "hidden", minHeight: 0 }}>

            {/* Left — Prep Brief */}
            <div style={{ background: "white", borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "11px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563eb" }} />
                <span style={{ fontSize: 11, color: "#374151", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Pre-Meeting Brief</span>
                <span style={{ marginLeft: "auto", background: "#eff6ff", color: "#1d4ed8", fontSize: 10, fontFamily: "monospace", fontWeight: 700, padding: "1px 8px", borderRadius: 10 }}>{prepPoints.length} pts</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
                {prepPoints.length === 0 ? (
                  <div style={{ color: "#d1d5db", fontSize: 13, fontStyle: "italic", paddingTop: 12, lineHeight: 1.8, textAlign: "center", paddingTop: 24 }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>📝</div>
                    No brief yet —<br />go to Prep tab to generate one.
                  </div>
                ) : prepPoints.map((p, i) => <SuggestionCard key={i} item={p} index={i} showNote={true} />)}
              </div>
            </div>

            {/* Right — Live Suggestions */}
            <div style={{ background: "#f9fafb", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ background: "white", padding: "11px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a", animation: isListening ? "pulse 2s infinite" : "none" }} />
                <span style={{ fontSize: 11, color: "#374151", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Live Suggestions</span>
                {liveStatus === "thinking" && (
                  <div style={{ width: 12, height: 12, border: "2px solid #d97706", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", marginLeft: 2 }} />
                )}
                <button onClick={fetchLiveSuggestions} disabled={transcript.length === 0} style={{
                  marginLeft: "auto", background: "#f0fdf4", border: "1px solid #86efac",
                  color: "#16a34a", borderRadius: 7, padding: "4px 11px",
                  fontSize: 11, fontFamily: "monospace", fontWeight: 600,
                  opacity: transcript.length === 0 ? 0.35 : 1,
                }}>↻ Refresh</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
                {liveSuggestions.length === 0 && liveStatus !== "thinking" && (
                  <div style={{ color: "#d1d5db", fontSize: 13, fontStyle: "italic", textAlign: "center", paddingTop: 24, lineHeight: 1.8 }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>💬</div>
                    {transcript.length > 0
                      ? "Click ↻ Refresh or wait ~18s for auto-update."
                      : "Start listening or add transcript text below."}
                  </div>
                )}
                {liveSuggestions.map((s, i) => <SuggestionCard key={i} item={s} index={i} showNote={false} />)}
                {liveError && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#dc2626", fontSize: 12, fontFamily: "monospace" }}>
                    ⚠ {liveError}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Transcript strip */}
          <div style={{ background: "white", borderTop: "1px solid #e5e7eb", flexShrink: 0, height: 95 }}>
            <div style={{ display: "flex", height: "100%" }}>
              <div style={{ padding: "7px 12px", borderRight: "1px solid #f3f4f6", display: "flex", alignItems: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", writingMode: "vertical-rl", transform: "rotate(180deg)", fontWeight: 600 }}>Transcript</span>
              </div>
              <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "10px 16px", borderRight: "1px solid #f3f4f6" }}>
                {transcript.length === 0
                  ? <span style={{ color: "#d1d5db", fontSize: 12, fontStyle: "italic" }}>Live transcript will appear here as people speak…</span>
                  : transcript.map((t, i) => (
                    <span key={t.id} style={{ color: "#374151", fontSize: 12 }}>
                      <span style={{ color: "#d1d5db", fontFamily: "monospace", fontSize: 10, marginRight: 5 }}>{String(i + 1).padStart(2, "0")}</span>
                      {t.text}{" "}
                    </span>
                  ))}
              </div>
              <div style={{ width: 280, display: "flex", gap: 8, padding: "10px 14px", alignItems: "flex-end" }}>
                <textarea
                  value={manualText}
                  onChange={e => setManualText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addManual(); } }}
                  placeholder="Type / paste what was just said…"
                  rows={3}
                  style={{ flex: 1, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827", padding: "7px 10px", fontSize: 12, fontFamily: "'DM Sans', sans-serif", resize: "none" }}
                />
                <button onClick={addManual} style={{
                  background: "#16a34a", border: "none", color: "white",
                  borderRadius: 8, padding: "7px 13px", fontSize: 12, fontWeight: 600,
                  alignSelf: "flex-end", boxShadow: "0 1px 4px rgba(22,163,74,0.3)",
                }}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
