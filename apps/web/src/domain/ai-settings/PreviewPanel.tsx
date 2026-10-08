import { MessageBody } from '../../components/RichText';
import { useEffect, useRef, useState } from 'react';
import { GraduationCap, RotateCcw, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Select } from '@/components/Field';
import { cn } from '@/lib/cn';
import { useAiConfig, useAiConfigDefaults } from './ai-settings.hooks';
import { previewService } from './preview.service';
import type { PreviewReply } from './preview.service';
// Runtime table from the registry source (see apps/web/src/i18n/i18n.ts for why).
import { LANGUAGES } from '../../../../../packages/types/src/common/language';
import { scenarioLabelText } from './ai-settings.service';
import type { ScenarioLang } from './ai-settings.service';
import { resolveFileUrl } from '@/lib/api-client';

type Role = 'user' | 'ai' | 'system' | 'agent';

interface PreviewMessage {
  id: number;
  role: Role;
  body: string;
  /** Server-side message id, present on AI turns — the coaching anchor. */
  messageId?: string;
  meta?: {
    confidence?: number;
    citations?: { title: string; videoUrl?: string | null }[];
    escalate?: boolean;
  };
}

export interface CoachTarget {
  messageId: number;
  question: string;
  answer: string;
}

interface PreviewPanelProps {
  /** Which AI agent the sandbox answers as (PLN-260820); null = the default agent. */
  agentId?: number | null;
  /** Hand an AI turn to the coaching tab. Omit to hide the coach affordance. */
  onCoach?: (target: CoachTarget) => void;
  /**
   * A question to re-ask, set when coaching applied a change and the admin
   * wants to see its effect. Cleared through `onReplayed` once sent.
   */
  replayQuestion?: string | null;
  onReplayed?: () => void;
}


let nextId = 1;

/**
 * Live chat sandbox for /ai-setting (PLN-AiSetting-Preview W1). Runs the REAL
 * pipeline (persona, rules, KB retrieval, moderation, scenario scripts) on an
 * isolated preview session — no agent alerts, no queue entries, no analytics.
 */
