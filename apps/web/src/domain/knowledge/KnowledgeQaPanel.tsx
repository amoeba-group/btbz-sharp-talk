import { useRef, useState } from 'react';
import { Pencil, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Select } from '@/components/Field';
import { useAiAgents } from '../ai-settings/ai-agents.hooks';
import { useAskKnowledge } from './knowledge.hooks';
import type { KnowledgeAnswer } from './knowledge.service';
import { GateDecisionCard } from './GateDecisionCard';
// Runtime table from the registry source (see apps/web/src/i18n/i18n.ts for why).
import { LANGUAGES } from '../../../../../packages/types/src/common/language';
import { GATE_AS_OPTIONS } from '../../../../../packages/types/src/common/gate-decision';
import type { GateAs } from '../../../../../packages/types/src/common/gate-decision';


/**
 * Knowledge QA (PLN-Knowledge-QA-Console F1). Answers the admin's question from
 * this tenant's KB and lists the documents the answer came from, each with a
 * shortcut into the editor — so a wrong or outdated source can be fixed and the
 * same question re-asked to confirm the fix.
 */
export function KnowledgeQaPanel({ onEditSource }: { onEditSource: (documentId: string) => void }) {
  const { t } = useTranslation('knowledge');
  const ask = useAskKnowledge();
  const [language, setLanguage] = useState<string>('ko');
  // 0 = every document the tenant has (the operator's view). Any other value
  // answers with exactly what that agent may cite, which is how you check a
  // category scope without opening the widget as five different personas.
  const [agentId, setAgentId] = useState<number>(0);
  const agents = (useAiAgents().data ?? []).filter((a) => a.active);
  // "Test as…" (PLN-261012 SG-51): '' = the operator's own view; otherwise what this kind of viewer
  // would be told, gate decision included — the same decision the chat itself makes.
  const [viewer, setViewer] = useState<GateAs | ''>('');
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [result, setResult] = useState<KnowledgeAnswer | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = (q: string) => {
    const text = q.trim();
    if (!text || ask.isPending) return;
    setAsked(text);
    ask.mutate(
      { question: text, language, aiAgentId: agentId || null, asAudience: viewer || null },
      { onSuccess: setResult },
    );
  };

  return (
    <Card
      title={t('qa.title')}
      action={
        <div className="flex gap-2">
          {agents.length > 1 ? (
            <Select value={String(agentId)} onChange={(e) => setAgentId(Number(e.target.value))}>
              {/* A simulated viewer talks to the default agent when none is picked — never to "everything". */}
              <option value="0">{viewer ? t('qa.agentDefault') : t('qa.agentAll')}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          ) : null}
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            {t('qa.testAs')}
            <Select
              value={viewer}
              onChange={(e) => {
                setViewer(e.target.value as GateAs | '');
                // A result from another viewer would read as this one's.
                setResult(null);
              }}
            >
              <option value="">{t('qa.asOperator')}</option>
              {GATE_AS_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {t(`qa.as_${v}`)}
                </option>
              ))}
            </Select>
          </label>
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeLabel}
              </option>
            ))}
          </Select>
        </div>
      }
    >
      <p className="mb-2 text-xs text-gray-400">{t('qa.hint')}</p>

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) run(question);
          }}
          placeholder={t('qa.placeholder')}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500"
        />
        <Button size="sm" onClick={() => run(question)} disabled={ask.isPending || !question.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {ask.isPending && <p className="mt-3 text-sm text-gray-400">{t('qa.thinking')}</p>}

      {!ask.isPending && result && (
        <div className="mt-3 space-y-3">
          {result.gate && <GateDecisionCard gate={result.gate} />}
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <p className="mb-1 text-[11px] font-medium text-gray-500">{asked}</p>
            {result.blocked ? (
              <p className="text-sm text-error">{t('qa.blocked')}</p>
            ) : (
              <p className="whitespace-pre-wrap text-sm text-gray-800">{result.answer}</p>
            )}
            <div className="mt-2 flex items-center gap-1.5">
              <Badge tone={result.confidence >= 0.45 ? 'success' : 'warning'}>
                {t('qa.confidence')} {result.confidence.toFixed(2)}
              </Badge>
              {result.blocked && <Badge tone="error">{t('qa.moderationBlocked')}</Badge>}
            </div>
          </div>

          <div>
            {result.sources.some((s) => s.conflicted) && (
              <p className="mb-2 rounded border border-error/30 bg-error/5 p-2 text-xs text-error">
                {t('qa.conflictWarning')}
              </p>
            )}
            <p className="mb-1.5 text-xs font-medium text-gray-600">{t('qa.sources')}</p>
            {result.sources.length === 0 && (
              <p className="text-xs text-gray-400">{t('qa.noSources')}</p>
            )}
            <ul className="space-y-1.5">
              {result.sources.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start gap-2 rounded-lg border border-gray-100 p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-800">{s.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-500">{s.snippet}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {s.category && <Badge tone="info">{s.category}</Badge>}
                      {s.source && (
                        <Badge tone="gray">{t(`source.${s.source}`, { defaultValue: s.source })}</Badge>
                      )}
                      {/* A flat ranked list gave no way to tell which of two
                          disagreeing sources to trust. */}
                      {s.conflicted && <Badge tone="error">{t('qa.conflicted')}</Badge>}
                      {s.stale && <Badge tone="warning">{t('staleBadge')}</Badge>}
                      {/* UI version vs the reference (SG-20): a customer reading an
                          answer that cites a mismatched document gets a caveat, so
                          the operator sees which source causes it. */}
                      {s.versionState === 'mismatch' && (
                        <Badge tone="warning">{t('uiVersionOther', { version: s.uiVersion })}</Badge>
                      )}
                      {s.versionState === 'unversioned' && (
                        <Badge tone="warning">{t('uiVersionUnversioned')}</Badge>
                      )}
                      {s.similarity !== null && (
                        <span className="text-[11px] tabular-nums text-gray-400">
                          {t('qa.similarity')} {s.similarity.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => onEditSource(String(s.id))}>
                    <Pencil className="h-3.5 w-3.5" /> {t('qa.fix')}
                  </Button>
                </li>
              ))}
            </ul>
            {result.sources.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                disabled={ask.isPending}
                onClick={() => run(asked)}
              >
                {t('qa.reask')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
