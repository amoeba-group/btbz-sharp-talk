// node --test scripts/__tests__/
//
// PLN-261012 SG-80: the install snippet in the console must point at THIS
// deployment's widget, never at Amoeba's staging host, unless nothing else is
// known (development). The logic lives in a dependency-free .ts file so it can be
// imported here — Node >= 22.18 strips the types natively; older Node skips.
import test from 'node:test';
import assert from 'node:assert/strict';

let resolveWidgetUrl;
let LEGACY_DEV_WIDGET_URL;
try {
  ({ resolveWidgetUrl, LEGACY_DEV_WIDGET_URL } = await import('../../apps/web/src/lib/widget-url-resolve.ts'));
} catch (err) {
  if (!/ERR_UNKNOWN_FILE_EXTENSION|Unknown file extension/.test(String(err?.code ?? err))) throw err;
}
const skip = resolveWidgetUrl ? false : 'this Node cannot import .ts (needs >= 22.18)';

test('an explicit VITE_WIDGET_URL wins and loses its trailing slashes', { skip }, () => {
  assert.equal(
    resolveWidgetUrl({ explicit: 'https://cdn.example.com/widget//', apiBase: 'https://talk.example.com/api/v1', origin: 'https://x' }),
    'https://cdn.example.com/widget',
  );
});

test('an absolute API base gives the same stack: origin + /widget (no staging host)', { skip }, () => {
  assert.equal(resolveWidgetUrl({ apiBase: 'https://talk-vn.go2joy.vn/api/v1' }), 'https://talk-vn.go2joy.vn/widget');
  assert.equal(resolveWidgetUrl({ apiBase: 'http://10.0.0.5:8080/api/v1', dev: true }), 'http://10.0.0.5:8080/widget');
});

test('a relative API base (the domain-agnostic release bundle) resolves against the console origin at runtime', { skip }, () => {
  assert.equal(resolveWidgetUrl({ apiBase: '/api/v1', origin: 'https://talk.go2joy.vn' }), 'https://talk.go2joy.vn/widget');
  assert.equal(resolveWidgetUrl({ origin: 'https://talk.go2joy.vn/' }), 'https://talk.go2joy.vn/widget');
});

test('development keeps the legacy default (the vite dev server is not the widget host)', { skip }, () => {
  assert.equal(resolveWidgetUrl({ apiBase: '/api/v1', origin: 'http://localhost:5173', dev: true }), LEGACY_DEV_WIDGET_URL);
  assert.equal(resolveWidgetUrl({ dev: true }), LEGACY_DEV_WIDGET_URL);
});

test('a malformed absolute API base falls through instead of throwing', { skip }, () => {
  assert.equal(resolveWidgetUrl({ apiBase: 'http://', origin: 'https://talk.example.com' }), 'https://talk.example.com/widget');
});

test('a production deployment never resolves to the Amoeba staging host when it knows its own origin', { skip }, () => {
  for (const input of [
    { apiBase: 'https://talk.go2joy.vn/api/v1' },
    { apiBase: '/api/v1', origin: 'https://talk.go2joy.vn' },
    { origin: 'https://talk.go2joy.vn' },
  ]) {
    assert.doesNotMatch(resolveWidgetUrl(input), /amoeba/);
  }
});
