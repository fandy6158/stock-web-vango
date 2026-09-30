const DEFAULT_CSV = "./data/stocks.csv";
const STORAGE_KEY = "stock-pwa-csv-url";
const SESSION_KEY = "vango-session";
const STORE_KEY = "vango-local-db";
const DEMO_OTP = "123456";

const PAY = {
  enabled: true,
  amount: "9.9",
  qrSrc: "./icons/wechat-pay.jpg",
  wechat: "WuFan",
  paidListUrl: "./data/paid.json",
  apiBase: "https://vango-member-hhjebqnncv.cn-hangzhou.fcapp.run"
};

const PLANS = {
  trial: { id: "trial", name: "体验会员", price: 99, days: 7, rank: 1, queries: "7 天内不限次（体验字段）", articles: "体验档文章 + 对应截图" },
  vip: { id: "vip", name: "VIP", price: 999, days: 180, rank: 2, queries: "6 个月内不限次（完整常用字段）", articles: "体验 + VIP 文章和截图" },
  svip: { id: "svip", name: "超级VIP", price: 2999, days: 365, rank: 3, queries: "12 个月内不限次（全部字段）", articles: "全部专栏和完整截图" }
};

const LEVEL_LABEL = { none: "注册用户", trial: "体验会员", vip: "VIP", svip: "超级VIP", admin: "管理员" };
const TRIAL_FIELDS = ["GXLGJ", "X0GJ", "X1GJ", "行业", "备注", "说明"];

function apiUrl(path, params) {
  const base = currentApiBase();
  const url = new URL(base + path);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return url.toString();
}

function currentApiBase() {
  return (localStorage.getItem("stock-pwa-api") || PAY.apiBase || "").replace(/\/$/, "");
}

const $ = (id) => document.getElementById(id);

const state = {
  rows: [],
  source: "",
  loadedAt: null,
  pending: null,
  paid: [],
  user: null,
  articles: [],
  view: "lookup",
  lastArticleList: "public"
};

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStore(db) {
  localStorage.setItem(STORE_KEY, JSON.stringify(db));
}

function defaultArticles() {
  return [
    {
      id: "pub-welcome",
      title: "公开说明：如何阅读估值与专栏",
      summary: "游客可阅读的公开文章。完整数据表以截图形式放在会员文章的非公开区。",
      visibility: "public",
      minLevel: "trial",
      publicBody: "本站公开专栏谁都能看。\n\n估值查询：输入框可见。未登录不能白查，可单次付费；注册后每个手机号共有 2 次免费查询；开通会员后按档位查询。\n\n会员文章：登录后可见标题和简介。完整文字与表格截图，按你开通的最低档开放。\n\n表格发布方式：作者先在 Excel 做好表，再截图上传到非公开区。",
      publicImages: [],
      privateBody: "",
      privateImages: [],
      published: true
    },
    {
      id: "mem-demo-trial",
      title: "体验档示例：表格截图放在非公开区",
      summary: "登录后可见本篇简介。开通体验会员及以上可看完整截图。",
      visibility: "members",
      minLevel: "trial",
      publicBody: "这是会员文章的公开导语。完整估值表请在下方会员区查看截图。",
      publicImages: [],
      privateBody: "以下位置用于放置 Excel 做好后截取的完整表格图片。演示环境请到 admin.html 上传你的截图。",
      privateImages: [],
      published: true
    },
    {
      id: "mem-demo-vip",
      title: "VIP 档示例文章",
      summary: "需要 VIP 或超级VIP 才能查看非公开截图。",
      visibility: "members",
      minLevel: "vip",
      publicBody: "VIP 专栏导语。完整数据表截图仅 VIP / 超级VIP 可见。",
      publicImages: [],
      privateBody: "在管理页把做好的表格截图上传到本篇非公开图片。",
      privateImages: [],
      published: true
    },
    {
      id: "mem-demo-svip",
      title: "超级VIP 档示例文章",
      summary: "最高档完整数据与截图。",
      visibility: "members",
      minLevel: "svip",
      publicBody: "超级VIP 专栏导语。",
      publicImages: [],
      privateBody: "完整模型表截图放在这里。",
      privateImages: [],
      published: true
    }
  ];
}

