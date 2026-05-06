import express from "express";
import { GoogleGenAI } from "@google/genai";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: ".env.local" });
dotenv.config();

const PORT = Number(process.env.PORT || 3001);
const DEFAULT_TWILIO_VOICE = process.env.TWILIO_VOICE || "Polly.Aditi";
const DEFAULT_TWILIO_GATHER_LANGUAGE = String(process.env.TWILIO_GATHER_LANGUAGE || "en-IN").trim();
const TWILIO_GATHER_TIMEOUT = String(process.env.TWILIO_GATHER_TIMEOUT || "15").trim();
const TWILIO_GATHER_SPEECH_TIMEOUT = String(process.env.TWILIO_GATHER_SPEECH_TIMEOUT || "auto").trim();
const TWILIO_SPEECH_MODEL = String(process.env.TWILIO_SPEECH_MODEL || "").trim();
const TWILIO_ENHANCED_SPEECH = String(process.env.TWILIO_ENHANCED_SPEECH || "false").trim().toLowerCase() === "true";
const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
const TWILIO_FROM_NUMBER = String(process.env.TWILIO_FROM_NUMBER || "").trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const DIALER_MODE = String(process.env.DIALER_MODE || "twilio").trim().toLowerCase();
const SIP_TRUNK_DOMAIN = String(process.env.SIP_TRUNK_DOMAIN || "").trim();
const SIP_AUTH_USERNAME = String(process.env.SIP_AUTH_USERNAME || "").trim();
const SIP_AUTH_PASSWORD = String(process.env.SIP_AUTH_PASSWORD || "").trim();
const MONGODB_URI = String(process.env.MONGODB_URI || "").trim();
const MONGODB_DB_NAME = String(process.env.MONGODB_DB_NAME || "dpvision_pooja_ai").trim();
const MONGODB_TLS_ALLOW_INVALID_CERTIFICATES =
  String(process.env.MONGODB_TLS_ALLOW_INVALID_CERTIFICATES || "false").trim().toLowerCase() === "true";
const promptPath = process.env.DPVISION_AGENT_PROMPT_FILE || "agent-prompt.txt";
const FALLBACK_REPLY =
  "I can still help with the basics while the AI quota resets. Tell me what you need, or share a date, time, and email for a demo.";
const callHistories = new Map();
const liveCallSessions = new Map();

const geminiApiKey = (process.env.GEMINI_API_KEY || "").trim();
const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

const configuredModel = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
let activeModel = configuredModel;
let lastGeminiError = "";
let discoveredModelCandidates = [configuredModel];
let modelDiscoveryAttempted = false;
const quotaBlockedModels = new Map();
const generationDefaults = {
  temperature: 0.72,
  topP: 0.88,
  maxOutputTokens: 75,
};
const schedulingStates = new Map();
const androidSessions = new Map();
let mongoClientPromise = null;
let voiceSettings = {
  voice: DEFAULT_TWILIO_VOICE,
  language: DEFAULT_TWILIO_GATHER_LANGUAGE,
  label: "Indian English - Pooja",
  promptLanguage: "English with a natural Indian tone",
};
const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const MAX_HISTORY_TURNS = 20;
const ANDROID_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const LIVE_CALL_TTL_MS = 2 * 60 * 60 * 1000;

function pruneLiveCallSessions() {
  const now = Date.now();
  for (const [callSid, session] of liveCallSessions.entries()) {
    const lastUpdatedAt = Number(session?.lastUpdatedAt || session?.createdAt || 0);
    if (now - lastUpdatedAt > LIVE_CALL_TTL_MS) {
      liveCallSessions.delete(callSid);
    }
  }
}

function ensureLiveCallSession(callSid, details = {}) {
  const normalizedCallSid = String(callSid || "").trim();
  if (!normalizedCallSid) return null;

  const now = Date.now();
  const existing = liveCallSessions.get(normalizedCallSid) || {};
  const session = {
    callSid: normalizedCallSid,
    to: details.to || existing.to || "",
    status: details.status || existing.status || "active",
    createdAt: existing.createdAt || now,
    lastUpdatedAt: now,
    endedAt: details.endedAt || existing.endedAt || null,
    events: Array.isArray(existing.events) ? existing.events : [],
  };

  liveCallSessions.set(normalizedCallSid, session);
  return session;
}

function appendLiveCallEvent(callSid, role, text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return;

  const session = ensureLiveCallSession(callSid);
  if (!session) return;
  const normalizedRole = role === "agent" ? "agent" : "user";
  const lastEvent = session.events[session.events.length - 1];
  if (lastEvent?.role === normalizedRole && String(lastEvent.text || "").trim() === normalizedText) {
    return;
  }

  session.events.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: normalizedRole,
    text: normalizedText,
    timestamp: new Date().toISOString(),
  });
  session.events = session.events.slice(-MAX_HISTORY_TURNS);
  session.lastUpdatedAt = Date.now();
  liveCallSessions.set(session.callSid, session);
}

function markLiveCallEnded(callSid) {
  const session = ensureLiveCallSession(callSid, { status: "ended", endedAt: Date.now() });
  if (!session) return;
  session.status = "ended";
  session.endedAt = Date.now();
  session.lastUpdatedAt = Date.now();
  liveCallSessions.set(session.callSid, session);
}

function buildLiveCallPayload(session) {
  if (!session) return null;
  return {
    callSid: session.callSid,
    to: session.to,
    status: session.status,
    createdAt: session.createdAt,
    lastUpdatedAt: session.lastUpdatedAt,
    endedAt: session.endedAt,
    events: session.events || [],
  };
}

function isValidLeadStatus(status) {
  return ["pending", "called", "converted", "failed"].includes(status);
}

function normalizeLead(input = {}) {
  const id = String(input.id || `lead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).trim();
  const status = String(input.status || "pending").trim().toLowerCase();
  return {
    id,
    name: String(input.name || "Unknown").trim() || "Unknown",
    company: String(input.company || "Unknown").trim() || "Unknown",
    email: String(input.email || "").trim(),
    phone: String(input.phone || "").trim(),
    status: isValidLeadStatus(status) ? status : "pending",
    sentiment: input.sentiment ? String(input.sentiment).trim() : "",
    notes: input.notes ? String(input.notes).trim() : "",
    lastCallDate: input.lastCallDate ? String(input.lastCallDate).trim() : "",
    updatedAt: new Date().toISOString(),
  };
}

function serializeLead(lead = {}) {
  return {
    id: String(lead.id || ""),
    name: String(lead.name || "Unknown"),
    company: String(lead.company || "Unknown"),
    email: String(lead.email || ""),
    phone: String(lead.phone || ""),
    status: isValidLeadStatus(lead.status) ? lead.status : "pending",
    sentiment: lead.sentiment || undefined,
    notes: lead.notes || undefined,
    lastCallDate: lead.lastCallDate || undefined,
  };
}

function summarizeMongoError(error) {
  const message = readErrorMessage(error);
  const lower = message.toLowerCase();
  if (lower.includes("ssl") || lower.includes("tls")) {
    return "MongoDB TLS connection failed. Check that MONGODB_URI is the full mongodb+srv Atlas driver string, the password is correct, Atlas Network Access allows Render, and try setting MONGODB_TLS_ALLOW_INVALID_CERTIFICATES=true if Atlas still rejects TLS.";
  }
  if (lower.includes("authentication failed") || lower.includes("bad auth")) {
    return "MongoDB authentication failed. Check the database username and password in MONGODB_URI.";
  }
  if (lower.includes("querysrv") || lower.includes("enotfound")) {
    return "MongoDB host lookup failed. Check that MONGODB_URI is copied from Atlas Drivers and starts with mongodb+srv://.";
  }
  return message;
}

async function getMongoDb() {
  if (!MONGODB_URI) {
    const error = new Error("MONGODB_URI is not configured.");
    error.statusCode = 503;
    throw error;
  }

  if (!mongoClientPromise) {
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      tlsAllowInvalidCertificates: MONGODB_TLS_ALLOW_INVALID_CERTIFICATES,
    });
    mongoClientPromise = client.connect();
  }

  const client = await mongoClientPromise;
  return client.db(MONGODB_DB_NAME);
}

async function getLeadsCollection() {
  const db = await getMongoDb();
  const collection = db.collection("leads");
  await collection.createIndex({ id: 1 }, { unique: true });
  return collection;
}

async function listStoredLeads() {
  const collection = await getLeadsCollection();
  const leads = await collection.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).toArray();
  return leads.map(serializeLead);
}

function getLatestLiveCallSession() {
  pruneLiveCallSessions();
  return [...liveCallSessions.values()].sort((a, b) => Number(b.lastUpdatedAt || 0) - Number(a.lastUpdatedAt || 0))[0] || null;
}

function getPublicBaseUrl(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "http";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return PUBLIC_BASE_URL || (host ? `${proto}://${host}` : "");
}

function isLocalBaseUrl(url) {
  return /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/|$)/i.test(String(url || ""));
}

