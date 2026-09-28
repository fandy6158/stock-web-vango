const DEFAULT_CSV = "./data/stocks.csv";
const STORAGE_KEY = "stock-pwa-csv-url";

// 个人收款码无法自动通知网页。真正自动验单需要微信支付商户号。
// 当前流程：生成订单号 → 用户付款并填备注 → 你在微信看到到账后，把订单号写入 data/paid.json → 用户点刷新。
const PAY = {
  enabled: true,
  amount: "9.99",
  qrSrc: "./icons/wechat-pay.jpg",
  wechat: "WuFan",
  paidListUrl: "./data/paid.json",
  apiBase: "https://stock-api-tvzvtpfrip.cn-hangzhou.fcapp.run"
};

function apiUrl(path, params) {
  const base = currentApiBase();
  const url = new URL(base + path);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v) url.searchParams.set(k, v);
  });
  return url.toString();
}

function useCloudApi() {
  return Boolean((PAY.apiBase || localStorage.getItem("stock-pwa-api") || "").trim());
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
  paid: []
};

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
          if (text[i + 1] === '"') {
            cur += '"';
            i += 2;
            continue;
          }
          quoted = false;
          i += 1;
          continue;
        }
        cur += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        quoted = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        cols.push(cur.trim());
        cur = "";
        i += 1;
        continue;
      }
      if (ch === "\n") {
        cols.push(cur.trim());
        i += 1;
        return cols;
      }
      if (ch === "\r") {
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
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
    header.forEach((key, idx) => {
      obj[key] = cols[idx] ?? "";
    });
    rows.push(obj);
  }
  return rows;
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\.SS$|\.SZ$|\.HK$|\.US$/i, "");
}

function ratingClass(rating) {
  if (/买|增持|强烈/.test(rating)) return "buy";
  if (/减|卖|回避/.test(rating)) return "sell";
  return "hold";
}

function formatPct(text) {
  if (!text) return "-";
  return text.includes("%") ? text : text;
}

