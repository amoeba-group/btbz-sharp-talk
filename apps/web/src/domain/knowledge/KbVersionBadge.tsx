import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/Badge';
import { FormRow, Input } from '@/components/Field';
// Deep import: the package entry is CJS and the bundler cannot trace a named
// export through its `export *` chain (see i18n.ts).
import {
  isValidKbVersionLabel,
  kbVersionBadge,
  KB_UI_VERSION_MAX_LEN,
} from '../../../../../packages/types/src/common/kb-version';

/**
 * A document's UI version against the tenant's reference version (PLN-261012
 * SG-20, wireframe W2). The comparison and the severity come from the shared
 * helper, so the list, the detail and the Q&A panel cannot disagree with what
 * the API does at answer time.
 *
 * - stamped with another version → warning, tooltip names the reference
 * - on the reference → green
 * - no version, tenant uses the feature → "No version" warning (flagged here,
 *   never in the answer); a tenant that never set a reference sees a dash,
 *   because every document would otherwise light up
 * - a version but nothing to compare it with → neutral
 */
export function KbVersionBadge({
  version,
  reference,
}: {
  version: string | null | undefined;
  reference: string | null | undefined;
}) {
  const { t } = useTranslation('knowledge');
  const b = kbVersionBadge(version, reference);
  if (b.state === 'unversioned') {
    return b.severity === 'warn' ? (
      <span title={t('uiVersionUnversionedTip')}>
        <Badge tone="warning">{t('uiVersionUnversioned')}</Badge>
      </span>
    ) : (
      <span className="text-gray-300">—</span>
    );
  }
  const tone = b.severity === 'warn' ? 'warning' : b.severity === 'ok' ? 'success' : 'gray';
  const title =
    b.state === 'mismatch'
      ? t('uiVersionMismatchTip', { reference: reference?.trim() })
      : b.state === 'match'
        ? t('uiVersionMatchTip', { reference: reference?.trim() })
        : undefined;
  return (
    <span title={title}>
      <Badge tone={tone}>{b.label}</Badge>
    </span>
  );
}

/** Blank is fine (it means "no version"); anything typed must be a valid label. */
export function isUiVersionInputInvalid(value: string): boolean {
  return value.trim() !== '' && !isValidKbVersionLabel(value);
}

/** The editable "UI version" row of the document editor and the add dialog. */
export function UiVersionField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation('knowledge');
  const invalid = isUiVersionInputInvalid(value);
  return (
    <>
      <FormRow label={t('uiVersion')}>
        <Input
          value={value}
          maxLength={KB_UI_VERSION_MAX_LEN + 8}
          placeholder="v0.12.0"
          aria-invalid={invalid}
          aria-label={t('uiVersion')}
          onChange={(e) => onChange(e.target.value)}
        />
      </FormRow>
      <p className={`-mt-2 mb-2 text-xs ${invalid ? 'text-warning' : 'text-gray-400'}`}>
        {invalid ? t('uiVersionInvalid') : t('uiVersionHint')}
      </p>
    </>
  );
}
