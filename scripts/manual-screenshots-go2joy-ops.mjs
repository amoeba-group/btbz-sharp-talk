#!/usr/bin/env node
/**
 * Go2Joy operations manual — Vietnamese console screenshots (PLN-261012 SG-85, stream w3b).
 *
 * Seeds FICTIONAL sample data into a SCRATCH environment and captures the real Vietnamese console.
 * Nothing here touches product code; everything goes through the same HTTP API the console and the
 * widget use, except the few things the API cannot produce on purpose (backdating a wait, lapsing
 * signed claims, a stale presence heartbeat) which are SQL on the scratch database.
 *
 *   node scripts/manual-screenshots-go2joy-ops.mjs prep [step,step,...]   labels,users,settings,kb,region,conversations,backdate,final
 *   node scripts/manual-screenshots-go2joy-ops.mjs shoot [name,name,...]  the screenshots (stage() first: waits, heartbeats, alerts)
 *   node scripts/manual-screenshots-go2joy-ops.mjs experiments            behaviour probes + 4 extra shots (duty-toggle-off,
 *                                                                          reroute-after, alarm-rerouted, alarm-unclaimed)
 *
 * Re-runnable: every prep step skips what exists. `prep conversations --fresh` empties the conversation tables of the
 * scratch DB and rebuilds the six sample conversations. Run `prep` once, then `shoot`, then `experiments` (the last one
 * creates throwaway conversations and deletes them again). Order matters only for waits and heartbeats, which
 * shoot/experiments refresh themselves. Set OBSERVED_OUT=<file.json> to keep the text each shot captured and the
 * experiment findings (default: the OS temp dir).
 *
 * What is SQL and why: `escalated_at` (a wait cannot be aged through the API), `sessions.identity_claims.verifiedAt`
 * (signed claims only ever get "now"), `agent_profiles.last_seen` (a stale heartbeat), the demo users' password hash
 * (accept-invite refuses the development default password), and the stub AI's English reply text, which is replaced
 * by sample Vietnamese text. Nothing else.
 *
 * Environment (defaults match the w3b scratch stack):
 *   WEB_URL     http://localhost:5176            console (Vite) built against the scratch API
 *   API_URL     http://localhost:3036/api/v1     scratch API
 *   DB_*        127.0.0.1:3316 / scratch_w3b     MUST be a scratch_* database — the script refuses anything else
 *   DEMO_PASSWORD  the seed's local development default password (apps/api/src/database/seed-identity.ts)
 *   PLAYWRIGHT_MODULE  path of an installed playwright package
 *
 * Output: apps/web/public/manual/img/go2joy-ops-<name>.vi.jpg (never touches files without that prefix).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const requireHere = createRequire(import.meta.url);
const { chromium } = requireHere(process.env.PLAYWRIGHT_MODULE || 'C:/Github/Work/node_modules/playwright');
const mysql = createRequire(path.join(ROOT, 'apps/api/package.json'))('mysql2/promise');

const WEB = process.env.WEB_URL || 'http://localhost:5176';
const API = process.env.API_URL || 'http://localhost:3036/api/v1';
const TENANT_SLUG = 'go2joy';
const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3316),
  user: process.env.DB_USER || 'sharptalk',
  password: process.env.DB_PASSWORD || 'sharptalk_dev_pw',
  database: process.env.DB_NAME || 'scratch_w3b',
};
if (!DB.database.startsWith('scratch_')) throw new Error(`refusing to run against database "${DB.database}" — scratch_* only`);
// Local development default (seed-identity.ts): every seeded and invited demo account uses it.
const PW = process.env.DEMO_PASSWORD || 'amb2026!@';
const OUT = path.join(ROOT, 'apps/web/public/manual/img');
const PREFIX = 'go2joy-ops-';
const VIEWPORT = { width: 1440, height: 900 };
const TZ = 'Asia/Ho_Chi_Minh';
const SHOP_DOMAIN = 'app.go2joy.vn';
const PARENT_ORIGIN = 'https://hotel-admin.go2joy.example';
const MASTER = 'master@go2joy.example';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Sample data (all fictional; *.example addresses, hotels marked "(demo)")
// ---------------------------------------------------------------------------------------------
const HOTELS = [
  { sn: '91001', code: 'HN-0001', name: 'Khách sạn Sao Mai (demo)', province: 'Hà Nội' },
  { sn: '91002', code: 'DN-0001', name: 'Khách sạn Biển Xanh (demo)', province: 'Đà Nẵng' },
  // "Tp Quy Nhơn" is deliberately NOT in the region table: it shows the "?" badge.
  { sn: '91003', code: 'QN-0001', name: 'Nhà nghỉ Hoa Sữa (demo)', province: 'Tp Quy Nhơn' },
  { sn: '91004', code: 'HCM-0001', name: 'Khách sạn Cửa Sông (demo)', province: 'TP.HCM' },
];
// In the pilot list but never chatting: they are what the "silent hotels" list shows.
const SILENT_PILOT = [
  { sn: '91005', note: 'Khách sạn Đồi Thông (demo)' },
  { sn: '91006', note: 'Nhà nghỉ Bến Phà (demo)' },
];
const LABELS = [
  { code: 'consult', name: 'CS (Hỗ trợ khách hàng)' },
  { code: 'sales_admin', name: 'SA (Sales Admin)' },
  { code: 'accounting', name: 'Kế toán' },
  { code: 'operations', name: 'Vận hành' },
];
const STAFF = [
  { email: 'lan.cs@go2joy.example', rank: 'staff', labels: ['consult'], region: 'south', duty: 'fresh' },
  { email: 'minh.cs@go2joy.example', rank: 'staff', labels: ['consult'], region: 'north', duty: 'off' },
  { email: 'huong.sa@go2joy.example', rank: 'staff', labels: ['sales_admin'], region: 'south', duty: 'fresh' },
  { email: 'nam.sa@go2joy.example', rank: 'manager', labels: ['sales_admin', 'consult'], region: '', duty: 'stale' },
  { email: 'tuan.staff@go2joy.example', rank: 'staff', labels: ['accounting'], region: '', duty: 'off' },
];
const OFF_HOURS_EMAIL = 'cs-offhours@go2joy.example';
const HOURS_WIDE = { timezone: TZ, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', breaks: [] };
const HOURS_FINAL = { timezone: TZ, days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30', breaks: [] };
// The Business team keeps shorter hours of its own so the per-team hours block has something to show.
const HOURS_BUSINESS_FINAL = { timezone: TZ, days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00' }] };

const KB_CATEGORIES = [
  { name: 'Đăng nhập & đăng ký đối tác', access: 'public' },
  { name: 'Chính sách hủy phòng', access: 'partner' },
  { name: 'Đối soát & tài khoản ngân hàng', access: 'manager' },
];
const KB_DOCS = [
  { category: 'Đăng nhập & đăng ký đối tác', ui_version: 'v0.12.0', title: 'Cách đăng nhập Hotel Admin lần đầu',
    content: 'Để đăng nhập Hotel Admin lần đầu, hãy dùng email đối tác đã đăng ký với Go2Joy (demo). Nếu chưa có tài khoản, chọn "Đăng ký đối tác" và điền thông tin khách sạn. Sau khi được duyệt, bạn sẽ nhận email mời đặt mật khẩu.' },
  { category: 'Đăng nhập & đăng ký đối tác', ui_version: 'v0.12.0', title: 'Quên mật khẩu đăng nhập đối tác',
    content: 'Chọn "Quên mật khẩu" ở màn hình đăng nhập, nhập email đối tác và làm theo liên kết trong email. Liên kết có hiệu lực trong 30 phút. Nếu không nhận được email, kiểm tra thư mục spam rồi liên hệ bộ phận hỗ trợ.' },
  { category: 'Đăng nhập & đăng ký đối tác', ui_version: '', title: 'Thêm lễ tân vào khách sạn',
    content: 'Quản lý khách sạn có thể mời lễ tân tại mục Nhân viên. Lễ tân chỉ xem được đặt phòng của khách sạn mình, không xem được đối soát.' },
  { category: 'Chính sách hủy phòng', ui_version: 'v0.12.0', title: 'Hủy phòng miễn phí trước 24 giờ',
    content: 'Đặt phòng có thể hủy miễn phí nếu thực hiện trước giờ nhận phòng 24 giờ. Sau mốc này, khách sạn có thể thu phí đêm đầu tiên theo chính sách đã công bố trên trang đặt phòng.' },
  { category: 'Chính sách hủy phòng', ui_version: 'v0.9.2', title: 'Hủy phòng theo giờ (giao diện cũ)',
    content: 'Với đặt phòng theo giờ, nút "Hủy" nằm ở màn hình chi tiết đặt phòng (giao diện cũ). Đặt phòng theo giờ chỉ được hủy trước giờ nhận phòng 2 tiếng.' },
  { category: 'Chính sách hủy phòng', ui_version: 'v0.12.0', title: 'Khách không đến (no-show)',
    content: 'Khi khách không đến, đánh dấu "Không đến" trong chi tiết đặt phòng trước 12:00 ngày hôm sau để hệ thống ghi nhận và tính đối soát đúng.' },
  { category: 'Đối soát & tài khoản ngân hàng', ui_version: 'v0.12.0', title: 'Chu kỳ đối soát hằng tuần',
    content: 'Go2Joy (demo) đối soát vào thứ Hai hằng tuần cho các đặt phòng đã hoàn tất của tuần trước. Quản lý có thể tải bảng đối soát ở mục Tài chính.' },
  { category: 'Đối soát & tài khoản ngân hàng', ui_version: 'v0.12.0', title: 'Đổi tài khoản ngân hàng nhận tiền',
    content: 'Chỉ quản lý mới đổi được tài khoản ngân hàng nhận tiền. Gửi yêu cầu kèm giấy xác nhận của ngân hàng; thay đổi có hiệu lực sau khi được duyệt.' },
];

// ---------------------------------------------------------------------------------------------
// HTTP / DB helpers
// ---------------------------------------------------------------------------------------------
async function api(pathname, { method = 'GET', token, body, headers } = {}) {
  const res = await fetch(API + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.status < 300, ...json };
}
/** Like api() but throws with the API error code on a non-2xx answer. */
async function must(label, pathname, opts) {
  const r = await api(pathname, opts);
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status} ${r.error?.code ?? ''} ${r.error?.message ?? JSON.stringify(r).slice(0, 200)}`);
  return r.data;
}
async function login(email, tenantSlug = TENANT_SLUG) {
  const r = await api('/auth/user/login', { method: 'POST', body: { email, password: PW, tenant_slug: tenantSlug } });
  if (!r.data?.accessToken) throw new Error(`login ${email}: HTTP ${r.status} ${r.error?.code ?? ''}`);
  return r.data.accessToken;
}
async function adminLogin(email = 'admin@go2joy.example') {
  const r = await api('/auth/admin/login', { method: 'POST', body: { email, password: PW } });
  if (!r.data?.accessToken) throw new Error(`admin login ${email}: HTTP ${r.status} ${r.error?.code ?? ''}`);
  return r.data.accessToken;
}
async function db(fn) {
  // timezone 'Z' = the API's own TypeORM setting (typeorm.config.ts): DATETIME values are UTC wall-clock.
  const c = await mysql.createConnection({ ...DB, charset: 'utf8mb4', timezone: 'Z' });
  try { return await fn(c); } finally { await c.end(); }
}
/** A JS Date round-trips exactly because db() uses the API's timezone convention. */
const minutesAgo = (m) => new Date(Date.now() - m * 60_000);

// ---------------------------------------------------------------------------------------------
// PREP
// ---------------------------------------------------------------------------------------------
async function stepLabels() {
  const tok = await login(MASTER);
  const rows = await must('job-labels', '/job-labels', { token: tok });
  for (const want of LABELS) {
    const row = rows.find((r) => r.code === want.code);
    if (!row) { log('label missing', want.code); continue; }
    if (row.name === want.name) continue;
    await must('rename label', `/job-labels/${row.id}`, { method: 'PATCH', token: tok, body: { name: want.name } });
    log('label renamed', want.code, '->', want.name);
  }
}

async function stepUsers() {
  const tok = await login(MASTER);
  const list = await must('users', '/users?page=1&size=100', { token: tok });
  const existing = new Map((list.items ?? list).map((u) => [u.email, u]));
  for (const s of STAFF) {
    if (existing.has(s.email)) { log('user exists', s.email); continue; }
    const inv = await must('invite', '/users/invite', {
      method: 'POST', token: tok,
      body: { email: s.email, rank: s.rank, label_codes: s.labels, ...(s.region ? { region: s.region } : {}) },
    });
    // The invitation flow is the real one: try to accept it. The seed's development default password is
    // refused by the password policy (E5003), so the fallback below copies the master's hash instead.
    const acc = await api('/users/accept-invite', { method: 'POST', body: { token: inv.invitationToken, new_password: PW } });
    log('user invited', s.email, 'accept ->', acc.status, acc.error?.code ?? '');
  }
  // Scratch DB only: activate the invited demo accounts with the master's (development default) password
  // hash and clear must_change_password, so no screenshot starts with a forced password dialog.
  await db(async (c) => {
    await c.query("UPDATE users u JOIN users m ON m.email = ? AND m.tenant_id = 1 SET u.password_hash = m.password_hash WHERE u.tenant_id = 1 AND u.email LIKE '%@go2joy.example'", [MASTER]);
    await c.query("UPDATE invitations SET status = 'accepted' WHERE tenant_id = 1 AND status = 'pending'");
    await c.query("UPDATE users SET status = 'active', must_change_password = 0 WHERE tenant_id = 1 AND email LIKE '%@go2joy.example' AND status = 'invited'");
    await c.query("UPDATE users SET must_change_password = 0 WHERE tenant_id = 1 AND email LIKE '%@go2joy.example'");
  });
}

/** The whole handoff config, rebuilt on top of whatever the console already stored. */
function handoffConfig(stored, { hours, businessHours, assignees, regionEnabled }) {
  const base = { ...(stored ?? {}) };
  delete base.businessHours;
  const handoff = {
    ...base,
    assigneeUserIds: assignees ?? base.assigneeUserIds ?? [],
    businessHours: hours,
    offHours: { ...(base.offHours ?? {}), email: OFF_HOURS_EMAIL },
    unclaimedAlerts: true,
    sla: base.sla ?? { normalHours: 24, urgentHours: 4 },
    teamRouting: {
      enabled: true,
      prompt: {},
      options: [
        { id: 'cs', jobLabel: 'consult', label: {}, businessHours: undefined },
        { id: 'business', jobLabel: 'sales_admin', label: {}, ...(businessHours ? { businessHours } : {}) },
      ],
    },
  };
  if (regionEnabled !== undefined) {
    handoff.regionRouting = { ...(base.regionRouting ?? { categories: [] }), enabled: regionEnabled };
  }
  return handoff;
}

async function putHandoff(opts) {
  const tok = await login(MASTER);
  const cfg = await must('ai-config', '/ai-config', { token: tok });
  const handoff = handoffConfig(cfg.handoffConfig, opts);
  await must('put ai-config', '/ai-config', { method: 'PUT', token: tok, body: { handoff_config: handoff, note: 'manual screenshots (demo)' } });
}

/** Region routing + province preset through the real console (the preset only fills the form, then Save). */
async function stepRegionPreset() {
  await putHandoff({ hours: HOURS_WIDE, regionEnabled: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await consoleLogin(page, MASTER);
    await page.goto(`${WEB}/settings/basic`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const present = await page.getByRole('button', { name: /Nạp bộ tỉnh Việt Nam/ }).first();
    await present.scrollIntoViewIfNeeded();
    page.once('dialog', (d) => d.accept());
    await present.click();
    await page.waitForTimeout(500);
    log('preset toast:', JSON.stringify(await page.evaluate(() => window.__toasts ?? [])));
    // Save sits at the bottom of the same card.
    await page.getByRole('button', { name: /^Lưu$/ }).last().click();
    await page.waitForTimeout(1200);
    log('preset saved; toasts:', JSON.stringify(await page.evaluate(() => window.__toasts ?? [])));
    await ctx.close();
  } finally { await browser.close(); }
  await stepFinal(); // the hours above were only for the preset step
}

async function stepSettings() {
  const tok = await login(MASTER);
  // Default AI agent: login guidance for visitors without a signed login.
  const agents = await must('agents', '/ai-agents', { token: tok });
  const def = (agents.items ?? agents).find((a) => a.isDefault || a.code === 'default') ?? (agents.items ?? agents)[0];
  await must('guest policy', `/ai-agents/${def.id}`, { method: 'PATCH', token: tok, body: { guest_policy: 'login_guidance' } });
  // Reference UI version + "append a caveat" mode.
  await must('kb version policy', '/ai-config', { method: 'PUT', token: tok, body: { kb_version_policy: { referenceVersion: 'v0.12.0', onMismatch: 'caveat' }, note: 'manual screenshots (demo)' } });
  // Pilot list: the four chatting hotels plus two that never chat; guests allowed, others hidden.
  await must('pilot access', '/tenants/me/pilot', { method: 'PUT', token: tok, body: { enabled: true, guest_allowed: true, non_pilot: 'hide' } });
  const have = new Set(((await must('pilot hotels', '/tenants/me/pilot/hotels?size=100', { token: tok })).items ?? []).map((h) => h.hotelSn));
  for (const h of [...HOTELS.map((x) => ({ sn: x.sn, note: x.name })), ...SILENT_PILOT]) {
    if (have.has(h.sn)) continue;
    await must('pilot add', '/tenants/me/pilot/hotels', { method: 'POST', token: tok, body: { hotel_sn: h.sn, note: h.note } });
  }
  // Partner data lookup (mock mode: PARTNER_DATA_ENABLED=1 on the API).
  await must('partner data', '/partner-data/settings', { method: 'PUT', token: tok, body: { enabled: true } });
  // Privacy notice: Vietnam PDPL profile with the controller line filled in (the draft wording ships with [[placeholders]]).
  // Every language the notice can be shown in needs the line, or the console keeps warning about the other four
  // (they fall back to the EN profile text, which still ships with the [[...]] markers).
  const controller = {
    VI: 'Bên kiểm soát dữ liệu: Go2Joy (demo) — liên hệ dpo@go2joy.example',
    EN: 'Data controller: Go2Joy (demo) — contact dpo@go2joy.example',
    ES: 'Responsable del tratamiento: Go2Joy (demo) — contacto: dpo@go2joy.example',
    KO: '개인정보 처리 책임자: Go2Joy (데모) — 문의: dpo@go2joy.example',
    JA: 'データ管理者：Go2Joy（デモ）— お問い合わせ：dpo@go2joy.example',
    ZH: '数据控制方：Go2Joy（演示）— 联系方式：dpo@go2joy.example',
  };
  await must('privacy notice', '/tenants/privacy-notice', {
    method: 'PATCH', token: tok,
    body: { privacy_profile: 'vn_pdpl', privacy_policy_url: 'https://hotel-admin.go2joy.example/privacy', privacy_notice_copy: Object.fromEntries(Object.entries(controller).map(([lang, line]) => [lang, { controller: line }])) },
  });
  // Embed: allowed origin for the host app (the signing secret is rotated when conversations are created).
  await must('embed origins', '/tenants/embed-origins', { method: 'PATCH', token: tok, body: { origins: [PARENT_ORIGIN] } });
  log('settings done (agent', def.id, ')');
}

async function stepKb() {
  const tok = await login(MASTER);
  const cats = await must('categories', '/knowledge/categories', { token: tok });
  const byName = new Map((cats.items ?? cats).map((c) => [c.name, c]));
  for (const c of KB_CATEGORIES) {
    let row = byName.get(c.name);
    if (!row) row = await must('create category', '/knowledge/categories', { method: 'POST', token: tok, body: { name: c.name } });
    await must('category access', `/knowledge/categories/${row.id}/access`, { method: 'PUT', token: tok, body: { access: c.access } });
  }
  const docs = await must('documents', '/knowledge/documents?page=1&size=100', { token: tok });
  const haveTitle = new Set((docs.items ?? docs).map((d) => d.title));
  for (const d of KB_DOCS) {
    if (haveTitle.has(d.title)) continue;
    const r = await api('/knowledge/documents', { method: 'POST', token: tok, body: { category: d.category, title: d.title, content: d.content, ...(d.ui_version ? { ui_version: d.ui_version } : {}) } });
    log('doc', d.title, '->', r.status, r.error?.code ?? '');
  }
}

/** Duty states: 'fresh' on duty and seen now, 'stale' on duty but silent for a while, 'off'. */
async function stepPresence() {
  for (const s of STAFF) {
    const tok = await login(s.email);
    if (s.duty === 'off') { await api('/agent/profile', { method: 'PUT', token: tok, body: { status: 'offline' } }); continue; }
    await must('duty on', '/agent/profile', { method: 'PUT', token: tok, body: { status: 'online', languages: 'vi', max_concurrent: 3 } });
  }
  await refreshPresence();
}
/** Keep the "fresh" ones fresh (the TTL is short) and the "stale" one silent. */
async function refreshPresence() {
  await db(async (c) => {
    for (const s of STAFF) {
      const [[u]] = await c.query('SELECT id FROM users WHERE tenant_id = 1 AND email = ?', [s.email]);
      if (!u) continue;
      if (s.duty === 'fresh') await c.query('UPDATE agent_profiles SET last_seen = ? WHERE user_id = ?', [new Date(), u.id]);
      if (s.duty === 'stale') await c.query('UPDATE agent_profiles SET last_seen = ? WHERE user_id = ?', [minutesAgo(12), u.id]);
    }
  });
}

// ---- partner conversations through the real embed / widget API --------------------------------
let embedSecret = null;
async function rotateSecret() {
  const tok = await login(MASTER);
  embedSecret = (await must('rotate secret', '/tenants/embed-secret/rotate', { method: 'POST', token: tok })).secret;
}
const sign = (userId, hotelSn, role, iat, province) =>
  crypto.createHmac('sha256', embedSecret).update(`${userId}|${hotelSn}|${role}|${iat}${province ? `|${province}` : ''}`).digest('hex');

/** ensure -> identify (v2, signed) -> consent -> messages. Returns the live session token + conversation id. */
async function partnerSession({ userId, hotel, role, name, messages }) {
  const ens = await must('ensure', '/session/ensure', { method: 'POST', body: { locale: 'vi', shop_domain: SHOP_DOMAIN, parent_origin: PARENT_ORIGIN } });
  const iat = Math.floor(Date.now() / 1000);
  const idn = await must('identify', '/public/embed/identify', {
    method: 'POST',
    body: {
      session_token: ens.sessionToken, user_id: userId, hash: sign(userId, hotel.sn, role, iat, hotel.province), name,
      claims: { hotel_sn: hotel.sn, role, iat, hotel_name: hotel.name, hotel_code: hotel.code, province: hotel.province },
    },
  });
  const token = idn.sessionToken;
  await must('consent', '/session/consent', { method: 'POST', body: { session_token: token, granted: true } });
  let conversationId = null;
  let last = null;
  for (const m of messages) {
    last = await must('message', '/chat/message', { method: 'POST', body: { session_token: token, message: m } });
    conversationId = last.conversationId ?? conversationId;
  }
  return { token, conversationId, last };
}
/** "I want a person" -> team chips -> the chip. */
async function escalateTo(session, supportType) {
  const first = await must('escalate', '/chat/escalate', { method: 'POST', body: { session_token: session.token, conversation_id: Number(session.conversationId) } });
  if (first.choose) {
    return must('escalate team', '/chat/escalate', { method: 'POST', body: { session_token: session.token, conversation_id: Number(session.conversationId), support_type: supportType } });
  }
  return first;
}

/**
 * The six sample conversations. \`aiReply\` replaces the stub AI adapter's English boilerplate in the stored
 * thread (the stub has no Vietnamese): the question, the escalation and every state flag stay real.
 */
const CONVERSATIONS = [
  // 1. Đà Nẵng manager asks for Business support; waiting a long time (red "Chờ").
  { key: 'danang-business', hotel: 1, role: 'manager', userId: 'demo-mgr-91002', name: 'Quản lý Biển Xanh', team: 'business', waitMin: 12,
    messages: ['Chào bạn, hợp đồng đối tác của khách sạn mình sắp hết hạn, cần gia hạn thì làm thế nào?'],
    aiReply: 'Mình chưa tìm thấy hướng dẫn gia hạn hợp đồng đối tác trong kho tri thức. Nếu bạn cần, mình có thể kết nối bạn với nhân viên hỗ trợ.' },
  // 2. Hà Nội manager picks CS.
  { key: 'hanoi-cs', hotel: 0, role: 'manager', userId: 'demo-mgr-91001', name: 'Quản lý Sao Mai', team: 'cs', waitMin: 3,
    messages: ['Mình không đăng nhập được Hotel Admin sau khi đổi mật khẩu.'],
    aiReply: 'Bạn thử chọn "Quên mật khẩu" ở màn hình đăng nhập, nhập email đối tác và làm theo liên kết trong email (có hiệu lực trong 30 phút). Nếu vẫn chưa đăng nhập được, mình có thể kết nối bạn với nhân viên hỗ trợ.' },
  // 3. Quy Nhơn receptionist: province is not in the region table -> "?".
  { key: 'quynhon-cs', hotel: 2, role: 'receptionist', userId: 'demo-rec-91003', name: 'Lễ tân Hoa Sữa', team: 'cs', waitMin: 7,
    messages: ['Khách báo hủy phòng nhưng hệ thống vẫn hiện đặt phòng, mình xử lý sao?'],
    aiReply: 'Đặt phòng đã hủy có thể vẫn hiển thị trong danh sách cho đến khi hệ thống đồng bộ. Nếu sau ít phút vẫn chưa cập nhật, mình có thể kết nối bạn với nhân viên hỗ trợ.' },
  // 4. Cửa Sông receptionist whose signed login has lapsed (backdated below).
  { key: 'cuasong-expired', hotel: 3, role: 'receptionist', userId: 'demo-rec-91004', name: 'Lễ tân Cửa Sông', team: 'cs', waitMin: 2, lapse: true,
    messages: ['Mình cần gặp nhân viên hỗ trợ về đặt phòng của khách hôm nay.'],
    aiReply: 'Mình có thể kết nối bạn với nhân viên hỗ trợ. Bạn cho mình biết thêm về đặt phòng của khách để nhân viên xử lý nhanh hơn nhé.' },
  // 5. Held by an agent (status "Nhân viên xử lý").
  { key: 'hanoi-held', hotel: 0, role: 'receptionist', userId: 'demo-rec-91001', name: 'Lễ tân Sao Mai', team: 'cs', waitMin: 20, heldBy: 'lan.cs@go2joy.example',
    messages: ['Cho mình hỏi cách xuất bảng đặt phòng trong ngày.'],
    aiReply: 'Bạn có thể xuất bảng đặt phòng trong ngày ở mục Đặt phòng > Xuất báo cáo. Nếu cần thêm trợ giúp, mình có thể kết nối bạn với nhân viên hỗ trợ.',
    agentReply: 'Chào bạn, mình là Lan bên Go2Joy (demo). Bạn vào Đặt phòng > Xuất báo cáo, chọn ngày hôm nay rồi bấm Tải về nhé.' },
  // 6. Still with the AI.
  { key: 'cuasong-ai', hotel: 3, role: 'manager', userId: 'demo-mgr-91004', name: 'Quản lý Cửa Sông', team: null,
    messages: ['Làm sao để đăng nhập Hotel Admin lần đầu?'],
    aiReply: 'Để đăng nhập Hotel Admin lần đầu, hãy dùng email đối tác đã đăng ký với Go2Joy (demo). Nếu chưa có tài khoản, chọn "Đăng ký đối tác" và điền thông tin khách sạn. Sau khi được duyệt, bạn sẽ nhận email mời đặt mật khẩu.' },
];

async function createConversation(spec) {
  const hotel = HOTELS[spec.hotel];
  const s = await partnerSession({ userId: spec.userId, hotel, role: spec.role, name: spec.name, messages: spec.messages });
  if (spec.team) await escalateTo(s, spec.team);
  return s;
}

/** Tables that only exist because of conversations/sessions (scratch DB: safe to empty). */
async function resetConversations() {
  await db(async (c) => {
    const [cols] = await c.query(
      "SELECT DISTINCT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name IN ('conversation_id', 'session_id')",
    );
    const tables = new Set([...cols.map((r) => r.t), 'conversations', 'sessions', 'customers', 'agent_alerts', 'messages']);
    await c.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of tables) {
      if (/^(users|tenants|kb_|tenant_|job_|ai_)/.test(t)) continue;
      await c.query('TRUNCATE TABLE ??', [t]);
    }
    await c.query('SET FOREIGN_KEY_CHECKS = 1');
    log('conversation tables emptied:', [...tables].filter((t) => !/^(users|tenants|kb_|tenant_|job_|ai_)/.test(t)).join(', '));
  });
}

/**
 * Waits and lapsed claims are what only SQL can produce: the API stamps "now". Re-run before every shoot
 * so "Chờ mm:ss" is the designed value, not whatever has accumulated since prep.
 */
async function backdate() {
  await db(async (c) => {
    for (const spec of CONVERSATIONS) {
      const hotel = HOTELS[spec.hotel];
      const [[row]] = await c.query('SELECT id FROM conversations WHERE hotel_sn = ? AND actor_role = ? ORDER BY id DESC LIMIT 1', [hotel.sn, spec.role]);
      if (!row) continue;
      if (spec.waitMin) {
        // unclaimed_pages at the cap keeps the 30-second sweeper from raising extra "chưa ai nhận" alarms mid-shoot.
        await c.query('UPDATE conversations SET escalated_at = ?, unclaimed_pages = 20, unclaimed_paged_at = ? WHERE id = ? AND status = ?', [minutesAgo(spec.waitMin), new Date(), row.id, 'waiting']);
      }
      if (spec.lapse) {
        await c.query(
          "UPDATE sessions s JOIN conversations cv ON cv.session_id = s.id SET s.identity_claims = JSON_SET(s.identity_claims, '$.verifiedAt', ?) WHERE cv.id = ?",
          [new Date(Date.now() - 9 * 3600_000).toISOString(), row.id],
        );
      }
    }
  });
  await redisCmd('FLUSHDB'); // session rows are cached for a moment; the lapse must be visible at once
}

/** Minimal RESP client: the scratch Redis (own container) needs nothing else from us. */
async function redisCmd(command) {
  const port = Number(process.env.REDIS_PORT || 6396);
  const net = await import('node:net');
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => { sock.write(command + '\r\n'); });
    sock.once('data', (d) => { sock.end(); resolve(String(d).trim()); });
    sock.once('error', () => resolve(null));
  });
}

async function stepConversations() {
  const have = await db(async (c) => (await c.query("SELECT COUNT(*) AS n FROM conversations WHERE hotel_sn IN ('91001','91002','91003','91004')"))[0][0].n);
  if (have > 0) {
    if (!process.argv.includes('--fresh')) { log(`conversations already seeded (${have}); pass --fresh to rebuild them`); return; }
    await resetConversations();
  }
  // Inside hours, whatever time it is when this runs: off hours the thread would wait on an email reply instead.
  await putHandoff({ hours: HOURS_WIDE, businessHours: undefined, regionEnabled: true });
  await rotateSecret();
  await stepPresence(); // on-duty agents are "present" only while the heartbeat is fresh
  const made = [];
  for (const spec of CONVERSATIONS) {
    await refreshPresence();
    const s = await createConversation(spec);
    log('conversation', spec.key, '->', s.conversationId);
    made.push({ spec, ...s });
  }
  // The stub AI adapter answers in English boilerplate: store the sample Vietnamese answer instead (data only).
  await db(async (c) => {
    for (const m of made) await c.query("UPDATE messages SET body = ? WHERE conversation_id = ? AND sender_type = 'ai'", [m.spec.aiReply, m.conversationId]);
  });
  // Held by an agent: the real accept call, then a real (moderated) agent reply, as that agent.
  for (const m of made.filter((x) => x.spec.heldBy)) {
    const tok = await login(m.spec.heldBy);
    await must('accept', `/agent/conversations/${m.conversationId}/accept`, { method: 'POST', token: tok });
    if (m.spec.agentReply) await must('agent reply', `/agent/conversations/${m.conversationId}/message`, { method: 'POST', token: tok, body: { body: m.spec.agentReply } });
    log('accepted by', m.spec.heldBy, '->', m.conversationId);
  }
  await backdate();
  await stepFinal(); // back to the hours the manual describes
}

async function stepFinal() {
  // The configuration the manual describes: Mon-Fri 08:30-17:30 (Business: its own shorter hours).
  await putHandoff({ hours: HOURS_FINAL, businessHours: HOURS_BUSINESS_FINAL, regionEnabled: true });
  await refreshPresence();
  log('final handoff config applied');
}

const PREP_STEPS = {
  labels: stepLabels,
  users: stepUsers,
  settings: stepSettings,
  kb: stepKb,
  region: stepRegionPreset,
  conversations: stepConversations,
  backdate,
  final: stepFinal,
};

async function prep(only) {
  const names = only.length ? only : Object.keys(PREP_STEPS);
  for (const n of names) {
    if (!PREP_STEPS[n]) throw new Error(`unknown prep step "${n}" (have: ${Object.keys(PREP_STEPS).join(', ')})`);
    log('== prep', n);
    await PREP_STEPS[n]();
  }
}


// ---------------------------------------------------------------------------------------------
// Browser helpers (shared by prep's console step and shoot)
// ---------------------------------------------------------------------------------------------
async function newContext(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'vi-VN', timezoneId: TZ });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('ivy_lang', 'vi');
      localStorage.setItem('ivy:knowledge:guide-collapsed', '1');
    } catch { /* ignore */ }
    // Toasts vanish after 4 s; keep every text that was ever shown so a run can report the exact wording.
    window.__toasts = [];
    setInterval(() => {
      document.querySelectorAll('div.fixed.bottom-4.right-4 p').forEach((p) => {
        const text = (p.textContent || '').trim();
        if (text && !window.__toasts.includes(text)) window.__toasts.push(text);
      });
    }, 60);
  });
  return ctx;
}
async function consoleLogin(page, email) {
  await page.goto(`${WEB}/user/${TENANT_SLUG}`, { waitUntil: 'networkidle' });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PW);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/user/'), { timeout: 15000 });
  await page.waitForTimeout(800);
}

// ---------------------------------------------------------------------------------------------
// SHOOT
// ---------------------------------------------------------------------------------------------
const OBSERVED_FILE = process.env.OBSERVED_OUT || path.join(os.tmpdir(), 'go2joy-ops-observed.json');
const observed = { shots: {}, findings: {} };
const failures = [];

class ConsoleSession {
  constructor(browser, email) { this.browser = browser; this.email = email; }
  async open() {
    this.ctx = await newContext(this.browser);
    this.page = await this.ctx.newPage();
    await consoleLogin(this.page, this.email);
    return this;
  }
  /** Open a console page; the global alarm modal is dismissed unless `alarm` (its "Bỏ qua" acks the alert). */
  async goto(pathname, { alarm = false, wait = 1500 } = {}) {
    await this.page.goto(WEB + pathname, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(wait);
    if (!alarm) await this.clearAlarm();
  }
  async clearAlarm() {
    for (let i = 0; i < 8; i++) {
      const dlg = this.page.getByRole('dialog').filter({ hasText: 'Chuyển tiếp hội thoại' }).first();
      if (!(await dlg.isVisible().catch(() => false))) return;
      await dlg.getByRole('button', { name: 'Bỏ qua' }).click().catch(() => this.page.keyboard.press('Escape'));
      await this.page.waitForTimeout(500);
    }
  }
  toasts() { return this.page.evaluate(() => window.__toasts ?? []); }
  async close() { await this.ctx.close().catch(() => {}); }
}

async function union(locators) {
  let box = null;
  for (const l of locators) {
    const b = await l.boundingBox();
    if (!b) continue;
    box = box
      ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), right: Math.max(box.right, b.x + b.width), bottom: Math.max(box.bottom, b.y + b.height) }
      : { x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height };
  }
  return box && { x: box.x, y: box.y, width: box.right - box.x, height: box.bottom - box.y };
}

async function writeJpeg(page, name, clip) {
  const file = path.join(OUT, `${PREFIX}${name}.vi.jpg`);
  let buf;
  for (const q of [82, 74, 66, 58, 50]) {
    buf = await page.screenshot({ type: 'jpeg', quality: q, clip });
    if (buf.length <= 250 * 1024) break;
  }
  fs.writeFileSync(file, buf);
  log('shot', name, `${Math.round(buf.length / 1024)} KB`, `${Math.round(clip.width)}x${Math.round(clip.height)}`);
  return file;
}

/**
 * Screenshot the box that holds `locators` (plus padding). Taller than the viewport? The viewport is stretched for
 * the shot (the console is viewport-locked, so that is the only way to see more rows) and restored afterwards.
 */
async function shotBox(page, name, locators, { pad = 12, scroll = true, text = true, viewportHeight = 0 } = {}) {
  const first = locators[0];
  // A viewport-locked list (the live-chat queue) only shows more rows when the viewport itself is taller.
  if (viewportHeight) { await page.setViewportSize({ width: VIEWPORT.width, height: viewportHeight }); await page.waitForTimeout(600); }
  const toTop = async () => {
    if (!scroll) return;
    await first.evaluate((el) => { el.style.scrollMarginTop = '84px'; el.scrollIntoView({ block: 'start' }); }).catch(() => {});
    await page.waitForTimeout(300);
  };
  await toTop();
  let box = await union(locators);
  if (!box) throw new Error(`${name}: nothing to capture`);
  let stretched = !!viewportHeight;
  const need = Math.ceil(box.y + box.height + pad + 12);
  if (need > page.viewportSize().height) {
    stretched = true;
    await page.setViewportSize({ width: VIEWPORT.width, height: need });
    await page.waitForTimeout(500);
    await toTop();
    box = await union(locators);
  }
  const vp = page.viewportSize();
  if (process.env.DEBUG_SHOTS) log('  box', name, JSON.stringify(box), 'viewport', JSON.stringify(vp));
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const clip = { x, y, width: Math.min(vp.width - x, Math.ceil(box.width + 2 * pad)), height: Math.min(vp.height - y, Math.ceil(box.height + 2 * pad)) };
  if (text) {
    const parts = [];
    for (const l of locators) parts.push(await l.innerText().catch(() => ''));
    observed.shots[name] = parts.join('\n').trim();
  }
  await writeJpeg(page, name, clip);
  if (stretched) { await page.setViewportSize(VIEWPORT); await page.waitForTimeout(300); }
}

/** The band between the top of one element and the top (or bottom) of another. */
async function shotBetween(page, name, top, bottom, { pad = 12, includeBottom = false } = {}) {
  const align = async () => { await top.evaluate((el) => { el.style.scrollMarginTop = '84px'; el.scrollIntoView({ block: 'start' }); }).catch(() => {}); await page.waitForTimeout(300); };
  await align();
  let a = await top.boundingBox();
  let b = await bottom.boundingBox();
  let bottomEdge = includeBottom ? b.y + b.height : b.y - 8;
  const need = Math.ceil(bottomEdge + pad + 12);
  let stretched = false;
  if (need > page.viewportSize().height) {
    stretched = true;
    await page.setViewportSize({ width: VIEWPORT.width, height: need });
    await page.waitForTimeout(500);
    await align();
    a = await top.boundingBox();
    b = await bottom.boundingBox();
    bottomEdge = includeBottom ? b.y + b.height : b.y - 8;
  }
  const vp = page.viewportSize();
  const x = Math.max(0, Math.floor(a.x - pad));
  const y = Math.max(0, Math.floor(a.y - pad));
  await writeJpeg(page, name, { x, y, width: Math.min(vp.width - x, Math.ceil(a.width + 2 * pad)), height: Math.min(vp.height - y, Math.ceil(bottomEdge - a.y + 2 * pad)) });
  if (stretched) { await page.setViewportSize(VIEWPORT); await page.waitForTimeout(300); }
}

/** The Card whose own title (h3) is `title`. */
const cardByTitle = (page, title) =>
  page.locator('h3', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().locator('xpath=../..');

async function convId(spec) {
  const hotel = HOTELS[spec.hotel];
  return db(async (c) => (await c.query('SELECT id FROM conversations WHERE hotel_sn = ? AND actor_role = ? ORDER BY id DESC LIMIT 1', [hotel.sn, spec.role]))[0][0]?.id);
}
const specOf = (key) => CONVERSATIONS.find((s) => s.key === key);
const ackAllAlerts = () => db((c) => c.query("UPDATE agent_alerts SET status = 'acked' WHERE status = 'new'"));

/** Everything the shots need to be true right now: waits at their designed value, heartbeats fresh, no stray alarms. */
async function stage() {
  await backdate();
  await refreshPresence();
  await ackAllAlerts();
}

async function shoot(only) {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--lang=vi-VN'] });
  const sessions = new Map();
  // Chrome draws native <input type="time"> from its UI language: vi shows "08:30 SA" (cut off in the narrow field),
  // a 24-hour locale shows "08:30", which is how Vietnamese workstations normally read. Only the hours shots use it.
  let browser24 = null;
  const as = async (email, { clock24 = false } = {}) => {
    const key = (clock24 ? '24|' : '') + email;
    if (!sessions.has(key)) {
      if (clock24 && !browser24) browser24 = await chromium.launch({ channel: 'chrome', headless: true, args: ['--lang=fr-FR'] });
      sessions.set(key, await new ConsoleSession(clock24 ? browser24 : browser, email).open());
    }
    return sessions.get(key);
  };
  const run = async (names, fn) => {
    if (only.length && !names.some((n) => only.includes(n))) return;
    try { await fn(); } catch (e) { failures.push(`${names[0]}: ${e.message.split('\n')[0]}`); log('FAIL', names[0], e.message.split('\n')[0]); }
  };
  const LAN = 'lan.cs@go2joy.example';
  try {
    await stage();

    // ---- Live chat as a south-region CS user ------------------------------------------------
    await run(['livechat-queue'], async () => {
      const s = await as(LAN);
      await s.goto('/live-chat');
      const col = s.page.locator('div.col-span-3').first();
      await shotBox(s.page, 'livechat-queue', [col], { pad: 8 });
    });
    await run(['livechat-queue-all'], async () => {
      const s = await as(LAN);
      await s.goto('/live-chat');
      await s.page.getByLabel('Lọc theo vùng').selectOption('all');
      await s.page.waitForTimeout(1500);
      await shotBox(s.page, 'livechat-queue-all', [s.page.locator('div.col-span-3').first()], { pad: 8, viewportHeight: 1500 });
      await s.page.getByLabel('Lọc theo vùng').selectOption('mine');
    });

    await run(['duty-toggle'], async () => {
      const s = await as(LAN);
      await s.goto('/live-chat');
      const header = s.page.locator('div.mb-6.flex.items-end.justify-between').filter({ has: s.page.getByRole('switch') }).first();
      await shotBox(s.page, 'duty-toggle', [header], { pad: 8 });
    });

    await run(['alarm'], async () => {
      const s = await as(LAN);
      const id = await convId(specOf('cuasong-expired'));
      await db((c) => c.query("UPDATE agent_alerts SET status = 'new' WHERE conversation_id = ? AND reason = 'user_request'", [id]));
      await s.goto('/dashboard', { alarm: true, wait: 800 });
      const dlg = s.page.getByRole('dialog').filter({ hasText: 'Chuyển tiếp hội thoại' }).first();
      await dlg.waitFor({ state: 'visible', timeout: 15000 });
      await s.page.waitForTimeout(500);
      await shotBox(s.page, 'alarm', [dlg], { pad: 6, scroll: false });
      await s.clearAlarm();
    });

    await run(['conversation-header'], async () => {
      const s = await as(LAN);
      await s.goto(`/live-chat?c=${await convId(specOf('danang-business'))}`);
      const header = s.page.locator('div.space-y-2.border-b.border-gray-100.px-4.py-3').first();
      await header.waitFor({ state: 'visible' });
      await shotBox(s.page, 'conversation-header', [header], { pad: 8, scroll: false });
    });

    await run(['expired'], async () => {
      const s = await as(LAN);
      const id = await convId(specOf('cuasong-expired'));
      await s.goto(`/live-chat?c=${id}`);
      const header = s.page.locator('div.space-y-2.border-b.border-gray-100.px-4.py-3').first();
      await header.waitFor({ state: 'visible' });
      await shotBox(s.page, 'expired', [header], { pad: 8, scroll: false });
      const row = s.page.locator('li').filter({ hasText: `Phiên ${id}` }).first();
      await shotBox(s.page, 'expired-row', [row], { pad: 6, scroll: false });
    });

    await run(['reroute'], async () => {
      const s = await as(LAN);
      await s.goto(`/live-chat?c=${await convId(specOf('danang-business'))}`);
      await s.page.getByRole('button', { name: /Chuyển sang/ }).click();
      const dlg = s.page.getByRole('dialog').filter({ hasText: 'Chuyển cuộc trò chuyện' }).first();
      await dlg.waitFor({ state: 'visible' });
      await dlg.getByLabel('Chuyển sang', { exact: true }).selectOption('cs');
      await s.page.waitForTimeout(300);
      await shotBox(s.page, 'reroute', [dlg], { pad: 6, scroll: false });
      await s.page.keyboard.press('Escape');
    });

    // ---- Users (platform view as master) ----------------------------------------------------
    await run(['users'], async () => {
      const s = await as(MASTER);
      await refreshPresence(); // heartbeats are only ~90 s alive: write them right before the page reads them
      await s.goto('/users');
      const table = s.page.locator('table').first();
      await shotBox(s.page, 'users', [table], { pad: 8 });
    });

    // ---- Settings -------------------------------------------------------------------------
    const m = async () => as(MASTER);
    await run(['handoff-team', 'handoff-hours'], async () => {
      const s = await as(MASTER, { clock24: true });
      await s.goto('/settings/basic');
      const card = cardByTitle(s.page, 'Chuyển cho nhân viên');
      const blocks = card.locator('div.space-y-4 > div');
      await shotBox(s.page, 'handoff-hours', [blocks.nth(1), blocks.nth(2), blocks.nth(3)], { pad: 10 });
      const team = blocks.filter({ has: s.page.getByText('Hỏi đội hỗ trợ khi khách yêu cầu gặp nhân viên', { exact: true }) }).first();
      // Open the Business team's own hours.
      await team.locator('details').nth(1).evaluate((d) => { d.open = true; });
      await shotBox(s.page, 'handoff-team', [team], { pad: 10 });
    });
    await run(['handoff-region'], async () => {
      const s = await m();
      await s.goto('/settings/basic');
      const card = cardByTitle(s.page, 'Chuyển cho nhân viên');
      const block = card.locator('div.border-t').filter({ has: s.page.getByText('Chuyển theo vùng của khách sạn', { exact: true }) }).first();
      await block.scrollIntoViewIfNeeded();
      await s.page.getByLabel('Thử một tỉnh', { exact: true }).fill('Đà Nẵng');
      await s.page.waitForTimeout(300);
      await shotBetween(s.page, 'handoff-region', block, s.page.getByTestId('hotel-province-card'), { pad: 10 });
    });
    await run(['hotel-csv'], async () => {
      const s = await m();
      await s.goto('/settings/basic');
      const card = s.page.getByTestId('hotel-province-card');
      await card.scrollIntoViewIfNeeded();
      const csv = 'hotel_sn,province\n91001,Hà Nội\n91002,Đà Nẵng\n91003,Quy Nhơn\n91004,TP.HCM\n91007,Cần Thơ\n';
      await card.locator('input[type="file"]').setInputFiles({ name: 'khach-san-tinh.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
      await card.getByRole('button', { name: 'Xem trước' }).click();
      await s.page.waitForTimeout(1500);
      await shotBox(s.page, 'hotel-csv', [card], { pad: 10 });
    });

    await run(['kb-access'], async () => {
      const s = await m();
      await s.goto('/knowledge');
      const card = s.page.locator('h3, h2').filter({ hasText: /^Danh mục$/ }).first().locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
      await shotBox(s.page, 'kb-access', [card], { pad: 10 });
    });
    await run(['kb-version', 'kb-docs'], async () => {
      const s = await m();
      await s.goto('/ai-setting');
      const card = cardByTitle(s.page, 'Phiên bản giao diện tham chiếu');
      await shotBox(s.page, 'kb-version', [card], { pad: 10 });
      await s.goto('/knowledge');
      // Collapse the sidebar: the document list is a wide table and the title column is squeezed without it.
      await s.page.locator('header button').first().click().catch(() => {});
      await s.page.waitForTimeout(600);
      const table = s.page.locator('table').filter({ hasText: 'Phiên bản giao diện' }).first();
      const box = table.locator('xpath=ancestor::div[contains(@class,"overflow-x-auto")][1]');
      await box.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      await shotBox(s.page, 'kb-docs', [box], { pad: 8 });
    });

    await run(['identity-policy', 'pilot'], async () => {
      const s = await m();
      await s.goto('/settings/widget');
      await shotBox(s.page, 'identity-policy', [cardByTitle(s.page, 'Chính sách đăng nhập có chữ ký (SSO)')], { pad: 10 });
      await shotBox(s.page, 'pilot', [cardByTitle(s.page, 'Phạm vi pilot theo khách sạn')], { pad: 10 });
    });
    await run(['partner-data'], async () => {
      const s = await m();
      await s.goto('/settings/etc');
      await shotBox(s.page, 'partner-data', [cardByTitle(s.page, 'Tra cứu dữ liệu đối tác')], { pad: 10 });
    });
    await run(['privacy-notice'], async () => {
      const s = await m();
      await s.goto('/settings/privacy');
      // The "Ngôn ngữ chỉnh sửa" select opens on Korean (PrivacyNoticePage defaults copyLang to 'KO'); the manual shows
      // the Vietnamese lines, so switch to them before the shot.
      await s.page.locator('select').filter({ has: s.page.locator('option', { hasText: 'Tiếng Việt' }) }).last().selectOption({ label: 'Tiếng Việt' });
      await s.page.waitForTimeout(400);
      // The controller line is filled in for VI and EN (prep "settings"), so no "[[…]]" warning must be left.
      observed.findings.privacyNoticeUnfilledWarningVisible = (await s.page.getByText('vẫn còn chỗ trống dạng').count()) > 0;
      await shotBox(s.page, 'privacy-notice', [cardByTitle(s.page, 'Cài đặt thông báo đồng ý')], { pad: 10 });
    });
    await run(['dsar'], async () => {
      const s = await m();
      await s.goto('/settings/data-requests');
      await s.page.locator('form select').first().selectOption('external_id');
      await s.page.getByPlaceholder('ID người dùng trong hệ thống của bạn').fill('demo-rec-91004');
      await s.page.getByRole('button', { name: 'Tìm kiếm' }).click();
      await s.page.waitForTimeout(1500);
      const result = s.page.locator('table').first();
      await result.waitFor({ state: 'visible' });
      await shotBox(s.page, 'dsar', [cardByTitle(s.page, 'Tìm khách hàng'), cardByTitle(s.page, 'Kết quả khớp')], { pad: 10 });
      await result.getByRole('button', { name: 'Xóa' }).first().click();
      const dlg = s.page.getByRole('dialog').first();
      await dlg.waitFor({ state: 'visible' });
      await shotBox(s.page, 'dsar-erase', [dlg], { pad: 16, scroll: false });
      await s.page.keyboard.press('Escape');
    });
    await run(['stats-pilot'], async () => {
      const s = await m();
      await s.goto('/statistics');
      await s.page.getByRole('button', { name: 'Thí điểm' }).or(s.page.getByRole('tab', { name: 'Thí điểm' })).first().click();
      await s.page.waitForTimeout(2500);
      await s.page.getByRole('button', { name: /Có trong danh sách nhưng chưa chat/ }).click();
      await s.page.waitForTimeout(500);
      const top = s.page.getByText('Kết quả thí điểm', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
      await shotBetween(s.page, 'stats-pilot', top, s.page.locator('table').first(), { pad: 10, includeBottom: true });
    });
  } finally {
    for (const s of sessions.values()) await s.close();
    await browser.close();
    if (browser24) await browser24.close();
    fs.writeFileSync(OBSERVED_FILE, JSON.stringify(observed, null, 1));
    log('observed text written to', OBSERVED_FILE);
    if (failures.length) { log('FAILED SHOTS:'); failures.forEach((f) => log('  -', f)); process.exitCode = 1; }
  }
}

// ---------------------------------------------------------------------------------------------
// EXPERIMENTS — what the console actually does (not screenshots; results go to the observed JSON)
// ---------------------------------------------------------------------------------------------
/** Remove the throwaway conversations an experiment made (scratch DB: rows are deleted, not ended). */
async function deleteConversations(ids) {
  if (!ids.length) return;
  await db(async (c) => {
    const [sessions] = await c.query('SELECT DISTINCT session_id AS s FROM conversations WHERE id IN (?)', [ids]);
    const sessionIds = sessions.map((r) => r.s);
    const [custs] = sessionIds.length ? await c.query('SELECT DISTINCT customer_id AS c FROM sessions WHERE id IN (?)', [sessionIds]) : [[]];
    for (const t of ['agent_alerts', 'assignments', 'messages', 'chat_comments', 'moderation_logs', 'partner_lookup_logs', 'issues', 'cjm_events']) {
      const [[col]] = await c.query("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'conversation_id'", [t]);
      if (col.n) await c.query('DELETE FROM ?? WHERE conversation_id IN (?)', [t, ids]);
    }
    await c.query('DELETE FROM conversations WHERE id IN (?)', [ids]);
    if (sessionIds.length) {
      await c.query('DELETE FROM cjm_events WHERE session_id IN (?)', [sessionIds]).catch(() => {});
      await c.query('DELETE FROM sessions WHERE id IN (?)', [sessionIds]);
      const custIds = custs.map((r) => r.c).filter(Boolean);
      if (custIds.length) await c.query('DELETE FROM customers WHERE id IN (?)', [custIds]);
    }
  });
}

async function experiments() {
  const out = observed.findings;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--lang=vi-VN'] });
  const sessions = [];
  const open = async (email) => { const s = await new ConsoleSession(browser, email).open(); sessions.push(s); return s; };
  const tmpIds = [];
  const LAN = 'lan.cs@go2joy.example';
  const stamp = Date.now();
  const mk = async (n, hotel, role, team, extra = {}) => {
    const s = await createConversation({ key: `tmp-${n}`, hotel, role, userId: `demo-tmp-${n}-${stamp}`, name: 'Thử nghiệm', team, messages: ['Mình cần hỗ trợ (thử nghiệm).'], ...extra });
    tmpIds.push(Number(s.conversationId));
    return s;
  };
  try {
    await stage();
    await rotateSecret();
    const waitingTarget = await convId(specOf('hanoi-cs')); // resolved before any temp conversation exists
    const lanToken = await login(LAN);

    // ---- (2) what the default region filter hides --------------------------------------------
    {
      const rows = (r) => (Array.isArray(r) ? r : (r.items ?? []));
      const brief = (r) => rows(r).map((x) => `#${x.id} ${x.identityClaims?.hotelSn ?? '-'} ${x.status} ${x.supportType ?? '-'}/${x.supportRegion ?? (x.supportRegionHint ? '?' : '-')}`);
      const all = await must('sessions all', '/agent/sessions?status=all&support_region=all', { token: lanToken });
      const mine = await must('sessions mine', '/agent/sessions?status=all&support_region=mine', { token: lanToken });
      const shownIds = new Set(rows(mine).map((x) => x.id));
      out.regionFilter = { agentRegion: 'south', all: brief(all), mine: brief(mine), hiddenByMine: rows(all).filter((x) => !shownIds.has(x.id)).map((x) => `#${x.id} ${x.identityClaims?.hotelSn ?? '-'} ${x.status} ${x.supportType ?? '-'}/${x.supportRegion ?? (x.supportRegionHint ? '?' : '-')}`) };
    }

    // ---- (1) duty switch ------------------------------------------------------------------
    {
      const s = await open(LAN);
      await s.goto('/live-chat');
      const sw = s.page.getByRole('switch');
      out.duty = { initial: await sw.innerText(), checked: await sw.getAttribute('aria-checked') };
      await sw.click();
      await s.page.waitForTimeout(1200);
      out.duty.afterOff = { label: await sw.innerText(), checked: await sw.getAttribute('aria-checked'), toasts: await s.toasts() };
      const header = s.page.locator('div.mb-6.flex.items-end.justify-between').filter({ has: sw }).first();
      await shotBox(s.page, 'duty-toggle-off', [header], { pad: 8, scroll: false });
      // Users page presence cell for lan.cs, as the master sees it.
      const m = await open(MASTER);
      await m.goto('/users');
      const row = m.page.locator('tr').filter({ hasText: LAN }).first();
      out.duty.usersCellWhileOff = (await row.innerText()).replace(/\s+/g, ' ');
      const before = (await s.toasts()).length;
      await sw.click();
      await s.page.waitForTimeout(1200);
      out.duty.afterOn = { label: await sw.innerText(), checked: await sw.getAttribute('aria-checked'), toastsAll: await s.toasts(), newToasts: (await s.toasts()).slice(before) };
      await refreshPresence();
      await m.goto('/users');
      await m.page.waitForTimeout(500);
      out.duty.usersCellWhileOn = (await m.page.locator('tr').filter({ hasText: LAN }).first().innerText()).replace(/\s+/g, ' ');
      await s.close();
      await m.close();
    }

    // ---- (6) a user with only the SA label --------------------------------------------------
    const huong = await open('huong.sa@go2joy.example');
    {
      const errors = [];
      huong.page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, '')}`); });
      await huong.goto('/live-chat');
      out.saOnly = {
        url: huong.page.url(),
        sidebar: (await huong.page.locator('aside, nav').first().innerText()).replace(/\s+/g, ' | '),
        pageHead: (await huong.page.locator('main').first().innerText()).slice(0, 400).replace(/\s+/g, ' | '),
        dutySwitch: await huong.page.getByRole('switch').count(),
        sessionsHeader: await huong.page.getByText(/^Phiên \(\d+\)$/).first().innerText().catch(() => null),
        httpErrors: errors,
      };
      await huong.page.screenshot({ path: path.join(os.tmpdir(), 'go2joy-ops-sa-livechat.png') });
    }

    // ---- (3)(5) re-route confirm --------------------------------------------------------------
    const r1 = await mk('reroute', 1, 'receptionist', 'cs');
    {
      const s = await open(LAN);
      const id = r1.conversationId;
      const alertsBefore = await db(async (c) => (await c.query('SELECT id, reason, target_user_id, status FROM agent_alerts WHERE conversation_id = ? ORDER BY id', [id]))[0]);
      out.reroute = { conversationId: id, alertsBefore };
      await s.goto(`/live-chat?c=${id}`);
      const head = s.page.locator('div.space-y-2.border-b.border-gray-100.px-4.py-3').first();
      out.reroute.headerBefore = (await head.innerText()).replace(/\s+/g, ' | ');
      await refreshPresence();
      await s.page.getByRole('button', { name: /Chuyển sang/ }).click();
      const dlg = s.page.getByRole('dialog').filter({ hasText: 'Chuyển cuộc trò chuyện' }).first();
      await dlg.getByLabel('Chuyển sang', { exact: true }).selectOption('business');
      out.reroute.dialogText = (await dlg.innerText()).replace(/\s+/g, ' | ');
      await dlg.getByRole('button', { name: 'Chuyển', exact: true }).click();
      await s.page.waitForTimeout(2500);
      out.reroute.toasts = await s.toasts();
      out.reroute.headerAfter = (await head.innerText()).replace(/\s+/g, ' | ');
      out.reroute.statusInDb = await db(async (c) => (await c.query('SELECT status, agent_id, support_type, support_region, escalated_at, unclaimed_pages FROM conversations WHERE id = ?', [id]))[0][0]);
      out.reroute.alertsAfter = await db(async (c) => (await c.query('SELECT id, reason, target_user_id, target_region, status FROM agent_alerts WHERE conversation_id = ? ORDER BY id', [id]))[0]);
      out.reroute.commentsInDb = await db(async (c) => (await c.query('SELECT scope, left(body, 200) AS body FROM chat_comments WHERE conversation_id = ?', [id]).catch(() => [[]]))[0]);
      out.reroute.notesPanel = (await s.page.getByText('Ghi chú', { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]').innerText().catch(() => '')).replace(/\s+/g, ' | ');
      await shotBox(s.page, 'reroute-after', [head], { pad: 8, scroll: false });
      await s.goto(`/live-chat?c=${id}`);
      await s.page.waitForTimeout(1500);
      out.reroute.notesPanelAfterReload = (await s.page.getByText('Ghi chú', { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]').innerText().catch(() => '')).replace(/\s+/g, ' | ');
      // (5) the alarm of the paged person: huong.sa holds the SA label in the south
      await huong.goto('/dashboard', { alarm: true, wait: 2500 });
      const modal = huong.page.getByRole('dialog').filter({ hasText: 'Chuyển tiếp hội thoại' }).first();
      out.rerouteAlarm = (await modal.isVisible().catch(() => false)) ? (await modal.innerText()).replace(/\s+/g, ' | ') : 'no modal visible for huong.sa';
      if (await modal.isVisible().catch(() => false)) await shotBox(huong.page, 'alarm-rerouted', [modal], { pad: 6, scroll: false });
      await huong.clearAlarm();
      // and for the one who re-routed (she must not be alarmed by her own hand-over, or must be)
      await s.goto('/dashboard', { alarm: true, wait: 2500 });
      const own = s.page.getByRole('dialog').filter({ hasText: 'Chuyển tiếp hội thoại' }).first();
      out.rerouteAlarmForActor = (await own.isVisible().catch(() => false)) ? (await own.innerText()).replace(/\s+/g, ' | ') : 'no modal visible for the agent who re-routed';
      await s.clearAlarm();
      await s.close();
    }

    // ---- (4) Nhận while holding 3 conversations ------------------------------------------------
    {
      const lanTok = await login(LAN);
      const held = await db(async (c) => (await c.query("SELECT COUNT(*) AS n FROM assignments WHERE agent_id = 2 AND status = 'active'"))[0][0].n);
      const need = Math.max(0, 3 - held);
      const h = [];
      for (let i = 0; i < need; i++) h.push(await mk(`held${i}`, i % 2 ? 3 : 0, 'manager', 'cs'));
      for (const x of h) await must('accept (setup)', `/agent/conversations/${x.conversationId}/accept`, { method: 'POST', token: lanTok });
      const target = waitingTarget;
      const s = await open(LAN);
      const net = [];
      const errs = [];
      s.page.on('response', async (r) => { if (r.url().includes('/accept')) net.push({ status: r.status(), body: (await r.text().catch(() => '')).slice(0, 200) }); });
      s.page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
      s.page.on('console', (m) => { if (m.type() === 'error') errs.push(`console.error: ${m.text().slice(0, 160)}`); });
      await s.goto(`/live-chat?c=${target}`);
      // Wait counters tick by themselves: compare the text with every clock replaced.
      const plain = async () => (await s.page.locator('main').first().innerText()).replace(/\d+:\d\d(:\d\d)?/g, '#').replace(/\d+ (giây|phút|giờ) trước/g, '# trước');
      const bodyBefore = await plain();
      await s.page.getByRole('button', { name: 'Nhận', exact: true }).click();
      await s.page.waitForTimeout(2500);
      const bodyAfter = await plain();
      await s.page.screenshot({ path: path.join(os.tmpdir(), 'go2joy-ops-accept-capacity.png') });
      out.acceptAtCapacity = {
        heldBeforeClick: await db(async (c) => (await c.query("SELECT COUNT(*) AS n FROM assignments WHERE agent_id = 2 AND status = 'active'"))[0][0].n),
        responses: net,
        toasts: await s.toasts(),
        visibleTextChanged: bodyBefore !== bodyAfter,
        diff: bodyBefore === bodyAfter ? '(identical)' : bodyAfter.split(String.fromCharCode(10)).filter((l) => !bodyBefore.includes(l)).slice(0, 8),
        consoleErrors: errs,
        statusAfter: await db(async (c) => (await c.query('SELECT status, agent_id FROM conversations WHERE id = ?', [target]))[0][0]),
      };
      await s.close();
    }

    // ---- (7) the "nobody took it" re-alert, raised by the real 30-second sweeper -----------------------
    {
      const id = await convId(specOf('danang-business')); // waiting ~12 min, unclaimed
      await db((c) => c.query('UPDATE conversations SET unclaimed_pages = 0, unclaimed_paged_at = NULL WHERE id = ?', [id]));
      let alert = null;
      for (let i = 0; i < 14 && !alert; i++) {
        await sleep(5000);
        alert = await db(async (c) => (await c.query("SELECT id, reason, target_user_id, target_region, status FROM agent_alerts WHERE conversation_id = ? AND reason = 'unclaimed'", [id]))[0][0]);
      }
      out.unclaimedSweep = { conversationId: id, alert: alert ?? 'the sweeper raised nothing within 70 s' };
      if (alert) {
        const s = await open(LAN);
        await s.goto('/dashboard', { alarm: true, wait: 2500 });
        const modal = s.page.getByRole('dialog').filter({ hasText: 'Chuyển tiếp hội thoại' }).first();
        out.unclaimedSweep.modal = (await modal.isVisible().catch(() => false)) ? (await modal.innerText()).replace(/\s+/g, ' | ') : 'no modal visible';
        if (await modal.isVisible().catch(() => false)) await shotBox(s.page, 'alarm-unclaimed', [modal], { pad: 6, scroll: false });
        await s.clearAlarm();
      }
    }
  } finally {
    // Restore the baseline: drop what the experiments created.
    await deleteConversations(tmpIds).catch((e) => log('cleanup failed:', e.message));
    await db((c) => c.query("UPDATE conversations SET unclaimed_pages = 20 WHERE status = 'waiting'")).catch(() => {});
    await stage().catch(() => {});
    for (const s of sessions) await s.close();
    await browser.close();
    fs.writeFileSync(OBSERVED_FILE, JSON.stringify(observed, null, 1));
    log('experiment results written to', OBSERVED_FILE);
  }
}

// ---------------------------------------------------------------------------------------------
const [, , cmd = 'help', ...rest] = process.argv;
const args = rest.filter((a) => !a.startsWith('--'));
const list = (args[0] || '').split(',').filter(Boolean);
try {
  if (cmd === 'prep') await prep(list);
  else if (cmd === 'shoot') await shoot(list);
  else if (cmd === 'experiments') await experiments();
  else console.log('usage: node scripts/manual-screenshots-go2joy-ops.mjs prep|shoot|experiments [names]');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
}