function marginTone(text) {
  const n = parseFloat(String(text).replace("%", ""));
  if (Number.isNaN(n)) return "";
  return n >= 0 ? "up" : "down";
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
  if (!("代码" in rows[0]) && !("code" in rows[0])) {
    // still allow if first column exists
  }
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

function renderResult(row) {
  const box = $("result");
  $("r-code").textContent = row["代码"] || row.code || "";
  $("r-name").textContent = row["名称"] || row.name || "未知标的";
  $("r-industry").textContent = "已解锁完整计算结果";
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
  $("status").textContent = msg || "";
}

function showEmpty(msg) {
  $("result").classList.remove("show");
  $("paywall").classList.remove("show");
  setStatus(msg);
}

function makeOrderId(code) {
  const n = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `GU${normalizeCode(code)}-${n}`;
}

function isUnlocked(code, orderId) {
  const c = normalizeCode(code);
  return state.paid.some((item) => {
    const paidCode = normalizeCode(item.code || item.代码 || "");
    const paidOrder = String(item.order || item.订单号 || "").toUpperCase();
    if (orderId && paidOrder && paidOrder === String(orderId).toUpperCase()) return true;
    return paidCode && paidCode === c && item.unlocked !== false;
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

function showPaywall(row) {
  $("result").classList.remove("show");
  const code = row["代码"] || "";
  const orderId = makeOrderId(code);
  state.pending = { row, orderId };
  sessionStorage.setItem("pending-order", JSON.stringify({ code, orderId, name: row["名称"] }));
  $("p-code").textContent = code;
  $("p-name").textContent = row["名称"] || "未知标的";
  $("p-industry").textContent = row["行业"] || "已找到记录，付款后显示完整估值： 【单只个股付费查询后，后续重复查询将免费】！！";
  $("p-amount").textContent = PAY.amount;
  $("p-qr").src = PAY.qrSrc;
  $("p-order").textContent = orderId;
 
  $("p-note").textContent = `付款后如遇不显示查询结果，请加微信：Vango77  或 私信推特X:@ai18431588 `;

  
  $("paywall").classList.add("show");
}

async function loadCatalog() {
  const res = await fetch(apiUrl("/catalog"), { cache: "no-store" });
  if (!res.ok) throw new Error("云函数 catalog 失败");
  const data = await res.json();
  state.rows = data.items || [];
  state.source = currentApiBase();
}

async function boot() {
  $("csv-url").value = currentCsvUrl();
  if ($("api-url")) $("api-url").value = currentApiBase();
  setStatus("正在连接数据源…");
  try {
    if (currentApiBase()) {
      PAY.apiBase = currentApiBase();
      await loadCatalog();
      setStatus(`已连接云函数 `);
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

function renderChips() {
  const wrap = $("chips");
  wrap.innerHTML = "";
  state.rows.slice(0, 8).forEach((row) => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.type = "button";
    btn.textContent = `${row["代码"]} ${row["名称"]}`;
    btn.addEventListener("click", () => {
      $("query").value = row["代码"];
      lookup();
    });
    wrap.appendChild(btn);
  });
}

async function lookup() {
  const q = $("query").value;
  setStatus("正在查询…");
  try {
    if (currentApiBase()) {
      const res = await fetch(apiUrl("/lookup", { code: q }), { cache: "no-store" });
      const data = await res.json();
      if (!data.found) {
        showEmpty(data.message || `没有找到「${q}」`);
        return;
      }
      setStatus("");
      const pending = JSON.parse(sessionStorage.getItem("pending-order") || "null");
      const same = pending && normalizeCode(pending.code) === normalizeCode(data.item["代码"]);
      if (same) {
        const revealed = await reveal(data.item["代码"], pending.orderId);
        if (revealed) return;
      }
      showPaywall(data.item);
      return;
    }
    if (!state.rows.length) {
      showEmpty("估值表还没加载成功。");
      return;
    }
    const row = findStock(q);
    if (!row) {
      showEmpty(`没有找到「${q}」。可输入代码或名称，例如 600519 / 茅台 / AAPL。`);
      return;
    }
    setStatus("");
    if (!PAY.enabled) {
      renderResult(row);
      return;
    }
    const pending = JSON.parse(sessionStorage.getItem("pending-order") || "null");
    const orderId = pending && normalizeCode(pending.code) === normalizeCode(row["代码"]) ? pending.orderId : "";
    if (isUnlocked(row["代码"], orderId)) {
      $("paywall").classList.remove("show");
      renderResult(row);
      return;
    }
    showPaywall(row);
  } catch (err) {
    showEmpty("查询失败：" + err.message);
  }
}

async function reveal(code, orderId) {
  const res = await fetch(apiUrl("/reveal", { code, order: orderId }), { cache: "no-store" });
  const data = await res.json();
  if (data.ok && data.item) {
    $("paywall").classList.remove("show");
    renderResult(data.item);
    return true;
  }
  return false;
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
  setStatus("正在向云端核对付款…");
  const pending = JSON.parse(sessionStorage.getItem("pending-order") || "null");
  if (currentApiBase() && pending) {
    const ok = await reveal(pending.code, pending.orderId);
    setStatus(ok ? "已确认付款，估值已解锁。" : "还没查到这笔订单。请等作者把订单写入云端白名单后再点。");
    return;
  }
  await loadPaidList();
  await lookup();
  setStatus($("result").classList.contains("show") ? "已确认付款，估值已解锁。" : "还没查到这笔订单。");
});

$("lookup").addEventListener("click", lookup);
$("query").addEventListener("keydown", (e) => {
  if (e.key === "Enter") lookup();
});
$("toggle-settings").addEventListener("click", () => {
  $("settings").classList.toggle("open");
});
$("save-url").addEventListener("click", saveUrl);
$("reset-url").addEventListener("click", resetUrl);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

boot();
