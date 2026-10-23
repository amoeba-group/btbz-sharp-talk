/**
 * Welcome bubble greets a host-signed-in user by name (PLN-261023 ②).
 *
 * go2joy's hotel-partner agent greeting is the first-visit copy; a `{name}` in
 * it used to be shown literally (or never filled), because only the tenant's
 * login greeting was filled with the name.
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/lib/copy.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const { welcomeGreeting } = await import(`data:text/javascript,${encodeURIComponent(outputFiles[0].text)}`);

const LOGIN = 'Welcome back, {name}!';

test('fills {name} in the first-visit copy when the name is known', () => {
  assert.equal(
    welcomeGreeting({ firstVisit: "Dear {name}, I'm Joydesk.", loginGreeting: LOGIN, name: 'ADMIN123', shop: 'Go2Joy' }),
    "Dear ADMIN123, I'm Joydesk.",
  );
});

test('drops the token cleanly when no name is known', () => {
  assert.equal(
    welcomeGreeting({ firstVisit: "Dear {name}, I'm Joydesk.", loginGreeting: LOGIN, name: null, shop: 'Go2Joy' }),
    "Dear, I'm Joydesk.",
  );
  assert.equal(welcomeGreeting({ firstVisit: '{name} hi', loginGreeting: LOGIN, name: null, shop: 'x' }), 'hi');
});

test('a first-visit copy without {name} hands over to the login greeting, as before', () => {
  assert.equal(
    welcomeGreeting({ firstVisit: 'Hi, welcome to {shop}.', loginGreeting: LOGIN, name: 'Mai', shop: 'Go2Joy' }),
    'Welcome back, Mai!',
  );
  assert.equal(
    welcomeGreeting({ firstVisit: 'Hi, welcome to {shop}.', loginGreeting: LOGIN, name: null, shop: 'Go2Joy' }),
    'Hi, welcome to Go2Joy.',
  );
});
