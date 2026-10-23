import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useAlertSettings, useSaveAlertSettings } from './alerts.hooks';
import type { AlertPopup, AlertSettings } from './alerts.service';
import { desktopPermission, playChime, requestDesktopPermission } from './alarm-signal';

const DEFAULTS: AlertSettings = { popup: 'all', sound: true, desktop: false, email: true };

/** My alarm settings (PLN-261024 D4, wireframe 2-4). */
export function AlertSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('livechat');
  const { t: tc } = useTranslation('common');
  const { data } = useAlertSettings(open);
  const save = useSaveAlertSettings();
  const [form, setForm] = useState<AlertSettings>(DEFAULTS);
  const [permission, setPermission] = useState(desktopPermission());

  useEffect(() => {
    if (open) {
      setForm(data ?? DEFAULTS);
      setPermission(desktopPermission());
    }
  }, [open, data]);

  const set = (patch: Partial<AlertSettings>) => setForm((f) => ({ ...f, ...patch }));
  const toggleDesktop = async (on: boolean) => {
    if (on && permission !== 'granted') {
      const p = await requestDesktopPermission();
      setPermission(p);
      if (p !== 'granted') return; // keep it off — the browser said no
    }
    set({ desktop: on });
  };
  const submit = () => save.mutate(form, { onSuccess: onClose });

  const radio = (value: AlertPopup) => (
    <label key={value} className="flex items-center gap-2 text-sm text-gray-700">
      <input type="radio" name="alarm-popup" checked={form.popup === value} onChange={() => set({ popup: value })} />
      {t(`alarmCenter.settings.popup_${value}`)}
    </label>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={t('alarmCenter.settings.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button disabled={save.isPending} onClick={submit}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div>
          <p className="mb-1 font-medium text-gray-800">{t('alarmCenter.settings.popup')}</p>
          <div className="space-y-1">{(['all', 'mine', 'off'] as const).map(radio)}</div>
          <p className="mt-1 text-[11px] text-gray-400">{t('alarmCenter.settings.popupHint')}</p>
        </div>
        <label className="flex items-center gap-2 text-gray-700">
          <input type="checkbox" className="h-4 w-4" checked={form.sound} onChange={(e) => set({ sound: e.target.checked })} />
          {t('alarmCenter.settings.sound')}
          <button type="button" className="ml-2 text-xs text-primary-600 hover:underline" onClick={playChime}>
            {t('alarmCenter.settings.soundTest')}
          </button>
        </label>
        <div>
          <label className="flex items-center gap-2 text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={form.desktop}
              disabled={permission === 'unsupported' || permission === 'denied'}
              onChange={(e) => void toggleDesktop(e.target.checked)}
            />
            {t('alarmCenter.settings.desktop')}
          </label>
          <p className="mt-1 pl-6 text-[11px] text-gray-400">{t(`alarmCenter.settings.permission_${permission}`)}</p>
        </div>
        <div>
          <label className="flex items-center gap-2 text-gray-700">
            <input type="checkbox" className="h-4 w-4" checked={form.email} onChange={(e) => set({ email: e.target.checked })} />
            {t('alarmCenter.settings.email')}
          </label>
          <p className="mt-1 pl-6 text-[11px] text-gray-400">{t('alarmCenter.settings.emailHint')}</p>
        </div>
      </div>
    </Modal>
  );
}
