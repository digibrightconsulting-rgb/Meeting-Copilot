// ── MEETING AUDIO ──────────────────────────────────────────────────────────
// Captures the audio of the meeting tab (Zoom / Meet / Teams in the browser),
// or the whole screen's system audio for desktop apps, and streams it to
// Deepgram for live transcription. This is what lets Unmute hear the OTHER
// people on the call; the microphone (Web Speech API) still covers the user.

// App language codes → Deepgram Nova-3 language codes
const DEEPGRAM_LANG = {
  "en-US": "en",
  "he-IL": "he",
  "fr-FR": "fr",
  "es-ES": "es",
  "ar-SA": "ar",
  "de-DE": "de",
};

const MIME_TYPE = "audio/webm;codecs=opus";
const MAX_RECONNECTS = 5;

export function meetingAudioSupported() {
  return typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.getDisplayMedia
    && typeof MediaRecorder !== "undefined"
    && MediaRecorder.isTypeSupported?.(MIME_TYPE);
}

// Opens Chrome's "choose what to share" picker. The user picks the meeting tab
// (with "Also share tab audio" on), or a whole screen with system audio for
// desktop apps. Returns the full capture stream; throws Error("NO_AUDIO") if
// they shared without audio, or the browser's error if they cancelled.
export async function pickMeetingAudio() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    // Chrome requires video to be requested; we never use it.
    video: { displaySurface: "browser", frameRate: 1, width: 320, height: 180 },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      suppressLocalAudioPlayback: false, // the user must still hear the call
    },
    preferCurrentTab: false,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    systemAudio: "include",
  });
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach(t => t.stop());
    throw new Error("NO_AUDIO");
  }
  return stream;
}

export function stopStream(stream) {
  stream?.getTracks().forEach(t => t.stop());
}

export function streamIsLive(stream) {
  return !!stream && stream.getAudioTracks().some(t => t.readyState === "live");
}

// Streams one capture stream to Deepgram and reports finished sentences.
export class MeetingTranscriber {
  constructor({ stream, languageCode, getToken, onFinal, onStatus }) {
    this.audioStream = new MediaStream(stream.getAudioTracks());
    this.language = DEEPGRAM_LANG[languageCode] || "en";
    this.getToken = getToken;
    this.onFinal = onFinal;
    this.onStatus = onStatus || (() => {});
    this.stopped = true;
    this.reconnects = 0;
    this.ws = null;
    this.recorder = null;
    this.keepAlive = null;
  }

  async start() {
    this.stopped = false;
    this.onStatus("connecting");
    let token;
    try {
      token = await this.getToken();
    } catch (err) {
      this.stopped = true;
      this.onStatus("error", err.message || "Could not start meeting transcription.");
      return;
    }
    if (this.stopped) return;

    const params = new URLSearchParams({
      model: "nova-3",
      language: this.language,
      smart_format: "true",
      punctuate: "true",
      interim_results: "false",
      endpointing: "300",
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["bearer", token]);
    this.ws = ws;

    ws.onopen = () => {
      if (this.stopped) { ws.close(); return; }
      this.reconnects = 0;
      // A fresh recorder per connection, so Deepgram receives the WebM header first
      const recorder = new MediaRecorder(this.audioStream, { mimeType: MIME_TYPE });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
      recorder.start(250);
      this.recorder = recorder;
      this.keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "KeepAlive" }));
      }, 8000);
      this.onStatus("connected");
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "Results" && data.is_final) {
          const text = data.channel?.alternatives?.[0]?.transcript?.trim();
          if (text) this.onFinal(text);
        }
      } catch { /* ignore non-JSON messages */ }
    };

    ws.onerror = () => { /* onclose follows and handles it */ };

    ws.onclose = () => {
      this.cleanupConnection();
      if (this.stopped) return;
      if (!this.audioStream.getAudioTracks().some(t => t.readyState === "live")) {
        this.stopped = true;
        this.onStatus("off");
        return;
      }
      if (this.reconnects >= MAX_RECONNECTS) {
        this.stopped = true;
        this.onStatus("error", "Lost the connection to meeting transcription. Click \"Hear the meeting\" to try again.");
        return;
      }
      this.reconnects += 1;
      this.onStatus("connecting");
      setTimeout(() => { if (!this.stopped) this.start(); }, 1000 * this.reconnects);
    };
  }

  cleanupConnection() {
    if (this.keepAlive) { clearInterval(this.keepAlive); this.keepAlive = null; }
    if (this.recorder && this.recorder.state !== "inactive") {
      try { this.recorder.stop(); } catch { /* already stopped */ }
    }
    this.recorder = null;
  }

  stop() {
    this.stopped = true;
    const ws = this.ws;
    this.ws = null;
    this.cleanupConnection();
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
        ws.close();
      } catch { /* already closed */ }
    }
    this.onStatus("off");
  }
}

// Formats transcript entries for prompts. When meeting audio is on, lines are
// labelled so the model knows who said what; otherwise it's plain text as before.
export function formatTranscript(entries) {
  const labelled = entries.some(e => e.speaker === "them");
  if (!labelled) return entries.map(e => e.text).join(" ");
  return entries.map(e => `${e.speaker === "them" ? "Them" : "You"}: ${e.text}`).join("\n");
}
