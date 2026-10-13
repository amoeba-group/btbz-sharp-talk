import { useTranslation } from 'react-i18next';
// Source deep-import: the package entry point is CJS and fails the browser build for values.
import { sessionLanguageForLocale } from '../../../../packages/types/src/common/language';
import type { SessionLanguage } from '../../../../packages/types/src/common/language';

/**
 * Which language tab a copy editor opens on (w3c, ops-manual finding 19).
 *
 * The Agent handoff card and the Privacy Notice page used to open on KO whatever the console
 * language was, so a Vietnamese operator typing into the first box wrote Korean copy without
 * noticing the tab. They now open on the console language, and on English when the console runs in
 * a language the registry does not know. (A language the tenant never filled in still falls back
 * to English at read time, so "EN" is also the safe default.)
 */
export function copyLangFor(consoleLanguage: string | null | undefined): SessionLanguage {
  return sessionLanguageForLocale(consoleLanguage) ?? 'EN';
}

/** `copyLangFor` for the language the console is showing right now; use it as a useState initialiser. */
export function useCopyLang(): SessionLanguage {
  const { i18n } = useTranslation();
  return copyLangFor(i18n.language);
}
