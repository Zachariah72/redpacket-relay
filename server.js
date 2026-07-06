const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.REDPACKET_DATA_DIR
  || (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join(os.tmpdir(), "redpacket-relay")
    : path.join(__dirname, "data"));
const STATE_FILE = path.join(DATA_DIR, "state.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const defaultState = {
  config: {
    mode: "simulation",
    operationalStatus: "basic",
    botName: "RedPacket Relay",
    targetAmounts: [88, 168, 188],
    sourceAccounts: [
      { id: "acct-a", name: "Account A", role: "monitor", authorized: true },
      { id: "acct-b", name: "Account B", role: "monitor", authorized: true },
      { id: "acct-c", name: "Account C", role: "monitor", authorized: true },
      { id: "acct-d", name: "Account D", role: "admin", authorized: true }
    ],
    destinationRules: [
      {
        id: "rule-vip",
        sourceGroupId: "source-vip",
        sourceGroupName: "VIP Source Group",
        destinationGroupId: "dest-vip",
        destinationGroupName: "VIP Destination Group",
        recipients: [
          { openid: "openid_001", displayName: "Recipient One" },
          { openid: "openid_002", displayName: "Recipient Two" }
        ]
      },
      {
        id: "rule-general",
        sourceGroupId: "source-general",
        sourceGroupName: "General Source Group",
        destinationGroupId: "dest-general",
        destinationGroupName: "General Destination Group",
        recipients: [
          { openid: "openid_003", displayName: "Recipient Three" }
        ]
      }
    ],
    limits: {
      maxDailyAmount: 2000,
      currency: "CNY"
    },
    merchant: {
      mchid: "",
      appid: "",
      productEnabled: false,
      callbackUrl: "",
      providerMode: "simulation",
      serialNo: "",
      notifyUrl: "",
      transferEndpoint: ""
    }
  },
  events: [],
  transactions: [],
  auditLog: []
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function ensureState() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    await saveState(defaultState);
    return structuredClone(defaultState);
  }
}

