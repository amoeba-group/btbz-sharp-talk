import { HandoffSection } from '../ai-settings/HandoffSection';

/**
 * Tenant settings — live-support handoff (PLN-261024). Split out of the basic
 * tab, where it took most of the page: assignees, routing rules and their
 * categories, re-alert, business hours, off-hours mail, SLA and the deny list.
 */
export function SettingsHandoffPage() {
  return (
    <div className="space-y-6">
      <HandoffSection />
    </div>
  );
}