function normalizeDialNumber(rawNumber) {
  const compact = String(rawNumber || "").replace(/[^\d+]/g, "");
  if (compact.startsWith("+")) return compact;
  if (/^\d{10}$/.test(compact)) return `+91${compact}`;
  if (/^\d{11,15}$/.test(compact)) return `+${compact}`;
  return compact;
}

function isValidDialNumber(number) {
  return /^\+[1-9]\d{7,14}$/.test(number);
}

function buildDialTarget(number) {
  if (DIALER_MODE === "sip") {
    const sipNumber = number.replace(/^\+/, "");
    return `sip:${encodeURIComponent(sipNumber)}@${SIP_TRUNK_DOMAIN};user=phone`;
  }
  return number;
}

function getDialerConfigStatus(req) {
  const missing = [];
  const publicBaseUrl = getPublicBaseUrl(req);
  if (!TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
  if (!TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
  if (!TWILIO_FROM_NUMBER) missing.push("TWILIO_FROM_NUMBER");
  if (!publicBaseUrl || isLocalBaseUrl(publicBaseUrl)) missing.push("PUBLIC_BASE_URL");
  if (DIALER_MODE === "sip" && !SIP_TRUNK_DOMAIN) missing.push("SIP_TRUNK_DOMAIN");

  return {
    ready: missing.length === 0,
    mode: DIALER_MODE === "sip" ? "sip" : "twilio",
    missing,
    fromNumberConfigured: Boolean(TWILIO_FROM_NUMBER),
    publicBaseUrlConfigured: Boolean(publicBaseUrl && !isLocalBaseUrl(publicBaseUrl)),
  };
}

async function startOutboundAiCall({ req, toNumber }) {
  const status = getDialerConfigStatus(req);
  if (!status.ready) {
    const error = new Error(`Dialer config missing: ${status.missing.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  const publicBaseUrl = getPublicBaseUrl(req);
  const voiceUrl = `${publicBaseUrl}/twilio/voice`;
  const dialTarget = buildDialTarget(toNumber);
  const params = new URLSearchParams({
    To: dialTarget,
    From: TWILIO_FROM_NUMBER,
    Url: voiceUrl,
    Method: "POST",
    StatusCallback: `${publicBaseUrl}/twilio/status`,
    StatusCallbackMethod: "POST",
  });
  for (const eventName of ["initiated", "ringing", "answered", "completed"]) {
    params.append("StatusCallbackEvent", eventName);
  }

  if (DIALER_MODE === "sip" && SIP_AUTH_USERNAME && SIP_AUTH_PASSWORD) {
    params.set("SipAuthUsername", SIP_AUTH_USERNAME);
    params.set("SipAuthPassword", SIP_AUTH_PASSWORD);
  }

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || `Twilio call failed with ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  ensureLiveCallSession(payload.sid, {
    to: toNumber,
    status: payload.status || "queued",
  });

  return {
    callSid: payload.sid,
    status: payload.status,
    to: toNumber,
    dialTarget,
    voiceUrl,
  };
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getVoiceSettings() {
  return {
    voice: String(voiceSettings.voice || DEFAULT_TWILIO_VOICE).trim() || DEFAULT_TWILIO_VOICE,
    language: String(voiceSettings.language || DEFAULT_TWILIO_GATHER_LANGUAGE).trim() || DEFAULT_TWILIO_GATHER_LANGUAGE,
    label: String(voiceSettings.label || "").trim(),
    promptLanguage: String(voiceSettings.promptLanguage || "").trim(),
  };
}

function normalizeVoiceSettings(input = {}) {
  const language = String(input.language || DEFAULT_TWILIO_GATHER_LANGUAGE).trim();
  const voice = String(input.voice || DEFAULT_TWILIO_VOICE).trim();
  return {
    voice: voice || DEFAULT_TWILIO_VOICE,
    language: language || DEFAULT_TWILIO_GATHER_LANGUAGE,
    label: String(input.label || `${language} - ${voice}`).trim(),
    promptLanguage: String(input.promptLanguage || "the selected language").trim(),
  };
}

function twiml(body) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

function buildSay(text, settings = getVoiceSettings()) {
  const spokenText = String(text)
    .replace(/\bD\s*P\s*vision\b/gi, "D P vision")
    .replace(/\bDP\s*vision\b/gi, "D P vision")
    .replace(/\bDPvision\b/gi, "D P vision")
    .replace(/\bDvision\b/gi, "D P vision")
    .replace(/\b10-minute\b/gi, "ten minute")
    .replace(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/gi, "$1 $3")
    .replace(/\s+/g, " ")
    .trim();
  return `<Say voice="${escapeXml(settings.voice)}" language="${escapeXml(settings.language)}">${escapeXml(spokenText)}</Say>`;
}

function say(text) {
  return buildSay(text);
}

function gather(prompt) {
  const settings = getVoiceSettings();
  const attributes = [
    `input="speech dtmf"`,
    `action="/twilio/respond"`,
    `method="POST"`,
    `timeout="${escapeXml(TWILIO_GATHER_TIMEOUT)}"`,
    `speechTimeout="${escapeXml(TWILIO_GATHER_SPEECH_TIMEOUT)}"`,
    `language="${escapeXml(settings.language)}"`,
    `actionOnEmptyResult="true"`,
  ];
  if (TWILIO_SPEECH_MODEL) {
    attributes.push(`speechModel="${escapeXml(TWILIO_SPEECH_MODEL)}"`);
    if (TWILIO_ENHANCED_SPEECH) {
      attributes.push(`enhanced="true"`);
    }
  }
  const promptText = String(prompt || "").trim();
  return `<Gather ${attributes.join(" ")}>${promptText ? say(promptText) : ""}</Gather>`;
}

function getPromptText() {
  const resolvedPath = path.resolve(process.cwd(), promptPath);
  if (!fs.existsSync(resolvedPath)) {
    return [
      "Hey, it's Pooja. How's your day going?",
      "",
      "You are Pooja. Talk like a real, relaxed person on a phone call. Keep the conversation natural, warm, and unscripted. Reply to what the caller actually said before doing anything else. If they greet you, greet them back and keep it light. If they ask how you are, answer casually and ask something small back. Do not jump into a pitch unless they invite it. Do not repeat the same line. Do not sound like a brochure, a helpdesk, or a sales script. Always spell the company name as DP vision Analytics. If the caller asks about the company, you can explain it briefly, but keep the tone conversational. If they ask something unrelated, respond naturally and keep the flow going. If they want to end the call, close politely and include [END_CALL].",
    ].join("\n");
  }
  return fs.readFileSync(resolvedPath, "utf8");
}

function splitPrompt(rawPrompt) {
  const lines = rawPrompt.replace(/\r\n/g, "\n").split("\n");
  const openerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (openerIndex === -1) {
    return {
      openingLine: "Hey, it's Pooja. How's your day going?",
      systemPrompt: "",
    };
  }

  const openingLine = lines[openerIndex].trim();
  const systemPrompt = lines.slice(openerIndex + 1).join("\n").trim();
  return { openingLine, systemPrompt };
}

function getPromptParts() {
  return splitPrompt(getPromptText());
}

function normalizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  const normalized = rawHistory
    .map((entry) => {
      const rawRole = String(entry?.role || "").toLowerCase();
      const role = rawRole === "model" || rawRole === "assistant" || rawRole === "agent" ? "model" : "user";
      const text = String(entry?.text || "").trim();
      return { role, text };
    })
    .filter((entry) => entry.text.length > 0);

  while (normalized.length > 0 && normalized[0].role === "model") {
    normalized.shift();
  }

  const collapsed = [];
  for (const entry of normalized) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && previous.role === entry.role) {
      previous.text = `${previous.text}\n${entry.text}`.trim();
    } else {
      collapsed.push(entry);
    }
  }

  return collapsed.slice(-12);
}

function generateSessionId(prefix = "session") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getStoredHistory(sessionId) {
  return normalizeHistory(callHistories.get(sessionId) || []);
}

function storeHistory(sessionId, history) {
  callHistories.set(sessionId, normalizeHistory(history).slice(-MAX_HISTORY_TURNS));
}

function appendHistoryTurn(sessionId, role, text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return;
  const history = getStoredHistory(sessionId);
  history.push({
    role: role === "model" ? "model" : "user",
    text: normalizedText,
  });
  storeHistory(sessionId, history);
}

function pruneAndroidSessions() {
  const now = Date.now();
  for (const [sessionId, session] of androidSessions.entries()) {
    const lastSeen = Number(session?.lastSeenAt || session?.createdAt || 0);
    if (now - lastSeen > ANDROID_SESSION_TTL_MS) {
      androidSessions.delete(sessionId);
      callHistories.delete(sessionId);
      schedulingStates.delete(sessionId);
    }
  }
}

function readErrorMessage(error) {
  if (!error) return "Unknown Gemini error";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message.trim().length > 0) return error.message.trim();
  try {
    return JSON.stringify(error);
  } catch (_jsonError) {
    return "Unserializable Gemini error";
  }
}

function isQuotaError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("resource_exhausted") ||
    text.includes("quota") ||
    text.includes("rate limit") ||
    text.includes("\"code\":429") ||
    text.includes("429")
  );
}