export function PreviewPanel({ agentId, onCoach, replayQuestion, onReplayed }: PreviewPanelProps = {}) {
  const { t } = useTranslation('aiSetting');
  const { data: config } = useAiConfig();
  const { data: defaults } = useAiConfigDefaults();

  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>('ko');
  const [messages, setMessages] = useState<PreviewMessage[]>([]);
  const [followUps, setFollowUps] = useState<{ id: string; label: string }[]>([]);
  const [mode, setMode] = useState<'customer' | 'agent'>('customer');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const push = (m: Omit<PreviewMessage, 'id'>) =>
    setMessages((prev) => [...prev, { ...m, id: nextId++ }]);

  async function resetSession(lang = language) {
    setBusy(true);
    setError(null);
    setMessages([]);
    setFollowUps([]);
    try {
      const res = await previewService.createSession(lang, agentId ?? undefined);
      setSessionToken(res.sessionToken);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Also re-created when the selected agent changes: the whole point of the
  // sandbox is hearing THAT agent's voice, and a stale session keeps the old one.
  useEffect(() => {
    void resetSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Coaching applied a change and asked to see it: re-ask the same question on
  // the live session so the before/after difference is visible in one place.
  useEffect(() => {
    if (!replayQuestion || !sessionToken || busy) return;
    onReplayed?.();
    void sendCustomer(replayQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayQuestion, sessionToken]);

  function replyMeta(reply: PreviewReply, escalate: boolean) {
    return {
      confidence: reply.confidence,
      citations: reply.citations?.map((c) => ({ title: c.title, videoUrl: c.videoUrl ?? null })),
      escalate,
    };
  }

  async function sendCustomer(text: string) {
    if (!sessionToken || !text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setFollowUps([]);
    push({ role: 'user', body: text.trim() });
    try {
      const res = await previewService.send(sessionToken, text.trim());
      if (res.reply) {
        push({
          role: (res.reply.senderType as Role) ?? 'ai',
          body: res.reply.body,
          messageId: res.reply.messageId,
          meta: replyMeta(res.reply, res.escalate),
        });
      } else {
        push({ role: 'system', body: t('preview.agentMode') });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Which actions actually have a script is the SERVER's list — the console
   * already fetches it for the "this button runs <script>" hint. Keeping a
   * second copy here is how the console and the runtime ended up each knowing
   * half of this map once before (see SCRIPT_BY_BUTTON_ACTION's comment).
   */
  const hasScript = (action: string): boolean =>
    !!defaults?.scriptByButtonAction[action] ||
    !!defaults?.scripts.some((s) => s.action === action);

  /**
   * Scenario chips and follow-ups share one click handler, the way the widget's
   * do: a scripted action runs the script, anything else asks the question.
   */
  function runChip(action: string, label: string, message?: string) {
    if (hasScript(action)) return void runScenario(action, label);
    return void sendCustomer((message || label).trim());
  }

  async function runScenario(action: string, label: string) {
    if (!sessionToken || busy) return;
    setBusy(true);
    setError(null);
    setFollowUps([]);
    push({ role: 'user', body: label });
    try {
      const res = await previewService.scenario(sessionToken, action);
      push({ role: (res.reply.senderType as Role) ?? 'ai', body: res.reply.body });
      setFollowUps(res.followUps ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function sendAgent(text: string) {
    if (!text.trim()) return;
    push({ role: 'agent', body: text.trim() });
  }

  function submit() {
    const text = input;
    setInput('');
    if (mode === 'agent') sendAgent(text);
    else void sendCustomer(text);
  }

  const scenarioChips = (config?.scenarioButtons ?? []).filter((b) => b.enabled);

  const bubbleStyle: Record<Role, string> = {
    user: 'ml-auto bg-primary-500 text-white',
    ai: 'mr-auto bg-gray-100 text-gray-800',
    system: 'mx-auto bg-amber-50 text-amber-800 text-xs',
    agent: 'mr-auto bg-emerald-50 text-emerald-900 border border-emerald-200',
  };

  return (
    <Card
      title={t('preview.title')}
      action={
        <div className="flex items-center gap-2">
          <Select
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              void resetSession(e.target.value);
            }}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeLabel}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" onClick={() => resetSession()} disabled={busy}>
            <RotateCcw className="h-4 w-4" /> {t('preview.newSession')}
          </Button>
        </div>
      }
    >
      <p className="mb-2 text-xs text-gray-400">{t('preview.hint')}</p>

      <div
        ref={scrollRef}
        className="h-96 space-y-2 overflow-y-auto rounded-lg border border-gray-100 bg-white p-3"
      >
        {messages.length === 0 && (
          <p className="pt-16 text-center text-sm text-gray-400">{t('preview.empty')}</p>
        )}
        {messages.map((m, idx) => (
          <div key={m.id} className="group flex flex-col">
            <div
              className={cn(
                'max-w-[85%] rounded-xl px-3 py-2 text-sm',
                bubbleStyle[m.role],
              )}
            >
              {m.role === 'agent' && (
                <span className="mb-0.5 block text-[10px] font-semibold text-emerald-600">
                  {t('preview.agentBadge')}
                </span>
              )}
              <MessageBody text={m.body} raw={m.role === 'user'} />
            </div>

            {/* Hand this exact answer to the coaching tab. Only AI turns that
                were persisted carry an id, so scripted/system copy has none. */}
            {onCoach && m.role === 'ai' && m.messageId && (
              <button
                type="button"
                onClick={() =>
                  onCoach({
                    messageId: Number(m.messageId),
                    question: [...messages.slice(0, idx)].reverse().find((p) => p.role === 'user')?.body ?? '',
                    answer: m.body,
                  })
                }
                className="mr-auto mt-1 flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 opacity-0 transition hover:bg-gray-50 hover:text-gray-700 focus:opacity-100 group-hover:opacity-100"
              >
                <GraduationCap className="h-3 w-3" /> {t('preview.coachThis')}
              </button>
            )}
            {m.meta && (m.meta.confidence !== undefined || m.meta.citations?.length || m.meta.escalate) && (
              <div className="mr-auto mt-1 flex max-w-[85%] flex-wrap items-center gap-1">
                {m.meta.confidence !== undefined && (
                  <Badge tone={m.meta.confidence >= 0.45 ? 'success' : 'warning'}>
                    conf {m.meta.confidence.toFixed(2)}
                  </Badge>
                )}
                {m.meta.escalate && <Badge tone="error">{t('preview.escalated')}</Badge>}
                {m.meta.citations?.map((c, i) => (
                  <Badge key={i} tone="info">
                    {c.title.length > 28 ? `${c.title.slice(0, 28)}…` : c.title}
                    {/* The same link a customer gets under the answer (PLN-261006). */}
                    {c.videoUrl && (
                      <a
                        href={resolveFileUrl(c.videoUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 underline"
                      >
                        ▶ {t('preview.watchVideo')}
                      </a>
                    )}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Scenario buttons / follow-up quick replies — exercised via the real API. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {/* The preview speaks the language picked above, so its chips resolve
            the same way the widget's would for that session. */}
        {(followUps.length > 0
          ? followUps.map((f) => ({ ...f, message: '' }))
          : scenarioChips.map((b) => ({
              id: b.action,
              label: scenarioLabelText(b.label, language.toUpperCase() as ScenarioLang),
              message: scenarioLabelText(b.message, language.toUpperCase() as ScenarioLang),
            }))
        ).map(
          (chip) => (
            <button
              key={chip.id}
              type="button"
              disabled={busy || !sessionToken}
              // A button whose action has no script ("send a message") is a
              // chat turn, not a scenario turn. Routing it to /chat/scenario is
              // what made every go2joy button answer "Resource not found" here
              // while the same question typed below worked (PLN-261001 §1-1).
              onClick={() => runChip(chip.id, chip.label, chip.message)}
              className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {chip.label}
            </button>
          ),
        )}
      </div>

      {error && <p className="mt-2 text-xs text-error">{error}</p>}

      <div className="mt-2 flex items-center gap-2">
        <Select value={mode} onChange={(e) => setMode(e.target.value as 'customer' | 'agent')}>
          <option value="customer">{t('preview.modeCustomer')}</option>
          <option value="agent">{t('preview.modeAgent')}</option>
        </Select>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
          placeholder={mode === 'agent' ? t('preview.agentPlaceholder') : t('preview.customerPlaceholder')}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500"
        />
        <Button size="sm" onClick={submit} disabled={busy || !sessionToken || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
