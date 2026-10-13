import { useEffect, useState } from 'react';

/**
 * `Date.now()` that ticks (PLN-261012 SG-66): a waiting time such as "07:42" has to count up
 * between the queue polls. The interval lives in the component that shows the time, so only that
 * badge re-renders each second — not the whole live-chat page with its fifty rows. `active` false
 * stops the timer (a row that is not waiting has nothing to count).
 */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}
