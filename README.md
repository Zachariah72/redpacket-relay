# RedPacket Relay

RedPacket Relay is a compliant bot prototype for authorized red-packet event monitoring. It does not capture WeChat traffic, modify payment packets, change group IDs on existing orders, or bypass WeChat security controls.

The implemented workflow is:

1. Receive an authorized event from one of the configured source accounts.
2. Detect whether the amount matches configured target amounts.
3. Map the source group to a destination group and recipient list.
4. Prevent duplicate processing by external event ID.
5. Enforce a daily payout limit.
6. Create a simulated payout record.
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

## Install as an App

The web console is installable as a Progressive Web App on supported desktop and mobile browsers.

1. Start the local server.
2. Open `http://localhost:8787`.
3. Use the **Install App** button when it appears, or use the browser menu to install the app.

Installed mode launches the relay console like an app and keeps the local UI shell available. The bot can automate its own authorized event matching, routing, record keeping, diagnostics and WeChat handoff logging. It cannot secretly control the WeChat client or bypass WeChat Pay security. Production payment initiation must be connected through official WeChat Pay merchant APIs or a user-approved WeChat handoff.

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

### WeChat handoff

```http
POST /api/wechat/initiate
```

Records a handoff initiation for the latest accepted transaction and returns a WeChat launch URI. Real payout delivery still requires official WeChat Pay provider integration.

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

## Production Notes

The current provider is intentionally simulation-only. A production WeChat Pay provider should be added only after the client supplies an approved merchant account, bound AppID, product permissions, certificates, APIv3 key, callback URL, and written authorization for all monitored accounts and recipients.

Do not implement packet capture, reverse-engineered client hooks, payment-order rewriting, or direct access to WeChat internal servers.
