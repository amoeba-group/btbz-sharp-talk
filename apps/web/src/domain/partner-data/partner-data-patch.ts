import type { PartnerDataSettings, PartnerDataSettingsPatch, PartnerLookupMode } from './partner-data.service';

/** The lookup-method choices the card offers; `inherit` = follow the server default. */
export type LookupMethodChoice = PartnerLookupMode | 'inherit';

/** What the server currently has, as a choice. */
export const methodOf = (s: Pick<PartnerDataSettings, 'dataMode'> | undefined): LookupMethodChoice => s?.dataMode ?? 'inherit';

/**
 * The PUT body for what the user changed — ONLY the fields that differ from the saved state, so a
 * save of the switch alone never rewrites the method (and the audit trail stays honest). Null = nothing to save.
 */
export function buildPartnerPatch(
  saved: Pick<PartnerDataSettings, 'enabled' | 'dataMode'> | undefined,
  draft: { enabled: boolean | null; method: LookupMethodChoice | null },
): PartnerDataSettingsPatch | null {
  const patch: PartnerDataSettingsPatch = {};
  if (draft.enabled !== null && draft.enabled !== (saved?.enabled ?? false)) patch.enabled = draft.enabled;
  if (draft.method !== null && draft.method !== methodOf(saved)) patch.data_mode = draft.method;
  return Object.keys(patch).length ? patch : null;
}

/**
 * Whether AI-assisted lookup would actually run for this choice, or quietly fall back to the standard
 * one — so the card can say so instead of letting the selector look live. `null` = nothing to warn about.
 */
export function toolsWarning(
  settings: Pick<PartnerDataSettings, 'serverMode' | 'toolsAllowed' | 'toolsSupport'> | undefined,
  method: LookupMethodChoice,
): 'off' | 'unsupported' | null {
  if (!settings) return null;
  const wantsTools = method === 'tools' || (method === 'inherit' && settings.serverMode === 'tools');
  if (!wantsTools) return null;
  if (!settings.toolsAllowed) return 'off';
  if (settings.toolsSupport && !settings.toolsSupport.supported) return 'unsupported';
  return null;
}
