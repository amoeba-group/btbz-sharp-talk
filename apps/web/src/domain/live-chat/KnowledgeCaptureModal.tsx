import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { FormRow, Input, Select } from '@/components/Field';
import { toast } from '@/store/toast-store';
import { useCreateDocument } from '../knowledge/knowledge.hooks';
import { findPii } from '@/lib/pii-hint';

/** Categories offered here — the KB accepts any string, these are the common ones. */
const CATEGORIES = ['faq', 'policy', 'product', 'shipping', 'partnership'] as const;

/**
 * Turn a conversation the AI handled badly into knowledge (PLN-260807).
 *
 * The agent sees what the customer asked and what the assistant actually said,
 * then writes the answer it should have given. Saving creates a knowledge
 * document, which is embedded immediately — so the next similar question is
 * answered from it rather than escalated.
 */
export function KnowledgeCaptureModal({
  open,
  question,
  answer,
  conversationId,
  onClose,
}: {
  open: boolean;
  question: string;
  answer: string;
  conversationId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['livechat', 'common']);
  const createDocument = useCreateDocument();

  const [title, setTitle] = useState(question.slice(0, 80));
  const [category, setCategory] = useState<string>('faq');
  // Seeded with what the assistant said: usually a good skeleton that only
  // needs the missing fact added, which is faster than writing from scratch.
  const [content, setContent] = useState(answer);

  // A knowledge document outlives the conversation it was written from, gets
  // answered back to other shoppers, and can be exported — so contact details
  // pasted in here escape the retention window (PLN-260920 F-10).
  const piiHint = useMemo(() => findPii(content), [content]);

  const save = async () => {
    if (!title.trim() || !content.trim()) return;
    try {
      await createDocument.mutateAsync({
        title: title.trim(),
        category,
        content: content.trim(),
        // Provenance: which conversation this answer was written from.
        source_url: conversationId ? `/live-chat?c=${conversationId}` : undefined,
      });
      toast.success(t('knowledge.saved'));
      onClose();
    } catch (e) {
      toast.error((e as Error).message || t('knowledge.saveFailed'), { sticky: true });
    }
  };

  return (
    <Modal open={open} title={t('knowledge.title')} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">{t('knowledge.question')}</p>
          <p className="rounded-lg bg-gray-50 p-2 text-sm text-gray-700">{question}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">{t('knowledge.aiAnswer')}</p>
          <p className="max-h-24 overflow-y-auto rounded-lg bg-gray-50 p-2 text-xs text-gray-500">
            {answer}
          </p>
        </div>

        <FormRow label={t('knowledge.docTitle')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormRow>
        <FormRow label={t('knowledge.category')}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </FormRow>
        {piiHint.kinds.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="mb-2">{t('knowledge.piiWarning')}</p>
            <Button size="sm" variant="secondary" onClick={() => setContent(piiHint.scrubbed)}>
              {t('knowledge.piiScrub')}
            </Button>
          </div>
        )}

        <FormRow label={t('knowledge.bestAnswer')}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
        </FormRow>
        <p className="text-xs text-gray-400">{t('knowledge.hint')}</p>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button
            onClick={save}
            disabled={createDocument.isPending || !title.trim() || !content.trim()}
          >
            {createDocument.isPending ? t('saving', { ns: 'common' }) : t('knowledge.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
