require('dotenv').config();

const token = process.env.BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET;
const webhookUrl =
  process.env.WEBHOOK_URL ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/api/webhook`
    : '');

async function main() {
  if (!token) {
    throw new Error('BOT_TOKEN environment variable is required');
  }

  if (!webhookUrl) {
    throw new Error('Set WEBHOOK_URL or VERCEL_URL environment variable');
  }

  const payload = {
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query'],
  };

  if (secret) {
    payload.secret_token = secret;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  const result = await response.json();

  if (!result.ok) {
    throw new Error(result.description || 'Telegram API error');
  }

  console.log(`Webhook set to ${webhookUrl}`);
  if (secret) {
    console.log('Secret token is enabled.');
  }
}

main().catch((error) => {
  console.error('Failed to set webhook:', error);
  process.exitCode = 1;
});
