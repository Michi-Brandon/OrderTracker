# OrderTracker

Minecraft orders tracker built on Mineflayer with a local dashboard. It connects to a server, runs `/orders <item>`, parses the GUI, and stores snapshots for analytics (max price over time, full page view, and craft margin breakdown).

## Features
- Mineflayer bot with Microsoft auth
- Orders GUI parsing (first page)
- JSONL snapshot log
- Dashboard with search, tracking queue, price chart, and craft margin
- Per-item `/orders` alias support (e.g. `redstone dust`)
- Tracking queue with persistence across restarts
- One-shot chat message after current tasks finish

## Requirements
- Node.js 18+
- Minecraft account with Microsoft auth

## Install
```bash
npm install
```

## Run
Start the bot:
```bash
node x.js
```

Start the dashboard:
```bash
node orders-dashboard.js
```

Open the UI at:
```
http://localhost:3008
```

## Environment Variables
These are optional. Defaults are shown.

```
MC_EMAIL=your@email.com
MC_PASSWORD=yourpassword //Dont use if you're using MC_AUTH=microsoft
MC_HOST=serverip
MC_VERSION=1.20.2
MC_AUTH=microsoft

VIEWER=1
VIEWER_PORT=3007

ORDERS_INTERVAL_MS=60000
ORDERS_OPEN_TIMEOUT_MS=15000
ORDERS_CLOSE_DELAY_MS=800
ORDERS_START_DELAY_MS=7000
ORDERS_HUMAN_DELAY_MIN_MS=300
ORDERS_HUMAN_DELAY_MAX_MS=900
ORDERS_SCHEDULER_INTERVAL_MS=1000
ORDERS_API_PORT=3010
ORDERS_AUTOTRACK=1
ORDERS_PRODUCT=repeater
ORDERS_CMD_PREFIX=/orders
ORDERS_SPAWN_PROBE=1

ORDERS_TRADER_ENABLED=0
ORDERS_TRADER_MARGIN_PCT=0.5
ORDERS_TRADER_REFRESH_MIN_MS=500
ORDERS_TRADER_REFRESH_MAX_MS=5490
ORDERS_TRADER_OWNED_SYNC_MS=30000
ORDERS_TRADER_CONFIRM_TIMEOUT_MS=5000
```

## Tracking & Aliases
- Track items from the dashboard.  
- Use the **Orders query** input to override the command name (alias).  
  Example: `redstone dust` for Redstone Dust.

Aliases are stored in:
```
orders-aliases.json
```

Tracked items and their order are stored in:
```
orders-tracked.json
```

## Data Files
Snapshots are stored as JSONL:
```
orders-snapshots.jsonl
```

Trader state files:
```
orders-owned.json
orders-market-state.json
orders-trader-deals.jsonl
```

## Notes
- The bot will wait idle if no items are tracked.
- If the server says you're already online, wait a minute and retry.
- If you see `ECONNRESET`, the server closed the connection; retry after server goes back up.
