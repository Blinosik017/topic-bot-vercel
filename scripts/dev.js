require('dotenv').config();

const bot = require('../bot');
const db = require('../db');

async function main() {
  await bot.telegram.deleteWebhook({ drop_pending_updates: false });
  await bot.launch();
  console.log('Bot started in polling mode. Press Ctrl+C to stop.');
}

async function shutdown(signal) {
  console.log(`Received ${signal}, stopping bot...`);
  bot.stop(signal);
  await db.closePool();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

main().catch(async (error) => {
  console.error('Failed to start bot:', error);
  await db.closePool();
  process.exitCode = 1;
});
