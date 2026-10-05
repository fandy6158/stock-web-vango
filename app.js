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
  trial: {
    id: "trial", name: "体验会员", price: 99, days: 7, rank: 1,
    queries: "7 天内100次内免费查询 5000多只个股估价",
    articles: "体验档文章及分析数据",
    extras: []
  },
  vip: {
    id: "vip", name: "VIP", price: 799, days: 180, rank: 2,
    queries: "6 个月内不限次数查询 5000多只个股估价",
    articles: "体验+VIP等级文章及分析数据",
    extras: ["vip群（盘中逻辑荐股）"]
  },
  svip: {
    id: "svip", name: "超级VIP", price: 1999, days: 365, rank: 3,
    queries: "12 个月内不限次数查询 5000多只个股估价",
    articles: "体验+VIP+SVIP 所有专栏文章及分析数据",
    extras: ["超级svip（盘中逻辑荐股++资产配置 ）"]
  }
};

const LEVEL_LABEL = { none: "注册用户", trial: "体验会员", vip: "VIP", svip: "超级VIP", admin: "管理员" };

function apiUrl(path, params) {
  const base = currentApiBase();
  const url = new URL(base + path);
  Object.entries(params || {}).forEach(function (entry) {
    const k = entry[0];
    const v = entry[1];
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return url.toString();
}

function currentApiBase() {
  return (localStorage.getItem("stock-pwa-api") || PAY.apiBase || "").replace(/\/$/, "");
}

const $ = function (id) { return document.getElementById(id); };

const state = {
  rows: [],
  source: "",
  loadedAt: null,
  pending: null,
  paid: [],
  user: null,
  articles: [],
  view: "lookup",

  lastArticleList: "public",
  memberLevel: "trial",
  articlesLoaded: false
};


function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch (e) {
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
      summary: "游客可阅读的公开文章。",
      visibility: "public",
      minLevel: "trial",
      publicBody: "本站公开专栏谁都能看。估值查询需登录、付费或开通会员。",
      publicImages: [],
      privateBody: "",
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

function isExpired(u) {
  if (!u || !u.level || u.level === "none" || u.level === "admin") return false;
  return !u.expireAt || Date.now() > u.expireAt;
}

function normalizeUser(u) {
  if (!u) return null;
  if (u.level !== "none" && u.level !== "admin" && isExpired(u)) {
    return Object.assign({}, u, { level: "none", expireAt: 0 });
  }
  return u;
}

function currentUser() {
  if (state.user && !isExpired(state.user)) return normalizeUser(state.user);
  if (state.user && isExpired(state.user)) {
    state.user.level = "none";
    state.user.expireAt = 0;
  }
  return state.user;
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
    state.user = JSON.parse(raw);
    renderAccount();
  } catch (e) {
    state.user = null;
  }
}



async function apiTry(method, path, body, headers) {
  const base = currentApiBase();
  if (!base) return null;
  try {
    const res = await fetch(base + path, {
      method: method,
      headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
    if (res.status === 404) return null;
    const data = await res.json().catch(function () { return null; });
    if (!res.ok) return data || null;
    return data;
  } catch (e) {
    return null;
  }
}

function authHeaders() {
  const u = currentUser();
  return u && u.token ? { Authorization: "Bearer " + u.token } : {};
}

async function sendSms(phone) {
  const remote = await apiTry("POST", "/sms/send", { phone: phone });
  if (remote && remote.ok) return remote;
  const db = ensureStore();
  db.otps[phone] = { code: DEMO_OTP, expireAt: Date.now() + 5 * 60 * 1000 };
  saveStore(db);
  return { ok: true, demo: true, message: "短信已发送，请查看手机验证码" };
}


async function loginWithSms(phone, code) {
  const remote = await apiTry("POST", "/auth/login", { phone: phone, code: code });
  if (remote && remote.ok && remote.user) {
    saveSession(remote.user);
    await loadArticles();
    return remote.user;
  }


  if (currentApiBase()) {
    throw new Error((remote && remote.message) || "云端登录失败，请重新发送验证码");
  }
  const db = ensureStore();
  const otp = db.otps[phone];
  if (!otp || otp.code !== String(code).trim() || Date.now() > otp.expireAt) {
    throw new Error("验证码不正确或已过期");
  }

  
  delete db.otps[phone];
  const existing = db.users[phone];
  const user = existing || {
    phone: phone,
    level: "none",
    expireAt: 0,
    freeQueriesLeft: 5,
    token: "local-" + phone,
    createdAt: Date.now()
  };
  db.users[phone] = user;
  saveStore(db);
  saveSession(user);
  return user;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "").replace(/\.SS$|\.SZ$|\.HK$|\.US$/i, "");
}

function currentCsvUrl() {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_CSV;
}

function parseCsv(text) {
  const rows = [];
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter(function (ln) { return ln.trim(); });
  if (!lines.length) return [];
  const header = lines[0].split(",").map(function (h) { return h.trim(); });
  for (var i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const obj = {};
    header.forEach(function (key, idx) { obj[key] = (cols[idx] || "").trim(); });
    rows.push(obj);
  }
  return rows;
}

async function loadCsv(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("无法读取 CSV（HTTP " + res.status + "）");
  const text = await res.text();
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("CSV 是空的，或表头无法识别");
  state.rows = rows;
  state.source = url;
  state.loadedAt = new Date();
  return rows;
}

function restoreCache() {
  try {
    const raw = localStorage.getItem("stock-pwa-cache");
    if (!raw) return false;
    const cached = JSON.parse(raw);
    state.rows = parseCsv(cached.text);
    return state.rows.length > 0;
  } catch (e) {
    return false;
  }
}

function findStock(query) {
  const q = normalizeCode(query);
  if (!q) return null;
  const exact = state.rows.find(function (row) { return normalizeCode(row["代码"] || row.code) === q; });
  if (exact) return exact;
  return state.rows.find(function (row) {
    const name = String(row["名称"] || row.name || "");
    const code = normalizeCode(row["代码"] || row.code);
    return name.indexOf(String(query || "").trim()) >= 0 || code.indexOf(q) >= 0;
  });
}

function filterFields(row) {
  return row;
}

function accessMode() {
  const u = currentUser();
  if (u && u.level === "admin") return { type: "member", mode: "full", reason: "admin" };
  if (u && rankOf(u.level) >= 1) return { type: "member", mode: "full", reason: u.level };
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
  const skip = { "代码": 1, "名称": 1, "行业": 1, code: 1, name: 1 };
  const grid = $("r-fields");
  grid.innerHTML = "";
  Object.keys(row).forEach(function (key) {
    if (skip[key]) return;
    const val = String(row[key] == null ? "" : row[key]).trim();
    if (!val) return;
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.innerHTML = '<div class="k"></div><div class="v"></div>';
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
  const all = [].concat(state.paid || [], db.orders || []);
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  return all.some(function (item) {
    if (item.type && item.type !== "query") return false;
    if (item.status && item.status !== "paid") return false;
    const start = Number(item.createdAt || item.at || item.paidAt || 0);
    const exp = Number(item.expireAt || (start ? start + week : 0));
    if (exp && now > exp) return false;
    const paidCode = normalizeCode(item.code || item.代码 || "");
    const paidOrder = String(item.order || item.orderId || "").toUpperCase();
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
  } catch (e) {
    state.paid = [];
  }
}

function showPaywall(row, reason) {
  $("result").classList.remove("show");
  const code = row["代码"] || row.code || "";
  const orderId = makeOrderId("GU", normalizeCode(code));
  state.pending = { row: row, orderId: orderId, type: "query" };
  sessionStorage.setItem("pending-order", JSON.stringify({ code: code, orderId: orderId, name: row["名称"] || row.name, type: "query" }));
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
  var publicItems = [];
  try {
    const res = await fetch("./data/articles.json?t=" + Date.now(), { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.items || []);
      publicItems = items.filter(function (a) {
        return a.published !== false && a.visibility === "public";
      });
    }
  } catch (e) {}

  var memberItems = [];
  const remote = await apiTry("GET", "/articles", null, authHeaders());
  if (remote && Array.isArray(remote.items)) {
    memberItems = remote.items.filter(function (a) {
      return a.published !== false && a.visibility === "members";
    });
  }

  state.articles = publicItems.concat(memberItems);
}







function renderChips() {
  const wrap = $("chips");
  if (!wrap) return;
  wrap.innerHTML = "";
  state.rows.slice(0, 8).forEach(function (row) {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.type = "button";
    btn.textContent = (row["代码"] || row.code || "") + " " + (row["名称"] || row.name || "");
    btn.addEventListener("click", function () {
      $("query").value = row["代码"] || row.code || "";
      lookup();
    });
    wrap.appendChild(btn);
  });
}

async function reveal(code, orderId) {
  const u = currentUser();
  const url = apiUrl("/reveal", { code: code, order: orderId, phone: u ? u.phone : "", token: u ? u.token : "" });
  const res = await fetch(url, { cache: "no-store", headers: authHeaders() });
  const data = await res.json();
  if (data.ok && data.item) {
    $("paywall").classList.remove("show");
    renderResult(data.item, "已确认并解锁");
    return true;
  }
  return false;
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

async function lookup() {
  const q = $("query").value;
  setStatus("正在查询…");
  try {
    var item = null;
    if (currentApiBase()) {
    const res = await fetch(apiUrl("/lookup", { code: q }), {
     cache: "no-store",
     headers: authHeaders()
    });

      
      const data = await res.json();
      if (!data.found) {
        showEmpty(data.message || ("没有找到「" + q + "」"));
        return;
      }

 item = data.item;
  if (data.trialQueriesLeft != null && currentUser()) {
  var u = currentUser();
  u.trialQueriesLeft = data.trialQueriesLeft;
  saveSession(u);
  renderAccount();
}


      
    } else {
      if (!state.rows.length) {
        showEmpty("估值表还没加载成功。");
        return;
      }
      item = findStock(q);
      if (!item) {
        showEmpty("没有找到「" + q + "」。");
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
        showEmpty("云端还没有完整估值，请稍后重试。");
        return;
      }
      renderResult(item, "会员已解锁");
      return;
    }
    if (access.type === "free") {
      setStatus("");
      $("paywall").classList.remove("show");
      consumeFreeQuery();
      renderResult(item, "注册体验查询，剩余 " + currentUser().freeQueriesLeft + " 次");
      return;
    }
    if (same && (await tryUnlockQuery(item, pending.orderId))) return;
    setStatus("");
    showPaywall(item, access.reason === "guest" ? "登录获5次免费查询，开通会员不限次数。" : "注册查询次数已用完。");
  } catch (err) {
    showEmpty("查询失败：" + err.message);
  }
}

async function showView(name) {
  state.view = name;
  document.querySelectorAll(".view").forEach(function (el) { el.classList.remove("show"); });
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

  document.querySelectorAll("#tabs .tab").forEach(function (btn) {
    btn.classList.toggle("on", btn.dataset.view === name || (name === "article" && btn.dataset.view === state.lastArticleList));
  });



  
if (name === "public" || name === "members" ) {
    if (!state.articlesLoaded) {
      await loadArticles();
      state.articlesLoaded = true;
    }
  }
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
  var extra = "";
  if (u.level === "trial") extra = " · 剩余 " + (u.trialQueriesLeft == null ? "—" : u.trialQueriesLeft) + " 次";
  $("header-sub").textContent = lv + (u.expireAt ? " · 至 " + new Date(u.expireAt).toLocaleDateString() : "") + extra;
  if ($("lookup-hint")) $("lookup-hint").textContent = u.level === "trial"
    ? "体验会员剩余 " + (u.trialQueriesLeft == null ? "—" : u.trialQueriesLeft) + " 次"
    : "会员有效期内估值按档位开放。";
  
  } else {
    $("header-sub").textContent = lv + " · 剩余免费查询 " + (u.freeQueriesLeft || 0) + " 次";
    if ($("lookup-hint")) $("lookup-hint").textContent = "已登录。注册查询剩余 " + (u.freeQueriesLeft || 0) + " 次。";
  }
}

function levelTagText(a) {
  if (a.visibility === "public") return "公开";
  const min = a.minLevel || "trial";
  if (min === "svip") return "SVIP";
  if (min === "vip") return "VIP、SVIP";
  return "体验、VIP、SVIP";
}


function articleCard(a) {
  const el = document.createElement("section");
  el.className = "card article-card";
  el.innerHTML = '<span class="level-tag"></span><h2></h2><p></p>';
  el.querySelector(".level-tag").textContent = levelTagText(a);

  
  el.querySelector("h2").textContent = a.title || "";
  el.querySelector("p").textContent = a.summary || "";
  el.addEventListener("click", function () { openArticle(a.id); });
  return el;
}

function renderPublicList() {
  const box = $("public-list");
  box.innerHTML = "";
  

  const list = (state.articles || []).filter(function (a) { return a.published !== false && a.visibility === "public"; }).sort(byNewest);
  
  
  if (!list.length) {
    box.innerHTML = '<section class="card notice"><h3>暂无公开文章</h3></section>';
    return;
  }
  list.forEach(function (a) { box.appendChild(articleCard(a)); });
}


function articleTime(a) {
  var t = Number(a.publishedAt || a.createdAt || 0);
  if (t) return t;
  var m = String(a.id || "").match(/(\d{13})/);
  return m ? Number(m[1]) : 0;
}


function byNewest(a, b) {
  var pa = a.pinned ? 1 : 0;
  var pb = b.pinned ? 1 : 0;
  if (pa !== pb) return pb - pa;
  return articleTime(b) - articleTime(a);
}


function renderMemberList() {
  const u = currentUser();
  if ($("members-gate")) $("members-gate").style.display = u ? "none" : "block";
  const box = $("member-list");
  if (!box) return;
  box.innerHTML = "";
  const level = state.memberLevel || "trial";
  document.querySelectorAll("#member-tabs .tab").forEach(function (btn) {
    btn.classList.toggle("on", btn.dataset.level === level);
  });

  const list = (state.articles || []).filter(function (a) {
    return a.published !== false && a.visibility === "members" && (a.minLevel || "trial") === level;
  }).sort(byNewest);
  if (!list.length) {
    box.innerHTML = '<section class="card notice"><h3>暂无</h3></section>';
    return;
  }
  list.forEach(function (a) { box.appendChild(articleCard(a)); });
}




function canSeePrivate(article) {
  const u = currentUser();
  if (!u) return false;
  return rankOf(u.level) >= rankOf(article.minLevel || "trial");
}



function openArticle(id) {
  const a = (state.articles || []).find(function (x) { return x.id === id; });
  if (!a) return;
  state.lastArticleList = a.visibility === "public" ? "public" : "members";
  const box = $("article-box");
  box.innerHTML = '<span class="level-tag"></span><h2></h2><div class="body" id="art-public"></div><div id="art-public-imgs" class="shots"></div><div id="art-private"></div>';
  box.querySelector("h2").textContent = a.title || "";
  box.querySelector("#art-public").textContent = a.publicBody || a.summary || "";
  const pub = box.querySelector("#art-public-imgs");
  (a.publicImages || []).forEach(function (src) {
    const img = document.createElement("img");
    img.src = src;
    pub.appendChild(img);
  });
  const priv = box.querySelector("#art-private");
  if (!currentUser() && a.visibility === "members") {
    priv.innerHTML = '<div class="lock-box"><p>登录注册会员可查更多      。</p></div>';
    showView("article");
    return;
  }
  if (a.visibility === "members" && !canSeePrivate(a)) {
    priv.innerHTML = '<div class="lock-box"><p>完整内容需开通对应会员。</p></div>';
    showView("article");
    return;
  }
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = a.privateBody || "";
  priv.appendChild(body);
  (a.privateImages || []).forEach(function (src) {
    const img = document.createElement("img");
    img.src = src;
    img.style.width = "100%";
    priv.appendChild(img);
  });
  showView("article");
}

function renderPlans() {
  const grid = $("plan-grid");
  grid.innerHTML = "";
  Object.keys(PLANS).forEach(function (id) {
    const plan = PLANS[id];
    const card = document.createElement("section");
    card.className = "card plan-card";
    card.innerHTML =
      '<div class="level-tag">' + plan.name + "</div>" +
      '<div class="price">' + plan.price + " 元</div>" +
      '<p class="hint">' + plan.days + " 天</p>" +
      "<ul><li>" + plan.queries + "</li><li>" + plan.articles + "</li>" + (plan.extras || []).map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ul>" +



      
      '<button class="primary" type="button">开通' + plan.name + "</button>";
    card.querySelector("button").addEventListener("click", function () { startVipOrder(plan.id); });
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
  const pending = { type: "vip", planId: planId, orderId: orderId, phone: u.phone };
  sessionStorage.setItem("pending-vip", JSON.stringify(pending));
  const db = ensureStore();
  db.orders.push({ orderId: orderId, type: "vip", planId: planId, phone: u.phone, amount: plan.price, status: "pending", createdAt: Date.now() });
  saveStore(db);
  $("v-plan-name").textContent = plan.name;
  $("v-amount").textContent = String(plan.price);
  $("v-order").textContent = orderId;
  $("vip-paywall").classList.add("show");
  $("vip-paywall").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function refreshVip() {
  const pending = JSON.parse(sessionStorage.getItem("pending-vip") || "null");
  const phone = (pending && pending.phone) || (currentUser() && currentUser().phone) || "";
  const remote = await apiTry("POST", "/vip/status", {
    phone: phone,
    order: pending && pending.orderId,
    plan: pending && pending.planId
  }, authHeaders());
  if (remote && remote.ok && remote.user && rankOf(remote.user.level) > 0) {
    saveSession(remote.user);
    if ($("vip-paywall")) $("vip-paywall").classList.remove("show");
    showView("me");
    return;
  }
  const me = await apiTry("GET", "/me", null, authHeaders());
  if (me && me.user && rankOf(me.user.level) > 0) {
    saveSession(me.user);
    if ($("vip-paywall")) $("vip-paywall").classList.remove("show");
    showView("me");
    return;
  }
  alert("还没查到会员开通记录。请确认管理页开通的是当前登录手机号，然后退出重新登录。");
}


function applyPlan(phone, planId) {
  const plan = PLANS[planId];
  const db = ensureStore();
  const user = db.users[phone] || { phone: phone, level: "none", freeQueriesLeft: 5, token: "local-" + phone };
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
    box.innerHTML = "<h3>未登录</h3><p>登录后可查看会员档位与到期时间。</p>";
    return;
  }
  const exp = u.expireAt ? new Date(u.expireAt).toLocaleString() : "未开通";
  var extra = "";
  if (!u.level || u.level === "none") {
    extra = "<p>注册免费估值剩余：" + (u.freeQueriesLeft || 0) + " 次</p>";
  }
  box.innerHTML =
    "<h3>我的账号</h3>" +
    "<p>手机号：" + maskPhone(u.phone) + "</p>" +
    "<p>当前身份：" + (LEVEL_LABEL[u.level] || u.level) + "</p>" +
    "<p>到期时间：" + (u.level === "none" ? "—" : exp) + "</p>" +
    extra +
    '<div class="actions" style="margin-top:12px">' +
    '<button class="primary" id="me-plans" type="button">开通 / 升级</button>' +
    '<button class="ghost" id="me-logout" type="button">退出登录</button>' +
    "</div>";
  $("me-plans").onclick = function () { showView("plans"); };
  $("me-logout").onclick = function () {
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
  const me = await apiTry("GET", "/me", null, authHeaders());
  if (me && me.user) saveSession(me.user);
  else if (currentUser()) saveSession(null);
  ensureStore();

  if ($("csv-url")) $("csv-url").value = currentCsvUrl();
  if ($("api-url")) $("api-url").value = currentApiBase();
  renderAccount();
  renderPlans();
  setStatus("正在连接数据源…");
  try {
    await loadArticles();
   state.articlesLoaded = true;
   if (state.view === "public") renderPublicList();
   if (state.view === "members") renderMemberList();
    
    
    if (currentApiBase()) {
      PAY.apiBase = currentApiBase();
      await loadCatalog();
      setStatus("已连接云函数");
      renderChips();
      return;
    }
    await Promise.all([loadCsv(currentCsvUrl()), loadPaidList()]);
    setStatus("本地演示表 " + state.rows.length + " 只");
    renderChips();
  } catch (err) {
    setStatus("加载失败：" + err.message);
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
  boot().then(function () { setStatus("已更新数据源并重新加载。"); });
}

function resetUrl() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("stock-pwa-api");
  if ($("csv-url")) $("csv-url").value = DEFAULT_CSV;
  if ($("api-url")) $("api-url").value = PAY.apiBase || "";
  boot();
}

$("copy-order").addEventListener("click", async function () {
  const text = $("p-order").textContent || "";
  try {
    await navigator.clipboard.writeText(text);
    setStatus("订单号已复制");
  } catch (e) {
    setStatus("请长按订单号复制");
  }
});

$("paid-refresh").addEventListener("click", async function () {
  setStatus("正在核对付款…");
  const pending = JSON.parse(sessionStorage.getItem("pending-order") || "null");
  if (currentApiBase() && pending) {
    const ok = await reveal(pending.code, pending.orderId);
    setStatus(ok ? "已确认付款，估值已解锁。" : "还没查到这笔订单。");
    return;
  }
  await lookup();
});

$("lookup").addEventListener("click", lookup);
$("query").addEventListener("keydown", function (e) {
  if (e.key === "Enter") lookup();
});
$("toggle-settings").addEventListener("click", function () { $("settings").classList.toggle("open"); });
$("save-url").addEventListener("click", saveUrl);
$("reset-url").addEventListener("click", resetUrl);
$("btn-account").addEventListener("click", function () {
  if (currentUser()) showView("me");
  else openLogin();
});
$("close-login").addEventListener("click", closeLogin);
$("members-login").addEventListener("click", openLogin);
$("members-plans").addEventListener("click", function () { showView("plans"); });
$("go-plans").addEventListener("click", function () { showView("plans"); });
$("article-back").addEventListener("click", function () { showView(state.lastArticleList || "public"); });
$("send-sms").addEventListener("click", async function () {
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
$("do-login").addEventListener("click", async function () {
  const phone = $("login-phone").value.trim();
  const code = $("login-code").value.trim();
  try {
    await loginWithSms(phone, code);
    closeLogin();
    renderMemberList();
  } catch (err) {
    $("login-msg").textContent = err.message;
  }
});
$("copy-vip-order").addEventListener("click", async function () {
  try {
    await navigator.clipboard.writeText($("v-order").textContent || "");
    alert("订单号已复制");
  } catch (e) {
    alert("请长按订单号复制");
  }
});
$("vip-refresh").addEventListener("click", refreshVip);
$("tabs").addEventListener("click", function (e) {
  const btn = e.target.closest("[data-view]");
  if (!btn) return;
  showView(btn.dataset.view);
});


const memberTabs = $("member-tabs");
if (memberTabs) {
  memberTabs.addEventListener("click", function (e) {
    const btn = e.target.closest("[data-level]");
    if (!btn) return;
    state.memberLevel = btn.dataset.level;
    renderMemberList();
  });
}




if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(function () {});
}

boot();
