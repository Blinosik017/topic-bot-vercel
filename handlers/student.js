const { Markup } = require('telegraf');
const db = require('../db');
const { BUTTONS } = require('../menu');
const { sendAssignmentFile } = require('../files');
const {
  isAdmin,
  escapeHtml,
  truncate,
  formatDate,
  assignmentDetailsHtml,
  displayName,
} = require('../utils');

const PAGE_SIZE = 10;
const TOPIC_TITLE_LIMIT = 150;
const MY_TOPIC_TITLE_LIMIT = 120;
const BUTTON_TITLE_LIMIT = 45;
const LITERATURE_PREVIEW_LIMIT = 300;

async function respond(ctx, text, extra = {}, forceReply = false) {
  const options = { disable_web_page_preview: true, ...extra };

  if (!forceReply && ctx.callbackQuery && ctx.callbackQuery.message) {
    try {
      return await ctx.editMessageText(text, options);
    } catch (error) {
      if ((error.description || '').includes('message is not modified')) {
        return null;
      }
      return ctx.reply(text, options);
    }
  }

  return ctx.reply(text, options);
}

function keyboard(rows) {
  return Markup.inlineKeyboard(rows);
}

async function renderAssignments(ctx) {
  const assignments = await db.getActiveAssignments();

  if (!assignments.length) {
    return respond(ctx, '📭 Сейчас нет активных заданий. Загляните позже!');
  }

  const rows = assignments.map((assignment) => [
    Markup.button.callback(
      `${assignment.file_id ? '📎' : '📖'} ${truncate(assignment.title, 35)} · ${assignment.free_topics}/${assignment.total_topics}`,
      `assign_${assignment.id}`,
    ),
  ]);

  rows.push([Markup.button.callback('🔄 Обновить', 'assignments')]);

  return respond(
    ctx,
    '📚 <b>Активные задания</b>\n\nВыберите задание, чтобы посмотреть темы:',
    { parse_mode: 'HTML', ...keyboard(rows) },
  );
}