function summarizeGeminiError(message) {
  const text = String(message || "");
  if (isQuotaError(text)) {
    return "Gemini quota exhausted. Wait for quota reset or switch to a billed Gemini plan/key.";
  }
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function getModelQuotaBlock(model) {
  const blockedUntil = Number(quotaBlockedModels.get(model) || 0);
  if (!blockedUntil) return 0;
  if (Date.now() >= blockedUntil) {
    quotaBlockedModels.delete(model);
    return 0;
  }
  return blockedUntil;
}

function markModelQuotaBlocked(model) {
  quotaBlockedModels.set(model, Date.now() + 15 * 60 * 1000);
}

function getQuotaBlockedModels() {
  const now = Date.now();
  const blocked = [];
  for (const [model, blockedUntil] of quotaBlockedModels.entries()) {
    if (now >= Number(blockedUntil)) {
      quotaBlockedModels.delete(model);
    } else {
      blocked.push(model);
    }
  }
  return blocked;
}

function normalizeCompanyName(text) {
  return String(text)
    .replace(/\bD\s*P\s*vision\b/gi, "DP vision")
    .replace(/\bDPvision\b/gi, "DP vision")
    .replace(/\bD-?vision\b/gi, "DP vision")
    .replace(/\bDpvision\b/g, "DP vision")
    .replace(/\bDP vision Analytics\b/gi, "DP vision Analytics");
}

function normalizeModelName(modelName) {
  const name = String(modelName || "").trim();
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

function uniqueModels(models) {
  return models.filter((model, index, all) => model && all.indexOf(model) === index);
}

function rankModel(model) {
  const name = model.toLowerCase();
  if (name === configuredModel.toLowerCase()) return 0;
  if (name.includes("gemini-2.5-flash")) return 1;
  if (name.includes("gemini-2.0-flash")) return 2;
  if (name.includes("flash")) return 3;
  if (name.includes("pro")) return 4;
  return 5;
}

async function ensureModelCandidates() {
  if (!ai) return [configuredModel];
  if (modelDiscoveryAttempted) return discoveredModelCandidates;

  modelDiscoveryAttempted = true;
  // Avoid runtime model listing to reduce first-turn latency.
  discoveredModelCandidates = uniqueModels([
    configuredModel,
    "gemini-2.5-flash",
    "gemini-2.0-flash",
  ]).sort((a, b) => rankModel(a) - rankModel(b));
  return discoveredModelCandidates;
}

function wasAsked(history, pattern) {
  return normalizeHistory(history).some((entry) => entry.role === "model" && pattern.test(entry.text));
}

function countAgentQuestions(history) {
  return normalizeHistory(history).filter((entry) => entry.role === "model" && entry.text.includes("?")).length;
}

function isMixedIntent(text) {
  const lower = String(text || "").trim().toLowerCase();
  return /\b(no|not sure|maybe)\b.*\b(but|okay|ok|fine|go ahead|tell me|continue|still|maybe|sure)\b/i.test(lower);
}

function isClearRejection(text) {
  const lower = String(text || "").trim().toLowerCase();
  if (!lower) return false;
  if (isMixedIntent(lower)) return false;
  return (
    /^(no|nope|nah|no sorry|sorry no|no thanks|no thank you|not now thanks|not intere?sted|not intrested|sorry not intere?sted|sorry not intrested|stop|end|bye|goodbye|hang up)[\s.!?,]*$/i.test(lower) ||
    /\b(no thanks|no thank you|not now thanks|not intere?sted|not intrested|stop calling|don't call|do not call|hang up|end the call|bye|goodbye)\b/i.test(lower)
  );
}

function getLocalAgentReply(customerText, history = []) {
  const text = String(customerText || "").trim();
  const lower = text.toLowerCase();
  const agentQuestionCount = countAgentQuestions(history);
  const offeredDemo = wasAsked(history, /10-minute demo|short demo|demo/i);

  if (!text || /\b(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(text)) {
    return "Hi, this is Pooja from DP vision Analytics. We build custom CRM, ERP, automation, and dashboard systems for growing teams. Is this relevant for your business?";
  }

  if (/^(yes|yeah|yep|sure|okay|ok|go ahead|tell me|haan|ha)[\s.!?,]*$/i.test(lower)) {
    if (offeredDemo || agentQuestionCount >= 2) {
      return "Perfect. Share a preferred time and email, and I can arrange a short demo with the DP vision team.";
    }
    return "Great. We usually help when teams are outgrowing Excel, WhatsApp, or disconnected software. Would a 10-minute demo be useful?";
  }

  if (isClearRejection(lower)) {
    return "No worries, thanks for your time. Have a good day. [END_CALL]";
  }

  if (isMixedIntent(lower)) {
    return "No problem, I will keep it brief. DP vision mainly helps teams clean up scattered tools and reports. A short demo can show the fit.";
  }

  if (/\b(who|what.*company|about|do you do|dpvision|dp vision|service|services)\b/i.test(lower)) {
    return "DP vision Analytics builds custom CRM, ERP, automation, and dashboard systems so business work is easier to track. I can arrange a quick demo if useful.";
  }

  if (/\b(crm|erp|inventory|sales|operations|finance|account|accounts)\b/i.test(lower)) {
    return "That makes sense. A custom CRM or ERP can bring that into one place instead of scattered tracking. Would you like a quick demo?";
  }

  if (/\b(automation|manual|follow.?up|whatsapp|telephony|calls|missed call|workflow)\b/i.test(lower)) {
    return "Got it. DP vision Analytics can automate follow-ups, WhatsApp flows, calls, and routine tasks. A short demo would show this clearly.";
  }

  if (/\b(dashboard|report|reporting|kpi|analytics|data|decision|visibility)\b/i.test(lower)) {
    return "Understood. Their dashboards help teams see KPIs and reports faster without manual chasing. I can set up a quick walkthrough.";
  }

  if (/\b(price|pricing|cost|charge|package|plan)\b/i.test(lower)) {
    return "A DP vision specialist can confirm exact pricing for your scope. If you share a date, time, and email, I can help set up a short demo.";
  }

  if (/\b(email|send|details|brochure|info|information)\b/i.test(lower)) {
    return "Sure, what email should I send the details to? I can also book a quick demo if you share a preferred date and time.";
  }

  if (detectSchedulingIntent(text)) {
    return "Great, I can help with that. Please share the preferred date, time, and email address for the 10-minute demo.";
  }

  if (/\b(busy|later|callback|call back)\b/i.test(lower)) {
    return "Sure, I can keep it brief. What time would be better for a quick callback?";
  }

  if (agentQuestionCount >= 2) {
    return "Fair enough. DP vision Analytics can show the right fit better in a short demo than over a long call.";
  }

  return "Got it. Many teams call us when Excel, WhatsApp, or separate tools become hard to manage. Is that close to your situation?";
}

function buildRuntimeCallRules(history) {
  const assistantTurns = normalizeHistory(history)
    .filter((entry) => entry.role === "model")
    .map((entry) => entry.text)
    .slice(-5);

  const previousReplies = assistantTurns.length
    ? `\nRecent Pooja replies, do not reuse these words or structure:\n${assistantTurns.map((turn) => `- ${turn}`).join("\n")}`
    : "";

  return `${previousReplies}

Live-call control rules:
- If the caller only says yes, okay, sure, or go ahead, do not repeat the opener or another permission question.
- Be a sales agent, not an interviewer: lead with a useful benefit, ask at most one light qualifying question, then offer a short demo or callback.
- Do not ask long menu questions with many options.
- If the caller gives a vague answer, briefly explain the value and move toward a demo instead of asking another discovery question.
- After two Pooja questions in the call, stop qualifying and ask for demo timing, email, or callback timing.
- Never say the same company/service list twice in the same call.`.trim();
}

function isWeakDiscoveryReply(customerText, replyText, history) {
  const customer = String(customerText || "").trim().toLowerCase();
  const reply = String(replyText || "").trim();
  const lowerReply = reply.toLowerCase();
  const onlyPermission = /^(yes|yeah|yep|sure|okay|ok|go ahead|tell me|haan|ha)\.?$/i.test(customer);
  if (!onlyPermission) return false;
  if (reply.length < 18) return true;
  if (!reply.includes("?") && !/\b(demo|callback|email|date|time)\b/i.test(reply)) return true;
  if (/\bis this (a )?(good|okay) time|quick call|quick chat\b/i.test(reply)) return true;

  const recentAgentText = normalizeHistory(history)
    .filter((entry) => entry.role === "model")
    .map((entry) => entry.text.toLowerCase());
  return recentAgentText.some((previous) => previous && lowerReply === previous);
}

async function getGeminiReply(callSid, customerText) {
  const history = normalizeHistory(callHistories.get(callSid) || []);
  const { systemPrompt } = getPromptParts();
  const settings = getVoiceSettings();
  const languageInstruction = settings.promptLanguage
    ? `\n\nCurrent call language and voice pack: ${settings.label || settings.language}. Reply in ${settings.promptLanguage}. Keep the same phone-call style and do not translate the company name DP vision Analytics.`
    : "";
  const userText = String(customerText || "").trim();

  if (!ai) {
    lastGeminiError = "GEMINI_API_KEY is missing.";
    if (userText) {
      callHistories.set(callSid, history.concat([{ role: "user", text: userText }]).slice(-MAX_HISTORY_TURNS));
    }
    return getLocalAgentReply(userText, history);
  }

  const conversation = [...history];
  const lastTurn = conversation[conversation.length - 1];
  if (userText && (!lastTurn || lastTurn.role !== "user" || lastTurn.text !== userText)) {
    conversation.push({ role: "user", text: userText });
  }

  if (conversation.length === 0) {
    conversation.push({ role: "user", text: "Hello" });
  }

  if (isClearRejection(userText)) {
    const closingReply = normalizeCompanyName(getLocalAgentReply(userText, conversation));
    callHistories.set(
      callSid,
      conversation
        .concat([{ role: "model", text: closingReply }])
        .slice(-MAX_HISTORY_TURNS)
    );
    return closingReply;
  }

  const candidates = await ensureModelCandidates();
  const errors = [];

  for (const model of candidates) {
    if (getModelQuotaBlock(model)) {
      errors.push(`${model}: Gemini quota exhausted. Waiting before retry.`);
      continue;
    }

    try {
      const response = await ai.models.generateContent({
        model,
        config: systemPrompt || languageInstruction
          ? { ...generationDefaults, systemInstruction: `${systemPrompt || ""}${languageInstruction}\n\n${buildRuntimeCallRules(conversation)}`.trim() }
          : generationDefaults,
        contents: conversation.map((entry) => ({
          role: entry.role,
          parts: [{ text: entry.text }],
        })),
      });

      const text = response.text?.trim();
      if (text) {
        const normalizedText = normalizeCompanyName(text);
        if (isWeakDiscoveryReply(userText, normalizedText, conversation)) {
          const fallbackText = normalizeCompanyName(getLocalAgentReply(userText, conversation));
          callHistories.set(
            callSid,
            conversation
              .concat([{ role: "model", text: fallbackText }])
              .slice(-MAX_HISTORY_TURNS)
          );
          return fallbackText;
        }
        activeModel = model;
        lastGeminiError = "";
        quotaBlockedModels.delete(model);
        callHistories.set(
          callSid,
          conversation
            .concat([{ role: "model", text: normalizedText }])
            .slice(-MAX_HISTORY_TURNS)
        );
        return normalizedText;
      }
    } catch (error) {
      const message = readErrorMessage(error);
      const summarized = summarizeGeminiError(message);
      errors.push(`${model}: ${summarized}`);
      console.warn("Gemini unavailable for phone call:", `${model}: ${summarized}`);
      if (isQuotaError(message)) {
        markModelQuotaBlocked(model);
        continue;
      }
    }
  }

  lastGeminiError = errors.length > 0 ? errors.join(" | ") : "No supported Gemini model returned text.";
  callHistories.set(callSid, conversation.slice(-MAX_HISTORY_TURNS));
  return normalizeCompanyName(getLocalAgentReply(userText, conversation));
}

function getLocalSentiment(text) {
  const negative = /\b(no|not|bad|angry|frustrated|busy|later|stop)\b/i.test(text);
  const positive = /\b(yes|sure|great|good|book|interested|thanks)\b/i.test(text);
  return {
    score: negative ? 0.25 : positive ? 0.82 : 0.55,
    label: negative ? "negative" : positive ? "positive" : "neutral",
  };
}

function detectSchedulingIntent(text) {
  return /\b(book|schedule|slot|meeting|calendar|demo|reschedule|tomorrow|today|day\s*-?\s*after\s*-?\s*tomorrow|am|pm|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|\d{1,2}[\/\-.]\d{1,2})\b/i.test(
    text
  );
}

function isAffirmative(text) {
  return /\b(yes|yeah|yep|sure|ok|okay|works|book it|go ahead|do it|perfect)\b/i.test(text);
}

function isNegative(text) {
  if (isMixedIntent(text)) return false;
  return /\b(no|nope|not now|later|different|another|won't work|doesn't work)\b/i.test(text);
}

function extractEmail(text) {
  const match = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

function extractLeadDetails(history, customerText) {
  const userTurns = history.filter((entry) => entry.role === "user").map((entry) => entry.text);
  const merged = [...userTurns, customerText].join("\n");
  const email = extractEmail(merged);

  const nameMatch = merged.match(/\b(?:i am|i'm|my name is)\s+([A-Za-z][A-Za-z\s'-]{1,40})/i);
  const leadName = nameMatch ? nameMatch[1].trim() : "Lead";

  return { email, leadName };
}

const MONTH_LOOKUP = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function parseClock(text) {
  const raw = String(text || "");

  const amPmMatch = raw.match(/\b(?:at\s*)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (amPmMatch) {
    let hour = Number(amPmMatch[1]);
    const minute = Number(amPmMatch[2] || 0);
    const meridiem = amPmMatch[3].toLowerCase();
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return { hour, minute };
  }

  const hhMmMatch = raw.match(/\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (hhMmMatch) {
    return { hour: Number(hhMmMatch[1]), minute: Number(hhMmMatch[2]) };
  }

  return null;
}

function isValidDateParts(year, monthIndex, day) {
  const candidate = new Date(year, monthIndex, day);
  return (
    candidate.getFullYear() === year &&
    candidate.getMonth() === monthIndex &&
    candidate.getDate() === day
  );
}

function parseYear(rawYear) {
  if (!rawYear) return null;
  const numeric = Number(rawYear);
  if (Number.isNaN(numeric)) return null;
  if (rawYear.length === 2) {
    return numeric >= 70 ? 1900 + numeric : 2000 + numeric;
  }
  return numeric;
}

function resolveYearForMonthDay(day, monthIndex, now) {
  const thisYear = now.getFullYear();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  if (isValidDateParts(thisYear, monthIndex, day)) {
    const currentYearDate = new Date(thisYear, monthIndex, day);
    if (currentYearDate >= todayStart) {
      return thisYear;
    }
  }

  const nextYear = thisYear + 1;
  if (isValidDateParts(nextYear, monthIndex, day)) {
    return nextYear;
  }

  return null;
}

function buildDateTime(year, monthIndex, day, timeInfo) {
  if (!isValidDateParts(year, monthIndex, day)) return null;
  const hour = timeInfo ? timeInfo.hour : 9;
  const minute = timeInfo ? timeInfo.minute : 0;
  const candidate = new Date(year, monthIndex, day, hour, minute, 0, 0);
  if (Number.isNaN(candidate.getTime())) return null;
  return candidate;
}

function isWithinNextTwoYears(date, now) {
  const maxDate = new Date(now);
  maxDate.setFullYear(maxDate.getFullYear() + 2);
  maxDate.setHours(23, 59, 59, 999);
  return date <= maxDate;
}

function parseRequestedDateTime(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const sanitized = raw
    .replace(/\bfor\b/gi, " ")
    .replace(/\bon\b/gi, " ")
    .replace(/,/g, " ")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();

  const now = new Date();
  const lower = sanitized.toLowerCase();
  const compactLower = lower.replace(/[\s-]+/g, "");
  const timeInfo = parseClock(sanitized);
  const hasExplicitTime = Boolean(timeInfo);

  if (lower.includes("today")) {
    const base = new Date(now);
    const time = timeInfo || { hour: 9, minute: 0 };
    base.setHours(time.hour, time.minute, 0, 0);
    return { date: base, hasExplicitTime };
  }

  if (lower.includes("day after tomorrow") || compactLower.includes("dayaftertomorrow")) {
    const base = new Date(now);
    const time = timeInfo || { hour: 9, minute: 0 };
    base.setDate(base.getDate() + 2);
    base.setHours(time.hour, time.minute, 0, 0);
    return { date: base, hasExplicitTime };
  }

  if (lower.includes("tomorrow")) {
    const base = new Date(now);
    const time = timeInfo || { hour: 9, minute: 0 };
    base.setDate(base.getDate() + 1);
    base.setHours(time.hour, time.minute, 0, 0);
    return { date: base, hasExplicitTime };
  }

  const isoMatch = sanitized.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2}))?\b/);
  if (isoMatch) {
    const [, y, m, d, hh, mm] = isoMatch;
    const fallbackTime = timeInfo || { hour: Number(hh || 9), minute: Number(mm || 0) };
    const parsed = buildDateTime(Number(y), Number(m) - 1, Number(d), fallbackTime);
    if (parsed && isWithinNextTwoYears(parsed, now)) {
      return { date: parsed, hasExplicitTime: hasExplicitTime || Boolean(hh) };
    }
    return null;
  }

  const numericDateMatch = sanitized.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (numericDateMatch) {
    const day = Number(numericDateMatch[1]);
    const monthIndex = Number(numericDateMatch[2]) - 1;
    const explicitYear = parseYear(numericDateMatch[3]);
    const resolvedYear = explicitYear ?? resolveYearForMonthDay(day, monthIndex, now);
    if (resolvedYear == null) return null;
    const parsed = buildDateTime(resolvedYear, monthIndex, day, timeInfo || { hour: 9, minute: 0 });
    if (parsed && isWithinNextTwoYears(parsed, now)) {
      return { date: parsed, hasExplicitTime };
    }
    return null;
  }

  const longDateMatch = sanitized.match(
    /\b(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{2,4}))?\b/i
  );
  if (longDateMatch) {
    const day = Number(longDateMatch[1]);
    const monthIndex = MONTH_LOOKUP[String(longDateMatch[2] || "").toLowerCase()];
    const explicitYear = parseYear(longDateMatch[3]);
    if (monthIndex != null) {
      const resolvedYear = explicitYear ?? resolveYearForMonthDay(day, monthIndex, now);
      if (resolvedYear == null) return null;
      const parsed = buildDateTime(resolvedYear, monthIndex, day, timeInfo || { hour: 9, minute: 0 });
      if (parsed && isWithinNextTwoYears(parsed, now)) {
        return { date: parsed, hasExplicitTime };
      }
    }
  }

  const monthFirstMatch = sanitized.match(
    /\b([A-Za-z]+)\s+(\d{1,2})(?:\s+(\d{2,4}))?\b/i
  );
  if (monthFirstMatch) {
    const monthIndex = MONTH_LOOKUP[String(monthFirstMatch[1] || "").toLowerCase()];
    const day = Number(monthFirstMatch[2]);
    const explicitYear = parseYear(monthFirstMatch[3]);
    if (monthIndex != null) {
      const resolvedYear = explicitYear ?? resolveYearForMonthDay(day, monthIndex, now);
      if (resolvedYear == null) return null;
      const parsed = buildDateTime(resolvedYear, monthIndex, day, timeInfo || { hour: 9, minute: 0 });
      if (parsed && isWithinNextTwoYears(parsed, now)) {
        return { date: parsed, hasExplicitTime };
      }
    }
  }

  const direct = Date.parse(sanitized);
  if (!Number.isNaN(direct)) {
    const parsed = new Date(direct);
    if (isWithinNextTwoYears(parsed, now)) {
      return { date: parsed, hasExplicitTime };
    }
  }

  return null;
}

function toSlotLabel(date, timeZone) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timeZone || "Asia/Calcutta",
  }).format(date);
}