function ensureStore() {
  const db = loadStore();
  if (!db.users) db.users = {};
  if (!db.otps) db.otps = {};
  if (!db.orders) db.orders = [];
  if (!db.articles || !db.articles.length) db.articles = defaultArticles();
  saveStore(db);
  return db;
}

function currentUser() {
  if (state.user && !isExpired(state.user)) return normalizeUser(state.user);
  if (state.user && isExpired(state.user)) {
    state.user.level = "none";
    state.user.expireAt = 0;
  }
  return state.user;
}

function normalizeUser(u) {
  if (!u) return null;
  if (u.level !== "none" && u.level !== "admin" && isExpired(u)) {
    return { ...u, level: "none", expireAt: 0 };
  }
  return u;
}

function isExpired(u) {
  if (!u || !u.level || u.level === "none" || u.level === "admin") return false;
  return !u.expireAt || Date.now() > u.expireAt;
}

function rankOf(level) {
  if (level === "admin") return 9;
  if (level === "svip") return 3;
  if (level === "vip") return 2;
  if (level === "trial") return 1;
  return 0;
}

function maskPhone(phone) {
  const s = String(phone || "");
  return s.length === 11 ? s.slice(0, 3) + "****" + s.slice(7) : s;
}

function saveSession(user) {
  state.user = user;
  if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  else localStorage.removeItem(SESSION_KEY);
  renderAccount();
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const u = JSON.parse(raw);
    const db = ensureStore();
    const fresh = db.users[u.phone] || u;
    saveSession(normalizeUser(fresh));
  } catch {
    state.user = null;
  }
}

async function apiTry(method, path, body, headers) {
  const base = currentApiBase();
  if (!base) return null;
  try {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(headers || {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
    if (res.status === 404) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) return data || null;
    return data;
  } catch {
    return null;
  }
}

function authHeaders() {
  const u = currentUser();
  return u && u.token ? { Authorization: "Bearer " + u.token } : {};
}

async function sendSms(phone) {
  const remote = await apiTry("POST", "/sms/send", { phone });
  if (remote && remote.ok) return remote;
  const db = ensureStore();
  db.otps[phone] = { code: DEMO_OTP, expireAt: Date.now() + 5 * 60 * 1000 };
  saveStore(db);
  return { ok: true, demo: true, message: "演示验证码 123456（云端短信未上线）" };
}

async function loginWithSms(phone, code) {
  const remote = await apiTry("POST", "/auth/login", { phone, code });
  if (remote && remote.ok && remote.user) {
    saveSession(remote.user);
    return remote.user;
  }
  const db = ensureStore();
  const otp = db.otps[phone];
  if (!otp || otp.code !== String(code).trim() || Date.now() > otp.expireAt) {
    throw new Error("验证码不正确或已过期");
  }
  delete db.otps[phone];
  const existing = db.users[phone];
  const user = existing || {
    phone,
    level: "none",
    expireAt: 0,
    freeQueriesLeft: 2,
    token: "local-" + phone,
    createdAt: Date.now()
  };
  db.users[phone] = user;
  saveStore(db);
  saveSession(user);
  return user;
}

function parseCsv(text) {
  const rows = [];
  let i = 0;
  const len = text.length;
  const nextRow = () => {
    const cols = [];
    let cur = "";
    let quoted = false;
    while (i < len) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
          quoted = false; i += 1; continue;
        }
        cur += ch; i += 1; continue;
      }
      if (ch === '"') { quoted = true; i += 1; continue; }
      if (ch === ",") { cols.push(cur.trim()); cur = ""; i += 1; continue; }
      if (ch === "\n") { cols.push(cur.trim()); i += 1; return cols; }
      if (ch === "\r") { i += 1; continue; }
      cur += ch; i += 1;
    }
    if (cur.length || cols.length) cols.push(cur.trim());
    return cols.length ? cols : null;
  };
  const header = nextRow();
  if (!header) return [];
  while (i < len) {
    const cols = nextRow();
    if (!cols || (cols.length === 1 && !cols[0])) continue;
    const obj = {};
    header.forEach((key, idx) => { obj[key] = cols[idx] ?? ""; });
    rows.push(obj);
  }
  return rows;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "").replace(/\.SS$|\.SZ$|\.HK$|\.US$/i, "");
}

