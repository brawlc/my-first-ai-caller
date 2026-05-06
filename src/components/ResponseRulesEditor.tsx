import React, { useEffect, useState } from 'react';
import { RefreshCw, Save, FileJson } from 'lucide-react';

const defaultPrompt = `Hey, this is Pooja from DP vision Analytics. Is this an okay time for a quick call?

You are Pooja. Talk like a real, relaxed sales caller. Reply to what the caller said, give one useful benefit, and move toward a short demo or callback. Do not interrogate the caller. If they only say yes, okay, sure, or go ahead, do not repeat the opener; explain DP vision Analytics in one sentence and ask if a 10-minute demo would be useful. Always spell the company name as DP vision Analytics. If they want to end the call, close politely and include [END_CALL].`;

export const ResponseRulesEditor = () => {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle');

  const loadPrompt = async () => {
    setStatus('loading');
    try {
      const response = await fetch('/api/agent-prompt');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setPrompt(await response.text());
      setStatus('idle');
    } catch (error) {
      console.error('Failed to load prompt', error);
      setStatus('error');
    }
  };

  useEffect(() => {
    loadPrompt();
  }, []);

  const savePrompt = async () => {
    setStatus('loading');
    try {
      const response = await fetch('/api/agent-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: prompt,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setPrompt(await response.text());
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 1500);
    } catch (error) {
      console.error('Failed to save prompt', error);
      setStatus('error');
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto flex flex-col gap-6" id="agent-config-editor">
      <header className="flex justify-between items-center bg-zinc-900/50 border border-zinc-800 rounded-2xl px-6 py-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight uppercase">Agent Prompt</h2>
          <p className="text-xs text-zinc-500 uppercase font-mono">Saved exactly as typed</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadPrompt}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-200 text-xs font-bold uppercase hover:bg-zinc-700"
          >
            <RefreshCw size={14} /> Reload
          </button>
          <button
            onClick={savePrompt}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 text-cyan-300 text-xs font-bold uppercase hover:bg-cyan-500/20"
          >
            <Save size={14} /> Save Prompt
          </button>
        </div>
      </header>

      <div className="space-y-4">
        <div className="bento-card space-y-4">
          <div className="flex items-center gap-2 text-zinc-400 text-[10px] font-bold uppercase tracking-widest">
            <FileJson size={14} /> Prompt
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={22}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-100 resize-none font-mono"
          />
        </div>

        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span
            className={`w-2 h-2 rounded-full ${
              status === 'saved'
                ? 'bg-green-400'
                : status === 'error'
                  ? 'bg-red-400'
                  : status === 'loading'
                    ? 'bg-yellow-400'
                    : 'bg-zinc-600'
            }`}
          />
          {status === 'saved' ? 'Saved' : status === 'loading' ? 'Working...' : status === 'error' ? 'Could not save' : 'Ready'}
        </div>
      </div>
    </div>
  );
};