function toDateLabel(date, timeZone) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timeZone || "Asia/Calcutta",
  }).format(date);
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

async function calendarRequest(token, pathName, method, body) {
  const response = await fetch(`${GOOGLE_CALENDAR_BASE_URL}${pathName}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Google Calendar ${method} ${pathName} failed: ${payload || response.statusText}`);
  }

  return response.json();
}

function eventBoundaryToDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getEventStartDate(event) {
  return eventBoundaryToDate(event?.start?.dateTime || event?.start?.date);
}

function getEventEndDate(event) {
  return eventBoundaryToDate(event?.end?.dateTime || event?.end?.date);
}

function getEventLabel(event, timeZone) {
  const start = getEventStartDate(event);
  const end = getEventEndDate(event);
  const title = String(event?.summary || "Busy").trim();
  if (!start || !end) return title;
  return `${title} (${toSlotLabel(start, timeZone)} - ${toSlotLabel(end, timeZone)})`;
}

function buildCalendarEventQuery(startTime, endTime, timeZone, maxResults = 50) {
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: startTime.toISOString(),
    timeMax: endTime.toISOString(),
    maxResults: String(maxResults),
    timeZone,
  });
  return `/calendars/primary/events?${params.toString()}`;
}

async function listBusyEvents(token, startTime, endTime, timeZone, maxResults = 50) {
  const payload = await calendarRequest(
    token,
    buildCalendarEventQuery(startTime, endTime, timeZone, maxResults),
    "GET"
  );
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.filter((event) => {
    const status = String(event?.status || "").toLowerCase();
    const transparency = String(event?.transparency || "").toLowerCase();
    return status !== "cancelled" && transparency !== "transparent";
  });
}