function currentCsvUrl() {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_CSV;
}

async function loadCsv(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`无法读取 CSV（HTTP ${res.status}）`);
  const text = await res.text();
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("CSV 是空的，或表头无法识别");
  state.rows = rows;
  state.source = url;
  state.loadedAt = new Date();
  localStorage.setItem("stock-pwa-cache", JSON.stringify({ url, text, at: Date.now() }));
  return rows;
}

function restoreCache() {
  try {
    const raw = localStorage.getItem("stock-pwa-cache");
    if (!raw) return false;
    const cached = JSON.parse(raw);
    state.rows = parseCsv(cached.text);
    state.source = cached.url + "（本地缓存）";
    state.loadedAt = new Date(cached.at);
    return state.rows.length > 0;
  } catch {
    return false;
  }
}

function findStock(query) {
  const q = normalizeCode(query);
  if (!q) return null;
  const exact = state.rows.find((row) => normalizeCode(row["代码"] || row.code) === q);
  if (exact) return exact;
  return state.rows.find((row) => {
    const name = String(row["名称"] || row.name || "");
    const code = normalizeCode(row["代码"] || row.code);
    return name.includes(query.trim()) || code.includes(q);
  });
}

function filterFields(row, mode) {
  return row;
}

function accessMode() {
  const u = currentUser();
  if (u && u.level === "admin") return { type: "member", mode: "full", reason: "admin" };
  if (u && rankOf(u.level) >= 3) return { type: "member", mode: "full", reason: "svip" };
  if (u && rankOf(u.level) >= 2) return { type: "member", mode: "full", reason: "vip" };
  if (u && rankOf(u.level) >= 1) return { type: "member", mode: "trial", reason: "trial" };
  if (u && (u.freeQueriesLeft || 0) > 0) return { type: "free", mode: "full", reason: "quota" };
  return { type: "pay", mode: "full", reason: u ? "no-quota" : "guest" };
}

function consumeFreeQuery() {
  const u = currentUser();
  if (!u || (u.freeQueriesLeft || 0) <= 0) return;
  u.freeQueriesLeft -= 1;
  const db = ensureStore();
  if (db.users[u.phone]) db.users[u.phone].freeQueriesLeft = u.freeQueriesLeft;
  saveStore(db);
  saveSession(u);
}

function renderResult(row, meta) {
  const box = $("result");
  $("r-code").textContent = row["代码"] || row.code || "";
  $("r-name").textContent = row["名称"] || row.name || "未知标的";
  $("r-industry").textContent = meta || "已解锁计算结果";
  $("r-rating").textContent = "已解锁";
  $("r-rating").className = "badge buy";
  const skip = new Set(["代码", "名称", "行业", "code", "name"]);
  const grid = $("r-fields");
  grid.innerHTML = "";
  Object.keys(row).forEach((key) => {
    if (skip.has(key)) return;
    const val = String(row[key] ?? "").trim();
    if (!val) return;
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.innerHTML = `<div class="k"></div><div class="v"></div>`;
    cell.querySelector(".k").textContent = key;
    cell.querySelector(".v").textContent = val;
    grid.appendChild(cell);
  });
  $("r-note").innerHTML = "<strong>说明：</strong>以上为作者维护的计算结果，不构成投资建议。";
  box.classList.add("show");
}

function setStatus(msg) {
  if ($("status")) $("status").textContent = msg || "";
}

function showEmpty(msg) {
  $("result").classList.remove("show");
  $("paywall").classList.remove("show");
  setStatus(msg);
}


function makeOrderId(prefix, extra) {
  const n = Math.random().toString(36).slice(2, 6).toUpperCase();
  const mid = extra ? String(extra).replace(/-+$/g, "") + "-" : "";
  return (prefix + mid + n).replace(/-+/g, "-");

  
}

