import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

/**
 * Signed partner context (identify v2, PLN-261001 §1.2b): the hotel and role
 * the host's server put under the signature. `hotelName`/`hotelCode` are
 * display only. With claims, `hash` must be HMAC-SHA256 of
 * `userId|hotelSn|role|iat` — claims under a v1 hash are refused.
 */
export interface ShopTalkClaims {
  hotelSn: string;
  role: 'manager' | 'receptionist' | 'internal';
  /** Unix seconds at signing; the API accepts ±10 minutes. */
  iat: number;
  hotelName?: string;
  hotelCode?: string;
}

/** Identity the host app has already authenticated, signed by the host's server. */
export interface ShopTalkUser {
  userId: string;
  /** HMAC-SHA256 of `userId` (v1) or `userId|hotelSn|role|iat` (v2) — made server-side. */
  hash: string;
  name?: string;
  email?: string;
  phone?: string;
  claims?: ShopTalkClaims;
}

export interface ShopTalkChatProps {
  /** Where the widget is served, e.g. https://talk.example.com/widget/ */
  widgetUrl: string;
  /** Store domain that identifies the tenant (same value the web SDK uses). */
  shop?: string;
  locale?: string;
  user?: ShopTalkUser;
  /** Called when the visitor closes the chat — dismiss the screen here. */
  onClose?: () => void;
  /** Fired after identify() has been verified (or rejected) by the server. */
  onIdentified?: (ok: boolean) => void;
}

interface BridgeMessage {
  type?: string;
  event?: string;
  ok?: boolean;
  url?: string;
}

/**
 * The ShopTalk conversation, hosted in a WebView (PLN-260820 W3).
 *
 * The same widget the web SDK embeds, so a fix on the web reaches the app with
 * no second implementation. This component's whole job is the four things a
 * WebView does not do for free: identify the user, close the screen, let a
 * photo be attached, and keep links out of the chat view.
 */
export function ShopTalkChat({
  widgetUrl,
  shop,
  locale,
  user,
  onClose,
  onIdentified,
}: ShopTalkChatProps) {
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const identified = useRef(false);

  const source = useMemo(() => {
    const base = widgetUrl.replace(/\/+$/, '');
    const params = new URLSearchParams({ embed: '1', mode: 'app' });
    if (shop) params.set('shop', shop);
    if (locale) params.set('locale', locale.slice(0, 5));
    return { uri: `${base}/?${params.toString()}` };
  }, [widgetUrl, shop, locale]);

  /** Deliver a message into the widget through the bridge global. */
  const send = useCallback((message: unknown) => {
    const payload = JSON.stringify(JSON.stringify(message));
    // The double encode is deliberate: the outer JSON.stringify makes a JS
    // string literal, so quotes inside the payload cannot break the injection.
    webRef.current?.injectJavaScript(
      `window.__shoptalkHost && window.__shoptalkHost(${payload}); true;`,
    );
  }, []);

  const sendIdentity = useCallback(() => {
    if (!user?.userId || !user?.hash) return;
    send({ type: 'ivy:identify', user });
  }, [send, user]);

  // Re-identify when the user changes (sign-in inside the app while the chat is
  // open). The widget binds the session; sending it twice is harmless.
  useEffect(() => {
    identified.current = false;
    if (!loading) sendIdentity();
  }, [loading, sendIdentity]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let data: BridgeMessage;
      try {
        data = JSON.parse(event.nativeEvent.data) as BridgeMessage;
      } catch {
        return; // not ours
      }

      if (data.type === 'ivy:ready') {
        // The widget mounted. Identity is queued on its side if it arrives
        // first, but sending on ready is what makes the common case immediate.
        sendIdentity();
        return;
      }
      if (data.type === 'ivy:close-request') {
        onClose?.();
        return;
      }
      if (data.type === 'ivy:open-url') {
        // A tenant-configured page (partner sign-in / registration, PLN-261001
        // V2): the system browser, never this WebView — same rule as links.
        const url = String(data.url || '');
        if (/^https?:\/\//i.test(url)) void Linking.openURL(url);
        return;
      }
      if (data.type === 'ivy:event' && data.event === 'identified') {
        identified.current = !!data.ok;
        onIdentified?.(!!data.ok);
      }
    },
    [onClose, onIdentified, sendIdentity],
  );

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      // Without this the message input sits under the keyboard on iOS.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <WebView
        ref={webRef}
        source={source}
        onMessage={onMessage}
        onLoadEnd={() => setLoading(false)}
        // Attachments: an Android WebView silently does nothing on a file input
        // unless the host grants this, so "the photo did not send" looks like a
        // widget bug rather than a missing permission.
        allowFileAccess
        allowFileAccessFromFileURLs={false}
        javaScriptEnabled
        domStorageEnabled
        // The session token lives in localStorage; without this a returning
        // visitor loses their conversation on every open.
        thirdPartyCookiesEnabled
        // Links in a conversation open in the system browser. Followed inside
        // this WebView, the customer would have no way back to the chat.
        onShouldStartLoadWithRequest={(request) => {
          const sameApp = request.url.startsWith(widgetUrl.replace(/\/+$/, ''));
          if (sameApp || request.url === 'about:blank') return true;
          void Linking.openURL(request.url);
          return false;
        }}
        style={styles.fill}
      />
      {loading && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
