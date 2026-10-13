import { AUDIENCE, SCENARIO_AUDIENCE } from '@sharptalk/types';
import type { Audience, ScenarioAudience } from '@sharptalk/types';

/**
 * Who sees a scenario button, and who may press it (PLN-261001 v1.1, PLN-261012 SG-10).
 *
 * Standalone (no service imports): ai-config decides what the widget is SHOWN and
 * scenario.service decides what a press may RUN, and both must read the same rule.
 */

/**
 * Is a button of this audience shown to this viewer? Absent = `all`, the shape from
 * before audiences existed, so a button set saved earlier is served as it was.
 * `viewer` is `audienceOf(effectiveIdentity(session))`: lapsed signed claims read as
 * public, so a guest-audience button comes back for someone no longer signed in.
 */
export function scenarioAudienceShows(audience: ScenarioAudience | undefined, viewer: Audience): boolean {
  switch (audience ?? SCENARIO_AUDIENCE.ALL) {
    case SCENARIO_AUDIENCE.GUEST:
      return viewer === AUDIENCE.PUBLIC;
    case SCENARIO_AUDIENCE.VERIFIED:
      return viewer !== AUDIENCE.PUBLIC;
    case SCENARIO_AUDIENCE.MANAGER:
      return viewer === AUDIENCE.MANAGER;
    default:
      return true;
  }
}

/** The part of a configured button the click-time check reads. */
export interface ScenarioButtonAudience {
  action: string;
  audience?: ScenarioAudience;
}

/**
 * May this viewer press a button that runs `action`? (PLN-261012 SG-10.)
 *
 * Until now the audience was presentation only: the widget stopped listing a
 * button, but the endpoint ran whatever action it was handed, so a receptionist
 * who called it directly read a manager-only script. A `manager` button is ENFORCED
 * here. The rule reads every configured button that runs the action, enabled or
 * not (a disabled manager-only button must not turn its script back into a public
 * one): the press is refused only when every one of them is manager-only and the
 * viewer is not a manager. An action no button uses (a follow-up chip, an older
 * client) is not judged — there is no audience to compare. `guest` / `verified`
 * stay presentation-only, as before: they steer relevance, they guard nothing.
 *
 * `resolve` maps a button action to the script key it runs (`resolveScriptAction`),
 * passed in because that table lives with the scripts.
 */
export function scenarioPressAllowed(
  buttons: readonly ScenarioButtonAudience[],
  action: string,
  viewer: Audience,
  resolve: (action: string) => string = (a) => a,
): boolean {
  if (viewer === AUDIENCE.MANAGER) return true;
  const target = resolve(action);
  const using = buttons.filter((b) => resolve(b.action) === target);
  if (!using.length) return true;
  return !using.every((b) => b.audience === SCENARIO_AUDIENCE.MANAGER);
}
