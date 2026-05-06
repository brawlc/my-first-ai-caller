function localSentiment(text: string) {
  const negative = /\b(no|not|bad|angry|frustrated|busy|later|stop)\b/i.test(text);
  const positive = /\b(yes|sure|great|good|book|interested|thanks)\b/i.test(text);
  return {
    score: negative ? 0.25 : positive ? 0.82 : 0.55,
    label: negative ? "negative" : positive ? "positive" : "neutral",
  };
}

type AgentRequestOptions = {
  sessionId?: string;
  calendarToken?: string;
  timeZone?: string;
};

async function agentReply(history: { role: string; text: string }[]) {
  const response = await fetch("/api/agent/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history }),
  });

  if (!response.ok) {
    throw new Error(`Agent proxy failed: ${response.status}`);
  }

  const data = (await response.json()) as { text?: string };
  return data.text?.trim() || "";
}

async function agentReplyWithOptions(history: { role: string; text: string }[], options?: AgentRequestOptions) {
  const response = await fetch("/api/agent/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      history,
      sessionId: options?.sessionId,
      calendarToken: options?.calendarToken,
      timeZone: options?.timeZone,
    }),
  });

  if (!response.ok) {
    throw new Error(`Agent proxy failed: ${response.status}`);
  }

  const data = (await response.json()) as { text?: string };
  return data.text?.trim() || "";
}

export async function analyzeSentiment(text: string) {
  try {
    const response = await fetch("/api/agent/sentiment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.warn("Sentiment proxy unavailable, using fallback:", error);
  }

  return localSentiment(text);
}

export async function getAgentResponse(history: { role: string; text: string }[], options?: AgentRequestOptions) {
  try {
    if (options?.sessionId || options?.calendarToken || options?.timeZone) {
      return { text: await agentReplyWithOptions(history, options) };
    }
    return { text: await agentReply(history) };
  } catch (error) {
    console.warn("Agent proxy unavailable, using fallback reply:", error);
    return { text: "I'm sorry, I had a brief connection issue. Could you say that again?" };
  }
}
