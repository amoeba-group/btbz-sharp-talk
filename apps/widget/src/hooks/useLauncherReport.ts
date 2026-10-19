import { useEffect } from 'react';
import { useWidgetStore } from '../store/widgetStore';
import { launcherFrameSize, resolveLauncher } from '../lib/launcher';
import { panelFrame, TEASER_FRAME_WIDTH } from '../../../../packages/types/src/common/widget-theme';
import { hostKind, isAppMode, postToHost } from '../lib/host-bridge';

/**
 * Tell the loader how much room the launcher needs, and which side (PLN-260819 S4).
 *
 * The button is drawn in here, but the iframe that contains it is sized and
 * positioned out there. Changing only one of the two clips the launcher against
 * its own frame, so the geometry is reported rather than duplicated.
 */
export function useLauncherReport(): void {
  const theme = useWidgetStore((s) => s.widgetTheme);
  const teaserVisible = useWidgetStore((s) => s.teaserVisible);

  useEffect(() => {
    // Only a parent frame owns an iframe box to resize. A native host presents
    // the widget its own way, and standalone has nobody to tell. App mode has no
    // launcher at all, so reporting its geometry is noise even inside a frame
    // (the simulator shows it arriving, which is how this was spotted).
    if (hostKind() !== 'frame' || isAppMode()) return;
    const launcher = resolveLauncher(theme);
    const size = launcherFrameSize(theme);
    postToHost({
      type: 'ivy:launcher',
      position: launcher.position,
      size,
      // Trigger mode (PLN-260916 P2): the loader draws no launcher box, docks
      // the frame under the storefront header and wires the page's own trigger.
      mode: launcher.mode ?? 'floating',
      offsetTop: launcher.offsetTop ?? 0,
      trigger: launcher.triggerSelector ?? null,
      // Open-panel frame (P2): the panel size is a tenant setting now, so the
      // loader can no longer hard-code 444×680.
      frame: panelFrame(theme),
      // Closed-frame box (PLN-261019 P2): the square the button needs, or the
      // wider strip while the greeting pill shows beside it. Re-reported the
      // moment the pill goes, so the invisible frame never outgrows what it draws.
      closed: { w: teaserVisible ? TEASER_FRAME_WIDTH : size, h: size },
    });
  }, [theme, teaserVisible]);
}
