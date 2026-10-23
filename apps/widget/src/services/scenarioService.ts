import { apiClient } from '../lib/api-client';
import type { ScenarioButton } from '../lib/types';

export interface ScenarioConfig {
  scenarioButtons: ScenarioButton[];
}

/**
 * Fetch the admin-managed scenario menu for the current session.
 * Public endpoint (no auth header); buttons are already filtered to enabled.
 */
export function getScenario(sessionToken: string, language?: string): Promise<ScenarioConfig> {
  return apiClient.get<ScenarioConfig>('/ai-config/scenario', {
    session_token: sessionToken,
    // Labels in the language on screen (PLN-261023); older APIs ignore it.
    ...(language ? { language: language.toUpperCase() } : {}),
  });
}