async function getPrimaryCalendarInfo(token) {
  const payload = await calendarRequest(token, "/users/me/calendarList/primary", "GET");
  return {
    id: String(payload?.id || "primary"),
    summary: String(payload?.summary || "Primary Calendar"),
    timeZone: String(payload?.timeZone || ""),
  };
}

async function checkSlotAvailability(token, startTime, endTime, timeZone) {
  const conflicts = await listBusyEvents(token, startTime, endTime, timeZone, 20);
  return {
    busy: conflicts.length > 0,
    conflicts,
  };
}

async function suggestAlternativeSameDay(token, requestedStart, durationMinutes, timeZone) {
  const dayStart = new Date(requestedStart);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(requestedStart);
  dayEnd.setHours(23, 59, 59, 999);

  const busyEvents = await listBusyEvents(token, dayStart, dayEnd, timeZone, 250);
  const busyRanges = busyEvents
    .map((entry) => ({
      start: getEventStartDate(entry),
      end: getEventEndDate(entry),
    }))
    .filter((range) => range.start && range.end);

  let candidate = new Date(requestedStart.getTime() + 30 * 60 * 1000);
  candidate.setSeconds(0, 0);
  const now = new Date();
  const minimumStart = new Date(now.getTime() + 5 * 60 * 1000);
  if (candidate < minimumStart) {
    candidate = minimumStart;
    candidate.setSeconds(0, 0);
  }
  const latest = new Date(requestedStart);
  latest.setHours(20, 0, 0, 0);

  while (candidate < latest) {
    const end = new Date(candidate.getTime() + durationMinutes * 60 * 1000);
    const isBusy = busyRanges.some((range) => overlaps(candidate, end, range.start, range.end));
    if (!isBusy) {
      return { start: candidate, end };
    }
    candidate = new Date(candidate.getTime() + 30 * 60 * 1000);
  }

  return null;
}

