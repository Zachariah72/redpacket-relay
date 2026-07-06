const state = {
  data: null,
  activeTab: "overview",
  health: "yellow",
  healthLabel: "Starting",
  heartbeat: [],
  lastHealthCheck: null,
  diagnostics: null,
  installPrompt: null
};

const displayText = {
  created: "created",
  rejected: "rejected",
  matched: "matched",
  ready: "ready",
  missing: "missing",
  authorized: "authorized",
  blocked: "blocked",
  online: "online",
  offline: "offline",
  basic: "basic mode",
  simulation: "simulation",
  production: "production",
  monitor: "monitor",
  admin: "admin",
  viewer: "viewer",
  critical: "critical",
  warning: "warning",
  info: "info"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function replaceContent(target, children) {
  const element = typeof target === "string" ? $(target) : target;
  if (!element) return;
  while (element.firstChild) element.removeChild(element.firstChild);
  children.forEach((child) => element.appendChild(child));
}

function formEntries(form) {
  const data = {};
  Array.from(form.elements).forEach((element) => {
    if (!element.name || element.disabled) return;
    data[element.name] = element.type === "checkbox" ? (element.checked ? "on" : "") : element.value;
  });
  return data;
}

function text(value) {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function display(value) {
  return displayText[value] || displayText[String(value || "").toLowerCase()] || text(value);
}

function normalizeLegacyText(value) {
  const original = text(value);
  const actionNames = {
    event_ingested: "event_ingested",
    config_updated: "config_updated",
    autofix_applied: "autofix_applied",
    admin_alert: "admin_alert"
  };
  return actionNames[original] || original;
}

function formatAmount(amount, currency = "CNY") {
  return `${Number(amount || 0).toFixed(2)} ${currency}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function todayTotal(transactions) {
  const day = new Date().toISOString().slice(0, 10);
  return transactions
    .filter((tx) => tx.createdAt && tx.createdAt.startsWith(day) && tx.status !== "rejected")
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
}

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function badge(label, type = label) {
  const el = document.createElement("span");
  el.className = `badge ${type}`;
  el.textContent = label;
  return el;
}

function pill(label) {
  const el = document.createElement("span");
  el.className = "pill";
  el.textContent = label;
  return el;
}

function cell(content) {
  const td = document.createElement("td");
  if (content instanceof Node) td.append(content);
  else td.textContent = text(content);
  return td;
}

function emptyRow(colspan, message) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = colspan;
  td.textContent = message;
  tr.append(td);
  return tr;
}

function setMessage(message, isError = false) {
  $("#action-message").textContent = normalizeLegacyText(message);
  $("#action-message").classList.toggle("error", isError);
  const eventResult = $("#event-result");
  if (eventResult) eventResult.textContent = normalizeLegacyText(message);
}

function operationalStatus(config) {
  return config.operationalStatus || "basic";
}

function coreReady(config) {
  return [
    config.sourceAccounts.some((account) => account.authorized),
    config.targetAmounts.length > 0,
    config.destinationRules.some((rule) => rule.recipients.length > 0),
    Number(config.limits.maxDailyAmount) > 0
  ].every(Boolean);
}

function healthLevel(config) {
  if (operationalStatus(config) === "offline") return "red";
  if (operationalStatus(config) === "online" && coreReady(config)) return "green";
  return "yellow";
}

function lastActivityTime(data) {
  const times = []
    .concat((data.transactions || []).map((tx) => tx.createdAt))
    .concat((data.events || []).map((event) => event.receivedAt))
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  return times.length ? Math.max(...times) : 0;
}

function effectiveHealthLevel(data) {
  const level = healthLevel(data.config);
  if (level !== "green") return level;
  const lastActivity = lastActivityTime(data);
  const idleForMs = lastActivity ? Date.now() - lastActivity : Infinity;
  return idleForMs > 30000 ? "gray" : "green";
}

function healthLabel(config, level = healthLevel(config)) {
  if (level === "green") return "Online";
  if (level === "gray") return "Idle";
  if (level === "red") return "Offline";
  return "Basic Mode";
}

function setHealth(level, label) {
  state.health = level;
  state.healthLabel = label;
  state.lastHealthCheck = new Date();
  const displayLabel = level === "green" || level === "gray" ? label : "";
  ["#status", "#health-chip"].forEach((selector) => {
    const element = $(selector);
    if (!element) return;
    element.classList.remove("green", "yellow", "red", "gray");
    element.classList.add(level);
    element.innerHTML = displayLabel ? `<i></i><span>${displayLabel}</span>` : "<i></i>";
  });
  renderBotHealth();
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function renderTabs() {
  if (!$(`.tab[data-tab="${state.activeTab}"]`) || !$(`#tab-${state.activeTab}`)) {
    state.activeTab = "overview";
  }
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === state.activeTab));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${state.activeTab}`));
  const activeButton = $(`.tab[data-tab="${state.activeTab}"]`);
  if ($("#page-title") && activeButton) $("#page-title").textContent = activeButton.textContent;
}

function openTab(tabName) {
  state.activeTab = tabName;
  renderTabs();
}

window.openTab = openTab;

function readinessItems(config, providerStatus = null) {
  const merchant = config.merchant || {};
  return [
    {
      title: "Authorized source accounts",
      ready: config.sourceAccounts.some((account) => account.authorized),
      detail: `${config.sourceAccounts.filter((account) => account.authorized).length} account(s) enabled`
    },
    {
      title: "Target amount rules",
      ready: config.targetAmounts.length > 0,
      detail: config.targetAmounts.length ? config.targetAmounts.join(", ") : "No target amounts configured"
    },
    {
      title: "Destination routing",
      ready: config.destinationRules.some((rule) => rule.recipients.length > 0),
      detail: `${config.destinationRules.length} source group rule(s)`
    },
    {
      title: "Daily limit",
      ready: Number(config.limits.maxDailyAmount) > 0,
      detail: `${formatAmount(config.limits.maxDailyAmount, config.limits.currency)} maximum`
    },
    {
      title: "Bot operating state",
      ready: operationalStatus(config) === "online",
      detail: operationalStatus(config) === "online" ? "Local transaction workflow enabled" : `Currently ${display(operationalStatus(config))}`
    },
    {
      title: "Merchant credentials",
      ready: Boolean(merchant.mchid && merchant.appid && merchant.productEnabled),
      detail: merchant.mchid && merchant.appid && merchant.productEnabled
        ? "Production credentials marked ready"
        : "Optional for local online simulation"
    },
    {
      title: "API provider",
      ready: merchant.providerMode === "wechatpay-v3" ? Boolean(providerStatus && providerStatus.canUseLive) : true,
      detail: merchant.providerMode === "wechatpay-v3"
        ? (providerStatus && providerStatus.canUseLive ? "Official WeChat Pay v3 provider ready" : "Official provider needs live credentials")
        : "Simulation payout provider active"
    }
  ];
}

function readinessScore(config, providerStatus = null) {
  const items = readinessItems(config, providerStatus);
  return items.length ? Math.round((items.filter((item) => item.ready).length / items.length) * 100) : 0;
}

function renderSelectors(config) {
  replaceContent(
    $('[name="sourceAccountId"]'),
    config.sourceAccounts.map((account) => option(account.id, `${normalizeLegacyText(account.name)} (${display(account.role)})`))
  );
  replaceContent($('[name="sourceGroupId"]'), config.destinationRules.map((rule) => option(rule.sourceGroupId, normalizeLegacyText(rule.sourceGroupName))));
}

function renderMetrics(data) {
  const created = data.transactions.filter((tx) => tx.status === "created").length;
  const rejected = data.transactions.filter((tx) => tx.status === "rejected").length;
  $("#metric-total").textContent = formatAmount(todayTotal(data.transactions), data.config.limits.currency);
  $("#metric-created").textContent = created;
  $("#metric-rejected").textContent = rejected;
  $("#metric-limit").textContent = formatAmount(data.config.limits.maxDailyAmount, data.config.limits.currency);
  $("#side-mode").textContent = data.config.mode;
  const level = effectiveHealthLevel(data);
  setHealth(level, healthLabel(data.config, level));
}

function renderReadiness(config, providerStatus = null) {
  replaceContent(
    "#readiness-list",
    readinessItems(config, providerStatus).map((item) => {
      const el = document.createElement("div");
      el.className = "check-item";
      el.append(badge(item.ready ? "ready" : "missing", item.ready ? "ready" : "missing"));
      const title = document.createElement("h4");
      title.textContent = item.title;
      const detail = document.createElement("p");
      detail.textContent = item.detail;
      el.append(title, detail);
      return el;
    })
  );
}

function renderRecentActivity(data) {
  const items = data.transactions.slice(0, 6).map((tx) => {
    const el = document.createElement("div");
    el.className = "activity";
    const left = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = tx.externalId;
    const detail = document.createElement("p");
    detail.textContent = `${formatAmount(tx.amount, tx.currency)} from ${tx.sourceGroupId}`;
    left.append(title, detail);
    el.append(left, badge(display(tx.status), tx.status));
    return el;
  });
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "activity";
    empty.textContent = "No activity yet.";
    items.push(empty);
  }
  replaceContent("#recent-activity", items);
}

function renderConfig(config) {
  const merchant = config.merchant || {};
  $("#target-amounts").value = config.targetAmounts.join(", ");
  $("#daily-limit").value = config.limits.maxDailyAmount;
  $("#currency").value = config.limits.currency;
  $("#provider-mode").value = merchant.providerMode || "simulation";
  $("#merchant-id").value = merchant.mchid || "";
  $("#merchant-appid").value = merchant.appid || "";
  $("#merchant-serial-no").value = merchant.serialNo || "";
  $("#callback-url").value = merchant.callbackUrl || "";
  $("#notify-url").value = merchant.notifyUrl || "";
  $("#transfer-endpoint").value = merchant.transferEndpoint || "";
  $("#product-enabled").value = String(Boolean(merchant.productEnabled));
}

function renderRules(rules) {
  replaceContent(
    "#rules",
    rules.map((rule) => {
      const card = document.createElement("article");
      card.className = "card";
      const head = document.createElement("div");
      head.className = "card-head";
      const titleWrap = document.createElement("div");
      const title = document.createElement("h4");
      title.textContent = normalizeLegacyText(rule.sourceGroupName);
      const desc = document.createElement("p");
      desc.textContent = `Routes to ${normalizeLegacyText(rule.destinationGroupName)}`;
      titleWrap.append(title, desc);
      const actions = document.createElement("div");
      actions.className = "card-actions";
      actions.append(badge(`${rule.recipients.length} recipient(s)`, "ready"));
      const remove = document.createElement("button");
      remove.className = "ghost danger small";
      remove.type = "button";
      remove.dataset.removeRule = rule.id;
      remove.textContent = "Remove";
      actions.append(remove);
      head.append(titleWrap, actions);
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.append(pill(`Source ${rule.sourceGroupId}`), pill(`Destination ${rule.destinationGroupId}`));
      rule.recipients.forEach((recipient) => meta.append(pill(normalizeLegacyText(recipient.displayName || recipient.openid))));
      card.append(head, meta);
      return card;
    })
  );
}

function renderAccounts(accounts) {
  replaceContent(
    "#accounts",
    accounts.map((account) => {
      const card = document.createElement("article");
      card.className = "card";
      const head = document.createElement("div");
      head.className = "card-head";
      const titleWrap = document.createElement("div");
      const title = document.createElement("h4");
      title.textContent = normalizeLegacyText(account.name);
      const desc = document.createElement("p");
      desc.textContent = `${account.id} / ${display(account.role)}`;
      titleWrap.append(title, desc);
      const actions = document.createElement("div");
      actions.className = "card-actions";
      actions.append(badge(account.authorized ? "authorized" : "blocked", account.authorized ? "ready" : "blocked"));
      const toggle = document.createElement("button");
      toggle.className = "ghost small";
      toggle.type = "button";
      toggle.dataset.toggleAccount = account.id;
      toggle.textContent = account.authorized ? "Block" : "Authorize";
      const remove = document.createElement("button");
      remove.className = "ghost danger small";
      remove.type = "button";
      remove.dataset.removeAccount = account.id;
      remove.textContent = "Remove";
      actions.append(toggle, remove);
      head.append(titleWrap, actions);
      card.append(head);
      return card;
    })
  );
}

function renderMerchant(config, providerStatus = null) {
  const merchant = config.merchant || {};
  if (!providerStatus || merchant.providerMode !== "wechatpay-v3") {
    $("#merchant-summary").textContent = "Simulation provider is active. Switch to Official WeChat Pay v3 only after merchant approval and credentials are ready.";
    replaceContent("#provider-checklist", []);
    return;
  }

  $("#merchant-summary").textContent = providerStatus.canUseLive
    ? "Official WeChat Pay v3 live provider is ready. New accepted payouts will use the signed API path."
    : `Official WeChat Pay v3 is selected but not ready. Missing: ${providerStatus.missing.join(", ")}.`;

  replaceContent(
    "#provider-checklist",
    providerStatus.requirements.map((item) => {
      const row = document.createElement("div");
      row.className = "provider-check";
      row.append(badge(item.ready ? "ready" : "missing", item.ready ? "ready" : "missing"));
      const label = document.createElement("span");
      label.textContent = item.label;
      row.append(label);
      return row;
    })
  );
}

function latestAcceptedTransaction(data) {
  return data.transactions.find((tx) => tx.status === "created") || null;
}

function findRuleForTransaction(config, transaction) {
  if (!transaction) return null;
  return config.destinationRules.find((rule) => rule.destinationGroupId === transaction.destinationGroupId)
    || config.destinationRules.find((rule) => rule.sourceGroupId === transaction.sourceGroupId)
    || null;
}

function renderWeChatHandoff(data) {
  const tx = latestAcceptedTransaction(data);
  const rule = findRuleForTransaction(data.config, tx);
  const merchant = data.config.merchant || {};
  const demoMode = merchant.providerMode !== "wechatpay-v3";
  const providerReady = Boolean(data.providerStatus && data.providerStatus.canUseLive);
  const recipientLabel = rule && rule.recipients.length
    ? `${rule.destinationGroupName} / ${rule.recipients.length} recipient(s)`
    : "No recipient route found";

  $("#wechat-envelope-amount").textContent = tx ? formatAmount(tx.amount, tx.currency) : "0.00 CNY";
  $("#wechat-envelope-recipient").textContent = tx ? recipientLabel : "Waiting for accepted transaction";
  $("#wechat-handoff-title").textContent = tx ? `Ready for ${tx.externalId}` : "No accepted payout selected";
  $("#wechat-handoff-summary").textContent = tx
    ? `${formatAmount(tx.amount, tx.currency)} is staged for ${tx.destinationGroupId || "the configured destination group"}.`
    : "Run a matching event to generate a red-envelope handoff preview.";
  $("#wechat-handoff-note").textContent = demoMode
    ? "Demo launch opens WeChat and records the handoff. It does not send a real red packet or control the WeChat screen."
    : providerReady
    ? "Official WeChat Pay provider is ready. Accepted payouts can run through the signed API path."
    : "Official WeChat Pay merchant credentials are required for production payout delivery.";

  const meta = [];
  if (tx) {
    meta.push(["External ID", tx.externalId]);
    meta.push(["Date & Time", formatDate(tx.createdAt)]);
    meta.push(["Source", tx.sourceGroupId]);
    meta.push(["Destination", tx.destinationGroupId || "-"]);
    meta.push(["Provider Batch", tx.providerResult ? tx.providerResult.providerBatchId : "-"]);
    meta.push(["Mode", demoMode ? "Demo" : "Official provider"]);
    meta.push(["Provider Ready", providerReady ? "Yes" : "No"]);
  }

  replaceContent(
    "#wechat-handoff-meta",
    meta.map(([label, value]) => {
      const row = document.createElement("div");
      const key = document.createElement("span");
      key.textContent = label;
      const val = document.createElement("strong");
      val.textContent = value;
      row.append(key, val);
      return row;
    })
  );

  $("#copy-wechat-reference").disabled = !tx;
  $("#open-wechat-placeholder").disabled = !tx;
  $("#open-wechat-placeholder").textContent = demoMode
    ? "Open WeChat Demo"
    : providerReady
      ? "Initiate WeChat"
      : "Credentials Required";
}

function renderTransactions(transactions) {
  const rows = transactions.map((tx) => {
    const tr = document.createElement("tr");
    tr.append(
      cell(badge(display(tx.status), tx.status)),
      cell(tx.externalId),
      cell(formatAmount(tx.amount, tx.currency)),
      cell(tx.sourceGroupId),
      cell(tx.destinationGroupId),
      cell(tx.providerResult ? tx.providerResult.providerBatchId : "-"),
      cell(formatDate(tx.createdAt)),
      cell(normalizeLegacyText(tx.reason))
    );
    return tr;
  });
  if (!rows.length) rows.push(emptyRow(8, "No transactions yet."));
  replaceContent("#transactions", rows);
}

function renderEvents(events) {
  const rows = events.map((event) => {
    const tr = document.createElement("tr");
    tr.append(
      cell(badge(display(event.decision), event.decision)),
      cell(event.externalId),
      cell(formatAmount(event.amount, event.currency)),
      cell(event.sourceAccountId),
      cell(event.sourceGroupId),
      cell(formatDate(event.receivedAt))
    );
    return tr;
  });
  if (!rows.length) rows.push(emptyRow(6, "No events ingested yet."));
  replaceContent("#events", rows);
}

function renderAudit(auditLog) {
  const items = auditLog.map((entry) => {
    const el = document.createElement("div");
    el.className = "timeline-item";
    const title = document.createElement("strong");
    title.textContent = normalizeLegacyText(entry.action);
    const message = document.createElement("p");
    message.textContent = normalizeLegacyText(entry.message);
    const time = document.createElement("p");
    time.textContent = formatDate(entry.createdAt);
    el.append(title, message, time);
    return el;
  });
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "timeline-item";
    empty.textContent = "No audit records yet.";
    items.push(empty);
  }
  replaceContent("#audit-log", items);
}

function heartbeatValue() {
  if (state.health === "red") return 18 + Math.random() * 8;
  if (state.health === "gray") return 30 + Math.random() * 8;
  if (state.health === "yellow") return 48 + Math.random() * 18;
  return 74 + Math.random() * 16;
}

function pushHeartbeat() {
  state.heartbeat.push(heartbeatValue());
  state.heartbeat = state.heartbeat.slice(-48);
}

function heartbeatPoints(values) {
  const samples = values.length ? values : [40, 44, 42, 52, 38, 43];
  const width = 900;
  const height = 160;
  const step = width / Math.max(samples.length - 1, 1);
  return samples
    .map((value, index) => {
      const spike = index % 8 === 4 ? 34 : 0;
      const y = height - Math.min(130, Math.max(16, value + spike));
      return `${Math.round(index * step)},${Math.round(y)}`;
    })
    .join(" ");
}

function renderHealthBars(config) {
  if (!$("#health-bars")) return;
  const bars = readinessItems(config, state.data ? state.data.providerStatus : null).map((item) => {
    const row = document.createElement("div");
    row.className = "health-bar-row";
    const label = document.createElement("div");
    label.className = "health-bar-label";
    label.innerHTML = `<span>${item.title}</span><strong>${item.ready ? "Ready" : "Missing"}</strong>`;
    const track = document.createElement("div");
    track.className = "health-bar-track";
    const fill = document.createElement("div");
    fill.className = item.ready ? "ready" : "missing";
    fill.style.width = item.ready ? "100%" : "34%";
    track.append(fill);
    row.append(label, track);
    return row;
  });
  replaceContent("#health-bars", bars);
}

function renderHealthTicker(data) {
  if (!$("#health-ticker")) return;
  const txItems = data.transactions.slice(0, 5).map((tx) => ({
    time: tx.createdAt,
    text: `${display(tx.status).toUpperCase()} / ${tx.externalId} / ${formatAmount(tx.amount, tx.currency)}`
  }));
  const auditItems = data.auditLog.slice(0, 4).map((entry) => ({
    time: entry.createdAt,
    text: `${normalizeLegacyText(entry.action)}: ${normalizeLegacyText(entry.message)}`
  }));
  const items = txItems.concat(auditItems)
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
    .slice(0, 8)
    .map((item) => {
      const row = document.createElement("div");
      row.className = "ticker-row";
      const time = document.createElement("span");
      time.textContent = formatDate(item.time);
      const textNode = document.createElement("strong");
      textNode.textContent = item.text;
      row.append(time, textNode);
      return row;
    });
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "ticker-row";
    empty.innerHTML = "<span>--</span><strong>Waiting for bot activity</strong>";
    items.push(empty);
  }
  replaceContent("#health-ticker", items);
}

function renderDiagnostics() {
  const diagnostics = state.diagnostics;
  const list = $("#issue-list");
  if (!list) return;

  if (!diagnostics) {
    $("#autofix-summary").textContent = "Checking issues";
    replaceContent(list, []);
    return;
  }

  const items = diagnostics.issues.concat(diagnostics.warnings);
  $("#autofix-summary").textContent = items.length
    ? `${diagnostics.issues.length} blocker(s), ${diagnostics.warnings.length} warning(s)`
    : "No live issues detected";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "issue-row ready";
    empty.innerHTML = "<strong>All clear</strong><p>No active blockers are hindering local bot operations.</p>";
    replaceContent(list, [empty]);
    return;
  }

  replaceContent(
    list,
    items.map((issue) => {
      const row = document.createElement("div");
      row.className = `issue-row ${issue.severity}`;
      const head = document.createElement("div");
      head.className = "issue-head";
      const title = document.createElement("strong");
      title.textContent = normalizeLegacyText(issue.title);
      const severity = document.createElement("span");
      severity.textContent = display(issue.severity);
      head.append(title, severity);
      const detail = document.createElement("p");
      detail.textContent = normalizeLegacyText(issue.detail);
      const fix = document.createElement("p");
      fix.className = "issue-fix";
      fix.textContent = normalizeLegacyText(issue.fix);
      row.append(head, detail, fix);
      return row;
    })
  );
}

function renderBotHealth() {
  if (!state.data) return;
  const config = state.data.config;
  const score = readinessScore(config, state.data.providerStatus);
  const label = healthLabel(config, state.health);
  const statusCard = $("#health-status-card");

  if (statusCard) {
    statusCard.classList.remove("green", "yellow", "red", "gray");
    statusCard.classList.add(state.health);
  }
  if ($("#health-status-label")) $("#health-status-label").textContent = label;
  if ($("#heartbeat-label")) {
    $("#heartbeat-label").textContent = state.health === "red"
      ? "Signal interrupted"
      : state.health === "gray"
        ? "Idle"
        : "Pulse active";
  }
  if ($("#heartbeat-time")) $("#heartbeat-time").textContent = state.lastHealthCheck ? formatDate(state.lastHealthCheck) : "--";
  if ($("#heartbeat-line")) $("#heartbeat-line").setAttribute("points", heartbeatPoints(state.heartbeat));
  if ($("#readiness-gauge")) $("#readiness-gauge").style.setProperty("--value", score);
  if ($("#readiness-score")) $("#readiness-score").textContent = `${score}%`;
  if ($("#readiness-caption")) {
    const items = readinessItems(config, state.data.providerStatus);
    $("#readiness-caption").textContent = `${items.filter((item) => item.ready).length} of ${items.length} controls ready.`;
  }
  if ($("#health-runtime")) $("#health-runtime").textContent = display(operationalStatus(config));
  if ($("#health-runtime-note")) {
    $("#health-runtime-note").textContent = state.health === "gray"
      ? "Bot is online and waiting for activity."
      : operationalStatus(config) === "online"
      ? "Local transaction workflow is accepting events."
      : operationalStatus(config) === "offline"
        ? "Event intake is paused until the bot is brought online."
        : "Basic mode is available for setup and checks.";
  }
  if ($("#health-last-check")) $("#health-last-check").textContent = state.lastHealthCheck ? formatDate(state.lastHealthCheck) : "--";
  if ($("#health-tx-count")) $("#health-tx-count").textContent = state.data.transactions.length;
  if ($("#health-volume")) $("#health-volume").textContent = formatAmount(todayTotal(state.data.transactions), config.limits.currency);
  renderHealthBars(config);
  renderHealthTicker(state.data);
  renderDiagnostics();
}

function render(data) {
  state.data = data;
  renderSelectors(data.config);
  renderMetrics(data);
  renderReadiness(data.config, data.providerStatus);
  renderRecentActivity(data);
  renderConfig(data.config);
  renderRules(data.config.destinationRules);
  renderAccounts(data.config.sourceAccounts);
  renderMerchant(data.config, data.providerStatus);
  renderWeChatHandoff(data);
  renderTransactions(data.transactions);
  renderEvents(data.events);
  renderAudit(data.auditLog);
  renderBotHealth();
  renderTabs();
}

function automaticOperationalStatus(config) {
  if (operationalStatus(config) === "offline") return "offline";
  return coreReady(config) ? "online" : "basic";
}

async function syncAutomaticOperationalStatus(data) {
  const desiredStatus = automaticOperationalStatus(data.config);
  if (desiredStatus === operationalStatus(data.config)) return data;
  const config = clone(data.config);
  config.operationalStatus = desiredStatus;
  if (desiredStatus === "online") config.mode = config.mode || "simulation";
  await api("/api/config", {
    method: "PUT",
    body: JSON.stringify(config)
  });
  return api("/api/state");
}

async function refresh() {
  try {
    const data = await syncAutomaticOperationalStatus(await api("/api/state"));
    render(data);
    await refreshDiagnostics();
  } catch (error) {
    setHealth("red", "Offline");
    throw error;
  }
}

async function refreshDiagnostics() {
  try {
    state.diagnostics = await api("/api/diagnostics");
    renderDiagnostics();
  } catch {
    state.diagnostics = {
      issues: [{
        id: "diagnostics-unavailable",
        severity: "critical",
        title: "Diagnostics unavailable",
        detail: "The admin diagnostics endpoint could not be reached.",
        fix: "Restart the bot server and refresh the console."
      }],
      warnings: []
    };
    renderDiagnostics();
  }
}

async function checkHealth() {
  try {
    const health = await api("/api/health");
    pushHeartbeat();
    if (!health.ok) {
      setHealth("red", "Issue");
      return;
    }
    if (!state.data) {
      setHealth("yellow", "Starting");
      return;
    }
    await refreshDiagnostics();
    const level = effectiveHealthLevel(state.data);
    setHealth(level, healthLabel(state.data.config, level));
  } catch {
    pushHeartbeat();
    setHealth("red", "Offline");
  }
}

function eventPayloadFromForm(form) {
  return formEntries(form);
}

function samplePayload() {
  const config = state.data.config;
  const firstRule = config.destinationRules[0];
  const firstAccount = config.sourceAccounts.find((account) => account.authorized) || config.sourceAccounts[0];
  return {
    externalId: `demo-${Date.now()}`,
    sourceAccountId: firstAccount.id,
    sourceGroupId: firstRule.sourceGroupId,
    amount: config.targetAmounts[0],
    rawText: "Authorized demo red packet event"
  };
}

function firstAuthorizedAccount(config) {
  return config.sourceAccounts.find((account) => account.authorized) || config.sourceAccounts[0];
}

function firstRoute(config) {
  return config.destinationRules[0];
}

function makeCasePayload(kind, suffix = Date.now()) {
  const config = state.data.config;
  const account = firstAuthorizedAccount(config);
  const route = firstRoute(config);
  const targetAmount = Number(config.targetAmounts[0] || 88);
  const base = {
    externalId: `case-${kind}-${suffix}`,
    sourceAccountId: account ? account.id : "acct-a",
    sourceGroupId: route ? route.sourceGroupId : "source-vip",
    amount: targetAmount,
    rawText: `Real scenario case: ${kind}`
  };
  if (kind === "wrong-amount") return { ...base, amount: targetAmount + 0.37 };
  if (kind === "unauthorized") return { ...base, sourceAccountId: "acct-unauthorized" };
  if (kind === "unknown-route") return { ...base, sourceGroupId: "source-unmapped" };
  return base;
}

function renderCaseResult(title, transaction) {
  const row = document.createElement("div");
  row.className = `case-result ${transaction.status}`;
  row.innerHTML = `
    <strong>${title}</strong>
    <span>${transaction.status}</span>
    <p>${normalizeLegacyText(transaction.reason)}</p>
  `;
  $("#case-results").prepend(row);
}

async function setTemporaryStatus(status) {
  const config = buildConfigFromState();
  const previous = config.operationalStatus || "basic";
  config.operationalStatus = status;
  await api("/api/config", {
    method: "PUT",
    body: JSON.stringify(config)
  });
  return previous;
}

async function restoreStatus(status) {
  const config = buildConfigFromState();
  config.operationalStatus = status;
  await api("/api/config", {
    method: "PUT",
    body: JSON.stringify(config)
  });
}

async function runCase(kind) {
  await refresh();
  const suffix = Date.now();
  if (kind === "offline") {
    const previous = await setTemporaryStatus("offline");
    await refresh();
    const result = await api("/api/events", {
      method: "POST",
      body: JSON.stringify(makeCasePayload(kind, suffix))
    });
    await restoreStatus(previous);
    await refresh();
    renderCaseResult("Offline Pause", result.transaction);
    return result;
  }

  const previous = await setTemporaryStatus("online");
  await refresh();
  if (kind === "duplicate") {
    const payload = makeCasePayload(kind, suffix);
    await api("/api/events", { method: "POST", body: JSON.stringify(payload) });
    const second = await api("/api/events", { method: "POST", body: JSON.stringify(payload) });
    await restoreStatus(previous);
    await refresh();
    renderCaseResult("Duplicate Protection", second.transaction);
    return second;
  }

  const result = await api("/api/events", {
    method: "POST",
    body: JSON.stringify(makeCasePayload(kind, suffix))
  });
  await restoreStatus(previous);
  await refresh();
  const labels = {
    matched: "Accepted Target Payout",
    "wrong-amount": "Amount Rejection",
    unauthorized: "Unauthorized Source",
    "unknown-route": "Unknown Route"
  };
  renderCaseResult(labels[kind] || kind, result.transaction);
  return result;
}

async function submitEvent(payload) {
  const result = await api("/api/events", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  setMessage(result.transaction.reason);
  await refresh();
}

function buildConfigFromState() {
  return clone(state.data.config);
}

async function saveConfig(config, message) {
  await api("/api/config", {
    method: "PUT",
    body: JSON.stringify(config)
  });
  setMessage(message);
  await refresh();
}

async function setOperatingStatus(status) {
  const config = buildConfigFromState();
  config.operationalStatus = status;
  if (status === "online") config.mode = config.mode || "simulation";
  await saveConfig(config, status === "offline" ? "Bot is offline. Transaction intake is paused." : "Bot operating status updated.");
}

function parseRecipients(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [openid, ...nameParts] = line.split(",");
      const cleanOpenid = openid.trim();
      return {
        openid: cleanOpenid,
        displayName: nameParts.join(",").trim() || cleanOpenid
      };
    })
    .filter((recipient) => recipient.openid);
}

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.activeTab = tab.dataset.tab;
    renderTabs();
  });
});

$("#refresh").addEventListener("click", refresh);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      setMessage("Install support is unavailable in this browser.", true);
    });
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  $("#install-app").classList.remove("install-hidden");
});

window.addEventListener("appinstalled", () => {
  state.installPrompt = null;
  $("#install-app").classList.add("install-hidden");
  setMessage("RedPacket Relay app installed.");
});

$("#install-app").addEventListener("click", async () => {
  if (!state.installPrompt) {
    setMessage("Use your browser menu to install this app on this device.");
    return;
  }
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  $("#install-app").classList.add("install-hidden");
});

$("#refresh-wechat-handoff").addEventListener("click", refresh);

$("#event-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await submitEvent(eventPayloadFromForm(event.currentTarget));
    event.currentTarget.externalId.value = "";
    event.currentTarget.amount.value = "";
    event.currentTarget.rawText.value = "";
  } catch (error) {
    setMessage(error.message, true);
  }
});

$("#sample-event").addEventListener("click", async () => {
  try {
    state.activeTab = "monitor";
    await submitEvent(samplePayload());
  } catch (error) {
    setMessage(error.message, true);
  }
});

$("#copy-wechat-reference").addEventListener("click", async () => {
  const tx = state.data ? latestAcceptedTransaction(state.data) : null;
  if (!tx) return;
  const reference = [
    `External ID: ${tx.externalId}`,
    `Amount: ${formatAmount(tx.amount, tx.currency)}`,
    `Destination: ${tx.destinationGroupId || "-"}`,
    `Provider Batch: ${tx.providerResult ? tx.providerResult.providerBatchId : "-"}`
  ].join("\n");

  try {
    await navigator.clipboard.writeText(reference);
    setMessage("WeChat handoff reference copied.");
  } catch {
    setMessage(reference);
  }
});

$("#open-wechat-placeholder").addEventListener("click", async () => {
  const tx = state.data ? latestAcceptedTransaction(state.data) : null;
  if (!tx) return;
  const merchant = state.data.config.merchant || {};
  const demoMode = merchant.providerMode !== "wechatpay-v3";
  if (!demoMode && (!state.data.providerStatus || !state.data.providerStatus.canUseLive)) {
    setMessage("Complete official WeChat Pay live provider setup before initiating production delivery.", true);
    state.activeTab = "merchant";
    renderTabs();
    return;
  }
  try {
    const result = await api("/api/wechat/initiate", {
      method: "POST",
      body: JSON.stringify({ externalId: tx.externalId })
    });
    setMessage(result.message);
    window.location.href = result.launchUri;
    await refresh();
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.querySelectorAll("[data-case]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await runCase(button.dataset.case);
      setMessage("Scenario case completed.");
    } catch (error) {
      setMessage(error.message, true);
    }
  });
});

$("#run-all-cases").addEventListener("click", async () => {
  try {
    for (const kind of ["matched", "duplicate", "wrong-amount", "unauthorized", "unknown-route", "offline"]) {
      await runCase(kind);
    }
    setMessage("All scenario cases completed.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

$("#save-routing").addEventListener("click", async () => {
  const config = buildConfigFromState();
  config.targetAmounts = $("#target-amounts").value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  config.limits.maxDailyAmount = Number($("#daily-limit").value);
  config.limits.currency = $("#currency").value.trim() || "CNY";
  await saveConfig(config, "Routing configuration saved.");
});

$("#rule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formEntries(form);
  const config = buildConfigFromState();
  const sourceGroupId = data.sourceGroupId.trim();
  if (config.destinationRules.some((rule) => rule.sourceGroupId === sourceGroupId)) {
    setMessage("A routing rule for that source group already exists.", true);
    return;
  }
  config.destinationRules.push({
    id: `rule-${slug(sourceGroupId) || Date.now()}`,
    sourceGroupId,
    sourceGroupName: data.sourceGroupName.trim(),
    destinationGroupId: data.destinationGroupId.trim(),
    destinationGroupName: data.destinationGroupName.trim(),
    recipients: parseRecipients(data.recipients)
  });
  await saveConfig(config, "Routing rule added.");
  form.reset();
});

$("#rules").addEventListener("click", async (event) => {
  const ruleId = event.target.dataset.removeRule;
  if (!ruleId) return;
  const config = buildConfigFromState();
  config.destinationRules = config.destinationRules.filter((rule) => rule.id !== ruleId);
  await saveConfig(config, "Routing rule removed.");
});

$("#account-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = formEntries(form);
  const account = {
    id: String(formData.id || "").trim(),
    name: String(formData.name || "").trim(),
    role: String(formData.role || "monitor").trim(),
    authorized: formData.authorized === "on"
  };
  const config = buildConfigFromState();
  if (config.sourceAccounts.some((item) => item.id === account.id)) {
    setMessage("An account with that ID already exists.", true);
    return;
  }
  config.sourceAccounts.push(account);
  await saveConfig(config, "Authorized account added.");
  form.reset();
  form.authorized.checked = true;
});

$("#accounts").addEventListener("click", async (event) => {
  const toggleId = event.target.dataset.toggleAccount;
  const removeId = event.target.dataset.removeAccount;
  if (!toggleId && !removeId) return;
  const config = buildConfigFromState();
  if (toggleId) {
    config.sourceAccounts = config.sourceAccounts.map((account) =>
      account.id === toggleId ? { ...account, authorized: !account.authorized } : account
    );
    await saveConfig(config, "Account authorization updated.");
  }
  if (removeId) {
    config.sourceAccounts = config.sourceAccounts.filter((account) => account.id !== removeId);
    await saveConfig(config, "Account removed.");
  }
});

$("#save-merchant").addEventListener("click", async () => {
  const config = buildConfigFromState();
  config.merchant.providerMode = $("#provider-mode").value;
  config.merchant.mchid = $("#merchant-id").value.trim();
  config.merchant.appid = $("#merchant-appid").value.trim();
  config.merchant.serialNo = $("#merchant-serial-no").value.trim();
  config.merchant.callbackUrl = $("#callback-url").value.trim();
  config.merchant.notifyUrl = $("#notify-url").value.trim();
  config.merchant.transferEndpoint = $("#transfer-endpoint").value.trim();
  config.merchant.productEnabled = $("#product-enabled").value === "true";
  config.mode = config.merchant.providerMode === "wechatpay-v3" ? "production" : "simulation";
  await saveConfig(config, "Merchant configuration saved.");
});

$("#set-offline").addEventListener("click", async () => {
  try {
    await setOperatingStatus("offline");
  } catch (error) {
    setMessage(error.message, true);
  }
});

$("#fix-all-issues").addEventListener("click", async () => {
  try {
    const result = await api("/api/autofix", { method: "POST", body: "{}" });
    state.diagnostics = result.after;
    setMessage(result.applied.length ? `Fixed ${result.applied.length} issue(s).` : "No fixes were needed.");
    await refresh();
  } catch (error) {
    setMessage(error.message, true);
  }
});

$("#reset-demo").addEventListener("click", async () => {
  await api("/api/demo/reset", { method: "POST", body: "{}" });
  setMessage("Demo state reset.");
  await refresh();
});

$("#export-transactions").addEventListener("click", () => {
  window.location.href = "/api/export/transactions.csv";
});

$("#export-state").addEventListener("click", () => {
  window.location.href = "/api/export/state.json";
});

setHealth("yellow", "Starting");
refresh().catch((error) => {
  setHealth("red", "Offline");
  setMessage(error.message, true);
});
setInterval(checkHealth, 5000);
setInterval(() => {
  pushHeartbeat();
  renderBotHealth();
}, 1000);
