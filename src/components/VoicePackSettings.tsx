import React, { useEffect, useMemo, useState } from 'react';
import { Languages, Mic2, Play, Save } from 'lucide-react';

type BotLanguage = {
  id: string;
  label: string;
  promptLanguage: string;
  description: string;
};

type AccentPack = {
  id: string;
  label: string;
  language: string;
  voice: string;
  promptStyle: string;
  description: string;
};

const BOT_LANGUAGES: BotLanguage[] = [
  {
    id: 'auto',
    label: 'Auto Multilingual',
    promptLanguage: 'the caller language when clear; otherwise use simple English or Hinglish',
    description: 'Best default. Pooja adapts to the caller instead of forcing one language.',
  },
  {
    id: 'english',
    label: 'English',
    promptLanguage: 'clear English with a natural Indian business tone',
    description: 'Use English for the conversation.',
  },
  {
    id: 'hinglish',
    label: 'Hindi + English',
    promptLanguage: 'natural Hinglish, using Hindi and English the way Indian callers normally speak',
    description: 'Use Hinglish for Indian leads.',
  },
  {
    id: 'hindi',
    label: 'Hindi',
    promptLanguage: 'simple Hindi, with common business words in English when natural',
    description: 'Use mostly Hindi.',
  },
  {
    id: 'punjabi',
    label: 'Punjabi + English',
    promptLanguage: 'Punjabi mixed with simple English when natural',
    description: 'Use Punjabi/Hinglish style for Punjabi-speaking callers.',
  },
  {
    id: 'regional',
    label: 'Indian Regional Mix',
    promptLanguage: 'the Indian regional language the caller uses, while keeping business terms simple',
    description: 'Useful when callers may switch between Indian languages.',
  },
];

const ACCENT_PACKS: AccentPack[] = [
  {
    id: 'indian-female',
    label: 'Indian Female',
    language: 'en-IN',
    voice: 'Polly.Aditi',
    promptStyle: 'a warm Indian female phone-caller accent',
    description: 'Default DPVision voice style.',
  },
  {
    id: 'indian-neutral',
    label: 'Indian Neutral',
    language: 'en-IN',
    voice: 'Polly.Raveena',
    promptStyle: 'a polished Indian English accent',
    description: 'A cleaner Indian English accent option.',
  },
  {
    id: 'us-female',
    label: 'US Female',
    language: 'en-US',
    voice: 'Polly.Joanna',
    promptStyle: 'a clear US English accent',
    description: 'Neutral American female voice.',
  },
  {
    id: 'us-male',
    label: 'US Male',
    language: 'en-US',
    voice: 'Polly.Matthew',
    promptStyle: 'a clear US English male accent',
    description: 'Neutral American male voice.',
  },
  {
    id: 'british-female',
    label: 'British Female',
    language: 'en-GB',
    voice: 'Polly.Amy',
    promptStyle: 'a concise British English accent',
    description: 'British female voice.',
  },
  {
    id: 'british-male',
    label: 'British Male',
    language: 'en-GB',
    voice: 'Polly.Brian',
    promptStyle: 'a concise British English male accent',
    description: 'British male voice.',
  },
  {
    id: 'australian-female',
    label: 'Australian Female',
    language: 'en-AU',
    voice: 'Polly.Olivia',
    promptStyle: 'a friendly Australian English accent',
    description: 'Australian female voice.',
  },
  {
    id: 'fallback-alice',
    label: 'Twilio Classic',
    language: 'en-IN',
    voice: 'alice',
    promptStyle: 'a simple classic Twilio phone voice',
    description: 'Fallback voice if a Polly accent is unavailable.',
  },
];

