# RedPacket Relay

RedPacket Relay is a compliant bot prototype for authorized red-packet event monitoring. It does not capture WeChat traffic, modify payment packets, change group IDs on existing orders, or bypass WeChat security controls.

The implemented workflow is:

1. Receive an authorized event from one of the configured source accounts.
2. Detect whether the amount matches configured target amounts.
3. Map the source group to a destination group and recipient list.
4. Prevent duplicate processing by external event ID.
5. Enforce a daily payout limit.
6. Create a simulated payout record, or submit through the official WeChat Pay v3 provider when live mode is explicitly configured.
7. Keep event, transaction, and audit history.

## Run

```powershell
node server.js
```

Or on Windows:

```cmd
.\start-redpacket-relay.cmd
```

Then open:

```text
http://localhost:8787
```

## Deployment Storage

Local runs store state in `data/state.json`. Serverless hosts such as Vercel do not allow durable writes inside the deployed app directory, so the app automatically uses the writable temp directory for demo state when deployed there.

For persistent production records, set `REDPACKET_DATA_DIR` to a writable mounted path or replace the JSON state file with a database-backed store. Temp storage can be cleared by the host between cold starts, so it is not enough for permanent transaction/audit records.

## Install as an App

The web console is installable as a Progressive Web App on supported desktop and mobile browsers.

1. Start the local server.
2. Open `http://localhost:8787`.
3. Use the **Install App** button when it appears, or use the browser menu to install the app.

Installed mode launches the relay console like an app and keeps the local UI shell available. The bot can automate its own authorized event matching, routing, record keeping, diagnostics and official-provider payout submission after merchant setup. It cannot secretly control the WeChat client or bypass WeChat Pay security. Production payment initiation must be connected through official WeChat Pay merchant APIs.

The web console includes tabs for overview metrics, event monitoring, real scenario cases, transactions, routing rules, authorized accounts, merchant readiness, bot health and audit history.

Bot Health controls the local operating state. Online and Basic Mode are selected automatically based on configuration readiness. The only manual runtime control is **Go Offline**, which pauses event intake. **Fix All Issues** safely restores required local configuration such as target amounts, authorized accounts, daily limits, default routes and online status.

The Real Cases tab runs production-style cases through the same event engine: accepted payout, duplicate protection, wrong amount, unauthorized account, unknown route and offline pause.

## Verify

```cmd
.\check-redpacket-relay.cmd
```

Or:

```powershell
node --check server.js
node --check public\app.js
```

## API

### Health

```http
GET /api/health
```

### Get state

```http
GET /api/state
```

### Diagnostics

```http
GET /api/diagnostics
POST /api/admin/alert
POST /api/autofix
```

### WeChat provider status

```http
GET /api/wechat/provider-status
```

Returns the live provider readiness checklist. Secrets are never returned.

### WeChat handoff

```http
POST /api/wechat/initiate
```

In simulation mode, records a demo handoff and returns a WeChat launch URI. This can open the WeChat app when the device/browser supports `weixin://`, but it does not click inside WeChat, read private chats, or send a real red packet.

In official provider mode, the endpoint is blocked until the WeChat Pay v3 checklist is complete. Live payout delivery should run through the signed API request path.

### Export records

```http
GET /api/export/transactions.csv
GET /api/export/audit.json
GET /api/export/state.json
```

### Ingest an authorized event

```http
POST /api/events
Content-Type: application/json

{
  "externalId": "wechat-event-001",
  "sourceAccountId": "acct-a",
  "sourceGroupId": "source-vip",
  "amount": 88,
  "rawText": "Authorized event text"
}
```

### Update configuration

```http
PUT /api/config
Content-Type: application/json
```

Send the full config object from `/api/state`, changed as needed.

## Official WeChat Pay Live Setup

Simulation is the default. To prepare live delivery, open the Merchant tab and set Provider Mode to **Official WeChat Pay v3**. Add the non-secret merchant fields there:

- Merchant ID
- bound AppID
- merchant certificate serial number
- callback and notify URLs
- the official transfer endpoint for the merchant product you are approved to use
- product permission confirmation

Keep sensitive credentials outside the UI in environment variables:

```powershell
$env:WECHAT_PAY_ENABLE_LIVE="true"
$env:WECHAT_PAY_MCHID="your_mchid"
$env:WECHAT_PAY_APPID="your_bound_appid"
$env:WECHAT_PAY_SERIAL_NO="your_merchant_certificate_serial"
$env:WECHAT_PAY_PRIVATE_KEY_PATH="C:\secure\apiclient_key.pem"
$env:WECHAT_PAY_API_V3_KEY="your_api_v3_key"
$env:WECHAT_PAY_NOTIFY_URL="https://your-domain.example/webhooks/wechat-pay/notify"
$env:WECHAT_PAY_TRANSFER_ENDPOINT="https://api.mch.weixin.qq.com/your/approved/transfer/endpoint"
node server.js
```

The app will not submit live payout requests unless every provider requirement is ready and `WECHAT_PAY_ENABLE_LIVE=true`. If live mode is selected but requirements are missing, accepted events are rejected with a clear provider reason instead of creating fake production records.

Do not implement packet capture, reverse-engineered client hooks, payment-order rewriting, or direct access to WeChat internal servers.
