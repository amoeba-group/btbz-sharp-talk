import { useState } from 'react';
import { Copy, Pencil, Plus, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Modal } from '@/components/Modal';
import { FormRow, Input } from '@/components/Field';
import { cn } from '@/lib/cn';
import { toast } from '@/store/toast-store';
import { useShopifySettings } from '../settings/settings.hooks';
import { LanguageTabs } from './LanguageTabs';
import type { ScenarioLang } from './ai-settings.service';
import {
  useAiAgents,
  useCreateAiAgent,
  useDeleteAiAgent,
  useSetDefaultAiAgent,
  useUpdateAiAgent,
} from './ai-agents.hooks';
import type { AiAgentRow } from './ai-agents.service';
import { WIDGET_URL } from '@/lib/widget-url';


/** What the operator pastes on the page that should talk as this agent. */
function snippetFor(code: string, shop: string): string {
  return (
    `<script>\n` +
    `  window.SHARPTALK_WIDGET_CONFIG = {\n` +
    `    shop: ${JSON.stringify(shop)},\n` +
    `    widgetUrl: ${JSON.stringify(WIDGET_URL)},\n` +
    `    agent: ${JSON.stringify(code)}\n` +
    `  };\n` +
    `</script>\n` +
    `<script src="${WIDGET_URL}/embed.js" defer></script>`
  );
}

/**
 * The tenant's AI agents (PLN-260820): pick one to edit its persona below,
 * add per-entry-point agents, choose the routing default. Selection is page
 * state — the persona/rules cards and the preview panel all follow it.
 */
export function AgentsSection({
  selectedId,
  onSelect,
}: {
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const { data: agents, isLoading, error } = useAiAgents();
  const [editing, setEditing] = useState<AiAgentRow | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Card
      title={t('agents.title')}
      action={
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={isLoading}>
          <Plus className="h-4 w-4" /> {t('agents.add')}
        </Button>
      }
    >
      {isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
      {!isLoading && error && (
        <p className="text-sm text-error">{error instanceof Error ? error.message : tc('empty')}</p>
      )}
      {!isLoading && !error && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">{t('agents.hint')}</p>
          <div className="flex flex-wrap gap-2">
            {(agents ?? []).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelect(a.id)}
                className={cn(
                  'group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition',
                  a.id === selectedId
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300',
                )}
              >
                <span
                  className={cn('h-2 w-2 rounded-full', a.active ? 'bg-emerald-500' : 'bg-gray-300')}
                  title={a.active ? t('agents.active') : t('agents.inactive')}
                />
                {a.name}
                {a.isDefault && <Badge tone="info">{t('agents.default')}</Badge>}
                <Pencil
                  className="h-3.5 w-3.5 text-gray-400 opacity-0 transition group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(a);
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <AgentModal open={adding} onClose={() => setAdding(false)} agent={null} onSelect={onSelect} />
      <AgentModal
        open={!!editing}
        onClose={() => setEditing(null)}
        agent={editing}
        onSelect={onSelect}
      />
    </Card>
  );
}

function AgentModal({
  open,
  onClose,
  agent,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  agent: AiAgentRow | null;
  onSelect: (id: number) => void;
}) {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const create = useCreateAiAgent();
  const update = useUpdateAiAgent();
  const remove = useDeleteAiAgent();
  const setDefault = useSetDefaultAiAgent();
  const { data: shopify } = useShopifySettings();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [active, setActive] = useState(true);
  // Widget-facing identity (REQ-260825 R3/R4): blank = tenant-level fallback.
  const [displayName, setDisplayName] = useState('');
  const [greeting, setGreeting] = useState<Record<string, string>>({});
  const [greetLang, setGreetLang] = useState<ScenarioLang>('KO');
  // Seed once per open — key the modal content on the agent id via `open` effect-free reset.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = agent ? String(agent.id) : 'new';
  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setName(agent?.name ?? '');
    setCode(agent?.code ?? '');
    setActive(agent?.active ?? true);
    setDisplayName(agent?.displayName ?? '');
    setGreeting(agent?.greeting ?? {});
  }
  if (!open && seededFor !== null) setSeededFor(null);

  const busy = create.isPending || update.isPending || remove.isPending || setDefault.isPending;
  const shop = (shopify?.shopDomain || '').trim() || 'your-store.example.com';

  const save = () => {
    if (agent) {
      update.mutate(
        {
          id: agent.id,
          name: name.trim(),
          active,
          display_name: displayName.trim(),
          greeting,
        },
        { onSuccess: onClose },
      );
    } else {
      create.mutate(
        { code: code.trim().toLowerCase(), name: name.trim() },
        {
          onSuccess: (row) => {
            onSelect(row.id);
            onClose();
          },
        },
      );
    }
  };

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippetFor(agent?.code ?? code, shop));
      toast.success(t('agents.snippetCopied'));
    } catch {
      toast.error(t('agents.snippetCopyFailed'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={agent ? t('agents.editTitle') : t('agents.addTitle')}
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex gap-2">
            {agent && !agent.isDefault && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setDefault.mutate(agent.id, { onSuccess: onClose })}
                >
                  <Star className="h-4 w-4" /> {t('agents.makeDefault')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t('agents.deleteConfirm', { name: agent.name }))) {
                      remove.mutate(agent.id, { onSuccess: onClose });
                    }
                  }}
                >
                  {tc('delete')}
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
              {tc('cancel')}
            </Button>
            <Button size="sm" onClick={save} disabled={busy || !name.trim() || (!agent && !code.trim())}>
              {tc('save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <FormRow label={t('agents.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </FormRow>
        <FormRow label={t('agents.code')}>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            // The code is baked into installed snippets — renaming it would
            // silently unpin every page using it, so it locks after create.
            disabled={!!agent}
            placeholder="hotel-partner"
            maxLength={64}
          />
        </FormRow>
        {!agent && <p className="text-xs text-gray-400">{t('agents.codeHint')}</p>}
        {agent && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={active}
              disabled={agent.isDefault}
              onChange={(e) => setActive(e.target.checked)}
            />
            {t('agents.active')}
            {agent.isDefault && (
              <span className="text-xs text-gray-400">{t('agents.defaultAlwaysActive')}</span>
            )}
          </label>
        )}
        {agent && (
          <>
            {/* Widget identity (REQ-260825 R4): what the SHOPPER sees. */}
            <FormRow label={t('agents.displayName')}>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('agents.displayNamePlaceholder')}
                maxLength={100}
              />
            </FormRow>
            <p className="-mt-3 text-xs text-gray-400">{t('agents.displayNameHint')}</p>
            {/* Per-agent first message (REQ-260825 R3), per language. */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-gray-500">{t('agents.greeting')}</span>
              <LanguageTabs value={greetLang} onChange={setGreetLang} filled={greeting} />
              <textarea
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500"
                rows={3}
                maxLength={500}
                value={greeting[greetLang] ?? ''}
                onChange={(e) =>
                  setGreeting((prev) => ({ ...prev, [greetLang]: e.target.value }))
                }
                placeholder={t('agents.greetingPlaceholder')}
              />
              <p className="text-xs text-gray-400">{t('agents.greetingHint')}</p>
            </div>
          </>
        )}
        {(agent || code.trim()) && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">{t('agents.snippet')}</span>
              <Button size="sm" variant="ghost" onClick={copySnippet}>
                <Copy className="h-3.5 w-3.5" /> {tc('copy')}
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-[11px] leading-4 text-gray-600">
              {snippetFor(agent?.code ?? code.trim().toLowerCase(), shop)}
            </pre>
            <p className="text-xs text-gray-400">{t('agents.snippetHint')}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
