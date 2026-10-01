import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { FormRow, Input, Select } from '@/components/Field';
import { usePrivacyNotice, useUpdatePrivacyNotice } from './privacy-notice.hooks';
import type { NoticeLineKey, NoticeLines } from './privacy-notice.service';
import { LANGUAGES } from '../../../../../packages/types/src/common/language';

/** Rendered in the banner's order; `title`/`body` lead, the disclosures follow. */
const NOTICE_LINES: NoticeLineKey[] = ['title', 'body', 'items', 'purpose', 'retention', 'aiProcessor'];

/** Empty is allowed (clears the link); otherwise http(s) URL, max 512 (server rule). */
function isValidPolicyUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v.length > 512) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Mirrors the server rule: alnum start, then [A-Za-z0-9._-], max 32. Empty = keep/default. */
function isValidVersion(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  return v.length <= 32 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v);
}

/**
 * Privacy notice settings (wireframe 5.3, master/director via the `settings`
 * capability). Bumping the version re-prompts every customer for consent.
 */
export function PrivacyNoticePage() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data, isLoading, error } = usePrivacyNotice();
  const update = useUpdatePrivacyNotice();

  const [policyUrl, setPolicyUrl] = useState('');
  const [version, setVersion] = useState('');
  const [profile, setProfile] = useState<string>('');
  const [copy, setCopy] = useState<Record<string, NoticeLines>>({});
  const [copyLang, setCopyLang] = useState<string>('KO');
  const [bumpVersion, setBumpVersion] = useState(false);
  const [urlInvalid, setUrlInvalid] = useState(false);
  const [versionInvalid, setVersionInvalid] = useState(false);

  // Seed the form once the current settings arrive (or after a refetch).
  useEffect(() => {
    if (data) {
      setPolicyUrl(data.privacyPolicyUrl ?? '');
      setVersion(data.consentNoticeVersion ?? '');
      setProfile(data.privacyProfile ?? '');
      setCopy(data.privacyNoticeCopy ?? {});
      setBumpVersion(false);
    }
  }, [data]);

  /** Blank clears the override for that line, falling back to the profile. */
  const setLine = (key: NoticeLineKey, text: string) =>
    setCopy((prev) => {
      const lang = { ...(prev[copyLang] ?? {}) };
      if (text.trim()) lang[key] = text;
      else delete lang[key];
      const next = { ...prev, [copyLang]: lang };
      if (!Object.keys(lang).length) delete next[copyLang];
      return next;
    });

  const onSave = () => {
    const urlOk = isValidPolicyUrl(policyUrl);
    const versionOk = isValidVersion(version);
    setUrlInvalid(!urlOk);
    setVersionInvalid(!versionOk);
    if (!urlOk || !versionOk) return;
    const trimmedVersion = version.trim();
    update.mutate({
      privacy_policy_url: policyUrl.trim() || null,
      ...(trimmedVersion ? { consent_notice_version: trimmedVersion } : {}),
      // '' = "decide from whether this tenant sells", which is the state every
      // tenant starts in — never store it as a profile name.
      privacy_profile: profile || null,
      privacy_notice_copy: Object.keys(copy).length ? copy : null,
      ...(bumpVersion ? { bump_version: true } : {}),
    });
  };

  return (
    <div className="space-y-6">
      {/* Rendered inside the settings tabs, which already carry the page
          heading — a second one here read as two pages stacked. */}
      <p className="text-sm text-gray-500">{t('privacyNotice.subtitle')}</p>

      <Card title={t('privacyNotice.cardTitle')}>
        {isLoading ? (
          <p className="text-sm text-gray-500">{tc('loading')}</p>
        ) : error ? (
          <p className="text-sm text-error">{(error as Error).message}</p>
        ) : (
          <div className="max-w-xl">
            <FormRow label={t('privacyNotice.policyUrl')}>
              <Input
                type="url"
                value={policyUrl}
                onChange={(e) => {
                  setPolicyUrl(e.target.value);
                  if (urlInvalid && isValidPolicyUrl(e.target.value)) setUrlInvalid(false);
                }}
                placeholder={t('privacyNotice.policyUrlPlaceholder')}
                maxLength={512}
                aria-invalid={urlInvalid}
              />
              {urlInvalid && (
                <p className="mt-1 text-xs text-error" role="alert">
                  {t('privacyNotice.invalidUrl')}
                </p>
              )}
              {!policyUrl.trim() && (
                <p className="mt-1 text-xs text-warning">{t('privacyNotice.unsetUrl')}</p>
              )}
              <p className="mt-1 text-xs text-gray-400">{t('privacyNotice.policyUrlHint')}</p>
            </FormRow>

            <FormRow label={t('privacyNotice.version')}>
              <Input
                value={version}
                onChange={(e) => {
                  setVersion(e.target.value);
                  if (versionInvalid && isValidVersion(e.target.value)) setVersionInvalid(false);
                }}
                placeholder={t('privacyNotice.versionPlaceholder')}
                maxLength={32}
                aria-invalid={versionInvalid}
              />
              {versionInvalid && (
                <p className="mt-1 text-xs text-error" role="alert">
                  {t('privacyNotice.invalidVersion')}
                </p>
              )}
              {/* Stored null = platform default version is in effect. */}
              {!version.trim() && (
                <>
                  <p className="mt-1 text-xs text-warning">{t('privacyNotice.unsetVersion')}</p>
                  <p className="mt-1 text-xs text-gray-400">{t('privacyNotice.versionDefaultHint')}</p>
                </>
              )}
            </FormRow>

            {/* --- notice copy (PLN-261001) --- */}
            <div className="mb-4 border-t border-gray-100 pt-4">
              <FormRow label={t('privacyNotice.profile')}>
                <Select value={profile} onChange={(e) => setProfile(e.target.value)}>
                  {/* '' is not a profile — it means "work it out from the
                      tenant", which is how every tenant starts. */}
                  <option value="">
                    {t('privacyNotice.profileAuto', {
                      profile: t(`privacyNotice.profile_${data?.effectiveProfile ?? 'commerce'}`),
                    })}
                  </option>
                  <option value="commerce">{t('privacyNotice.profile_commerce')}</option>
                  <option value="lodging">{t('privacyNotice.profile_lodging')}</option>
                  <option value="generic">{t('privacyNotice.profile_generic')}</option>
                </Select>
                <p className="mt-1 text-xs text-gray-400">{t('privacyNotice.profileHint')}</p>
              </FormRow>

              <FormRow label={t('privacyNotice.copyLang')}>
                <Select value={copyLang} onChange={(e) => setCopyLang(e.target.value)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.session} value={l.session}>
                      {l.nativeLabel}
                    </option>
                  ))}
                </Select>
              </FormRow>

              {NOTICE_LINES.map((key) => (
                <FormRow key={key} label={t(`privacyNotice.line_${key}`)}>
                  <Input
                    value={copy[copyLang]?.[key] ?? ''}
                    // The placeholder is the profile's own wording, so an
                    // operator can see what they are replacing before they do.
                    placeholder={data?.profileCopy?.[copyLang]?.[key] ?? ''}
                    onChange={(e) => setLine(key, e.target.value)}
                    maxLength={500}
                  />
                </FormRow>
              ))}
              <p className="mb-2 text-xs text-gray-400">{t('privacyNotice.copyHint')}</p>
              <p className="text-xs text-gray-500">{t('privacyNotice.copyResponsibility')}</p>
            </div>

            {/* Version bump re-prompts every customer — make that unmissable. */}
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-xs leading-relaxed text-gray-700">
                {t('privacyNotice.versionWarning')}
              </p>
            </div>

            {/* Changing words is not automatically a material change (D5). */}
            <label className="mb-4 flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={bumpVersion}
                onChange={(e) => setBumpVersion(e.target.checked)}
                className="mt-0.5"
              />
              <span>{t('privacyNotice.bumpVersion')}</span>
            </label>

            <Button onClick={onSave} disabled={update.isPending}>
              {update.isPending ? tc('saving') : tc('save')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