function isUnlocked(code, orderId) {
  const c = normalizeCode(code);
  const u = currentUser();
  const db = ensureStore();
  const all = [...(state.paid || []), ...(db.orders || [])];
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  return all.some((item) => {
    if (item.type && item.type !== "query") return false;
    if (item.status && item.status !== "paid") return false;
    const start = Number(item.createdAt || item.at || item.paidAt || 0);
    const exp = Number(item.expireAt || (start ? start + week : 0));
    if (exp && now > exp) return false;
    if (start && !item.expireAt && now - start > week) return false;
    const paidCode = normalizeCode(item.code || item.代码 || item.stock_code || "");
    const paidOrder = String(item.order || item.orderId || item.订单号 || "").toUpperCase();
    if (orderId && paidOrder && paidOrder === String(orderId).toUpperCase()) return true;
    if (u && item.phone && item.phone === u.phone && paidCode === c) return true;
    return paidCode && paidCode === c && item.unlocked !== false && !item.phone;
  });
}

async function loadPaidList() {
  try {
    const res = await fetch(PAY.paidListUrl + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    state.paid = Array.isArray(data) ? data : data.orders || [];
  } catch {
    state.paid = [];
  }
}

function showPaywall(row, reason) {
  $("result").classList.remove("show");
  const code = row["代码"] || row.code || "";
  const orderId = makeOrderId("GU", normalizeCode(code));
  state.pending = { row, orderId, type: "query" };
  sessionStorage.setItem("pending-order", JSON.stringify({ code, orderId, name: row["名称"] || row.name, type: "query" }));
  $("p-code").textContent = code;
  $("p-name").textContent = row["名称"] || row.name || "未知标的";
  $("p-industry").textContent = reason || "已找到记录，单次付费或开通会员后显示完整估值";
  $("p-amount").textContent = PAY.amount;
  $("p-qr").src = PAY.qrSrc;
  $("p-order").textContent = orderId;
  $("p-note").textContent = "付款后如遇不显示查询结果，请加微信：Vango77 或私信推特 X:@ai18431588";
  $("paywall").classList.add("show");
}

async function loadCatalog() {
  const res = await fetch(apiUrl("/catalog"), { cache: "no-store" });
  if (!res.ok) throw new Error("云函数 catalog 失败");
  const data = await res.json();
  state.rows = data.items || [];
  state.source = currentApiBase();
}

async function loadArticles() {
  const remote = await apiTry("GET", "/articles");
  if (remote && Array.isArray(remote.items)) {
    state.articles = remote.items;
    return;
  }
  try {
    const res = await fetch("./data/articles.json?t=" + Date.now(), { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        const db = ensureStore();
        const localMap = Object.fromEntries((db.articles || []).map((a) => [a.id, a]));
        state.articles = data.map((a) => ({ ...a, ...(localMap[a.id] || {}) }));
        const extras = (db.articles || []).filter((a) => !data.some((b) => b.id === a.id));
        state.articles = state.articles.concat(extras);
        return;
      }
    }
  } catch {}
  state.articles = ensureStore().articles || defaultArticles();
}

function renderChips() {
  const wrap = $("chips");
  if (!wrap) return;
  wrap.innerHTML = "";
  state.rows.slice(0, 8).forEach((row) => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.type = "button";
    btn.textContent = `${row["代码"] || row.code || ""} ${row["名称"] || row.name || ""}`;
    btn.addEventListener("click", () => {
      $("query").value = row["代码"] || row.code || "";
      lookup();
    });
    wrap.appendChild(btn);
  });
}

