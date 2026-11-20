import React, { useEffect, useState } from 'react';
import { Building2, ChevronDown, Plus, LayoutGrid, Compass, Check, Sun, Moon, Shield, X, Users, UserPlus, Trash2 } from 'lucide-react';
import { api, setActiveAccountId, type AccountRow, type AccountMember, type Session } from '../lib/api';
import { AskAssistant } from './AskAssistant';

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('gc.theme', theme); } catch { /* private mode */ }
}

export type Mode = 'operate' | 'explore' | 'admin';

const UTILITY_TYPES = [
  { v: 'electric', l: 'Electric Utility' }, { v: 'gas', l: 'Gas Utility' },
  { v: 'electric_gas', l: 'Electric & Gas' }, { v: 'generation_only', l: 'Generation Only' },
  { v: 'nuclear', l: 'Nuclear Operator' },
];
const TERRITORY = ['Small (<500K)', 'Medium (500K–2M)', 'Large (2M–5M)', 'Very Large (5M+)'];
const GEOGRAPHY = ['United States', 'Canada', 'Europe', 'Australia / Pacific', 'Other'];
const PRIORITIES = ['Grid Reliability', 'Cost Reduction', 'Customer Satisfaction', 'Regulatory Compliance',
  'Revenue Growth', 'Sustainability', 'Worker & Public Safety', 'Workforce & Backoffice Efficiency'];

/** Top bar: brand, Operate / Explore / Admin, the business-unit switcher (membership-
 *  gated), theme toggle and the assistant. A new business unit captures its profile once. */