async function saveState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendDownload(res, filename, contentType, body) {
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`
  });
  res.end(body);
}

function publicState(state) {
  return {
    ...state,
    providerStatus: getWechatProviderStatus(state)
  };
}

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function recordsToCsv(records, fields) {
  const header = fields.map((field) => csvCell(field.label)).join(",");
  const rows = records.map((record) =>
    fields.map((field) => csvCell(field.value(record))).join(",")
  );
  return [header, ...rows].join("\n");
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getDailyTotal(state) {
  const day = todayKey();
  return state.transactions
    .filter((tx) => tx.createdAt && tx.createdAt.startsWith(day) && tx.status !== "rejected")
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
}

function findDestinationRule(state, groupId) {
  return state.config.destinationRules.find((rule) => rule.sourceGroupId === groupId);
}

function isTargetAmount(state, amount) {
  return state.config.targetAmounts.some((target) => Number(target) === Number(amount));
}

function getOperationalStatus(state) {
  return state.config.operationalStatus || "basic";
}

function merchantConfig(state) {
  return {
    ...defaultState.config.merchant,
    ...(state.config.merchant || {})
  };
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function getDiagnostics(state) {
  const config = state.config;
  const merchant = merchantConfig(state);
  const providerStatus = getWechatProviderStatus(state);
  const sourceAccounts = ensureArray(config.sourceAccounts);
  const destinationRules = ensureArray(config.destinationRules);
  const targetAmounts = ensureArray(config.targetAmounts);
  const issues = [];
  const warnings = [];

  if (getOperationalStatus(state) === "offline") {
    issues.push({
      id: "bot-offline",
      severity: "critical",
      title: "Bot is offline",
      detail: "Event intake is paused and transactions cannot be created.",
      fix: "Run Fix All Issues to bring the bot back online after reviewing the outage."
    });
  } else if (getOperationalStatus(state) !== "online") {
    issues.push({
      id: "bot-basic",
      severity: "warning",
      title: "Bot is in basic mode",
      detail: "The bot is available for setup, but green online transaction intake is not enabled.",
      fix: "Complete the required configuration. The console will switch the bot online automatically."
    });
  }

  if (!sourceAccounts.some((account) => account.authorized)) {
    issues.push({
      id: "no-authorized-account",
      severity: "critical",
      title: "No authorized source account",
      detail: "No configured account is allowed to submit events.",
      fix: "Authorize the first existing account or create an auto monitor account."
    });
  }

  if (!targetAmounts.length) {
    issues.push({
      id: "no-target-amounts",
      severity: "critical",
      title: "No target amounts",
      detail: "The matcher cannot accept any red-packet event amounts.",
      fix: "Restore default target amounts: 88, 168 and 188."
    });
  }

  if (!Number.isFinite(Number(config.limits.maxDailyAmount)) || Number(config.limits.maxDailyAmount) <= 0) {
    issues.push({
      id: "invalid-daily-limit",
      severity: "critical",
      title: "Invalid daily limit",
      detail: "Daily payout protection is not configured correctly.",
      fix: "Set the daily limit to 2000."
    });
  }

  if (!destinationRules.length) {
    issues.push({
      id: "no-routing-rules",
      severity: "critical",
      title: "No routing rules",
      detail: "Events cannot be mapped from a source group to a destination group.",
      fix: "Create a default VIP routing rule with two simulation recipients."
    });
  } else if (!destinationRules.some((rule) => Array.isArray(rule.recipients) && rule.recipients.length > 0)) {
    issues.push({
      id: "no-recipients",
      severity: "critical",
      title: "No destination recipients",
      detail: "Configured routing rules do not have recipients.",
      fix: "Add a simulation recipient to the first routing rule."
    });
  }

  if (!merchant.mchid || !merchant.appid || !merchant.productEnabled) {
    warnings.push({
      id: "merchant-not-ready",
      severity: "info",
      title: "Production merchant setup incomplete",
      detail: "Local simulation can run, but real WeChat Pay payouts require merchant credentials and product permission.",
      fix: "Complete the Merchant tab before production deployment."
    });
  }

  if (merchant.providerMode === "wechatpay-v3" && !providerStatus.canUseLive) {
    issues.push({
      id: "wechatpay-provider-not-ready",
      severity: "critical",
      title: "WeChat Pay provider is not ready",
      detail: `Missing live requirement(s): ${providerStatus.missing.join(", ")}.`,
      fix: "Set the required merchant fields and environment variables before using live payout mode."
    });
  }

  return {
    ok: issues.filter((issue) => issue.severity === "critical").length === 0,
    issues,
    warnings,
    checkedAt: new Date().toISOString()
  };
}

function envFlag(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
}

function envPresent(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function getWechatProviderStatus(state) {
  const merchant = merchantConfig(state);
  const liveEnabled = envFlag("WECHAT_PAY_ENABLE_LIVE");
  const privateKeyConfigured = envPresent("WECHAT_PAY_PRIVATE_KEY") || envPresent("WECHAT_PAY_PRIVATE_KEY_PATH");
  const transferEndpoint = merchant.transferEndpoint || process.env.WECHAT_PAY_TRANSFER_ENDPOINT || "";
  const requirements = [
    { id: "providerMode", label: "Merchant provider mode is WeChat Pay v3", ready: merchant.providerMode === "wechatpay-v3" },
    { id: "productEnabled", label: "WeChat Pay product permission confirmed", ready: Boolean(merchant.productEnabled) },
    { id: "mchid", label: "Merchant ID configured", ready: Boolean(merchant.mchid || process.env.WECHAT_PAY_MCHID) },
    { id: "appid", label: "AppID configured", ready: Boolean(merchant.appid || process.env.WECHAT_PAY_APPID) },
    { id: "serialNo", label: "Merchant certificate serial number configured", ready: Boolean(merchant.serialNo || process.env.WECHAT_PAY_SERIAL_NO) },
    { id: "privateKey", label: "Merchant private key configured in environment", ready: privateKeyConfigured },
    { id: "apiV3Key", label: "API v3 key configured in environment", ready: envPresent("WECHAT_PAY_API_V3_KEY") },
    { id: "notifyUrl", label: "Notify URL configured", ready: Boolean(merchant.notifyUrl || merchant.callbackUrl || process.env.WECHAT_PAY_NOTIFY_URL) },
    { id: "transferEndpoint", label: "Valid HTTPS live transfer endpoint configured", ready: isHttpsUrl(transferEndpoint) },
    { id: "liveGuard", label: "Live payout guard enabled", ready: liveEnabled }
  ];
  const missing = requirements.filter((item) => !item.ready).map((item) => item.label);

  return {
    provider: merchant.providerMode || "simulation",
    liveEnabled,
    canUseLive: requirements.every((item) => item.ready),
    requirements,
    missing,
    merchantIdSource: merchant.mchid ? "config" : envPresent("WECHAT_PAY_MCHID") ? "environment" : "missing",
    appIdSource: merchant.appid ? "config" : envPresent("WECHAT_PAY_APPID") ? "environment" : "missing",
    checkedAt: new Date().toISOString()
  };
}

async function readWechatPrivateKey() {
  if (process.env.WECHAT_PAY_PRIVATE_KEY) {
    return process.env.WECHAT_PAY_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  if (process.env.WECHAT_PAY_PRIVATE_KEY_PATH) {
    return fs.readFile(process.env.WECHAT_PAY_PRIVATE_KEY_PATH, "utf8");
  }
  throw new Error("WECHAT_PAY_PRIVATE_KEY or WECHAT_PAY_PRIVATE_KEY_PATH is required.");
}

function wechatRequestTarget(endpoint) {
  const url = new URL(endpoint);
  return `${url.pathname}${url.search}`;
}

async function createWechatAuthorization({ method, endpoint, body, merchant }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString("hex");
  const bodyText = body ? JSON.stringify(body) : "";
  const message = `${method}\n${wechatRequestTarget(endpoint)}\n${timestamp}\n${nonce}\n${bodyText}\n`;
  const privateKey = await readWechatPrivateKey();
  const signature = crypto.createSign("RSA-SHA256").update(message).end().sign(privateKey, "base64");
  const mchid = merchant.mchid || process.env.WECHAT_PAY_MCHID;
  const serialNo = merchant.serialNo || process.env.WECHAT_PAY_SERIAL_NO;

  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
}

function buildWechatTransferBody({ event, rule, amount, currency, merchant }) {
  const cents = Math.round(Number(amount) * 100);
  const baseRecipientAmount = Math.floor(cents / rule.recipients.length);
  const remainder = cents - (baseRecipientAmount * rule.recipients.length);
  return {
    appid: merchant.appid || process.env.WECHAT_PAY_APPID,
    out_batch_no: event.externalId,
    batch_name: "RedPacket Relay payout",
    batch_remark: "Authorized red-packet relay payout",
    total_amount: cents,
    total_num: rule.recipients.length,
    transfer_detail_list: rule.recipients.map((recipient, index) => ({
      out_detail_no: `${event.externalId}-${index + 1}`,
      transfer_amount: baseRecipientAmount + (index === 0 ? remainder : 0),
      transfer_remark: "RedPacket Relay recipient payout",
      openid: recipient.openid
    })),
    notify_url: merchant.notifyUrl || merchant.callbackUrl || process.env.WECHAT_PAY_NOTIFY_URL,
    currency
  };
}

async function createWechatPayTransfer({ state, event, rule, amount, currency }) {
  const merchant = merchantConfig(state);
  const providerStatus = getWechatProviderStatus(state);
  if (!providerStatus.canUseLive) {
    return {
      ok: false,
      reason: `WeChat Pay live provider is not ready: ${providerStatus.missing.join(", ")}.`
    };
  }

  const endpoint = merchant.transferEndpoint || process.env.WECHAT_PAY_TRANSFER_ENDPOINT;
  const body = buildWechatTransferBody({ event, rule, amount, currency, merchant });
  const authorization = await createWechatAuthorization({
    method: "POST",
    endpoint,
    body,
    merchant
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Authorization": authorization,
      "Content-Type": "application/json",
      "User-Agent": "RedPacket-Relay/1.0"
    },
    body: JSON.stringify(body)
  });
  const responseText = await response.text();
  let responseBody = {};
  try {
    responseBody = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseBody = { raw: responseText };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `WeChat Pay provider rejected the transfer request (${response.status}).`,
      providerResponse: responseBody
    };
  }

  return {
    ok: true,
    payout: {
      provider: "wechatpay-v3",
      providerBatchId: responseBody.batch_id || responseBody.out_batch_no || event.externalId,
      status: responseBody.batch_status || "submitted",
      message: "Official WeChat Pay v3 transfer request submitted.",
      destinationGroupId: rule.destinationGroupId,
      recipientCount: rule.recipients.length,
      amount,
      currency,
      reference: event.externalId,
      providerResponse: responseBody
    }
  };
}

async function autofixIssues() {
  const state = await ensureState();
  const config = state.config;
  const before = getDiagnostics(state);
  const applied = [];

  config.operationalStatus = "online";
  applied.push("Set bot operating state to online.");

  config.targetAmounts = ensureArray(config.targetAmounts)
    .map(normalizeAmount)
    .filter((amount) => amount !== null);
  if (!config.targetAmounts.length) {
    config.targetAmounts = [88, 168, 188];
    applied.push("Restored default target amounts.");
  }

  if (!Number.isFinite(Number(config.limits.maxDailyAmount)) || Number(config.limits.maxDailyAmount) <= 0) {
    config.limits.maxDailyAmount = 2000;
    applied.push("Restored default daily limit.");
  }

  config.sourceAccounts = ensureArray(config.sourceAccounts);
  if (!config.sourceAccounts.length) {
    config.sourceAccounts.push({ id: "acct-auto", name: "Auto Monitor", role: "monitor", authorized: true });
    applied.push("Created an authorized monitor account.");
  } else if (!config.sourceAccounts.some((account) => account.authorized)) {
    config.sourceAccounts[0].authorized = true;
    applied.push("Authorized the first configured source account.");
  }

  config.destinationRules = ensureArray(config.destinationRules);
  if (!config.destinationRules.length) {
    config.destinationRules.push({
      id: "rule-auto-vip",
      sourceGroupId: "source-vip",
      sourceGroupName: "VIP Source Group",
      destinationGroupId: "dest-vip",
      destinationGroupName: "VIP Destination Group",
      recipients: [
        { openid: "openid_auto_001", displayName: "Auto Recipient One" },
        { openid: "openid_auto_002", displayName: "Auto Recipient Two" }
      ]
    });
    applied.push("Created a default VIP routing rule.");
  } else if (!config.destinationRules.some((rule) => ensureArray(rule.recipients).length > 0)) {
    config.destinationRules[0].recipients = [
      { openid: "openid_auto_001", displayName: "Auto Recipient One" }
    ];
    applied.push("Added a simulation recipient to the first routing rule.");
  }

  state.auditLog.unshift({
    id: createId("audit"),
    action: "autofix_applied",
    message: applied.length ? applied.join(" ") : "No automatic fixes were needed.",
    createdAt: new Date().toISOString()
  });
  state.auditLog = state.auditLog.slice(0, 200);
  await saveState(state);

  return {
    before,
    after: getDiagnostics(state),
    applied,
    state
  };
}

async function createAdminAlert() {
  const state = await ensureState();
  const diagnostics = getDiagnostics(state);
  const count = diagnostics.issues.length + diagnostics.warnings.length;
  state.auditLog.unshift({
    id: createId("audit"),
    action: "admin_alert",
    message: count ? `${count} diagnostic item(s) require attention.` : "No diagnostic issues found.",
    createdAt: new Date().toISOString()
  });
  state.auditLog = state.auditLog.slice(0, 200);
  await saveState(state);
  return diagnostics;
}

async function initiateWeChatHandoff(input = {}) {
  const state = await ensureState();
  const merchant = merchantConfig(state);
  const providerStatus = getWechatProviderStatus(state);
  const transaction = state.transactions.find((tx) =>
    tx.status === "created" && (!input.externalId || tx.externalId === input.externalId)
  );

  if (!transaction) {
    return {
      status: 404,
      payload: { error: "No accepted transaction is available for WeChat handoff." }
    };
  }

  if (merchant.providerMode === "wechatpay-v3" && !providerStatus.canUseLive) {
    return {
      status: 409,
      payload: { error: `WeChat Pay live provider is not ready: ${providerStatus.missing.join(", ")}.` }
    };
  }

  const now = new Date().toISOString();
  const demoMode = merchant.providerMode !== "wechatpay-v3";
  state.auditLog.unshift({
    id: createId("audit"),
    action: demoMode ? "wechat_demo_opened" : "wechat_handoff_initiated",
    message: demoMode
      ? `${transaction.externalId}: WeChat demo launch requested. No real red packet was sent.`
      : `${transaction.externalId}: WeChat handoff initiation requested.`,
    createdAt: now
  });
  state.auditLog = state.auditLog.slice(0, 200);
  await saveState(state);

  return {
    status: 200,
    payload: {
      ok: true,
      launchUri: "weixin://",
      mode: demoMode ? "demo" : "live-ready",
      message: demoMode
        ? "WeChat launch requested for demo handoff. No real red packet was sent."
        : "WeChat Pay live provider is configured. Official payout delivery should run through the signed API request path.",
      transaction
    }
  };
}

function simulatePayout({ event, rule, amount, currency }) {
  return {
    provider: "simulation",
    providerBatchId: createId("sim_batch"),
    status: "created",
    message: "Simulation payout created. Configure official WeChat Pay credentials before production use.",
    destinationGroupId: rule.destinationGroupId,
    recipientCount: rule.recipients.length,
    amount,
    currency,
    reference: event.externalId
  };
}

async function createProviderPayout({ state, event, rule, amount, currency }) {
  const merchant = merchantConfig(state);
  if (merchant.providerMode === "wechatpay-v3" || state.config.mode === "production") {
    return createWechatPayTransfer({ state, event, rule, amount, currency });
  }

  return {
    ok: true,
    payout: simulatePayout({ event, rule, amount, currency })
  };
}

async function ingestEvent(input) {
  const state = await ensureState();
  const amount = normalizeAmount(input.amount);
  const now = new Date().toISOString();
  const externalId = String(input.externalId || "").trim();
  const sourceAccountId = String(input.sourceAccountId || "").trim();
  const sourceGroupId = String(input.sourceGroupId || "").trim();

  if (!externalId || !sourceAccountId || !sourceGroupId || amount === null) {
    return { status: 400, payload: { error: "externalId, sourceAccountId, sourceGroupId and positive amount are required." } };
  }

  const event = {
    id: createId("evt"),
    externalId,
    sourceAccountId,
    sourceGroupId,
    amount,
    currency: input.currency || state.config.limits.currency,
    rawText: String(input.rawText || ""),
    receivedAt: now
  };

  const authorizedAccount = state.config.sourceAccounts.find((account) => account.id === sourceAccountId && account.authorized);
  const existingTransaction = state.transactions.find((tx) => tx.externalId === externalId);
  const rule = findDestinationRule(state, sourceGroupId);
  const dailyTotal = getDailyTotal(state);
  const projectedTotal = dailyTotal + amount;

  let decision = "rejected";
  let reason = "";
  let payout = null;

  if (getOperationalStatus(state) === "offline") {
    reason = "Bot is offline. Event intake is paused.";
  } else if (!authorizedAccount) {
    reason = "Source account is not authorized.";
  } else if (existingTransaction) {
    reason = "Duplicate external event ignored.";
  } else if (!isTargetAmount(state, amount)) {
    reason = "Amount does not match configured targets.";
  } else if (!rule) {
    reason = "No destination rule exists for this source group.";
  } else if (projectedTotal > Number(state.config.limits.maxDailyAmount)) {
    reason = "Daily payout limit would be exceeded.";
  } else if (!rule.recipients.length) {
    reason = "Destination rule has no recipients.";
  } else {
    const providerResult = await createProviderPayout({ state, event, rule, amount, currency: event.currency });
    if (providerResult.ok) {
      decision = "matched";
      reason = "Target matched and payout created.";
      payout = providerResult.payout;
    } else {
      reason = providerResult.reason || "Payout provider did not create the transfer.";
    }
  }

  const transaction = {
    id: createId("tx"),
    externalId,
    eventId: event.id,
    status: decision === "matched" ? "created" : "rejected",
    reason,
    amount,
    currency: event.currency,
    sourceAccountId,
    sourceGroupId,
    destinationGroupId: rule ? rule.destinationGroupId : null,
    providerResult: payout,
    createdAt: now
  };

  state.events.unshift({ ...event, decision, reason });
  state.transactions.unshift(transaction);
  state.auditLog.unshift({
    id: createId("audit"),
    action: "event_ingested",
    message: `${externalId}: ${reason}`,
    createdAt: now
  });

  state.events = state.events.slice(0, 200);
  state.transactions = state.transactions.slice(0, 200);
  state.auditLog = state.auditLog.slice(0, 200);
  await saveState(state);

  return { status: decision === "matched" ? 201 : 202, payload: { event, transaction } };
}

async function updateConfig(input) {
  const state = await ensureState();
  const nextConfig = {
    ...state.config,
    ...input,
    limits: { ...state.config.limits, ...(input.limits || {}) },
    merchant: { ...state.config.merchant, ...(input.merchant || {}) }
  };

  nextConfig.targetAmounts = (nextConfig.targetAmounts || [])
    .map(normalizeAmount)
    .filter((amount) => amount !== null);
  nextConfig.operationalStatus = ["basic", "online", "offline"].includes(nextConfig.operationalStatus)
    ? nextConfig.operationalStatus
    : "basic";
  nextConfig.mode = ["simulation", "production"].includes(nextConfig.mode) ? nextConfig.mode : "simulation";
  nextConfig.merchant.providerMode = ["simulation", "wechatpay-v3"].includes(nextConfig.merchant.providerMode)
    ? nextConfig.merchant.providerMode
    : "simulation";
  nextConfig.sourceAccounts = Array.isArray(nextConfig.sourceAccounts) ? nextConfig.sourceAccounts : [];
  nextConfig.destinationRules = Array.isArray(nextConfig.destinationRules) ? nextConfig.destinationRules : [];

  state.config = nextConfig;
  state.auditLog.unshift({
    id: createId("audit"),
    action: "config_updated",
    message: "Configuration updated from admin API.",
    createdAt: new Date().toISOString()
  });
  await saveState(state);
  return state.config;
}

async function resetDemo() {
  await saveState(defaultState);
  return publicState(structuredClone(defaultState));
}

async function serveStatic(req, res) {
  const requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function router(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/health") {
      const state = await ensureState();
      const providerStatus = getWechatProviderStatus(state);
      sendJson(res, 200, {
        ok: getOperationalStatus(state) !== "offline",
        service: "RedPacket Relay",
        mode: state.config.mode,
        operationalStatus: getOperationalStatus(state),
        provider: providerStatus.provider,
        providerReady: providerStatus.canUseLive
      });
      return;
    }

    if (url.pathname === "/api/state" && req.method === "GET") {
      sendJson(res, 200, publicState(await ensureState()));
      return;
    }

    if (url.pathname === "/api/wechat/provider-status" && req.method === "GET") {
      sendJson(res, 200, getWechatProviderStatus(await ensureState()));
      return;
    }

    if (url.pathname === "/api/diagnostics" && req.method === "GET") {
      sendJson(res, 200, getDiagnostics(await ensureState()));
      return;
    }

    if (url.pathname === "/api/admin/alert" && req.method === "POST") {
      sendJson(res, 200, await createAdminAlert());
      return;
    }

    if (url.pathname === "/api/autofix" && req.method === "POST") {
      sendJson(res, 200, await autofixIssues());
      return;
    }

    if (url.pathname === "/api/wechat/initiate" && req.method === "POST") {
      const result = await initiateWeChatHandoff(await readBody(req));
      sendJson(res, result.status, result.payload);
      return;
    }

    if (url.pathname === "/api/export/transactions.csv" && req.method === "GET") {
      const state = await ensureState();
      const csv = recordsToCsv(state.transactions, [
        { label: "id", value: (tx) => tx.id },
        { label: "externalId", value: (tx) => tx.externalId },
        { label: "status", value: (tx) => tx.status },
        { label: "reason", value: (tx) => tx.reason },
        { label: "amount", value: (tx) => tx.amount },
        { label: "currency", value: (tx) => tx.currency },
        { label: "sourceAccountId", value: (tx) => tx.sourceAccountId },
        { label: "sourceGroupId", value: (tx) => tx.sourceGroupId },
        { label: "destinationGroupId", value: (tx) => tx.destinationGroupId },
        { label: "provider", value: (tx) => tx.providerResult ? tx.providerResult.provider : "" },
        { label: "providerBatchId", value: (tx) => tx.providerResult ? tx.providerResult.providerBatchId : "" },
        { label: "createdAt", value: (tx) => tx.createdAt }
      ]);
      sendDownload(res, "redpacket-transactions.csv", "text/csv; charset=utf-8", csv);
      return;
    }

    if (url.pathname === "/api/export/audit.json" && req.method === "GET") {
      const state = await ensureState();
      sendDownload(res, "redpacket-audit.json", "application/json; charset=utf-8", JSON.stringify(state.auditLog, null, 2));
      return;
    }

    if (url.pathname === "/api/export/state.json" && req.method === "GET") {
      sendDownload(res, "redpacket-state.json", "application/json; charset=utf-8", JSON.stringify(await ensureState(), null, 2));
      return;
    }

    if (url.pathname === "/api/config" && req.method === "PUT") {
      sendJson(res, 200, { config: await updateConfig(await readBody(req)) });
      return;
    }

    if (url.pathname === "/api/events" && req.method === "POST") {
      const result = await ingestEvent(await readBody(req));
      sendJson(res, result.status, result.payload);
      return;
    }

    if (url.pathname === "/api/demo/reset" && req.method === "POST") {
      sendJson(res, 200, await resetDemo());
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "Unknown API route." });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "Unexpected server error." });
  }
}

const server = http.createServer(router);

server.listen(PORT, () => {
  console.log(`RedPacket Relay running at http://localhost:${PORT}`);
});
