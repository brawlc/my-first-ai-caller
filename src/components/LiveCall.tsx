import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Mic, MicOff, Phone, PhoneCall, PhoneOff } from 'lucide-react';
import { analyzeSentiment, getAgentResponse } from '../services/geminiService';
import {
  getAccessToken,
  getCachedAccessToken,
  getConnectedCalendarInfo,
  getConfiguredClientId,
  isCalendarConfigured,
  setGoogleAccountHint,
} from '../services/googleWorkspaceService';

type ChatMessage = {
  role: 'agent' | 'user';
  text: string;
  sentiment?: { score: number; label: string };
};

type AgentStatus = {
  geminiReady?: boolean;
  aiMode?: string;
  configuredModel?: string;
  model?: string;
  quotaLimited?: boolean;
  statusMessage?: string;
  lastGeminiError?: string;
};

type CalendarStatus = {
  tone: 'neutral' | 'success' | 'error';
  text: string;
};

type DialerStatus = {
  ready?: boolean;
  mode?: string;
  missing?: string[];
};

type DialerNotice = {
  tone: 'neutral' | 'success' | 'error';
  text: string;
};

type LivePhoneCallEvent = {
  id: string;
  role: 'agent' | 'user';
  text: string;
  timestamp: string;
};

type LivePhoneCall = {
  callSid: string;
  to?: string;
  status?: string;
  events?: LivePhoneCallEvent[];
};

const defaultOpeningLine = "Hi, this is Pooja from DP vision Analytics. How are you doing today?";
const LIVE_CALL_SESSION_KEY = 'dpvision_live_call_session_v1';
const LIVE_AGENT_SESSION_ID_KEY = 'dpvision_live_agent_session_id_v1';
const IDLE_CHECK_DELAY_MS = 18000;
const MAX_IDLE_CHECKS = 2;
const idleCheckLines = [
  'Are we still connected?',
  'Just checking, can you hear me okay?',
];

type PersistedLiveCallSession = {
  isCalling: boolean;
  messages: ChatMessage[];
  inputText: string;
};

function appendUniqueMessage(messages: ChatMessage[], message: ChatMessage) {
  const normalizedText = message.text.trim();
  if (!normalizedText) return messages;
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role === message.role && lastMessage.text.trim() === normalizedText) {
    return messages;
  }
  return [...messages, { ...message, text: normalizedText }];
}

function dedupeAdjacentMessages(messages: ChatMessage[]) {
  return messages.reduce<ChatMessage[]>((uniqueMessages, message) => appendUniqueMessage(uniqueMessages, message), []);
}

function loadPersistedSession(): PersistedLiveCallSession {
  if (typeof window === 'undefined') {
    return { isCalling: false, messages: [], inputText: '' };
  }

  try {
    const raw = window.localStorage.getItem(LIVE_CALL_SESSION_KEY);
    if (!raw) return { isCalling: false, messages: [], inputText: '' };
    const parsed = JSON.parse(raw) as Partial<PersistedLiveCallSession>;

    const isCalling = Boolean(parsed.isCalling);
    const inputText = typeof parsed.inputText === 'string' ? parsed.inputText : '';
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .map((message): ChatMessage => {
            const role: ChatMessage['role'] = message?.role === 'agent' ? 'agent' : 'user';
            const text = typeof message?.text === 'string' ? message.text : '';
            const sentiment =
              message?.sentiment && typeof message.sentiment.score === 'number' && typeof message.sentiment.label === 'string'
                ? { score: message.sentiment.score, label: message.sentiment.label }
                : undefined;
            return { role, text, sentiment };
          })
          .filter((message) => message.text.trim().length > 0)
      : [];

    return { isCalling, messages, inputText };
  } catch (_error) {
    return { isCalling: false, messages: [], inputText: '' };
  }
}

function getOrCreateAgentSessionId(): string {
  if (typeof window === 'undefined') return `session-${Date.now()}`;
  const existing = window.localStorage.getItem(LIVE_AGENT_SESSION_ID_KEY);
  if (existing) return existing;
  const generated = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(LIVE_AGENT_SESSION_ID_KEY, generated);
  return generated;
}

function looksLikeSchedulingIntent(text: string) {
  return /\b(book|schedule|slot|calendar|meeting|demo|tomorrow|today|am|pm)\b/i.test(text);
}

