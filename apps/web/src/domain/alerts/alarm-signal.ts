/**
 * Sound and desktop notification for a new alarm (PLN-261024 D4).
 *
 * The chime is synthesized (Web Audio) — no asset to ship or cache-bust.
 * Browsers only let a page make sound after the user has interacted with it,
 * and a blocked attempt simply stays silent. Desktop notifications need the
 * user's permission; without it nothing is shown.
 */
let ctx: AudioContext | null = null;

export function playChime(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = ctx ?? new Ctor();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.16);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.17);
    });
  } catch {
    /* autoplay blocked or no audio device — stay silent */
  }
}

export function desktopPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export async function requestDesktopPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Show a desktop notification; clicking it focuses the console and runs `onClick`. */
export function showDesktop(title: string, body: string, tag: string, onClick: () => void): void {
  if (desktopPermission() !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker — skip */
  }
}