async function renderAssignment(
  ctx,
  assignmentId,
  page = 0,
  forceReply = false,
) {
  const assignment = await db.getAssignment(assignmentId);

  if (!assignment) {
    return respond(ctx, '⚠️ Задание не найдено.', {}, forceReply);
  }

  const topics = await db.getAssignmentTopics(assignmentId);
  const totalPages = Math.max(1, Math.ceil(topics.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const start = currentPage * PAGE_SIZE;
  const pageTopics = topics.slice(start, start + PAGE_SIZE);
  const freeTopics = topics.filter((topic) => topic.status === 'free').length;

  let text = `📚 <b>${escapeHtml(assignment.title)}</b>\n`;

  const details = assignmentDetailsHtml(
    assignment,
    LITERATURE_PREVIEW_LIMIT,
  );
  if (details) {
    text += `${details}\n`;
  }

  text += `🟢 Свободно: ${freeTopics} из ${topics.length}\n`;
  if (totalPages > 1) {
    text += `📄 Страница ${currentPage + 1} из ${totalPages}\n`;
  }
  text += '\n';

  if (!topics.length) {
    text += '📭 В этом задании пока нет тем.';
  } else {
    const lines = pageTopics.map((topic, index) => {
      const number = start + index + 1;
      const title = escapeHtml(truncate(topic.title, TOPIC_TITLE_LIMIT));

      if (topic.status === 'free') {
        return `🟢 <b>${number}.</b> ${title}`;
      }

      const mine = String(topic.student_id) === String(ctx.from.id);
      const student = mine ? 'вы' : escapeHtml(topic.student_name || 'студент');
      return `🔴 <b>${number}.</b> ${title} — <i>${student}</i>`;
    });

    text += lines.join('\n');
  }

  const rows = [];

  for (const [index, topic] of pageTopics.entries()) {
    const number = start + index + 1;

    if (topic.status === 'free') {
      rows.push([
        Markup.button.callback(`🟢 Занять №${number}`, `book_${topic.id}`),
      ]);
    } else if (String(topic.student_id) === String(ctx.from.id)) {
      rows.push([
        Markup.button.callback(`🔓 Освободить №${number}`, `unbook_${topic.id}`),
      ]);
    }
  }

  if (totalPages > 1) {
    const navigation = [];
    if (currentPage > 0) {
      navigation.push(
        Markup.button.callback('⬅️ Назад', `assign_${assignmentId}_${currentPage - 1}`),
      );
    }
    if (currentPage < totalPages - 1) {
      navigation.push(
        Markup.button.callback('Вперёд ➡️', `assign_${assignmentId}_${currentPage + 1}`),
      );
    }
    if (navigation.length) {
      rows.push(navigation);
    }
  }

  if (assignment.literature) {
    rows.push([
      Markup.button.callback(
        '📚 Список литературы',
        `literature_${assignmentId}`,
      ),
    ]);
  }

  if (isAdmin(ctx.from.id)) {
    rows.push([
      Markup.button.callback(
        '✏️ Редактировать',
        `edit_assignment_${assignmentId}`,
      ),
    ]);
  }

  rows.push([Markup.button.callback('⬅️ К заданиям', 'assignments')]);

  return respond(
    ctx,
    text,
    { parse_mode: 'HTML', ...keyboard(rows) },
    forceReply,
  );
}

async function renderMyTopics(ctx) {
  const topics = await db.getMyTopics(ctx.from.id);

  if (!topics.length) {
    return respond(
      ctx,
      '📭 У вас пока нет забронированных тем.\n\nПосмотрите /topics, чтобы выбрать тему.',
    );
  }

  const groups = new Map();

  for (const topic of topics) {
    if (!groups.has(topic.assignment_id)) {
      groups.set(topic.assignment_id, {
        title: topic.assignment_title,
        topics: [],
      });
    }
    groups.get(topic.assignment_id).topics.push(topic);
  }

  let text = '📌 <b>Мои темы</b>\n\n';
  const rows = [];

  for (const group of groups.values()) {
    text += `📚 <b>${escapeHtml(group.title)}</b>\n`;

    for (const topic of group.topics) {
      text += `• ${escapeHtml(truncate(topic.title, MY_TOPIC_TITLE_LIMIT))}`;
      if (topic.claimed_at) {
        text += ` <i>(${formatDate(topic.claimed_at)})</i>`;
      }
      text += '\n';

      rows.push([
        Markup.button.callback(
          `🔓 Освободить: ${truncate(topic.title, BUTTON_TITLE_LIMIT)}`,
          `unbook_${topic.id}`,
        ),
      ]);
    }

    text += '\n';
  }

  return respond(ctx, text.trim(), { parse_mode: 'HTML', ...keyboard(rows) });
}

async function pageForTopic(assignmentId, topicId) {
  const topics = await db.getAssignmentTopics(assignmentId);
  const index = topics.findIndex((topic) => topic.id === topicId);
  return index === -1 ? 0 : Math.floor(index / PAGE_SIZE);
}

function registerStudentHandlers(bot) {
  bot.command('topics', (ctx) => renderAssignments(ctx));
  bot.command('my', (ctx) => renderMyTopics(ctx));

  bot.hears(BUTTONS.topics, (ctx) => renderAssignments(ctx));
  bot.hears(BUTTONS.my, (ctx) => renderMyTopics(ctx));

  bot.action('assignments', (ctx) => renderAssignments(ctx));

  bot.action(/^literature_(\d+)$/, async (ctx) => {
    const assignmentId = Number(ctx.match[1]);
    const assignment = await db.getAssignment(assignmentId);

    if (!assignment || !assignment.literature) {
      await ctx.answerCbQuery('Список литературы не добавлен.', {
        show_alert: true,
      });
      return;
    }

    await ctx.answerCbQuery();

    return ctx.reply(
      `📚 Литература к заданию «${assignment.title}»\n\n` +
        assignment.literature,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '⬅️ К заданию',
            `assign_${assignmentId}_0`,
          ),
        ],
      ]),
    );
  });

  bot.action(/^assign_(\d+)(?:_(\d+))?$/, async (ctx) => {
    const assignmentId = Number(ctx.match[1]);
    const page = ctx.match[2] ? Number(ctx.match[2]) : 0;
    const initialOpen = !ctx.match[2];

    if (initialOpen) {
      const assignment = await db.getAssignment(assignmentId);

      if (assignment?.file_id) {
        await sendAssignmentFile(ctx, assignment);
        return renderAssignment(ctx, assignmentId, page, true);
      }
    }

    return renderAssignment(ctx, assignmentId, page);
  });

  bot.action(/^book_(\d+)$/, async (ctx) => {
    const topicId = Number(ctx.match[1]);
    const booked = await db.bookTopic(
      topicId,
      ctx.from.id,
      displayName(ctx.from),
    );

    if (!booked) {
      await ctx.answerCbQuery('❌ Увы, эту тему уже заняли!', {
        show_alert: true,
      });

      const topic = await db.getTopic(topicId);
      if (topic) {
        const page = await pageForTopic(topic.assignment_id, topic.id);
        await renderAssignment(ctx, topic.assignment_id, page);
      }
      return;
    }

    await ctx.answerCbQuery('✅ Тема закреплена за вами!', { show_alert: true });

    const page = await pageForTopic(booked.assignment_id, booked.id);
    return renderAssignment(ctx, booked.assignment_id, page);
  });

  bot.action(/^unbook_(\d+)$/, async (ctx) => {
    const topicId = Number(ctx.match[1]);
    const fromMyTopics = (ctx.callbackQuery?.message?.text || '').includes(
      'Мои темы',
    );
    const unbooked = await db.unbookTopic(topicId, ctx.from.id);

    if (!unbooked) {
      await ctx.answerCbQuery(
        '⚠️ Не удалось снять бронь: тема уже освобождена или забронирована другим.',
        { show_alert: true },
      );

      if (fromMyTopics) {
        return renderMyTopics(ctx);
      }

      const topic = await db.getTopic(topicId);
      if (topic) {
        const page = await pageForTopic(topic.assignment_id, topic.id);
        await renderAssignment(ctx, topic.assignment_id, page);
      }
      return;
    }

    await ctx.answerCbQuery('✅ Бронь снята!', { show_alert: true });

    if (fromMyTopics) {
      return renderMyTopics(ctx);
    }

    const page = await pageForTopic(unbooked.assignment_id, unbooked.id);
    return renderAssignment(ctx, unbooked.assignment_id, page);
  });
}

module.exports = { registerStudentHandlers };