export function AccountBar({ mode, onSetMode, onSession }: {
  mode: Mode;
  onSetMode: (m: Mode) => void;
  onSession?: (s: Session) => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark');
  const toggleTheme = () => { const n = theme === 'dark' ? 'light' : 'dark'; setTheme(n); applyTheme(n); };

  const load = async () => {
    try {
      const s = await api.session();
      setSession(s);
      if (s.active_account_id != null) setActiveAccountId(s.active_account_id);
      onSession?.(s);
    } catch (e) { setErr(String(e)); }
  };
  useEffect(() => { void load(); }, []);

  const active = session?.accounts.find((a) => a.id === session.active_account_id) || session?.accounts[0];
  const inAdmin = mode === 'admin';

  const doSwitch = async (id: number) => {
    setOpen(false);
    try { await api.switchAccount(id); setActiveAccountId(id); window.location.reload(); }
    catch (e) { setErr(String(e)); }
  };

  return (
    <div className="w-full border-b border-navy-600 bg-navy-900">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-4 flex-wrap">
        <div className="flex items-baseline gap-2 pr-1" title="AI Value Realization">
          <span className="text-heading font-bold tracking-tight">AIVR</span>
          <span className="hidden lg:inline text-xs text-navy-400">AI Value Realization</span>
        </div>
        <div className="flex items-center rounded-lg bg-navy-800 p-0.5 text-sm">
          <button onClick={() => onSetMode('operate')}
            title="Operate — build and track the roadmap for this business unit"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium ${mode === 'operate' ? 'bg-navy-700 shadow-sm text-heading' : 'text-navy-400 hover:text-heading'}`}>
            <LayoutGrid className="w-4 h-4" /> Operate
          </button>
          <button onClick={() => onSetMode('explore')}
            title="Explore — the use-case catalog and what each use case depends on"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium ${mode === 'explore' ? 'bg-navy-700 shadow-sm text-heading' : 'text-navy-400 hover:text-heading'}`}>
            <Compass className="w-4 h-4" /> Explore
          </button>
          {session?.is_admin && (
            <button onClick={() => onSetMode('admin')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium ${mode === 'admin' ? 'bg-navy-700 shadow-sm text-heading' : 'text-navy-400 hover:text-heading'}`}
              title="Admin — manage the catalog, business units and administrators">
              <Shield className="w-4 h-4" /> Admin
            </button>
          )}
        </div>

        {/* Business-unit switcher — hidden in Admin mode (cross-unit, not per-unit). */}
        {!inAdmin ? (
          <div className="relative">
            <button onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg border border-navy-600 px-3 py-1.5 text-sm hover:bg-navy-800">
              <Building2 className="w-4 h-4 text-navy-400" />
              <span className="font-medium text-navy-300">{active?.name || 'No business unit'}</span>
              <ChevronDown className="w-4 h-4 text-navy-500" />
            </button>
            {open && (
              <div className="absolute z-30 mt-1 w-72 rounded-lg border border-navy-600 bg-navy-800 shadow-lg py-1">
                {session?.accounts.length ? session.accounts.map((a) => (
                  <button key={a.id} onClick={() => doSwitch(a.id)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-navy-700">
                    <span className="text-navy-300">{a.name}{a.utility_type && <span className="text-navy-500"> · {a.utility_type}</span>}</span>
                    {a.id === active?.id && <Check className="w-4 h-4 text-emerald-500" />}
                  </button>
                )) : <div className="px-3 py-2 text-sm text-navy-500">No business units yet</div>}
                {active && (
                  <button onClick={() => { setOpen(false); setShowShare(true); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-navy-300 hover:bg-navy-700 border-t border-navy-600 mt-1">
                    <Users className="w-4 h-4 text-navy-400" /> Manage access to {active.name}
                  </button>
                )}
                <button onClick={() => { setOpen(false); setShowNew(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-info-500 hover:bg-navy-700 border-t border-navy-600 mt-1">
                  <Plus className="w-4 h-4" /> New business unit
                </button>
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs px-2 py-1 rounded-full border border-info-600/40 bg-info-600/10 text-info-500">All business units</span>
        )}

        <div className="flex-1" />

        <button onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="flex items-center justify-center rounded-lg border border-navy-600 w-8 h-8 text-navy-400 hover:text-heading hover:bg-navy-800">
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <AskAssistant />

        {session?.email && <span className="text-xs text-navy-500">{session.email}</span>}
      </div>

      {err && (
        <div className="max-w-7xl mx-auto px-4 pb-2">
          <div className="text-xs text-rose-500">{err}</div>
        </div>
      )}

      {showNew && <NewAccountModal onClose={() => setShowNew(false)} />}
      {showShare && active && (
        <ShareAccountModal accountId={active.id} accountName={active.name}
          onClose={() => setShowShare(false)} />
      )}
    </div>
  );
}

/** Manage who can see & manage an account: owners share it with others (viewer = view
 *  only, editor/owner = manage). Everyone on the account sees the member list; only an
 *  owner (or a global admin) sees the add/remove controls. */
function ShareAccountModal({ accountId, accountName, onClose }: {
  accountId: number; accountName: string; onClose: () => void;
}) {
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [me, setMe] = useState('');
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor' | 'owner'>('viewer');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setErr(null);
    try {
      const r = await api.accountMembers(accountId);
      setMembers(r.members || []); setCanManage(r.can_manage); setMe(r.me || '');
    } catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [accountId]);

  const add = async () => {
    if (!email.trim()) return;
    setBusy(true); setErr(null);
    try { await api.addAccountMember(accountId, email.trim(), role); setEmail(''); await load(); }
    catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };
  const remove = async (m: AccountMember) => {
    if (!window.confirm(`Remove ${m.user_email}'s access to ${accountName}?`)) return;
    setErr(null);
    try { await api.removeAccountMember(accountId, m.user_email); await load(); }
    catch (e: any) { setErr(e?.message || String(e)); }
  };

  const ROLE_LABEL: Record<string, string> = { owner: 'Owner', editor: 'Editor · can manage', viewer: 'Viewer · view only' };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-6" onClick={onClose}>
      <div className="bg-navy-900 border border-navy-600 rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-navy-600">
          <h3 className="text-heading font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-navy-400" /> Access to {accountName}</h3>
          <button onClick={onClose} className="text-navy-400 hover:text-heading"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {err && <div className="text-rose-500 text-xs">{err}</div>}
          {loading ? <div className="text-navy-400 text-sm">Loading…</div> : (
            <>
              {canManage && (
                <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40">
                  <div className="text-[11px] uppercase tracking-wide text-navy-500 mb-2 flex items-center gap-1"><UserPlus className="w-3.5 h-3.5" /> Share with someone</div>
                  <div className="flex items-end gap-2 flex-wrap">
                    <label className="text-[11px] text-navy-500 flex-1 min-w-[12rem]">Email
                      <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
                        placeholder="person@company.com" type="email"
                        className="mt-1 w-full rounded-lg border border-navy-600 bg-navy-800 px-3 py-1.5 text-sm text-heading" /></label>
                    <label className="text-[11px] text-navy-500">Access
                      <select value={role} onChange={(e) => setRole(e.target.value as any)}
                        className="mt-1 block rounded-lg border border-navy-600 bg-navy-800 px-2 py-1.5 text-sm text-heading">
                        <option value="viewer">Viewer · view only</option>
                        <option value="editor">Editor · can manage</option>
                        <option value="owner">Owner · full control</option>
                      </select></label>
                    <button onClick={add} disabled={busy || !email.trim()}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                      {busy ? 'Adding…' : 'Share'}</button>
                  </div>
                </div>
              )}
              <div>
                <div className="text-[11px] uppercase tracking-wide text-navy-500 mb-1">People with access ({members.length})</div>
                <div className="divide-y divide-navy-600/40 border border-navy-600 rounded-lg">
                  {members.map((m) => (
                    <div key={m.user_email} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm text-heading truncate">{m.user_email}{m.user_email.toLowerCase() === me.toLowerCase() && <span className="text-navy-500"> (you)</span>}</div>
                        <div className="text-[11px] text-navy-500">{ROLE_LABEL[m.role] || m.role}</div>
                      </div>
                      {canManage && (
                        <button onClick={() => remove(m)} title="Remove access"
                          className="shrink-0 text-navy-500 hover:text-rose-400 p-1 rounded hover:bg-rose-500/10"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  ))}
                </div>
                {!canManage && <div className="text-[11px] text-navy-500 mt-2">Only an owner of this account can add or remove people. Ask an owner (or an admin) to change access.</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** New business unit = capture its profile once. */
function NewAccountModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [utilityType, setUtilityType] = useState('electric_gas');
  const [territory, setTerritory] = useState('');
  const [geography, setGeography] = useState('United States');
  const [priorities, setPriorities] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (p: string) => setPriorities((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);
  const submit = async () => {
    if (!name.trim()) { setErr('A name is required.'); return; }
    setBusy(true); setErr(null);
    try {
      const a = await api.createAccountFull({
        name: name.trim(), utility_type: utilityType, territory_size: territory || undefined,
        geography, strategic_priorities: priorities,
      });
      setActiveAccountId(a.id); window.location.reload();
    } catch (e: any) { setErr(e?.message || String(e)); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-navy-900 border border-navy-600 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-navy-600">
          <h2 className="text-lg font-bold text-heading">New business unit</h2>
          <button onClick={onClose} className="text-navy-400 hover:text-heading"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-navy-400">Each business unit has its own portfolio, roadmap and data readiness. Import its roadmap from <b>Operate</b> once it exists.</p>
          <Field label="Business unit / company name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Example Power & Light"
              className="w-full rounded-lg border border-navy-600 bg-navy-800 px-3 py-2 text-sm text-heading" />
          </Field>
          <Field label="Utility type">
            <div className="flex flex-wrap gap-2">
              {UTILITY_TYPES.map((u) => (
                <button key={u.v} onClick={() => setUtilityType(u.v)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border ${utilityType === u.v ? 'border-electric text-electric bg-electric/10' : 'border-navy-600 text-navy-400 hover:text-heading'}`}>{u.l}</button>
              ))}
            </div>
          </Field>
          <Field label="Service territory size">
            <div className="flex flex-wrap gap-2">
              {TERRITORY.map((t) => (
                <button key={t} onClick={() => setTerritory(t)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border ${territory === t ? 'border-electric text-electric bg-electric/10' : 'border-navy-600 text-navy-400 hover:text-heading'}`}>{t}</button>
              ))}
            </div>
          </Field>
          <Field label="Primary geography">
            <div className="flex flex-wrap gap-2">
              {GEOGRAPHY.map((g) => (
                <button key={g} onClick={() => setGeography(g)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border ${geography === g ? 'border-electric text-electric bg-electric/10' : 'border-navy-600 text-navy-400 hover:text-heading'}`}>{g}</button>
              ))}
            </div>
          </Field>
          <Field label="Strategic priorities (select all that apply)">
            <div className="flex flex-wrap gap-2">
              {PRIORITIES.map((p) => (
                <button key={p} onClick={() => toggle(p)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border ${priorities.includes(p) ? 'border-electric text-electric bg-electric/10' : 'border-navy-600 text-navy-400 hover:text-heading'}`}>{p}</button>
              ))}
            </div>
          </Field>
          {err && <div className="text-xs text-rose-500">{err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-navy-600">
          <button onClick={onClose} className="text-sm text-navy-400 hover:text-heading px-3 py-1.5">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-heading hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'Creating…' : 'Create business unit'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-navy-300 mb-1.5">{label}</label>{children}</div>;
}
