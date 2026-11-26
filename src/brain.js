// ── PROFILE BRAIN ──────────────────────────────────────────────────────────
// Onboarding collects a little from the user in their own words; the AI turns
// it into a structured understanding (the "brain") that every prompt uses:
//   brain = {
//     company: { name, summary, industry, products[], markets[], customers, regulation, competitors[], marketingContext },
//     role:    { summary, responsibilities[], channels[], kpis[] },
//     profiles: { main: Focus, <specialtyId>: Focus },
//     builtAt, sourceHash,
//   }
//   Focus = { name, summary, focusConcepts[], tools: [{ name, role }], kpis[], typicalQuestions[], vocabulary[] }
// Company and role are confirmed by the user; profiles are derived and rebuilt
// whenever the inputs change.

const arr = (v) => (Array.isArray(v) ? v : []);
const line = (label, v) => (v && (!Array.isArray(v) || v.length) ? `${label}: ${Array.isArray(v) ? v.join(", ") : v}` : "");

export function hasBrain(profile) {
  return !!(profile?.brain?.profiles && Object.keys(profile.brain.profiles).length);
}

// Inputs that, when changed, mean the brain should be rebuilt
export function brainSourceHash(profile) {
  const src = JSON.stringify({
    c: profile.brain?.company || null,
    r: profile.brain?.role || null,
    t: profile.role, rd: profile.roleDescription, li: profile.linkedinText,
    p: arr(profile.platforms).slice().sort(),
    a: profile.typicalAudience, m: arr(profile.meetingTypes).length ? profile.meetingTypes : profile.meetingType,
    s: arr(profile.specialties).map(s => [s.id, s.name, arr(s.platforms).slice().sort(), s.context, s.audience]),
  });
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export function brainIsStale(profile) {
  return !hasBrain(profile) || profile.brain.sourceHash !== brainSourceHash(profile);
}

// ── Step: understand the role from the user's own words ───────────────────
export function buildRoleInferencePrompt(profile, platformOptions) {
  const c = profile.brain?.company;
  return `You are setting up an AI meeting assistant for a marketing professional. From what they've told you, work out what their job really involves.

THEM:
Name: ${profile.name || "-"}
Job title: ${profile.role || "-"}
Company: ${profile.company || "-"}
${c ? `About the company: ${c.summary}${c.industry ? " (" + c.industry + ")" : ""}${c.regulation ? ". Regulation: " + c.regulation : ""}` : ""}
In their own words: "${profile.roleDescription || ""}"
${profile.linkedinText ? `Their LinkedIn summary/experience:\n"""${profile.linkedinText.slice(0, 3000)}"""` : ""}

Work out:
- A one-sentence summary of their role at this company.
- 4-6 core responsibilities, specific to this company (e.g. "promoting eToro's copy-trading on Instagram and TikTok", not "social media").
- The channels they work across.
- 3-6 KPIs they are most likely judged on.
- Which platforms/tools they most likely use. Prefer names from this list where they fit: ${platformOptions.join(", ")}. Add others (e.g. AppsFlyer, GA4, Google Tag Manager, Sprout Social) only if strongly implied.
- Specialist profiles: ONLY if their work clearly spans distinct specialities that would come up in different meetings (e.g. media buying AND tracking/measurement), suggest 1-3. Otherwise return an empty list.

Respond ONLY with JSON:
{"summary": "...", "responsibilities": ["..."], "channels": ["..."], "kpis": ["..."], "platforms": ["..."],
 "suggestedProfiles": [{"name": "e.g. Tracking & Measurement", "icon": "one emoji", "platforms": ["tools used for this"], "context": "one sentence: what they do in these meetings"}]}`;
}

// ── Step: build the brain for every profile (main + specialists) ──────────
export function buildBrainPrompt(profile) {
  const c = profile.brain?.company || {};
  const r = profile.brain?.role || {};
  const specs = arr(profile.specialties);
  const profilesDesc = [
    `- id "main": their main/general profile. Platforms: ${arr(profile.platforms).join(", ") || "-"}. What they do: ${profile.roleDescription || r.summary || "-"}`,
    ...specs.map(s => `- id "${s.id}": "${s.name}" specialist profile. Tools: ${arr(s.platforms).join(", ") || "-"}. What they do in these meetings: ${s.context || "-"}${s.audience ? ". Usually meets with: " + s.audience : ""}`),
  ].join("\n");

  return `You are building the knowledge an AI meeting assistant will use to help this person contribute expertly in meetings. Be specific to their company, role and tools, never generic.

COMPANY: ${c.name || profile.company || "-"}: ${c.summary || ""}
${line("Industry", c.industry)}
${line("Products", c.products)}
${line("Markets", c.markets)}
${line("Customers", c.customers)}
${line("Regulation", c.regulation)}
${line("Competitors", c.competitors)}
${line("Marketing context", c.marketingContext)}

PERSON: ${profile.name || ""}, ${profile.role || ""}
${line("Role summary", r.summary)}
${line("Responsibilities", r.responsibilities)}
${line("Channels", r.channels)}
${line("KPIs", r.kpis)}
${line("Usually meets with", profile.typicalAudience)}
${line("Types of meetings", arr(profile.meetingTypes).length ? profile.meetingTypes : profile.meetingType)}
${profile.linkedinText ? `Career background (from LinkedIn): ${profile.linkedinText.slice(0, 1500)}` : ""}

THEIR PROFILES (build one entry per id):
${profilesDesc}

For EACH profile, write what the assistant must focus on when they are in a meeting wearing that hat:
- "summary": 2 sentences on how they add value in these meetings at this company.
- "focusConcepts": 8-12 core concepts, frameworks and issues for this speciality with these tools at this company (e.g. for tracking with AppsFlyer + GTM at a trading app: SKAN & ATT, attribution windows, server-side tagging, event mapping for deposits, fraud protection, data discrepancies, incrementality).
- "tools": each tool with a one-line "role": what it does for THEM at this company (max 15 words).
- "kpis": 3-6 metrics that matter in these meetings.
- "typicalQuestions": 4-6 questions or debates that typically come up in these meetings.
- "vocabulary": 10-25 terms, product names, brand names and jargon likely to be SPOKEN in these meetings (for speech recognition), including the company's own product names.

Never invent statistics or claims about the company's internal data.

Respond ONLY with JSON:
{"profiles": {"main": {"name": "short label", "summary": "...", "focusConcepts": [], "tools": [{"name": "", "role": ""}], "kpis": [], "typicalQuestions": [], "vocabulary": []}${specs.map(s => `, "${s.id}": {...same shape...}`).join("")}}}`;
}

// The user's own edits survive rebuilds: concepts they added are always kept,
// concepts they removed never come back.
export function mergeUserEdits(fresh, previous) {
  if (!fresh) return fresh;
  const added = arr(previous?.userAdded);
  const removed = arr(previous?.userRemoved).map(x => x.toLowerCase());
  const keep = (list) => arr(list).filter(x => !removed.includes(String(x).toLowerCase()));
  const uniq = (list) => [...new Map(list.map(x => [String(x).toLowerCase(), x])).values()];
  return {
    ...fresh,
    focusConcepts: uniq([...added, ...keep(fresh.focusConcepts)]),
    vocabulary: uniq([...keep(fresh.vocabulary), ...added]),
    userAdded: added,
    userRemoved: arr(previous?.userRemoved),
  };
}

// Records which concepts the user added/removed by hand
export function trackConceptEdit(focus, nextConcepts) {
  const prev = arr(focus.focusConcepts).map(x => x.toLowerCase());
  const next = nextConcepts.map(x => x.toLowerCase());
  const added = nextConcepts.filter(x => !prev.includes(x.toLowerCase()));
  const removed = arr(focus.focusConcepts).filter(x => !next.includes(x.toLowerCase()));
  const userAdded = [...arr(focus.userAdded).filter(x => next.includes(x.toLowerCase())), ...added];
  const userRemoved = [...arr(focus.userRemoved).filter(x => !next.includes(x.toLowerCase())), ...removed];
  return { ...focus, focusConcepts: nextConcepts, userAdded, userRemoved };
}

export function normaliseFocus(f, fallbackName) {
  if (!f || typeof f !== "object") return null;
  const s = (v, n) => String(v || "").slice(0, n);
  const l = (v, n, each = 80) => arr(v).slice(0, n).map(x => s(x, each)).filter(Boolean);
  return {
    name: s(f.name || fallbackName, 60),
    summary: s(f.summary, 400),
    focusConcepts: l(f.focusConcepts, 14),
    tools: arr(f.tools).slice(0, 12).map(t => ({ name: s(t?.name, 60), role: s(t?.role, 140) })).filter(t => t.name),
    kpis: l(f.kpis, 8),
    typicalQuestions: l(f.typicalQuestions, 8, 160),
    vocabulary: l(f.vocabulary, 30, 50),
  };
}

// ── Using the brain ───────────────────────────────────────────────────────
// The focus for the profile the user picked (specialist or main)
export function activeFocus(profile) {
  const id = profile.activeSpecialty?.id || "main";
  return profile.brain?.profiles?.[id] || null;
}

// One shared "who they are" block for every prompt. Company + role apply to
// every meeting; only the ACTIVE profile's focus is included.
export function whoBlock(profile) {
  const c = profile.brain?.company;
  const r = profile.brain?.role;
  const f = activeFocus(profile);
  if (!c && !r && !f) {
    // Legacy profile without a brain yet
    return [
      `${profile.name || "They"}: ${profile.role}${profile.company ? " at " + profile.company : ""}`,
      line("Expertise", profile.expertise),
      line("Platforms", profile.platforms),
      profile.jobContext ? `Their work: ${profile.jobContext}` : "",
      line("Usually meets with", profile.typicalAudience),
    ].filter(Boolean).join("\n");
  }
  return [
    `${profile.name || "They"}: ${profile.role}${profile.company ? " at " + profile.company : ""}`,
    c ? `COMPANY: ${c.name}: ${c.summary}` : "",
    c ? [line("Industry", c.industry), line("Products", c.products), line("Markets", c.markets), line("Regulation", c.regulation), line("Competitors", c.competitors), line("Marketing context", c.marketingContext)].filter(Boolean).join("\n") : "",
    r ? `ROLE: ${r.summary}` : "",
    r ? [line("Responsibilities", r.responsibilities), line("Judged on", r.kpis)].filter(Boolean).join("\n") : "",
    f ? `FOCUS FOR THIS MEETING: ${profile.activeSpecialty ? `"${f.name}" specialist profile` : "main profile"}. ${f.summary}` : "",
    f ? [
      line("Core concepts to draw on", f.focusConcepts),
      f.tools?.length ? `Their tools: ${f.tools.map(t => t.role ? `${t.name} (${t.role})` : t.name).join("; ")}` : "",
      line("KPIs that matter here", f.kpis),
      line("Debates that typically come up", f.typicalQuestions),
    ].filter(Boolean).join("\n") : "",
    line("Usually meets with", profile.activeSpecialty?.audience || profile.typicalAudience),
  ].filter(Boolean).join("\n");
}

// Terms for Deepgram keyterm prompting: names and jargon likely to be spoken
export function keytermsFor(profile) {
  const c = profile.brain?.company || {};
  const f = activeFocus(profile) || {};
  const terms = [
    c.name, profile.company, ...arr(c.products), ...arr(c.competitors),
    ...arr(f.tools).map(t => t.name), ...arr(f.vocabulary), ...arr(profile.platforms),
  ].map(t => String(t || "").trim()).filter(t => t && t.length <= 40);
  return [...new Map(terms.map(t => [t.toLowerCase(), t])).values()].slice(0, 50);
}