async function lookup() {
  const q = $("query").value;
  setStatus("正在查询…");
  try {
    let item = null;
    if (currentApiBase()) {
      const res = await fetch(apiUrl("/lookup", { code: q }), { cache: "no-store" });
      const data = await res.json();
      if (!data.found) {
        showEmpty(data.message || `没有找到「${q}」`);
        return;
      }
      item = data.item;
    } else {
      if (!state.rows.length) {
        showEmpty("估值表还没加载成功。");
        return;
      }
      item = findStock(q);
      if (!item) {
        showEmpty(`没有找到「${q}」。可输入代码或名称，例如 600519 / 茅台。`);
        return;
      }
    }

    const pending = JSON.parse(sessionStorage.getItem("pending-order") || "null");
    const same = pending && pending.type !== "vip" && normalizeCode(pending.code) === normalizeCode(item["代码"] || item.code);
    const access = accessMode();

    if (access.type === "member") {
      setStatus("");
      $("paywall").classList.remove("show");
      if (currentApiBase()) {
        const revealed = await reveal(item["代码"] || item.code, pending && same ? pending.orderId : "MEMBER");
        if (revealed) return;
        showEmpty("会员已记录在本机，但云端还没有完整估值。请打开管理页，用同一个手机号再点一次「确认到账并开通」，然后重新查询。");
        return;
      }
      renderResult(filterFields(item, access.mode), access.mode === "trial" ? "体验会员字段" : "会员已解锁");
      return;
    }

    if (access.type === "free") {
      setStatus("");
      $("paywall").classList.remove("show");
      consumeFreeQuery();
      renderResult(filterFields(item, "full"), `注册体验查询，剩余 ${currentUser().freeQueriesLeft} 次`);
      return;
    }

    if (same && (await tryUnlockQuery(item, pending.orderId))) return;

    setStatus("");
    const reason = access.reason === "guest"
      ? "未登录不能白查。可单次付费，或登录后使用 2 次注册查询 / 开通会员。"
      : "注册查询次数已用完。可单次付费或开通会员。";
    showPaywall(item, reason);
  } catch (err) {
    showEmpty("查询失败：" + err.message);
  }
}

async function tryUnlockQuery(item, orderId) {
  const code = item["代码"] || item.code;
  if (currentApiBase()) {
    const ok = await reveal(code, orderId);
    if (ok) return true;
  }
  if (isUnlocked(code, orderId)) {
    $("paywall").classList.remove("show");
    renderResult(item, "单次付费已解锁");
    return true;
  }
  return false;
}

async function reveal(code, orderId) {
  const u = currentUser();
  const url = apiUrl("/reveal", { code, order: orderId, phone: u ? u.phone : "", token: u ? u.token : "" });
  const res = await fetch(url, { cache: "no-store", headers: authHeaders() });
  const data = await res.json();
  if (data.ok && data.item) {
    $("paywall").classList.remove("show");
    const access = accessMode();
    renderResult(filterFields(data.item, access.mode === "trial" ? "trial" : "full"), "已确认并解锁");
    return true;
  }
  return false;
}

function showView(name) {
  state.view = name;
  document.querySelectorAll(".view").forEach((el) => el.classList.remove("show"));
  const map = {
    lookup: "view-lookup",
    public: "view-public",
    members: "view-members",
    article: "view-article",
    plans: "view-plans",
    me: "view-me"
  };
  const id = map[name] || "view-lookup";
  $(id).classList.add("show");
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.view === name || (name === "article" && btn.dataset.view === state.lastArticleList));
  });
  if (name === "public") renderPublicList();
  if (name === "members") renderMemberList();
  if (name === "plans") renderPlans();
  if (name === "me") renderMe();
}

