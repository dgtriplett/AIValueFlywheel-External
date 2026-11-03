import React, { useState } from 'react';
import { api } from '../lib/api';

/**
 * App-wide "Ask" launcher — a small floating assistant available in every mode (used to
 * be buried in the Operate "Agents" tab). Answers about the active account's portfolio,
 * data gaps, readiness, and value using the live chat tools.
 */
export function AskAssistant() {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [turns, setTurns] = useState<Array<{ role: string; text: string }>>([]);
  const [conv, setConv] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const q = msg.trim();
    if (!q) return;
    setTurns((t) => [...t, { role: 'user', text: q }]);
    setMsg(''); setBusy(true);
    try {
      const r = await api.chatSend(q, conv);
      setConv(r.conversation_id);
      setTurns((t) => [...t, { role: 'assistant', text: r.answer }]);
    } catch (e: any) {
      setTurns((t) => [...t, { role: 'assistant', text: `Error: ${e?.message || e}` }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      <button onClick={() => setOpen((o) => !o)} title="Ask the assistant"
        className="text-xs rounded-lg border border-info-600/40 text-info-500 bg-info-600/10 px-2.5 py-1.5 hover:bg-info-600/20">
        ✦ Ask
      </button>
      {open && (
        <div className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[90vw] bg-navy-900 border border-navy-600 rounded-xl shadow-2xl flex flex-col" style={{ maxHeight: '70vh' }}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-navy-600">
            <span className="text-sm font-semibold text-heading">Ask about this account</span>
            <button onClick={() => setOpen(false)} className="text-navy-400 hover:text-heading text-lg leading-none">×</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[120px]">
            {turns.length === 0 && <div className="text-xs text-navy-500">e.g. "Which shovel-ready use cases have the highest value?" or "What data gap blocks the most value?"</div>}
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'text-right' : ''}>
                <div className={`inline-block text-sm rounded-lg px-3 py-1.5 max-w-[85%] text-left ${t.role === 'user' ? 'bg-navy-700 text-heading' : 'bg-navy-800 border border-navy-600 text-navy-300 whitespace-pre-wrap'}`}>{t.text}</div>
              </div>
            ))}
            {busy && <div className="text-xs text-navy-500">Thinking…</div>}
          </div>
          <div className="flex items-end gap-2 p-2 border-t border-navy-600">
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={1}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              className="input-field text-sm flex-1" placeholder="Ask a question…" />
            <button onClick={send} disabled={busy || !msg.trim()} className="btn-primary text-sm">Send</button>
          </div>
        </div>
      )}
    </>
  );
}
