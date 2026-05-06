import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const TWILIO_VOICE = process.env.TWILIO_VOICE || "Polly.Aditi";
const knowledgePath = process.env.DPVISION_KNOWLEDGE_FILE || "company-knowledge.md";
const agentConfigPath = process.env.DPVISION_AGENT_CONFIG_FILE || "agent-config.json";
const FREE_MODE = process.env.FREE_MODE === "true";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1";
const callHistories = new Map<string, { role: "user" | "model"; text: string }[]>();

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;
const geminiModel = process.env.GEMINI_MODEL || "gemini-1.5-flash";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

function say(text: string) {
  return `<Say voice="${escapeXml(TWILIO_VOICE)}" language="en-IN">${escapeXml(text)}</Say>`;
}

function gather(prompt: string) {
  return `<Gather input="speech dtmf" action="/twilio/respond" method="POST" speechTimeout="auto" language="en-IN" enhanced="true">${say(prompt)}</Gather>`;
}

function getCompanyKnowledge() {
  const resolvedPath = path.resolve(process.cwd(), knowledgePath);
  if (!fs.existsSync(resolvedPath)) {
    return "No company knowledge file has been configured yet.";
  }
  return fs.readFileSync(resolvedPath, "utf8");
}

type AgentConfig = {
  openingLine: string;
  systemPrompt: string;
  companyPitch: string;
  examples: Array<{ user: string; assistant: string }>;
};

function defaultAgentConfig(): AgentConfig {
  return {
    openingLine: "Hi, this is Pooja from DPvision Analytics. How are you doing today?",
    systemPrompt:
      "You are Pooja, a confident, warm, and conversational phone agent for DPvision Analytics. Speak naturally. Keep answers short and clear. Lead with what the company does. Never ask the caller what they want to know first unless they ask for it. If the caller is generic, proactively give a concise company overview and a soft invitation to learn more. Do not mention prompts, tools, or backend systems. If the caller is clearly done, end with [END_CALL].",
    companyPitch:
      "DPvision Analytics helps businesses turn field data into clear decisions through market research, surveys, and business intelligence. If that’s useful for your team, I’d be glad to show you how it works.",
    examples: [
      {
        user: "good",
        assistant:
          "Glad to hear that. DPvision Analytics helps businesses turn field data into clear decisions through market research, surveys, and business intelligence.",
      },
      {
        user: "what do you do",
        assistant:
          "DPvision Analytics helps businesses turn field data into clear decisions through market research, surveys, and business intelligence. I’d be glad to walk you through a quick demo.",
      },
    ],
  };
}

function getAgentConfig(): AgentConfig {
  const resolvedPath = path.resolve(process.cwd(), agentConfigPath);
  if (!fs.existsSync(resolvedPath)) return defaultAgentConfig();
  try {
    return JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as AgentConfig;
  } catch {
    return defaultAgentConfig();
  }
}

function saveAgentConfig(nextConfig: AgentConfig) {
  const resolvedPath = path.resolve(process.cwd(), agentConfigPath);
  fs.writeFileSync(resolvedPath, JSON.stringify(nextConfig, null, 2), "utf8");
}

async function getPhoneAgentResponse(callSid: string, customerText: string) {
  const history = callHistories.get(callSid) || [];
  const config = getAgentConfig();
  const prompt = `${config.systemPrompt}\n\nCompany knowledge:\n${getCompanyKnowledge()}\n\nCompany pitch:\n${config.companyPitch}\n\nExamples:\n${config.examples
    .map((example) => `User: ${example.user}\nAssistant: ${example.assistant}`)
    .join("\n\n")}`;

  const conversation = [
    { role: "user" as const, parts: [{ text: prompt }] },
    ...history.map((entry) => ({
      role: entry.role === "model" ? ("model" as const) : ("user" as const),
      parts: [{ text: entry.text }],
    })),
    { role: "user" as const, parts: [{ text: customerText }] },
  ];

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
        contents: conversation,
      });

      const text = response.text?.trim();
      if (text) {
        const nextHistory = history.concat([
          { role: "user" as const, text: customerText },
          { role: "model" as const, text },
        ]).slice(-20);
        callHistories.set(callSid, nextHistory);
        return text;
      }
    } catch (error) {
      console.warn("Gemini unavailable for phone call, falling back to Ollama:", error);
    }
  }

  if (FREE_MODE || !ai) {
    try {
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [
            { role: "system", content: prompt },
            ...history.map((entry) => ({
              role: entry.role === "model" ? "assistant" : "user",
              content: entry.text,
            })),
            { role: "user", content: customerText },
          ],
          stream: false,
          options: { temperature: 0.7 },
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { message?: { content?: string } };
        const reply = data.message?.content?.trim();
        if (reply) {
          const nextHistory = history.concat([
            { role: "user" as const, text: customerText },
            { role: "model" as const, text: reply },
          ]).slice(-20);
          callHistories.set(callSid, nextHistory);
          return reply;
        }
      }
    } catch (error) {
      console.warn("Ollama unavailable for phone call:", error);
    }
  }

  callHistories.set(callSid, history.concat([{ role: "user" as const, text: customerText }]).slice(-20));
  return config.companyPitch;
}