function renderAccount() {
  const btn = $("btn-account");
  const u = currentUser();
  if (!u) {
    btn.textContent = "登录";
    $("header-sub").textContent = "公开文章可阅读 · 估值按会员或单次付费";
    return;
  }
  const lv = LEVEL_LABEL[u.level] || "注册用户";
  btn.textContent = maskPhone(u.phone);
  if (u.level && u.level !== "none") {
    $("header-sub").textContent = lv + (u.expireAt ? " · 至 " + new Date(u.expireAt).toLocaleDateString() : "");
    $("lookup-hint").textContent = "会员有效" + (u.expireAt ? "至 " + new Date(u.expireAt).toLocaleDateString() : "") + "。期内估值按档位开放。";
  } else {
    $("header-sub").textContent = lv + " · 剩余免费查询 " + (u.freeQueriesLeft || 0) + " 次";
    $("lookup-hint").textContent = "已登录。注册查询剩余 " + (u.freeQueriesLeft || 0) + " 次；用完后可单次付费或开通会员。";
  }








function articleCard(a, locked) {
  const el = document.createElement("section");
  el.className = "card article-card";
  el.innerHTML = `
    <span class="level-tag">${a.visibility === "public" ? "公开" : (PLANS[a.minLevel] || {}).name || a.minLevel}</span>
    <h2></h2>
    <p></p>
  `;
  el.querySelector("h2").textContent = a.title;
  el.querySelector("p").textContent = a.summary + (locked ? "（登录后查看更多）" : "");
  el.addEventListener("click", () => openArticle(a.id));
  return el;
}

function renderPublicList() {
  const box = $("public-list");
  box.innerHTML = "";
  const list = (state.articles || []).filter((a) => a.published !== false && a.visibility === "public");
  if (!list.length) {
    box.innerHTML = `<section class="card notice"><h3>暂无公开文章</h3><p>作者可在 admin.html 发布公开专栏。</p></section>`;
    return;
  }
  list.forEach((a) => box.appendChild(articleCard(a, false)));
}

function renderMemberList() {
  const u = currentUser();
  $("members-gate").style.display = u ? "none" : "block";
  const box = $("member-list");
  box.innerHTML = "";
  if (!u) return;
  const list = (state.articles || []).filter((a) => a.published !== false && a.visibility === "members");
  if (!list.length) {
    box.innerHTML = `<section class="card notice"><h3>暂无会员文章</h3><p>作者可在管理页发布，并勾选体验 / VIP / 超级VIP。</p></section>`;
    return;
  }
  list.forEach((a) => box.appendChild(articleCard(a, false)));
}

function canSeePrivate(article) {
  const u = currentUser();
  if (!u) return false;
  return rankOf(u.level) >= rankOf(article.minLevel || "trial");
}

function renderShots(urls) {
  if (!urls || !urls.length) return "";
  return `<div class="shots">${urls.map(() => `<img alt="表格截图">`).join("")}</div>`;
}

function openArticle(id) {
  const a = (state.articles || []).find((x) => x.id === id);
  if (!a) return;
  state.lastArticleList = a.visibility === "public" ? "public" : "members";
  const box = $("article-box");
  const publicImgs = a.publicImages || [];
  const privateImgs = a.privateImages || [];
  box.innerHTML = `
    <span class="level-tag">${a.visibility === "public" ? "公开" : (PLANS[a.minLevel] || {}).name || ""}</span>
    <h2></h2>
    <div class="body" id="art-public"></div>
    <div id="art-public-imgs" class="shots"></div>
    <div id="art-private"></div>
  `;
  box.querySelector("h2").textContent = a.title;
  box.querySelector("#art-public").textContent = a.publicBody || a.summary || "";
  const pub = box.querySelector("#art-public-imgs");
  publicImgs.forEach((src) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "公开配图";
    pub.appendChild(img);
  });
  const priv = box.querySelector("#art-private");
  if (a.visibility === "public" && !a.privateBody && !privateImgs.length) {
    showView("article");
    return;
  }
  if (!currentUser() && a.visibility === "members") {
    priv.innerHTML = `<div class="lock-box"><p>登录后可看简介以外的内容。</p></div>`;
    showView("article");
    return;
  }
  if (!canSeePrivate(a)) {
    const need = (PLANS[a.minLevel] || {}).name || "对应会员";
    priv.innerHTML = `<div class="lock-box"><p>完整文字和表格截图需开通${need}。</p><button class="primary" id="art-go-plan" type="button">开通会员</button></div>`;
    setTimeout(() => {
      const b = document.getElementById("art-go-plan");
      if (b) b.onclick = () => showView("plans");
    }, 0);
    showView("article");
    return;
  }
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = a.privateBody || "";
  priv.appendChild(body);
  privateImgs.forEach((src) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "数据表截图";
    img.style.width = "100%";
    img.style.borderRadius = "12px";
    img.style.marginTop = "12px";
    priv.appendChild(img);
  });
  showView("article");
}

function renderPlans() {
  const grid = $("plan-grid");
  grid.innerHTML = "";
  Object.values(PLANS).forEach((plan) => {
    const card = document.createElement("section");
    card.className = "card plan-card";
    card.innerHTML = `
      <div class="level-tag">${plan.name}</div>
      <div class="price">${plan.price} 元</div>
      <p class="hint">${plan.days} 天</p>
      <ul>
        <li>${plan.queries}</li>
        <li>${plan.articles}</li>
        <li>到期后公开文章仍可看，估值恢复为次数或单次付费</li>
      </ul>
      <button class="primary" type="button">开通${plan.name}</button>
    `;
    card.querySelector("button").addEventListener("click", () => startVipOrder(plan.id));
    grid.appendChild(card);
  });
}