export const LiveCall = () => {
  const persistedSession = useMemo(() => loadPersistedSession(), []);
  const agentSessionId = useMemo(() => getOrCreateAgentSessionId(), []);
  const [isCalling, setIsCalling] = useState(persistedSession.isCalling);
  const [messages, setMessages] = useState<ChatMessage[]>(persistedSession.messages);
  const [inputText, setInputText] = useState(persistedSession.inputText);
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({});
  const [isCalendarConnected, setIsCalendarConnected] = useState(Boolean(getCachedAccessToken()));
  const [isCalendarSetupReady, setIsCalendarSetupReady] = useState(false);
  const [calendarClientId, setCalendarClientId] = useState('');
  const [connectedCalendarSummary, setConnectedCalendarSummary] = useState('');
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null);
  const [dialNumber, setDialNumber] = useState('');
  const [dialerStatus, setDialerStatus] = useState<DialerStatus>({});
  const [dialerNotice, setDialerNotice] = useState<DialerNotice | null>(null);
  const [isDialing, setIsDialing] = useState(false);
  const [livePhoneCallSid, setLivePhoneCallSid] = useState('');
  const [livePhoneCallStatus, setLivePhoneCallStatus] = useState('');
  const [livePhoneCallEvents, setLivePhoneCallEvents] = useState<LivePhoneCallEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const openingLineRef = useRef(defaultOpeningLine);
  const idleTimerRef = useRef<number | null>(null);
  const idleCheckCountRef = useRef(0);

  const currentSentiment = useMemo(() => {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user' && m.sentiment);
    return lastUserMessage?.sentiment ?? { score: 0.5, label: 'neutral' };
  }, [messages]);

  const displayMessages = useMemo<ChatMessage[]>(() => {
    if (!livePhoneCallEvents.length) return dedupeAdjacentMessages(messages);
    return dedupeAdjacentMessages(
      livePhoneCallEvents.map((event) => ({
        role: event.role,
        text: event.text,
      }))
    );
  }, [livePhoneCallEvents, messages]);

  const maskedClientId = useMemo(() => {
    if (!calendarClientId) return 'missing';
    if (calendarClientId.length < 16) return calendarClientId;
    return `${calendarClientId.slice(0, 14)}...${calendarClientId.slice(-12)}`;
  }, [calendarClientId]);

  const pickPreferredVoice = useCallback((voices: SpeechSynthesisVoice[]) => {
    return (
      voices.find(
        (v) =>
          (v.lang === 'en-IN' || v.name.toLowerCase().includes('india')) &&
          (v.name.toLowerCase().includes('female') ||
            v.name.toLowerCase().includes('woman') ||
            v.name.toLowerCase().includes('pooja'))
      ) ||
      voices.find((v) => v.lang === 'en-IN') ||
      voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
      null
    );
  }, []);

  const ensurePreferredVoice = useCallback(async () => {
    if (!window.speechSynthesis) return null;
    if (preferredVoiceRef.current) return preferredVoiceRef.current;

    const immediateVoice = pickPreferredVoice(window.speechSynthesis.getVoices());
    if (immediateVoice) {
      preferredVoiceRef.current = immediateVoice;
      return immediateVoice;
    }

    return await new Promise<SpeechSynthesisVoice | null>((resolve) => {
      let settled = false;
      const finish = (voice: SpeechSynthesisVoice | null) => {
        if (settled) return;
        settled = true;
        if (window.speechSynthesis.removeEventListener) {
          window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        }
        if (timer) {
          window.clearTimeout(timer);
        }
        if (voice) preferredVoiceRef.current = voice;
        resolve(voice);
      };

      const onVoicesChanged = () => {
        const voice = pickPreferredVoice(window.speechSynthesis.getVoices());
        if (voice) finish(voice);
      };

      if (window.speechSynthesis.addEventListener) {
        window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
      }

      const timer = window.setTimeout(() => {
        const voice = pickPreferredVoice(window.speechSynthesis.getVoices());
        finish(voice);
      }, 250);
    });
  }, [pickPreferredVoice]);

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const spokenText = String(text)
      .replace(/\bD\s*P\s*vision\b/gi, 'D P vision')
      .replace(/\bDP\s*vision\b/gi, 'D P vision')
      .replace(/\bDPvision\b/gi, 'D P vision')
      .replace(/\bDvision\b/gi, 'D P vision');
    const utterance = new SpeechSynthesisUtterance(spokenText);
    const voice = preferredVoiceRef.current || pickPreferredVoice(window.speechSynthesis.getVoices());

    if (voice) utterance.voice = voice;
    utterance.rate = 1.08;
    utterance.pitch = 1.02;
    window.speechSynthesis.speak(utterance);
  }, [pickPreferredVoice]);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = false;
    recognitionRef.current.lang = 'en-US';

    recognitionRef.current.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      void processUserMessage(transcript);
      setIsListening(false);
    };
    recognitionRef.current.onerror = () => setIsListening(false);
    recognitionRef.current.onend = () => setIsListening(false);
  }, []);

  useEffect(() => {
    if (!window.speechSynthesis) return;

    const applyVoice = () => {
      const voice = pickPreferredVoice(window.speechSynthesis.getVoices());
      if (voice) {
        preferredVoiceRef.current = voice;
      }
    };

    applyVoice();
    if (window.speechSynthesis.addEventListener) {
      window.speechSynthesis.addEventListener('voiceschanged', applyVoice);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', applyVoice);
    }
    return undefined;
  }, [pickPreferredVoice]);

  useEffect(() => {
    void ensurePreferredVoice();
  }, [ensurePreferredVoice]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [displayMessages, isTyping]);

  useEffect(() => {
    clearIdleTimer();

    if (!isCalling || isTyping || messages.length === 0) return undefined;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'user') {
      idleCheckCountRef.current = 0;
      return undefined;
    }

    if (idleCheckCountRef.current >= MAX_IDLE_CHECKS) return undefined;

    idleTimerRef.current = window.setTimeout(() => {
      const line = idleCheckLines[idleCheckCountRef.current] || idleCheckLines[idleCheckLines.length - 1];
      idleCheckCountRef.current += 1;
      setMessages((prev) => appendUniqueMessage(prev, { role: 'agent', text: line }));
      speak(line);
    }, IDLE_CHECK_DELAY_MS);

    return clearIdleTimer;
  }, [clearIdleTimer, isCalling, isTyping, messages, speak]);

  useEffect(() => {
    return clearIdleTimer;
  }, [clearIdleTimer]);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/agent-status');
      if (!response.ok) return;
      setAgentStatus(await response.json());
    } catch (error) {
      console.warn('Could not load agent status', error);
    }
  }, []);

  const loadDialerStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/dialer/status');
      if (!response.ok) return;
      setDialerStatus(await response.json());
    } catch (error) {
      console.warn('Could not load dialer status', error);
    }
  }, []);

  const loadLivePhoneCall = useCallback(async (callSid: string) => {
    try {
      const response = await fetch(`/api/live-calls/${encodeURIComponent(callSid)}`);
      if (!response.ok) {
        const latestResponse = await fetch('/api/live-calls/latest');
        if (!latestResponse.ok) return;
        const latestData = (await latestResponse.json()) as LivePhoneCall;
        if (!latestData.callSid) return;
        setLivePhoneCallSid(latestData.callSid);
        setLivePhoneCallStatus(latestData.status || '');
        setLivePhoneCallEvents(Array.isArray(latestData.events) ? latestData.events : []);
        if (latestData.status === 'ended') {
          setIsCalling(false);
        }
        return;
      }
      const data = (await response.json()) as LivePhoneCall;
      let events = Array.isArray(data.events) ? data.events : [];
      let status = data.status || '';

      if (!events.length && data.status !== 'ended') {
        const latestResponse = await fetch('/api/live-calls/latest');
        if (latestResponse.ok) {
          const latestData = (await latestResponse.json()) as LivePhoneCall;
          if (latestData.callSid && latestData.callSid !== callSid) {
            setLivePhoneCallSid(latestData.callSid);
            events = Array.isArray(latestData.events) ? latestData.events : [];
            status = latestData.status || status;
          }
        }
      }

      setLivePhoneCallStatus(status);
      setLivePhoneCallEvents(events);
      if (status === 'ended') {
        setIsCalling(false);
      }
    } catch (error) {
      console.warn('Could not load live phone call transcript', error);
    }
  }, []);

  const connectCalendar = useCallback(async () => {
    const configuredClientId = await getConfiguredClientId();
    const configured = await isCalendarConfigured();

    setCalendarClientId(configuredClientId);
    setIsCalendarSetupReady(configured);

    if (!configured) {
      setIsCalendarConnected(false);
      setCalendarStatus({ tone: 'error', text: 'Calendar is not configured. Add VITE_CLIENT_ID and restart app.' });
      return null;
    }

    try {
      setCalendarStatus({ tone: 'neutral', text: 'Connecting Google Calendar...' });
      const token = await getAccessToken({ interactive: true });
      const calendarInfo = await getConnectedCalendarInfo(token);
      setIsCalendarConnected(true);
      setConnectedCalendarSummary(calendarInfo.summary || calendarInfo.id);
      setGoogleAccountHint(calendarInfo.id || calendarInfo.summary);
      setCalendarStatus({ tone: 'success', text: `Google Calendar connected: ${calendarInfo.summary || calendarInfo.id}` });
      return token;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not connect Google Calendar.';
      setIsCalendarConnected(false);
      setConnectedCalendarSummary('');
      setCalendarStatus({
        tone: 'error',
        text: `${message} (Client ID: ${configuredClientId || 'missing'})`,
      });
      throw new Error(message);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadDialerStatus();
  }, [loadDialerStatus, loadStatus]);

  useEffect(() => {
    if (!livePhoneCallSid) return undefined;

    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      await loadLivePhoneCall(livePhoneCallSid);
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 1500);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [livePhoneCallSid, loadLivePhoneCall]);

  useEffect(() => {
    let isMounted = true;

    const loadCalendarConfig = async () => {
      const configuredClientId = await getConfiguredClientId();
      const configured = await isCalendarConfigured();
      const cachedToken = getCachedAccessToken();
      if (!isMounted) return;
      setCalendarClientId(configuredClientId);
      setIsCalendarSetupReady(configured);
      if (!configured) {
        setCalendarStatus({ tone: 'error', text: 'Calendar is not configured. Add VITE_CLIENT_ID and restart app.' });
      } else if (cachedToken) {
        try {
          const calendarInfo = await getConnectedCalendarInfo(cachedToken);
          if (!isMounted) return;
          setIsCalendarConnected(true);
          setConnectedCalendarSummary(calendarInfo.summary || calendarInfo.id);
          setGoogleAccountHint(calendarInfo.id || calendarInfo.summary);
        } catch (_error) {
          if (!isMounted) return;
          setIsCalendarConnected(false);
          setConnectedCalendarSummary('');
        }
      } else {
        try {
          const silentToken = await getAccessToken({ interactive: false });
          const calendarInfo = await getConnectedCalendarInfo(silentToken);
          if (!isMounted) return;
          setIsCalendarConnected(true);
          setConnectedCalendarSummary(calendarInfo.summary || calendarInfo.id);
          setGoogleAccountHint(calendarInfo.id || calendarInfo.summary);
          setCalendarStatus({ tone: 'success', text: `Google Calendar connected: ${calendarInfo.summary || calendarInfo.id}` });
        } catch (_error) {
          if (!isMounted) return;
          setIsCalendarConnected(false);
          setConnectedCalendarSummary('');
        }
      }
    };

    void loadCalendarConfig();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadOpeningLine = async () => {
      try {
        const response = await fetch('/api/agent-prompt');
        if (!response.ok) return;
        const promptText = await response.text();
        const firstLine = promptText
          .replace(/\r\n/g, '\n')
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        if (firstLine && isMounted) {
          openingLineRef.current = firstLine;
        }
      } catch (error) {
        console.warn('Could not preload opening line', error);
      }
    };

    void loadOpeningLine();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload: PersistedLiveCallSession = { isCalling, messages, inputText };
    window.localStorage.setItem(LIVE_CALL_SESSION_KEY, JSON.stringify(payload));
  }, [isCalling, messages, inputText]);

  const startCall = async () => {
    setLivePhoneCallSid('');
    setLivePhoneCallStatus('');
    setLivePhoneCallEvents([]);
    setIsCalling(true);
    setMessages([]);
    setIsTyping(false);
    idleCheckCountRef.current = 0;
    clearIdleTimer();

    const openingLine = openingLineRef.current || defaultOpeningLine;
    setMessages([{ role: 'agent', text: openingLine }]);

    // Do not force interactive OAuth on every call start.
    // Silent refresh is already attempted during initial load.

    void ensurePreferredVoice().then(() => {
      speak(openingLine);
    });
  };

  const endCall = () => {
    clearIdleTimer();
    idleCheckCountRef.current = 0;
    setIsCalling(false);
    setMessages([]);
    setLivePhoneCallSid('');
    setLivePhoneCallStatus('');
    setLivePhoneCallEvents([]);
    setInputText('');
    window.speechSynthesis?.cancel();
  };

  const processUserMessage = async (rawText: string) => {
    const userText = rawText.trim();
    if (!userText || !isCalling) return;

    const userMessage: ChatMessage = { role: 'user', text: userText };
    setMessages((prev) => appendUniqueMessage(prev, userMessage));

    void analyzeSentiment(userText).then((sentiment) => {
      setMessages((prev) =>
        prev.map((message) => {
          if (message.role === 'user' && message.text === userText && !message.sentiment) {
            return { ...message, sentiment };
          }
          return message;
        })
      );
    });

    setIsTyping(true);
    try {
      const history = [...messages, userMessage];
      let calendarToken = getCachedAccessToken() || undefined;
      if (!calendarToken && isCalendarSetupReady && looksLikeSchedulingIntent(userText)) {
        try {
          calendarToken = (await connectCalendar()) || undefined;
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Calendar permission was not granted.';
          setMessages((prev) =>
            appendUniqueMessage(prev, {
              role: 'agent',
              text: `I can book this for you as soon as Calendar permission is approved. Current issue: ${reason}`,
            })
          );
          setIsTyping(false);
          return;
        }
      }

      const result = await getAgentResponse(history, {
        sessionId: agentSessionId,
        calendarToken,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      const shouldEnd = result.text.includes('[END_CALL]');
      const cleanText = result.text.replace('[END_CALL]', '').trim();

      setMessages((prev) => appendUniqueMessage(prev, { role: 'agent', text: cleanText }));
      if (cleanText) speak(cleanText);

      if (shouldEnd) {
        setTimeout(() => endCall(), 2000);
      }
    } catch (error) {
      console.error('Failed to get Gemini response', error);
    } finally {
      setIsTyping(false);
      void loadStatus();
    }
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = inputText;
    setInputText('');
    void processUserMessage(text);
  };

  const startOutboundCall = async (event: React.FormEvent) => {
    event.preventDefault();
    const number = dialNumber.trim();
    if (!number || isDialing) return;

    setIsDialing(true);
    setDialerNotice({ tone: 'neutral', text: 'Starting outbound call...' });

    try {
      const response = await fetch('/api/dialer/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number }),
      });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Could not start the call.');
      }

      setDialerNotice({
        tone: 'success',
        text: `Calling ${data.to}. Call SID: ${data.callSid || 'created'}`,
      });
      if (data.callSid) {
        setLivePhoneCallSid(data.callSid);
        setLivePhoneCallStatus(data.status || 'queued');
        setLivePhoneCallEvents([]);
      }
      setMessages([]);
      setIsCalling(true);
      void loadDialerStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start the call.';
      setDialerNotice({ tone: 'error', text: message });
    } finally {
      setIsDialing(false);
    }
  };

  const toggleListening = () => {
    if (!recognitionRef.current || !isCalling) return;
    if (isListening) {
      recognitionRef.current.stop();
      return;
    }
    setIsListening(true);
    recognitionRef.current.start();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto flex flex-col gap-6 h-[calc(100vh-1rem)]">
      <header className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800 rounded-2xl px-5 py-4">
        <div>
          <h2 className="text-lg font-bold uppercase tracking-tight">Live Gemini Call</h2>
          <p className="text-xs text-zinc-500 font-mono uppercase">
            Mode: {agentStatus.aiMode || 'unknown'} | Model: {agentStatus.quotaLimited ? 'built-in sales flow' : agentStatus.model || 'unknown'}
          </p>
          {livePhoneCallSid && (
            <p className="text-[11px] mt-1 text-cyan-300">
              Phone call: {livePhoneCallStatus || 'connecting'} | {livePhoneCallSid}
            </p>
          )}
          <p className={`text-[11px] mt-1 ${isCalendarConnected ? 'text-green-300' : 'text-zinc-400'}`}>
            Calendar: {isCalendarConnected ? 'Connected' : 'Not connected'}
          </p>
          {connectedCalendarSummary && <p className="text-[11px] text-zinc-500">Calendar account: {connectedCalendarSummary}</p>}
          <p className="text-[11px] text-zinc-500">OAuth Client: {maskedClientId}</p>
          {agentStatus.statusMessage && (
            <p className="text-[11px] text-amber-300 mt-1">{agentStatus.statusMessage}</p>
          )}
          {agentStatus.lastGeminiError && !agentStatus.quotaLimited && (
            <p className="text-[11px] text-red-300 mt-1">Gemini issue: {agentStatus.lastGeminiError}</p>
          )}
          {calendarStatus && (
            <p
              className={`text-[11px] mt-1 ${
                calendarStatus.tone === 'success'
                  ? 'text-green-300'
                  : calendarStatus.tone === 'error'
                    ? 'text-red-300'
                    : 'text-zinc-400'
              }`}
            >
              {calendarStatus.text}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void connectCalendar().catch(() => {})}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase border ${
              isCalendarConnected
                ? 'bg-green-600/15 border-green-500/40 text-green-300'
                : 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200 hover:bg-indigo-600/30'
            }`}
          >
            {isCalendarConnected ? 'Calendar Connected' : 'Connect Calendar'}
          </button>
          {!isCalling ? (
            <button
              onClick={startCall}
              className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold uppercase flex items-center gap-2"
            >
              <Phone size={14} /> Start Call
            </button>
          ) : (
            <button
              onClick={endCall}
              className="px-4 py-2 rounded-xl bg-red-600/20 border border-red-500/40 hover:bg-red-600/30 text-red-300 text-xs font-bold uppercase flex items-center gap-2"
            >
              <PhoneOff size={14} /> End Call
            </button>
          )}
        </div>
      </header>

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-2xl px-5 py-4">
        <form onSubmit={startOutboundCall} className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-wide text-zinc-300">SIP Dialer</p>
              <p
                className={`text-[10px] font-mono uppercase ${
                  dialerStatus.ready ? 'text-green-300' : 'text-amber-300'
                }`}
              >
                {dialerStatus.ready ? `${dialerStatus.mode || 'twilio'} ready` : 'config needed'}
              </p>
            </div>
            <input
              type="tel"
              value={dialNumber}
              onChange={(event) => setDialNumber(event.target.value)}
              placeholder="+91XXXXXXXXXX"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500/60"
            />
          </div>
          <button
            type="submit"
            disabled={!dialNumber.trim() || isDialing}
            className="h-[46px] px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold uppercase flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <PhoneCall size={15} /> {isDialing ? 'Dialing' : 'Call'}
          </button>
        </form>
        {(dialerNotice || (!dialerStatus.ready && dialerStatus.missing?.length)) && (
          <p
            className={`mt-3 text-[11px] ${
              dialerNotice?.tone === 'success'
                ? 'text-green-300'
                : dialerNotice?.tone === 'error'
                  ? 'text-red-300'
                  : dialerNotice
                    ? 'text-zinc-400'
                    : 'text-amber-300'
            }`}
          >
            {dialerNotice?.text || `Missing: ${dialerStatus.missing?.join(', ')}`}
          </p>
        )}
      </section>

      <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden flex flex-col">
        <div ref={scrollRef} className="flex-1 p-5 space-y-4 overflow-y-auto bg-zinc-950/60">
          {!displayMessages.length && (
            <p className="text-xs text-zinc-500 font-mono uppercase">
              {livePhoneCallSid ? 'Waiting for the phone conversation to start...' : 'Start the call to begin conversation.'}
            </p>
          )}

          {displayMessages.map((message, index) => (
            <motion.div
              key={`${message.role}-${index}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${message.role === 'agent' ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[78%] rounded-2xl p-4 border ${
                  message.role === 'agent'
                    ? 'bg-zinc-900 border-zinc-800 text-zinc-100 rounded-tl-none'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-100 rounded-tr-none'
                }`}
              >
                <p className="text-sm leading-relaxed">{message.text}</p>
                {message.sentiment && (
                  <p className="text-[10px] mt-2 text-zinc-500 font-mono uppercase">
                    Sentiment: {message.sentiment.label} ({Math.round(message.sentiment.score * 100)}%)
                  </p>
                )}
              </div>
            </motion.div>
          ))}

          {isTyping && (
            <div className="inline-flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" />
            </div>
          )}
        </div>

        <div className="border-t border-zinc-800 p-4 bg-zinc-900/90">
          <div className="mb-3 text-[10px] font-mono uppercase text-zinc-500">
            Current sentiment: {currentSentiment.label} ({Math.round(currentSentiment.score * 100)}%)
          </div>
          <form onSubmit={onSubmit} className="flex gap-3">
            <input
              type="text"
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder="Say something..."
              disabled={!isCalling}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500/60 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={toggleListening}
              disabled={!isCalling}
              className={`p-3 rounded-xl border ${
                isListening
                  ? 'bg-red-500/20 border-red-400/50 text-red-300'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
              } disabled:opacity-50`}
              title="Voice input"
            >
              {isListening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
