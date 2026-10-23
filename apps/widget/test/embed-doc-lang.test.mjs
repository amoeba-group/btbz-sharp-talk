/**
 * The loader reports the page's `<html lang>` (PLN-261023-Widget-Header-Buttons D3).
 *
 * A tenant that hides the widget's language button wants the widget to speak
 * the page's language. The loader cannot know that setting, so it only says
 * where the language came from (`lang_src=doc`) and forwards later changes as
 * `locale` commands marked `source: 'doc'`; the widget decides what to do.
 *
 * Runs the REAL `public/embed.js` in a DOM stub, like embed-sign-in.test.mjs.
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../public/embed.js', import.meta.url), 'utf8');
const WIDGET_ORIGIN = 'https://widget.example';

function load({ config = {}, lang = 'ko' } = {}) {
  const posted = [];
  const observers = [];
  const listeners = {};
  let frame = null;
  const html = { lang };

  const win = {
    name: '',
    opener: null,
    IVY_WIDGET_CONFIG: { shop: 'acme.myshopify.com', ...config },
    location: {
      hostname: 'acme.example',
      pathname: '/',
      search: '',
      hash: '',
      href: 'https://acme.example/',
      origin: 'https://acme.example',
      assign() {},
    },
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    innerWidth: 1280,
    outerWidth: 1280,
    outerHeight: 800,
    screenX: 0,
    screenY: 0,
    open: () => null,
  };

  const ctx = {
    window: win,
    document: {
      referrer: '',
      documentElement: html,
      body: { appendChild() {} },
      getElementById: () => null,
      addEventListener() {},
      createElement: (tag) => {
        const node = { tag, style: {}, setAttribute() {} };
        if (tag === 'iframe' && !frame) {
          frame = node;
          node.contentWindow = { postMessage: (msg) => posted.push(msg) };
        }
        return node;
      },
      currentScript: { src: WIDGET_ORIGIN + '/widget/v1/embed.js' },
      getElementsByTagName: () => [],
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    history: { replaceState() {} },
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
    MutationObserver: class {
      constructor(cb) {
        this.cb = cb;
        observers.push(this);
      }
      observe(target, opts) {
        this.target = target;
        this.opts = opts;
      }
    },
    URL,
    URLSearchParams,
    setTimeout,
    setInterval: () => 0,
    clearInterval() {},
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'embed.js' });

  return {
    get src() {
      return frame?.src ?? '';
    },
    observers,
    posted,
    html,
    ready() {
      for (const fn of listeners.message ?? []) fn({ origin: WIDGET_ORIGIN, data: { type: 'ivy:ready' } });
    },
  };
}

test('D3-1 a page language read from <html lang> is marked lang_src=doc', () => {
  const page = load({ lang: 'ko' });
  assert.match(page.src, /[?&]locale=ko(&|$)/);
  assert.match(page.src, /[?&]lang_src=doc(&|$)/);
  assert.doesNotMatch(page.src, /host_locale=1/);
});

test('D3-2 a language chosen in config is the host choice, not a doc reading', () => {
  const page = load({ lang: 'ko', config: { locale: 'vi' } });
  assert.match(page.src, /[?&]locale=vi(&|$)/);
  assert.match(page.src, /host_locale=1/);
  assert.doesNotMatch(page.src, /lang_src=doc/);
  // That host owns the language through setLocale(); nothing to watch.
  assert.equal(page.observers.length, 0);
});

test('D3-3 no <html lang> → no doc marker (the guess stays a guess)', () => {
  const page = load({ lang: '' });
  assert.doesNotMatch(page.src, /lang_src=doc/);
});

test('D3-4 an SPA language switch is forwarded as a doc-sourced locale command', () => {
  const page = load({ lang: 'ko' });
  assert.equal(page.observers.length, 1);
  assert.deepEqual([...page.observers[0].opts.attributeFilter], ['lang']);
  page.ready();

  page.html.lang = 'en-US';
  page.observers[0].cb();
  page.observers[0].cb(); // same value again — not re-sent

  const locales = page.posted.filter((m) => m.action === 'locale');
  assert.equal(locales.length, 1);
  assert.equal(locales[0].locale, 'en');
  assert.equal(locales[0].source, 'doc');
});