async function createDemoEvent(token, startTime, endTime, timeZone, leadName, email) {
  const attendees = email ? [{ email }] : undefined;
  const created = await calendarRequest(token, "/calendars/primary/events", "POST", {
    summary: "DP vision Analytics Demo",
    description: `Lead: ${leadName}\nBooked by Pooja AI`,
    start: { dateTime: startTime.toISOString(), timeZone },
    end: { dateTime: endTime.toISOString(), timeZone },
    attendees,
  });
  if (!created?.id) return created;
  return calendarRequest(token, `/calendars/primary/events/${encodeURIComponent(created.id)}`, "GET");
}

async function maybeHandleSchedulingFlow({
  sessionId,
  history,
  customerText,
  calendarToken,
  timeZone,
}) {
  const normalizedSessionId = String(sessionId || "").trim() || "default";
  const tz = timeZone || "Asia/Calcutta";
  const text = String(customerText || "").trim();
  if (!text) return null;

  const existingState = schedulingStates.get(normalizedSessionId);
  const leadDetails = extractLeadDetails(history, text);
  let calendarInfo = null;
  if (calendarToken) {
    try {
      calendarInfo = await getPrimaryCalendarInfo(calendarToken);
    } catch (error) {
      console.warn("Calendar identity lookup failed:", readErrorMessage(error));
    }
  }
  const calendarName = calendarInfo?.summary || "your primary calendar";

  const bookOrSuggestSlot = async (requestedStart, bookingLeadDetails) => {
    const now = new Date();
    if (requestedStart.getTime() < now.getTime() - 60 * 1000) {
      return "That time is in the past. Please share a future slot and I will lock it in.";
    }

    const requestedEnd = new Date(requestedStart.getTime() + 30 * 60 * 1000);
    const slotCheck = await checkSlotAvailability(calendarToken, requestedStart, requestedEnd, tz);
    const busy = slotCheck.busy;

    if (!busy) {
      const event = await createDemoEvent(
        calendarToken,
        requestedStart,
        requestedEnd,
        tz,
        bookingLeadDetails.leadName,
        bookingLeadDetails.email
      );
      const slotLabel = toSlotLabel(requestedStart, tz);
      return `Awesome, that slot is open and I have booked your demo on ${calendarName} for ${slotLabel}. ${
        event?.htmlLink ? `Open event: ${event.htmlLink}` : ""
      }`.trim();
    }

    const alternative = await suggestAlternativeSameDay(calendarToken, requestedStart, 30, tz);
    if (!alternative) {
      return "Sorry, that time is booked and I could not find another open slot on the same day. Share another day and I'll check instantly.";
    }

    schedulingStates.set(normalizedSessionId, {
      awaitingConfirmation: true,
      startISO: alternative.start.toISOString(),
      endISO: alternative.end.toISOString(),
      email: bookingLeadDetails.email,
      leadName: bookingLeadDetails.leadName,
    });

    const firstConflict = slotCheck.conflicts?.[0];
    const conflictText = firstConflict ? `I can see a conflict: ${getEventLabel(firstConflict, tz)}. ` : "";
    return `Sorry, that slot is already booked on ${calendarName}. ${conflictText}I can do ${toSlotLabel(alternative.start, tz)} instead. Want me to lock that in?`;
  };

  if (existingState?.awaitingConfirmation) {
    if (isAffirmative(text)) {
      if (!calendarToken) {
        return "Perfect. I can lock it in as soon as Google Calendar is connected. Please connect it once and say yes again.";
      }
      const event = await createDemoEvent(
        calendarToken,
        new Date(existingState.startISO),
        new Date(existingState.endISO),
        tz,
        existingState.leadName || leadDetails.leadName,
        existingState.email || leadDetails.email
      );
      schedulingStates.delete(normalizedSessionId);
      const slotLabel = toSlotLabel(new Date(existingState.startISO), tz);
      return `Done, booked. I've scheduled your demo on ${calendarName} for ${slotLabel}. ${event?.htmlLink ? `Open it here: ${event.htmlLink}` : ""}`.trim();
    }

    if (isNegative(text)) {
      schedulingStates.delete(normalizedSessionId);
      return "No problem at all. Share another time on the same day and I'll check it right away.";
    }
  }

  if (existingState?.awaitingTime) {
    const timeInfo = parseClock(text);
    if (!timeInfo) {
      return `Got it for ${toDateLabel(new Date(existingState.dateISO), tz)}. What time works best?`;
    }
    const requestedStart = new Date(existingState.dateISO);
    requestedStart.setHours(timeInfo.hour, timeInfo.minute, 0, 0);
    schedulingStates.delete(normalizedSessionId);
    return bookOrSuggestSlot(requestedStart, {
      email: existingState.email || leadDetails.email,
      leadName: existingState.leadName || leadDetails.leadName,
    });
  }

  if (!detectSchedulingIntent(text)) {
    return null;
  }

  if (!calendarToken) {
    return "Absolutely. Share your preferred date and time, and once Google Calendar is connected I'll check availability and book it for you.";
  }

  const parsedRequest = parseRequestedDateTime(text);
  if (!parsedRequest) {
    return "Perfect, let's book it. Tell me the exact date and time (example: tomorrow 3:30 pm) and the best email for the invite.";
  }

  if (!parsedRequest.hasExplicitTime) {
    schedulingStates.set(normalizedSessionId, {
      awaitingTime: true,
      dateISO: parsedRequest.date.toISOString(),
      email: leadDetails.email,
      leadName: leadDetails.leadName,
    });
    return `Great, I can do ${toDateLabel(parsedRequest.date, tz)}. What time should I book?`;
  }

  return bookOrSuggestSlot(parsedRequest.date, leadDetails);
}

function endAndroidSession(sessionId) {
  androidSessions.delete(sessionId);
  callHistories.delete(sessionId);
  schedulingStates.delete(sessionId);
}