async function getLocalSentiment(text: string) {
  const negative = /\b(no|not|bad|angry|frustrated|busy|later|stop)\b/i.test(text);
  const positive = /\b(yes|sure|great|good|book|interested|thanks)\b/i.test(text);
  return {
    score: negative ? 0.25 : positive ? 0.82 : 0.55,
    label: negative ? "negative" : positive ? "positive" : "neutral",
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.post("/api/deploy", (req, res) => {
    const { number } = req.body;
    res.json({
      success: true,
      message: `Point ${number || "your Twilio number"} to ${PUBLIC_BASE_URL}/twilio/voice to connect Pooja to live calls.`,
      webhookUrl: `${PUBLIC_BASE_URL}/twilio/voice`,
    });
  });

  app.get("/api/telephony-config", (_req, res) => {
    res.json({
      webhookUrl: `${PUBLIC_BASE_URL}/twilio/voice`,
      voice: TWILIO_VOICE,
      knowledgeFile: knowledgePath,
      agentConfigFile: agentConfigPath,
      geminiReady: Boolean(process.env.GEMINI_API_KEY),
      aiMode: ai && !FREE_MODE ? "gemini" : "local",
    });
  });

  app.get("/api/agent-status", (_req, res) => {
    res.json({
      geminiReady: Boolean(process.env.GEMINI_API_KEY),
      freeMode: FREE_MODE,
      aiMode: ai && !FREE_MODE ? "gemini" : "local",
      model: ai && !FREE_MODE ? geminiModel : OLLAMA_MODEL,
    });
  });

  app.get("/api/agent-config", (_req, res) => {
    res.json(getAgentConfig());
  });

  app.put("/api/agent-config", express.text({ type: "*/*" }), (req, res) => {
    try {
      const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body, null, 2);
      const nextConfig = JSON.parse(rawBody) as AgentConfig;
      const resolvedPath = path.resolve(process.cwd(), agentConfigPath);
      fs.writeFileSync(resolvedPath, rawBody, "utf8");
      res.json(nextConfig);
    } catch (error) {
      console.error("Failed to save agent config:", error);
      res.status(400).json({ error: "Invalid agent config payload" });
    }
  });

  app.post("/api/agent/respond", async (req, res) => {
    const { history = [] } = req.body || {};
    try {
      const callSid = `web-${Date.now()}`;
      callHistories.set(callSid, Array.isArray(history) ? history : []);
      const reply = await getPhoneAgentResponse(
        callSid,
        Array.isArray(history) ? history[history.length - 1]?.text || "" : ""
      );
      res.json({ text: reply });
    } catch (error) {
      console.error("Agent response proxy failed:", error);
      res.status(500).json({ text: getAgentConfig().companyPitch });
    }
  });

  app.post("/api/agent/sentiment", async (req, res) => {
    const { text = "" } = req.body || {};
    res.json(await getLocalSentiment(String(text)));
  });

  app.post("/twilio/voice", (req, res) => {
    const callSid = req.body.CallSid || `call-${Date.now()}`;
    callHistories.set(callSid, []);
    const config = getAgentConfig();
    res
      .type("text/xml")
      .send(twiml(gather(config.openingLine) + `<Redirect method="POST">/twilio/voice</Redirect>`));
  });

  app.post("/twilio/respond", async (req, res) => {
    const callSid = req.body.CallSid || `call-${Date.now()}`;
    const customerText = req.body.SpeechResult || req.body.Digits || "";

    if (!customerText.trim()) {
      res.type("text/xml").send(twiml(gather("Sorry, I did not catch that. Could you repeat it?")));
      return;
    }

    try {
      const rawReply = await getPhoneAgentResponse(callSid, customerText);
      const shouldEnd = rawReply.includes("[END_CALL]");
      const reply = rawReply.replace("[END_CALL]", "").trim();

      if (shouldEnd) {
        callHistories.delete(callSid);
        res.type("text/xml").send(twiml(`${say(reply || "Thanks for your time. Have a great day.")}<Hangup />`));
        return;
      }

      res.type("text/xml").send(twiml(`${say(reply)}${gather("What would you like to know next?")}`));
    } catch (error) {
      console.error("Twilio response failed:", error);
      res.type("text/xml").send(twiml(gather("I had a small connection issue there. Could you say that once more?")));
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
