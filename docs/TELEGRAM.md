# Telegram integration

Xdesk uses the Telegram Bot API with Long Polling.

## Setup

1. Open the official `@BotFather` in Telegram.
2. Run `/newbot` and create your own bot.
3. Copy the bot token.
4. Put it only in your local `.env`:

```env
TELEGRAM_BOT_ENABLED=true
TELEGRAM_BOT_TOKEN=YOUR_OWN_TOKEN
BOT_COMPANY_NAME=Your Company
```

5. Start/restart Docker:

```bash
docker compose up -d
```

6. Check:

```bash
docker compose logs --tail=100 telegram-bot
```

The bot can create tickets, list the user's Telegram-created tickets, exchange messages with the Xdesk ticket chat, send status notifications, handle supported attachments, and request a 1–5 rating after closure.

## Important

- Never commit `TELEGRAM_BOT_TOKEN`.
- A public IP is not required for the bot itself because Long Polling uses outgoing HTTPS connections.
- If the bot token is exposed publicly, revoke it through BotFather and issue a new one.