function startVipOrder(planId) {
  const u = currentUser();
  if (!u) {
    openLogin();
    return;
  }
  const plan = PLANS[planId];
  const orderId = makeOrderId("VIP-", plan.id.toUpperCase() + "-" + plan.days + "D");

  
  const pending = { type: "vip", planId, orderId, phone: u.phone };
  sessionStorage.setItem("pending-vip", JSON.stringify(pending));
  const db = ensureStore();
  db.orders.push({ orderId, type: "vip", planId, phone: u.phone, amount: plan.price, status: "pending", createdAt: Date.now() });
  saveStore(db);
  $("v-plan-name").textContent = plan.name;
  $("v-amount").textContent = String(plan.price);
  $("v-order").textContent = orderId;
  $("vip-paywall").classList.add("show");
  $("vip-paywall").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function refreshVip() {
  const pending = JSON.parse(sessionStorage.getItem("pending-vip") || "null");
  if (!pending) {
    setStatus("没有待确认的会员订单。");
    alert("没有待确认的会员订单。请先点开通，再付款。");
    return;
  }

  const remote = await apiTry("POST", "/vip/status", {
    phone: pending.phone,
    order: pending.orderId,
    plan: pending.planId
  }, authHeaders());

  if (remote && remote.ok && remote.user && rankOf(remote.user.level) > 0) {
    saveSession(remote.user);
    $("vip-paywall").classList.remove("show");
    showView("me");
    return;
  }

  const me = await apiTry("GET", "/me", null, authHeaders());
  if (me && me.user && rankOf(me.user.level) > 0) {
    saveSession(me.user);
    $("vip-paywall").classList.remove("show");
    showView("me");
    return;
  }

  const db = ensureStore();
  const hit = (db.orders || []).find((o) => o.orderId === pending.orderId && o.status === "paid");
  if (hit) {
    applyPlan(pending.phone, pending.planId);
    $("vip-paywall").classList.remove("show");
    showView("me");
    return;
  }

  alert("还没查到会员开通记录。请到管理页「开通会员」填写同一手机号和订单号。");
}



function applyPlan(phone, planId) {
  const plan = PLANS[planId];
  const db = ensureStore();
  const user = db.users[phone] || { phone, level: "none", freeQueriesLeft: 2, token: "local-" + phone };
  user.level = plan.id;
  user.expireAt = Date.now() + plan.days * 24 * 60 * 60 * 1000;
  db.users[phone] = user;
  saveStore(db);
  if (currentUser() && currentUser().phone === phone) saveSession(user);
}

function renderMe() {
  const box = $("me-box");
  const u = currentUser();
  if (!u) {
    box.innerHTML = `<h3>未登录</h3><p>登录后可查看会员档位与剩余查询次数。</p>`;
    return;
  }
  const exp = u.expireAt ? new Date(u.expireAt).toLocaleString() : "未开通";
  box.innerHTML = `
    <h3>我的账号</h3>
    <p>手机号：${maskPhone(u.phone)}</p>
    <p>当前身份：${LEVEL_LABEL[u.level] || u.level}</p>
    <p>到期时间：${u.level === "none" ? "—" : exp}</p>
    
    ${(!u.level || u.level === "none") ? `<p>注册免费估值剩余：${u.freeQueriesLeft || 0} 次</p>` : ""}
    
    <div class="actions" style="margin-top:12px">
      <button class="primary" id="me-plans" type="button">开通 / 升级</button>
      <button class="ghost" id="me-logout" type="button">退出登录</button>
    </div>
  `;
  $("me-plans").onclick = () => showView("plans");
  $("me-logout").onclick = () => {
    saveSession(null);
    showView("lookup");
  };
}

function openLogin() {
  $("login-modal").hidden = false;
  $("login-msg").textContent = "";
}

function closeLogin() {
  $("login-modal").hidden = true;
}

async function boot() {
  restoreSession();
  ensureStore();
  if ($("csv-url")) $("csv-url").value = currentCsvUrl();
  if ($("api-url")) $("api-url").value = currentApiBase();
  renderAccount();
  renderPlans();
  setStatus("正在连接数据源…");
  try {
    await loadArticles();
    if (currentApiBase()) {
      PAY.apiBase = currentApiBase();
      await loadCatalog();
      setStatus("已连接云函数");
      renderChips();
      return;
    }
    await Promise.all([loadCsv(currentCsvUrl()), loadPaidList()]);
    setStatus(`本地演示表 ${state.rows.length} 只 · 正式环境请改用云函数`);
    renderChips();
  } catch (err) {
    const ok = !currentApiBase() && restoreCache();
    if (ok) {
      setStatus(`读取失败，已用缓存。${err.message}`);
      renderChips();
    } else {
      setStatus("加载失败：" + err.message);
    }
  }
}

function saveUrl() {
  const url = $("csv-url").value.trim() || DEFAULT_CSV;
  localStorage.setItem(STORAGE_KEY, url);
  if ($("api-url")) {
    const api = $("api-url").value.trim();
    if (api) localStorage.setItem("stock-pwa-api", api);
    else localStorage.removeItem("stock-pwa-api");
    PAY.apiBase = api;
  }
  boot().then(() => setStatus("已更新数据源并重新加载。"));
}

function resetUrl() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("stock-pwa-api");
  $("csv-url").value = DEFAULT_CSV;
  if ($("api-url")) $("api-url").value = PAY.apiBase || "";
  boot();
}