export const VoicePackSettings = () => {
  const [selectedLanguageId, setSelectedLanguageId] = useState(BOT_LANGUAGES[0].id);
  const [selectedAccentId, setSelectedAccentId] = useState(ACCENT_PACKS[0].id);
  const [status, setStatus] = useState<{ tone: 'neutral' | 'success' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const selectedLanguage = useMemo(
    () => BOT_LANGUAGES.find((language) => language.id === selectedLanguageId) || BOT_LANGUAGES[0],
    [selectedLanguageId]
  );
  const selectedAccent = useMemo(
    () => ACCENT_PACKS.find((accent) => accent.id === selectedAccentId) || ACCENT_PACKS[0],
    [selectedAccentId]
  );

  useEffect(() => {
    let mounted = true;
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/voice-settings');
        const payload = await response.json();
        if (!response.ok || !payload.ok) return;
        const matchingAccent = ACCENT_PACKS.find((accent) => accent.language === payload.language && accent.voice === payload.voice);
        if (mounted && matchingAccent) setSelectedAccentId(matchingAccent.id);
        const matchingLanguage = BOT_LANGUAGES.find((language) => payload.promptLanguage?.includes(language.promptLanguage.slice(0, 20)));
        if (mounted && matchingLanguage) setSelectedLanguageId(matchingLanguage.id);
      } catch (_error) {
        // Keep defaults.
      }
    };
    void loadSettings();
    return () => {
      mounted = false;
    };
  }, []);

  const saveVoicePack = async () => {
    const payload = {
      label: `${selectedLanguage.label} + ${selectedAccent.label}`,
      language: selectedAccent.language,
      voice: selectedAccent.voice,
      promptLanguage: `${selectedLanguage.promptLanguage}, spoken with ${selectedAccent.promptStyle}`,
    };

    try {
      setIsSaving(true);
      setStatus({ tone: 'neutral', text: 'Saving voice settings...' });
      const response = await fetch('/api/voice-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not save voice settings.');
      setStatus({ tone: 'success', text: `${payload.label} is active for new calls.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save voice settings.';
      setStatus({ tone: 'error', text: message });
    } finally {
      setIsSaving(false);
    }
  };

  const waitForBrowserVoices = async () => {
    if (!window.speechSynthesis) return [] as SpeechSynthesisVoice[];
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) return voices;

    return await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.speechSynthesis.removeEventListener?.('voiceschanged', finish);
        resolve(window.speechSynthesis.getVoices());
      };
      window.speechSynthesis.addEventListener?.('voiceschanged', finish);
      window.setTimeout(finish, 800);
    });
  };

  const testVoicePack = async () => {
    const sampleText =
      selectedLanguage.id === 'hinglish' || selectedLanguage.id === 'hindi'
        ? 'Namaste, main Pooja bol rahi hoon DP vision Analytics se. Kya aapke paas ek minute hai?'
        : selectedLanguage.id === 'punjabi'
          ? 'Sat sri akal, main Pooja bol rahi haan DP vision Analytics ton. Ki tuhade kol ik minute hai?'
          : 'Hi, this is Pooja from DP vision Analytics. I am testing this voice pack for new calls.';

    try {
      if (!window.speechSynthesis) {
        setStatus({ tone: 'error', text: 'Voice preview is not supported in this browser.' });
        return;
      }
      setIsTesting(true);
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(sampleText);
      utterance.lang = selectedAccent.language;
      utterance.rate = 1.02;
      utterance.pitch = selectedAccent.id.includes('male') ? 0.9 : 1.02;
      const voices = await waitForBrowserVoices();
      const matchingVoice =
        voices.find((voice) => voice.lang === selectedAccent.language && voice.name.toLowerCase().includes(selectedAccent.label.split(' ')[0].toLowerCase())) ||
        voices.find((voice) => voice.lang === selectedAccent.language) ||
        voices.find((voice) => voice.lang.toLowerCase().startsWith(selectedAccent.language.split('-')[0].toLowerCase()));
      if (matchingVoice) utterance.voice = matchingVoice;
      const resumeTimer = window.setInterval(() => {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      }, 250);
      utterance.onend = () => {
        window.clearInterval(resumeTimer);
        setIsTesting(false);
      };
      utterance.onerror = () => {
        window.clearInterval(resumeTimer);
        setIsTesting(false);
        setStatus({ tone: 'error', text: 'Could not play the voice preview.' });
      };
      window.speechSynthesis.speak(utterance);
      window.speechSynthesis.resume();
      setStatus({
        tone: 'neutral',
        text: matchingVoice
          ? `Playing browser preview with ${matchingVoice.name}. Real phone calls use Twilio voice settings.`
          : 'Playing browser preview with the default browser voice. Real phone calls use Twilio voice settings.',
      });
    } catch (error) {
      setIsTesting(false);
      const message = error instanceof Error ? error.message : 'Could not play the voice preview.';
      setStatus({ tone: 'error', text: message });
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="bg-zinc-900/50 border border-zinc-800 rounded-2xl px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl border border-cyan-500/40 bg-cyan-500/10 flex items-center justify-center">
            <Languages size={20} className="text-cyan-300" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight uppercase">Voice Packs</h2>
            <p className="text-xs text-zinc-500 uppercase font-mono">Bot language + voice accent for new calls</p>
          </div>
        </div>
      </header>

      {status && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs ${
            status.tone === 'success'
              ? 'bg-green-600/10 border-green-500/30 text-green-200'
              : status.tone === 'error'
                ? 'bg-red-600/10 border-red-500/30 text-red-200'
                : 'bg-zinc-900 border-zinc-700 text-zinc-200'
          }`}
        >
          {status.text}
        </div>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-300">Bot Language</p>
          <p className="mt-1 text-[11px] text-zinc-500">Controls what language Pooja replies in.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {BOT_LANGUAGES.map((language) => {
            const selected = selectedLanguageId === language.id;
            return (
              <button
                key={language.id}
                onClick={() => setSelectedLanguageId(language.id)}
                className={`text-left rounded-2xl border p-4 transition-colors ${
                  selected
                    ? 'border-cyan-500/50 bg-cyan-500/10'
                    : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700 hover:bg-zinc-900'
                }`}
              >
                <p className="text-sm font-bold uppercase text-zinc-100">{language.label}</p>
                <p className="mt-3 text-xs leading-relaxed text-zinc-400">{language.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-300">Voice Accent</p>
          <p className="mt-1 text-[11px] text-zinc-500">Controls the spoken voice/accent Twilio uses.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {ACCENT_PACKS.map((accent) => {
            const selected = selectedAccentId === accent.id;
            return (
              <button
                key={accent.id}
                onClick={() => setSelectedAccentId(accent.id)}
                className={`text-left rounded-2xl border p-4 transition-colors ${
                  selected
                    ? 'border-cyan-500/50 bg-cyan-500/10'
                    : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700 hover:bg-zinc-900'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold uppercase text-zinc-100">{accent.label}</p>
                    <p className="mt-1 text-[11px] font-mono text-zinc-500">
                      {accent.language} | {accent.voice}
                    </p>
                  </div>
                  <Mic2 size={16} className={selected ? 'text-cyan-300' : 'text-zinc-600'} />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-zinc-400">{accent.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-300">Selected Setup</p>
          <p className="mt-1 text-sm text-cyan-200">
            {selectedLanguage.label} + {selectedAccent.label}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Pooja replies in {selectedLanguage.label}; Twilio speaks with {selectedAccent.label}.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={testVoicePack}
            disabled={isTesting}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-xs font-bold uppercase text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
          >
            <Play size={15} />
            {isTesting ? 'Playing' : 'Test Voice'}
          </button>
          <button
            onClick={() => void saveVoicePack()}
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-xs font-bold uppercase text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            <Save size={15} />
            {isSaving ? 'Saving' : 'Use This Setup'}
          </button>
        </div>
      </section>
    </div>
  );
};