function buildAndroidStatusPayload(sessionId) {
  const session = androidSessions.get(sessionId);
  if (!session) {
    return { connected: false, sessionId, message: "Session not found." };
  }

  return {
    connected: true,
    sessionId,
    callerNumber: session.callerNumber || "",
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    timeZone: session.timeZone,
    hasCalendarToken: Boolean(session.calendarToken),
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get("/api/agent-status", (_req, res) => {
    pruneAndroidSessions();
    const quotaBlockedModelNames = getQuotaBlockedModels();
    const quotaLimited = quotaBlockedModelNames.length > 0 || isQuotaError(lastGeminiError);
    res.json({
      geminiReady: Boolean(geminiApiKey),
      aiMode: quotaLimited || !ai ? "sales fallback" : "gemini",
      configuredModel,
      model: ai ? activeModel : "none",
      modelCandidates: discoveredModelCandidates,
      quotaBlockedModels: quotaBlockedModelNames,
      quotaLimited,
      statusMessage: quotaLimited
        ? "Gemini quota is cooling down. Pooja is using the built-in sales flow until quota resets."
        : "",
      lastGeminiError: quotaLimited ? "" : lastGeminiError,
      androidGatewayReady: true,
      activeAndroidSessions: androidSessions.size,
    });
  });

  app.get("/api/dialer/status", (req, res) => {
    res.json(getDialerConfigStatus(req));
  });

  app.get("/api/live-calls/latest", (_req, res) => {
    const session = getLatestLiveCallSession();
    if (!session) {
      res.status(404).json({ ok: false, error: "No live call found." });
      return;
    }
    res.json({ ok: true, ...buildLiveCallPayload(session) });
  });

  app.get("/api/live-calls/:callSid", (req, res) => {
    pruneLiveCallSessions();
    const callSid = String(req.params.callSid || "").trim();
    const session = liveCallSessions.get(callSid);
    if (!session) {
      res.status(404).json({ ok: false, error: "Call not found." });
      return;
    }
    res.json({ ok: true, ...buildLiveCallPayload(session) });
  });

  app.post("/api/dialer/call", async (req, res) => {
    const normalizedNumber = normalizeDialNumber(req.body?.number || "");
    if (!isValidDialNumber(normalizedNumber)) {
      res.status(400).json({
        ok: false,
        error: "Enter a valid phone number with country code, for example +919876543210.",
      });
      return;
    }

    try {
      const call = await startOutboundAiCall({ req, toNumber: normalizedNumber });
      res.json({ ok: true, ...call });
    } catch (error) {
      console.error("Outbound AI call failed:", error);
      res.status(error.statusCode || 500).json({
        ok: false,
        error: readErrorMessage(error),
        details: error.payload || undefined,
      });
    }
  });

  app.post("/api/dialer/calls/:callSid/end", async (req, res) => {
    const callSid = String(req.params.callSid || "").trim();
    if (!callSid) {
      res.status(400).json({ ok: false, error: "callSid is required." });
      return;
    }
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      res.status(400).json({ ok: false, error: "Twilio credentials are not configured." });
      return;
    }

    try {
      const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ Status: "completed" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = payload?.message || `Twilio end call failed with ${response.status}`;
        res.status(response.status).json({ ok: false, error, details: payload });
        return;
      }
      callHistories.delete(callSid);
      markLiveCallEnded(callSid);
      res.json({ ok: true, callSid, status: payload.status || "completed" });
    } catch (error) {
      res.status(500).json({ ok: false, error: readErrorMessage(error) });
    }
  });

  app.get("/api/runtime-config", (_req, res) => {
    res.json({
      clientId: String(process.env.VITE_CLIENT_ID || "").trim(),
      port: PORT,
    });
  });

  app.get("/api/health", (_req, res) => {
    pruneAndroidSessions();
    res.json({
      ok: true,
      port: PORT,
      mode: ai ? "gemini" : "local fallback",
      androidGatewayReady: true,
      activeAndroidSessions: androidSessions.size,
      mongoReady: Boolean(MONGODB_URI),
    });
  });

  app.get("/api/leads", async (_req, res) => {
    try {
      res.json({ ok: true, leads: await listStoredLeads() });
    } catch (error) {
      res.status(error.statusCode || 500).json({ ok: false, error: summarizeMongoError(error) });
    }
  });

  app.post("/api/leads", async (req, res) => {
    try {
      const collection = await getLeadsCollection();
      const lead = normalizeLead(req.body || {});
      await collection.updateOne(
        { id: lead.id },
        { $set: lead, $setOnInsert: { createdAt: new Date().toISOString() } },
        { upsert: true }
      );
      res.json({ ok: true, lead: serializeLead(lead) });
    } catch (error) {
      res.status(error.statusCode || 500).json({ ok: false, error: summarizeMongoError(error) });
    }
  });

  app.post("/api/leads/import", async (req, res) => {
    try {
      const incomingLeads = Array.isArray(req.body?.leads) ? req.body.leads : [];
      const leads = incomingLeads.map(normalizeLead);
      const collection = await getLeadsCollection();
      if (leads.length) {
        await collection.bulkWrite(
          leads.map((lead) => ({
            updateOne: {
              filter: { id: lead.id },
              update: { $set: lead, $setOnInsert: { createdAt: new Date().toISOString() } },
              upsert: true,
            },
          }))
        );
      }
      res.json({ ok: true, leads: await listStoredLeads() });
    } catch (error) {
      res.status(error.statusCode || 500).json({ ok: false, error: summarizeMongoError(error) });
    }
  });

  app.put("/api/leads/:id", async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      const collection = await getLeadsCollection();
      const lead = normalizeLead({ ...(req.body || {}), id });
      const result = await collection.updateOne({ id }, { $set: lead });
      if (!result.matchedCount) {
        res.status(404).json({ ok: false, error: "Lead not found." });
        return;
      }
      res.json({ ok: true, lead: serializeLead(lead) });
    } catch (error) {
      res.status(error.statusCode || 500).json({ ok: false, error: summarizeMongoError(error) });
    }
  });

  app.delete("/api/leads/:id", async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      const collection = await getLeadsCollection();
      await collection.deleteOne({ id });
      res.json({ ok: true, id });
    } catch (error) {
      res.status(error.statusCode || 500).json({ ok: false, error: summarizeMongoError(error) });
    }
  });

  app.get("/api/agent-prompt", (_req, res) => {
    res.type("text/plain").send(getPromptText());
  });

  app.get("/api/voice-settings", (_req, res) => {
    res.json({ ok: true, ...getVoiceSettings() });
  });

  app.put("/api/voice-settings", (req, res) => {
    voiceSettings = normalizeVoiceSettings(req.body || {});
    res.json({ ok: true, ...getVoiceSettings() });
  });

  app.post("/api/voice-settings/test-call", async (req, res) => {
    const normalizedNumber = normalizeDialNumber(req.body?.number || "");
    if (!isValidDialNumber(normalizedNumber)) {
      res.status(400).json({
        ok: false,
        error: "Enter a valid phone number with country code, for example +919876543210.",
      });
      return;
    }
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      res.status(400).json({ ok: false, error: "Twilio credentials are not configured." });
      return;
    }

    const testSettings = normalizeVoiceSettings(req.body?.settings || getVoiceSettings());
    const sampleText = String(
      req.body?.sampleText || "Hi, this is Pooja from DP vision Analytics. This is a real phone test for this voice pack."
    ).trim();
    const params = new URLSearchParams({
      To: normalizedNumber,
      From: TWILIO_FROM_NUMBER,
      Twiml: twiml(`${buildSay(sampleText, testSettings)}<Hangup />`),
    });

    try {
      const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        res.status(response.status).json({ ok: false, error: payload?.message || "Twilio test call failed.", details: payload });
        return;
      }
      res.json({ ok: true, callSid: payload.sid, status: payload.status, to: normalizedNumber });
    } catch (error) {
      res.status(500).json({ ok: false, error: readErrorMessage(error) });
    }
  });

  app.put("/api/agent-prompt", express.text({ type: "*/*" }), (req, res) => {
    try {
      const rawPrompt = typeof req.body === "string" ? req.body : "";
      const resolvedPath = path.resolve(process.cwd(), promptPath);
      fs.writeFileSync(resolvedPath, rawPrompt, "utf8");
      res.type("text/plain").send(rawPrompt);
    } catch (error) {
      console.error("Failed to save agent prompt:", error);
      res.status(400).type("text/plain").send("Invalid prompt payload");
    }
  });

  app.post("/api/agent/respond", async (req, res) => {
    const { history = [], sessionId = "", calendarToken = "", timeZone = "" } = req.body || {};
    try {
      const normalizedHistory = normalizeHistory(history);
      const lastUserTurn = [...normalizedHistory].reverse().find((entry) => entry.role === "user");
      const customerText = lastUserTurn?.text || "";
      const callSid = `web-${Date.now()}`;

      callHistories.set(callSid, normalizedHistory);
      let schedulingReply = null;
      try {
        schedulingReply = await maybeHandleSchedulingFlow({
          sessionId,
          history: normalizedHistory,
          customerText,
          calendarToken: String(calendarToken || "").trim(),
          timeZone: String(timeZone || "").trim(),
        });
      } catch (calendarError) {
        console.error("Calendar automation failed:", calendarError);
        const reason = readErrorMessage(calendarError).toLowerCase();
        if (reason.includes("401") || reason.includes("invalid credentials") || reason.includes("invalid_grant")) {
          schedulingReply =
            "Your Google Calendar token expired. Please reconnect Calendar once and I will book the slot immediately.";
        } else if (reason.includes("insufficient") || reason.includes("permission")) {
          schedulingReply =
            "Calendar permission looks incomplete. Please reconnect and allow calendar access, then I can book it right away.";
        } else {
          schedulingReply =
            "I hit a quick calendar sync issue while checking that slot. Please confirm your date, time, and email once more and I'll try again.";
        }
      }

      if (schedulingReply) {
        const normalizedReply = normalizeCompanyName(schedulingReply);
        res.json({ text: normalizedReply });
        return;
      }

      const reply = await getGeminiReply(callSid, customerText);
      res.json({ text: reply });
    } catch (error) {
      console.error("Agent response proxy failed:", error);
      res.status(500).json({ text: FALLBACK_REPLY });
    }
  });

  app.post("/api/agent/sentiment", async (req, res) => {
    const { text = "" } = req.body || {};
    res.json(getLocalSentiment(String(text)));
  });

  app.post("/api/android/session/start", (req, res) => {
    pruneAndroidSessions();
    const {
      sessionId = "",
      callerNumber = "",
      calendarToken = "",
      timeZone = "",
      resume = false,
    } = req.body || {};

    const normalizedSessionId = String(sessionId || "").trim() || generateSessionId("android");
    const hasExistingSession = androidSessions.has(normalizedSessionId);
    const shouldResume = Boolean(resume) && hasExistingSession;
    const nowIso = new Date().toISOString();

    const previous = androidSessions.get(normalizedSessionId) || {};
    const nextSession = {
      sessionId: normalizedSessionId,
      callerNumber: String(callerNumber || previous.callerNumber || "").trim(),
      calendarToken: String(calendarToken || previous.calendarToken || "").trim(),
      timeZone: String(timeZone || previous.timeZone || "Asia/Calcutta").trim() || "Asia/Calcutta",
      createdAt: previous.createdAt || nowIso,
      lastSeenAt: nowIso,
    };

    androidSessions.set(normalizedSessionId, nextSession);

    let openingLine = "";
    if (!shouldResume) {
      const promptOpeningLine = normalizeCompanyName(getPromptParts().openingLine);
      openingLine = promptOpeningLine || "Hey, it's Pooja. How are you today?";
      callHistories.set(normalizedSessionId, []);
      schedulingStates.delete(normalizedSessionId);
      appendHistoryTurn(normalizedSessionId, "model", openingLine);
    }

    res.json({
      ok: true,
      sessionId: normalizedSessionId,
      resumed: shouldResume,
      openingLine,
      replyText: openingLine,
      ...buildAndroidStatusPayload(normalizedSessionId),
    });
  });

  app.post("/api/android/session/turn", async (req, res) => {
    pruneAndroidSessions();
    const {
      sessionId = "",
      userText = "",
      calendarToken = "",
      timeZone = "",
    } = req.body || {};

    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      res.status(400).json({ ok: false, error: "sessionId is required." });
      return;
    }

    const session = androidSessions.get(normalizedSessionId);
    if (!session) {
      res.status(404).json({
        ok: false,
        error: "Session not found. Start a session first.",
      });
      return;
    }

    const normalizedUserText = String(userText || "").trim();
    if (!normalizedUserText) {
      res.status(400).json({ ok: false, error: "userText is required." });
      return;
    }

    session.lastSeenAt = new Date().toISOString();
    if (calendarToken) session.calendarToken = String(calendarToken).trim();
    if (timeZone) session.timeZone = String(timeZone).trim();
    if (!session.timeZone) session.timeZone = "Asia/Calcutta";
    androidSessions.set(normalizedSessionId, session);

    try {
      const history = getStoredHistory(normalizedSessionId);
      let schedulingReply = null;

      try {
        schedulingReply = await maybeHandleSchedulingFlow({
          sessionId: normalizedSessionId,
          history,
          customerText: normalizedUserText,
          calendarToken: session.calendarToken,
          timeZone: session.timeZone,
        });
      } catch (calendarError) {
        console.error("Android calendar automation failed:", calendarError);
        const reason = readErrorMessage(calendarError).toLowerCase();
        if (reason.includes("401") || reason.includes("invalid credentials") || reason.includes("invalid_grant")) {
          schedulingReply =
            "Your Google Calendar token expired. Reconnect Calendar once and I will book it immediately.";
        } else if (reason.includes("insufficient") || reason.includes("permission")) {
          schedulingReply =
            "Calendar permission looks incomplete. Reconnect and allow calendar access, then I can lock the slot.";
        } else {
          schedulingReply =
            "I hit a quick calendar sync issue while checking that slot. Confirm date, time, and email once more and I'll retry.";
        }
      }

      let replyText = "";
      let shouldEnd = false;

      if (schedulingReply) {
        replyText = normalizeCompanyName(String(schedulingReply || "").replace("[END_CALL]", "").trim());
        shouldEnd = String(schedulingReply).includes("[END_CALL]");
        appendHistoryTurn(normalizedSessionId, "user", normalizedUserText);
        appendHistoryTurn(normalizedSessionId, "model", replyText);
      } else {
        const rawReply = await getGeminiReply(normalizedSessionId, normalizedUserText);
        shouldEnd = rawReply.includes("[END_CALL]");
        replyText = normalizeCompanyName(rawReply.replace("[END_CALL]", "").trim());
      }

      if (!replyText) {
        replyText = "Sorry, I missed that. Could you repeat it once?";
      }

      if (shouldEnd) {
        endAndroidSession(normalizedSessionId);
      }

      res.json({
        ok: true,
        sessionId: normalizedSessionId,
        replyText,
        shouldEnd,
        sentiment: getLocalSentiment(normalizedUserText),
        status: shouldEnd ? { connected: false } : buildAndroidStatusPayload(normalizedSessionId),
      });
    } catch (error) {
      console.error("Android session turn failed:", error);
      res.status(500).json({
        ok: false,
        sessionId: normalizedSessionId,
        replyText: FALLBACK_REPLY,
      });
    }
  });

  app.get("/api/android/session/:sessionId", (req, res) => {
    pruneAndroidSessions();
    const normalizedSessionId = String(req.params.sessionId || "").trim();
    if (!normalizedSessionId) {
      res.status(400).json({ ok: false, error: "sessionId is required." });
      return;
    }
    const payload = buildAndroidStatusPayload(normalizedSessionId);
    if (!payload.connected) {
      res.status(404).json({ ok: false, ...payload });
      return;
    }
    res.json({ ok: true, ...payload });
  });

  app.post("/api/android/session/end", (req, res) => {
    const { sessionId = "" } = req.body || {};
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      res.status(400).json({ ok: false, error: "sessionId is required." });
      return;
    }
    endAndroidSession(normalizedSessionId);
    res.json({ ok: true, sessionId: normalizedSessionId, ended: true });
  });

  app.post("/twilio/voice", (req, res) => {
    const callSid = req.body.CallSid || `call-${Date.now()}`;
    const { openingLine } = getPromptParts();
    if (!callHistories.has(callSid)) {
      callHistories.set(callSid, [{ role: "model", text: openingLine }]);
    }
    const liveSession = ensureLiveCallSession(callSid, {
      to: req.body.To || "",
      status: "in-progress",
    });
    if (!liveSession?.events?.length) {
      appendLiveCallEvent(callSid, "agent", openingLine);
    }
    res.type("text/xml").send(twiml(gather(openingLine) + `<Redirect method="POST">/twilio/voice</Redirect>`));
  });

  app.post("/twilio/respond", async (req, res) => {
    const callSid = req.body.CallSid || `call-${Date.now()}`;
    const customerText = req.body.SpeechResult || req.body.Digits || "";
    ensureLiveCallSession(callSid, {
      to: req.body.To || "",
      status: "in-progress",
    });
    console.log(
      "Twilio heard:",
      JSON.stringify({
        callSid,
        speech: req.body.SpeechResult || "",
        confidence: req.body.Confidence || "",
        digits: req.body.Digits || "",
      })
    );

    if (!customerText.trim()) {
      const missedLine = "I missed that last bit. What was that?";
      appendLiveCallEvent(callSid, "agent", missedLine);
      res.type("text/xml").send(twiml(gather(missedLine)));
      return;
    }

    try {
      appendLiveCallEvent(callSid, "user", customerText);
      const rawReply = await getGeminiReply(callSid, customerText);
      const shouldEnd = rawReply.includes("[END_CALL]");
      const reply = rawReply.replace("[END_CALL]", "").trim();
      appendLiveCallEvent(callSid, "agent", reply || "Thanks for your time. Have a great day.");

      if (shouldEnd) {
        callHistories.delete(callSid);
        markLiveCallEnded(callSid);
        res.type("text/xml").send(twiml(`${say(reply || "Thanks for your time. Have a great day.")}<Hangup />`));
        return;
      }

      res.type("text/xml").send(twiml(`${say(reply)}${gather("")}`));
    } catch (error) {
      console.error("Twilio response failed:", error);
      const errorLine = "I had a small connection issue there. Could you say that once more?";
      appendLiveCallEvent(callSid, "agent", errorLine);
      res.type("text/xml").send(twiml(gather(errorLine)));
    }
  });

  app.post("/twilio/status", (req, res) => {
    const callSid = String(req.body.CallSid || "").trim();
    const parentCallSid = String(req.body.ParentCallSid || "").trim();
    const callStatus = String(req.body.CallStatus || req.body.CallStatusCallbackEvent || "").trim().toLowerCase();
    const statusTargetSids = [callSid, parentCallSid].filter(Boolean);
    if (callSid) {
      console.log(
        "Twilio status:",
        JSON.stringify({
          callSid,
          parentCallSid,
          status: callStatus,
          to: req.body.To || "",
          from: req.body.From || "",
        })
      );
      for (const sid of statusTargetSids) {
        if (["completed", "canceled", "busy", "failed", "no-answer"].includes(callStatus)) {
          callHistories.delete(sid);
          markLiveCallEnded(sid);
        } else if (callStatus) {
          ensureLiveCallSession(sid, {
            to: req.body.To || "",
            status: callStatus,
          });
        }
      }
    }
    res.type("text/plain").send("ok");
  });

  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