$("copy-order").addEventListener("click", async () => {
  const text = $("p-order").textContent || "";
  try {
    await navigator.clipboard.writeText(text);
    setStatus("订单号已复制，付款备注请粘贴这一串。");
  } catch {
    setStatus("请长按订单号手动复制。");
  }
});

$("paid-refresh").addEventListener("click", async () => {
  setStatus("正在核对付款…");
  const pending = JSON.parse(sessionStorage.getItem("pending-order") || "null");
  if (currentApiBase() && pending) {
    const ok = await reveal(pending.code, pending.orderId);
    setStatus(ok ? "已确认付款，估值已解锁。" : "还没查到这笔订单。请等作者写入白名单后再点。");
    return;
  }
  await loadPaidList();
  if (pending && isUnlocked(pending.code, pending.orderId)) {
    const item = findStock(pending.code) || { 代码: pending.code, 名称: pending.name };
    $("paywall").classList.remove("show");
    renderResult(item, "单次付费已解锁");
    setStatus("已确认付款，估值已解锁。");
    return;
  }
  await lookup();
  setStatus($("result").classList.contains("show") ? "已确认付款，估值已解锁。" : "还没查到这笔订单。");
});

$("lookup").addEventListener("click", lookup);
$("query").addEventListener("keydown", (e) => {
  if (e.key === "Enter") lookup();
});
$("toggle-settings").addEventListener("click", () => $("settings").classList.toggle("open"));
$("save-url").addEventListener("click", saveUrl);
$("reset-url").addEventListener("click", resetUrl);
$("btn-account").addEventListener("click", () => {
  if (currentUser()) showView("me");
  else openLogin();
});
$("close-login").addEventListener("click", closeLogin);
$("members-login").addEventListener("click", openLogin);
$("members-plans").addEventListener("click", () => showView("plans"));
$("go-plans").addEventListener("click", () => showView("plans"));
$("article-back").addEventListener("click", () => showView(state.lastArticleList || "public"));
$("send-sms").addEventListener("click", async () => {
  const phone = $("login-phone").value.trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    $("login-msg").textContent = "请输入 11 位大陆手机号";
    return;
  }
  try {
    const data = await sendSms(phone);
    $("login-msg").textContent = data.message || "验证码已发送";
  } catch (err) {
    $("login-msg").textContent = err.message;
  }
});
$("do-login").addEventListener("click", async () => {
  const phone = $("login-phone").value.trim();
  const code = $("login-code").value.trim();
  try {
    await loginWithSms(phone, code);
    closeLogin();
    renderMemberList();
    if (state.view === "plans") renderPlans();
  } catch (err) {
    $("login-msg").textContent = err.message;
  }
});
$("copy-vip-order").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("v-order").textContent || "");
    alert("订单号已复制");
  } catch {
    alert("请长按订单号复制");
  }
});
$("vip-refresh").addEventListener("click", refreshVip);
$("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-view]");
  if (!btn) return;
  showView(btn.dataset.view);
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

boot();
