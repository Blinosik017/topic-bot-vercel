require('dotenv').config();

const { Telegraf } = require('telegraf');
const db = require('./db');
const { isAdmin } = require('./utils');
const { mainMenuKeyboard, startText } = require('./menu');
const { registerStudentHandlers } = require('./handlers/student');
const { registerAdminHandlers } = require('./handlers/admin');

const token = process.env.BOT_TOKEN;

if (!token) {
  throw new Error('BOT_TOKEN environment variable is required');
}

const bot = new Telegraf(token);

bot.use(async (ctx, next) => {
  if (ctx.from && !ctx.from.is_bot) {
    await db.upsertUser(ctx.from);
  }
  return next();
});

bot.start((ctx) => {
  const admin = isAdmin(ctx.from.id);

  return ctx.reply(startText(admin), {
    parse_mode: 'HTML',
    ...mainMenuKeyboard(admin),
  });
});

bot.command('cancel', async (ctx) => {
  await db.clearSession(ctx.from.id);

  const admin = isAdmin(ctx.from.id);

  return ctx.reply('✅ Текущее действие отменено.', mainMenuKeyboard(admin));
});

registerStudentHandlers(bot);
registerAdminHandlers(bot);

bot.catch(async (error, ctx) => {
  console.error('Bot error:', error);

  try {
    if (ctx && typeof ctx.reply === 'function') {
      await ctx.reply('⚠️ Произошла ошибка. Попробуйте ещё раз.');
    }
  } catch (replyError) {
    console.error('Failed to send error message:', replyError);
  }
});

module.exports = bot;
