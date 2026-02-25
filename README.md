# <img src="https://i.imgur.com/pkL9paz.png" width="50" alt="BotMonitor">  BotMonitor

> **Monitor and manage Discord bot status efficiently** with this powerful Discord.js bot.

---

## 📋 Overview

BotMonitor is a comprehensive Discord bot built with Discord.js that monitors bot health, server activity, and provides automated status updates. It uses slash commands for easy configuration and maintains detailed logs of all monitoring operations.

> [!NOTE]
> Requires Node.js 18+ and valid Discord bot token. Use the [Discord Developer Portal](https://discord.com/developers/applications) to create and manage your bot.

> [!WARNING]
> **Bot-Only Monitoring:** BotMonitor is designed exclusively for monitoring Discord bot accounts. Regular user accounts cannot be added to the monitoring list - the system automatically rejects user IDs and only accepts verified bot accounts. This ensures compliance with Discord's Terms of Service and prevents unauthorized user tracking.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔴 **Real-Time Bot Status** | Live monitoring of bot online/offline status with visual indicators |
| 📊 **Persistent Embeds** | Auto-updating Discord embed that refreshes every 60 seconds |
| 📬 **Offline Alerts** | Direct messages when monitored bots go offline/online |
| ⏱️ **Downtime Tracking** | Measures and reports how long bots are offline |
| 🤖 **Multi-Bot Monitoring** | Monitor unlimited bots with dynamic add/remove functionality |
| 💾 **Auto-Recovery** | Automatically restores monitoring status after bot restarts |
| ⚡ **Slash Commands** | Easy-to-use commands for setup and management |
| 📋 **Bot Management** | Add, remove, and list monitored bots on-the-fly |

**Live Dashboard:** Creates a beautiful embedded Discord message that updates automatically and shows which bots are online/offline at a glance.

---

## 🎯 Slash Commands

- **`/status`** - Start the Status Monitor with live updating embed
- **`/stop_status`** - Stop monitoring and delete the embed
- **`/add_bot <bot_id>`** - Add a bot to the monitoring list (user accounts are rejected)
- **`/remove_bot <bot_id>`** - Remove a bot from monitoring
- **`/list_bots`** - View all currently monitored bots
- **`/help_status`** - Display available commands and usage guide

---

## 🚀 Installation & Usage

### Prerequisites
- Node.js 18 or higher
- Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- Active Discord server for testing

### Step-by-Step Guide

1. **Clone the repository** to your local machine
2. **Install dependencies** with `npm install`
3. **Create `.env` file** with your Discord bot token and configuration:
   ```
   DISCORD_TOKEN=your_token_here
   CLIENT_ID=your_client_id
   BOT_IDS=bot_id_1,bot_id_2,bot_id_3
   ALERT_USER_ID=your_user_id
   ```
4. **Register slash commands** with `node deploy-commands.js`
5. **Run the bot** with `npm start` or `node bot.js`
6. **Use `/status` command** in your Discord server to start monitoring
7. **Add more bots to monitor** using `/add_bot <bot_id>` command

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| **DISCORD_TOKEN** | Your Discord bot token from Developer Portal | `Nzc2MDkz...` |
| **CLIENT_ID** | Your bot's Client ID | `776093083921547294` |
| **BOT_IDS** | Comma-separated list of bot IDs to monitor on startup | `123456789,987654321` |
| **ALERT_USER_ID** | Your Discord user ID for receiving offline/online alerts | `774679828594163802` |

> **Note:** `BOT_IDS` are loaded on startup, but you can add/remove bots anytime using `/add_bot` and `/remove_bot` commands without restarting.

### Initial Setup

- The bot will automatically save configuration to `status-monitor-config.json`
- Monitored bot IDs are stored in `monitored-bots.json` for persistence
- After a restart, the bot will restore the monitoring dashboard automatically
- Offline alerts are sent as DMs to the user ID specified in `ALERT_USER_ID`

---

## ⚙️ Technical Architecture

### Core Modules

| Module | Purpose |
|--------|---------|
| **bot.js** | Main bot initialization and event handlers |
| **deploy-commands.js** | Slash command registration and deployment |
| **status-monitor-config.json** | Configuration file for monitoring settings |
| **Discord.js Client** | Core Discord bot client and event listeners |
| **Intents System** | Selective event subscription for performance |

### How It Works

1. Initializes with Gateway Intents for guilds, members, DMs, and presences
2. Loads saved configuration and monitored bot list from JSON files
3. Registers slash commands for user interaction
4. Creates a persistent Discord embed in the specified channel
5. Updates the embed every 60 seconds with current bot statuses
6. Monitors for status changes (online → offline, offline → online)
7. Sends direct message alerts with bot names and downtime duration
8. Auto-restores monitoring after bot disconnections or restarts
9. Maintains persistent records in JSON for recovery scenarios
