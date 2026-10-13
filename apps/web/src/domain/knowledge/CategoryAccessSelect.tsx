import { useTranslation } from 'react-i18next';
import { Select } from '@/components/Field';
import { useSetCategoryAccess } from './knowledge.hooks';
import type { KbCategoryRow } from './knowledge.service';
// Source deep-import, not '@sharptalk/types': the package's CJS runtime exports are invisible to the
// browser build (see KbVersionSection). The tier rules live there once, for the API and this select.
import {
  KB_ACCESS_OPTIONS,
  kbAccessConfirmKey,
  kbAccessOf,
  kbAccessWarningKey,
} from '../../../../../packages/types/src/common/kb-access';
import type { Audience } from '../../../../../packages/types/src/common/audience';

/**
 * Who may read a category (PLN-261012 SG-10, wireframe W1): public | signed-in partners | managers
 * only. It replaces the guest-visible toggle (PLN-261001 W3); the server writes both columns.
 *
 * The default is "Signed-in partners" — a category is never public or manager-only until an
 * operator says so. Widening asks first: the documents already filed here become readable by
 * people who could not read them a second ago (visitors who never signed in, or receptionists).
 * The select is controlled by the SAVED value, so a declined confirmation, or a failed save,
 * simply snaps back to what the server holds.
 *
 * Renders a fragment into the row's flex container: the select, then — for manager-only — a
 * full-width warning on its own line (`order-last`, so the row's buttons stay where they were)
 * saying receptionists will be pointed to their manager account.
 */
export function CategoryAccessSelect({ category }: { category: KbCategoryRow }) {
  const { t } = useTranslation('knowledge');
  const setAccess = useSetCategoryAccess();
  // The API reports the tier it derived (`access`); the local derivation only covers an older API that
  // sends the two columns' worth of facts it has (the list endpoint carries no raw `minAudience`).
  const access: Audience =
    category.access ?? kbAccessOf({ guestVisible: category.guestVisible, minAudience: category.minAudience });
  const warningKey = kbAccessWarningKey(access);

  return (
    <>
      <Select
        aria-label={t('categoryAccessLabel')}
        title={t('categoryAccessHint')}
        value={access}
        disabled={setAccess.isPending}
        className="w-auto py-1 text-xs"
        onChange={(e) => {
          const next = e.target.value as Audience;
          const confirmKey = kbAccessConfirmKey(access, next, category.documentCount);
          if (confirmKey && !window.confirm(t(confirmKey, { count: category.documentCount }))) return;
          setAccess.mutate({ id: category.id, access: next });
        }}
      >
        {KB_ACCESS_OPTIONS.map((a) => (
          <option key={a} value={a}>
            {t(`categoryAccessOption.${a}`)}
          </option>
        ))}
      </Select>
      {warningKey ? (
        <p className="order-last basis-full pl-1 text-[11px] text-warning">{t(warningKey)}</p>
      ) : null}
    </>
  );
}
