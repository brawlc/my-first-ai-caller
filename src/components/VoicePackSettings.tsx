import React, { useEffect, useMemo, useState } from 'react';
import { Languages, Mic2, Save } from 'lucide-react';

type VoicePack = {
  id: string;
  label: string;
  language: string;
  voice: string;
  promptLanguage: string;
  description: string;
};

const VOICE_PACKS: VoicePack[] = [
  {
    id: 'en-in-pooja',
    label: 'Indian English - Pooja',
    language: 'en-IN',
    voice: 'Polly.Aditi',
    promptLanguage: 'English with a natural Indian tone',
    description: 'Default Indian English voice for DPVision calls.',
  },
  {
    id: 'hi-in',
    label: 'Hindi',
    language: 'hi-IN',
    voice: 'Polly.Aditi',
    promptLanguage: 'Hindi or Hinglish, matching the caller naturally',
    description: 'Good for Hindi-speaking leads; can blend Hindi and English.',
  },
  {
    id: 'ta-in',
    label: 'Tamil',
    language: 'ta-IN',
    voice: 'Polly.Aditi',
    promptLanguage: 'Tamil when possible, with simple English terms for business words',
    description: 'Tamil speech recognition with an Indian voice.',
  },
  {
    id: 'te-in',
    label: 'Telugu',
    language: 'te-IN',
    voice: 'Polly.Aditi',
    promptLanguage: 'Telugu when possible, with simple English terms for business words',
    description: 'Telugu speech recognition with an Indian voice.',
  },
  {
    id: 'kn-in',
    label: 'Kannada',
    language: 'kn-IN',
    voice: 'Polly.Aditi',
    promptLanguage: 'Kannada when possible, with simple English terms for business words',
    description: 'Kannada speech recognition with an Indian voice.',
  },
  {
    id: 'ml-in',
    label: 'Malayalam',
    language: 'ml-IN',
    voice: 'Polly.Aditi',
    promptLanguage: 'Malayalam when possible, with simple English terms for business words',
    description: 'Malayalam speech recognition with an Indian voice.',
  },
  {
    id: 'bn-in',
    label: 'Bengali',
    language: 'bn-IN',
    voice: 'Polly.Aditi',
    promptLanguage: 'Bengali when possible, with simple English terms for business words',
    description: 'Bengali speech recognition with an Indian voice.',
  },
  {
    id: 'mr-in',
    label: 'Marathi',
    language: 'mr-IN',
    voice: 'Polly.Aditi',
    promptLanguage: 'Marathi when possible, with simple English terms for business words',
    description: 'Marathi speech recognition with an Indian voice.',
  },
  {
    id: 'gu-in',
    label: 'Gujarati',
    language: 'gu-IN',
    voice: 'Polly.Aditi',
    promptLanguage: 'Gujarati when possible, with simple English terms for business words',
    description: 'Gujarati speech recognition with an Indian voice.',
  },
  {
    id: 'pa-in',
    label: 'Punjabi',
    language: 'pa-IN',
    voice: 'Polly.Aditi',
    promptLanguage: 'Punjabi when possible, with simple English terms for business words',
    description: 'Punjabi speech recognition with an Indian voice.',
  },
  {
    id: 'en-us',
    label: 'US English',
    language: 'en-US',
    voice: 'alice',
    promptLanguage: 'clear US English',
    description: 'A more neutral English phone voice.',
  },
  {
    id: 'es-es',
    label: 'Spanish',
    language: 'es-ES',
    voice: 'alice',
    promptLanguage: 'Spanish',
    description: 'Spanish speech recognition and simple Spanish replies.',
  },
  {
    id: 'ar-sa',
    label: 'Arabic',
    language: 'ar-SA',
    voice: 'alice',
    promptLanguage: 'Arabic',
    description: 'Arabic speech recognition and simple Arabic replies.',
  },
];

export const VoicePackSettings = () => {
  const [selectedPackId, setSelectedPackId] = useState(VOICE_PACKS[0].id);
  const [status, setStatus] = useState<{ tone: 'neutral' | 'success' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selectedPack = useMemo(
    () => VOICE_PACKS.find((pack) => pack.id === selectedPackId) || VOICE_PACKS[0],
    [selectedPackId]
  );

  useEffect(() => {
    let mounted = true;
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/voice-settings');
        const payload = await response.json();
        if (!response.ok || !payload.ok) return;
        const matchingPack = VOICE_PACKS.find(
          (pack) => pack.language === payload.language && pack.voice === payload.voice && pack.label === payload.label
        );
        if (mounted && matchingPack) setSelectedPackId(matchingPack.id);
      } catch (_error) {
        // Keep default pack.
      }
    };
    void loadSettings();
    return () => {
      mounted = false;
    };
  }, []);

  const saveVoicePack = async () => {
    try {
      setIsSaving(true);
      setStatus({ tone: 'neutral', text: 'Saving voice pack...' });
      const response = await fetch('/api/voice-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedPack),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not save voice pack.');
      setStatus({ tone: 'success', text: `${selectedPack.label} is active for new calls.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save voice pack.';
      setStatus({ tone: 'error', text: message });
    } finally {
      setIsSaving(false);
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
            <p className="text-xs text-zinc-500 uppercase font-mono">Language + Twilio voice for new calls</p>
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

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {VOICE_PACKS.map((pack) => {
          const selected = selectedPackId === pack.id;
          return (
            <button
              key={pack.id}
              onClick={() => setSelectedPackId(pack.id)}
              className={`text-left rounded-2xl border p-4 transition-colors ${
                selected
                  ? 'border-cyan-500/50 bg-cyan-500/10'
                  : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold uppercase text-zinc-100">{pack.label}</p>
                  <p className="mt-1 text-[11px] font-mono text-zinc-500">
                    {pack.language} | {pack.voice}
                  </p>
                </div>
                <Mic2 size={16} className={selected ? 'text-cyan-300' : 'text-zinc-600'} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-zinc-400">{pack.description}</p>
            </button>
          );
        })}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-300">Selected Pack</p>
          <p className="mt-1 text-sm text-cyan-200">{selectedPack.label}</p>
          <p className="mt-1 text-[11px] text-zinc-500">{selectedPack.description}</p>
        </div>
        <button
          onClick={() => void saveVoicePack()}
          disabled={isSaving}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-xs font-bold uppercase text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          <Save size={15} />
          {isSaving ? 'Saving' : 'Use Voice Pack'}
        </button>
      </section>
    </div>
  );
};
