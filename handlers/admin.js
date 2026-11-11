const { Markup } = require('telegraf');
const db = require('../db');
const { BUTTONS, mainMenuKeyboard } = require('../menu');
const { sendAssignmentFile } = require('../files');
const {
  isAdmin,
  getCommandArgs,
  escapeHtml,
  formatDate,
  formatDateOnly,
  assignmentDetailsHtml,
  csvEscape,
  truncate,
} = require('../utils');

const MENU_LABELS = new Set(Object.values(BUTTONS));
const CLEAR_WORDS = new Set(['-', 'удалить', 'очистить']);
const EDIT_TOPICS_PAGE_SIZE = 8;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTACT_LENGTH = 300;
const MAX_LITERATURE_LENGTH = 3000;
const MAX_ASSIGNMENT_FILE_SIZE = 20 * 1024 * 1024;
const SKIP_FILE_CALLBACK = 'skip_file';
const FILE_PROMPT_TEXT =
  'Прикрепи файл со списком тем (PDF, DOCX, JPG и т.д.) или нажми кнопку ниже, чтобы пропустить этот шаг.\n\n' +
  'Для отмены: /cancel';

function adminOnly(ctx, next) {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery('⛔ Доступно только старосте.', {
        show_alert: true,
      });
    }

    return ctx.reply('⛔ Эта команда доступна только старосте.');
  }

  return next();
}

function parseAssignmentId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseDateInput(value) {
  const text = String(value || '').trim();

  let match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  let day;
  let month;
  let year;

  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  } else {
    match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

    if (!match) {
      return null;
    }

    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isClearInput(value) {
  return CLEAR_WORDS.has(String(value || '').trim().toLowerCase());
}

function extractAssignmentFile(ctx) {
  const document = ctx.message?.document;

  if (document) {
    return {
      fileId: document.file_id,
      fileName: document.file_name || 'прикреплённый файл',
      fileSize: document.file_size || 0,
    };
  }

  const photos = ctx.message?.photo;

  if (Array.isArray(photos) && photos.length) {
    const photo = photos[photos.length - 1];

    return {
      fileId: photo.file_id,
      fileName: 'photo.jpg',
      fileSize: photo.file_size || 0,
    };
  }

  return null;
}

function filePromptKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        '⏩ Пропустить',
        SKIP_FILE_CALLBACK,
      ),
    ],
  ]);
}

async function sendFilePrompt(ctx, payload, prefix = '') {
  const text = prefix ? `${prefix}\n\n${FILE_PROMPT_TEXT}` : FILE_PROMPT_TEXT;
  const message = await ctx.reply(text, filePromptKeyboard());

  await db.setSession(ctx.from.id, 'awaiting_assignment_file', {
    ...payload,
    promptMessageId: message?.message_id,
  });

  return message;
}

async function editStoredPrompt(ctx, payload, text) {
  const messageId = Number(payload?.promptMessageId);

  if (!Number.isInteger(messageId) || messageId <= 0) {
    return false;
  }

  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      messageId,
      undefined,
      text,
      { reply_markup: { inline_keyboard: [] } },
    );
    return true;
  } catch (error) {
    return false;
  }
}

async function finishAssignmentCreation(
  ctx,
  assignmentId,
  successText,
  promptPayload,
  { editCurrentMessage = false } = {},
) {
  let edited = false;

  if (editCurrentMessage && ctx.callbackQuery) {
    try {
      await ctx.editMessageText(successText, Markup.inlineKeyboard([]));
      edited = true;
    } catch (error) {
      edited = false;
    }
  } else {
    edited = await editStoredPrompt(ctx, promptPayload, successText);
  }

  if (!edited) {
    await ctx.reply(successText);
  }

  return replyWithEditMenu(ctx, assignmentId);
}

async function buildAssignmentEditMenu(assignmentId) {
  const assignment = await db.getAssignment(assignmentId);

  if (!assignment) {
    return null;
  }

  const topics = await db.getAssignmentTopics(assignmentId);
  const freeTopics = topics.filter((topic) => topic.status === 'free').length;

  let text = `⚙️ <b>${escapeHtml(assignment.title)}</b>\n\n`;
  const details = assignmentDetailsHtml(assignment, 300);

  if (details) {
    text += `${details}\n\n`;
  }

  text += `📋 Тем: ${topics.length} · свободно: ${freeTopics}\n\n`;
  text += 'Что изменить?';

  const rows = [
    [
      Markup.button.callback('📅 Дедлайн', `edit_deadline_${assignmentId}`),
      Markup.button.callback('☎️ Контакты', `edit_contact_${assignmentId}`),
    ],
    [
      Markup.button.callback(
        '📚 Литература',
        `edit_literature_${assignmentId}`,
      ),
    ],
    [
      Markup.button.callback(
        '➕ Добавить темы',
        `add_topics_${assignmentId}`,
      ),
    ],
    [
      Markup.button.callback(
        '✏️ Редактировать темы',
        `manage_topics_${assignmentId}_0`,
      ),
    ],
  ];

  if (assignment.file_id) {
    rows.push([
      Markup.button.callback(
        '📎 Показать файл',
        `show_file_${assignmentId}`,
      ),
    ]);
  }

  if (topics.length) {
    rows.push([
      Markup.button.callback(
        '🗑 Удалить все темы',
        `delete_all_topics_${assignmentId}`,
      ),
    ]);
  }

  rows.push([
    Markup.button.callback(
      '🗑 Удалить задание',
      `delete_assignment_${assignmentId}`,
    ),
  ]);
  rows.push([
    Markup.button.callback('⬅️ К заданию', `assign_${assignmentId}`),
  ]);

  return { text, keyboard: Markup.inlineKeyboard(rows) };
}

async function replyWithEditMenu(ctx, assignmentId, prefix = '') {
  const menu = await buildAssignmentEditMenu(assignmentId);

  if (!menu) {
    return ctx.reply('⚠️ Задание не найдено.');
  }

  const text = prefix ? `${prefix}\n\n${menu.text}` : menu.text;

  return ctx.reply(text, { parse_mode: 'HTML', ...menu.keyboard });
}

async function editMessageWithMenu(ctx, assignmentId, prefix = '') {
  const menu = await buildAssignmentEditMenu(assignmentId);

  if (!menu) {
    await ctx.answerCbQuery('⚠️ Задание не найдено.', { show_alert: true });
    return;
  }

  const text = prefix ? `${prefix}\n\n${menu.text}` : menu.text;

  await ctx.answerCbQuery();

  try {
    return await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...menu.keyboard,
    });
  } catch (error) {
    if ((error.description || '').includes('message is not modified')) {
      return;
    }
    return ctx.reply(text, { parse_mode: 'HTML', ...menu.keyboard });
  }
}

async function buildTopicsMenu(assignmentId, page = 0) {
  const assignment = await db.getAssignment(assignmentId);

  if (!assignment) {
    return null;
  }

  const topics = await db.getAssignmentTopics(assignmentId);
  const totalPages = Math.max(
    1,
    Math.ceil(topics.length / EDIT_TOPICS_PAGE_SIZE),
  );
  const currentPage = Math.min(
    Math.max(Number(page) || 0, 0),
    totalPages - 1,
  );
  const start = currentPage * EDIT_TOPICS_PAGE_SIZE;
  const pageTopics = topics.slice(start, start + EDIT_TOPICS_PAGE_SIZE);

  let text = `✏️ <b>Редактирование тем</b>\n`;
  text += `📚 ${escapeHtml(assignment.title)}\n`;
  text += `Всего тем: ${topics.length}`;

  if (totalPages > 1) {
    text += ` · страница ${currentPage + 1}/${totalPages}`;
  }

  text += '\n\n';

  if (!topics.length) {
    text += '📭 Тем пока нет.';
  } else {
    text += pageTopics
      .map((topic, index) => {
        const number = start + index + 1;
        const status = topic.status === 'free' ? '🟢' : '🔴';
        return `${status} <b>${number}.</b> ${escapeHtml(
          truncate(topic.title, 80),
        )}`;
      })
      .join('\n');
  }

  const rows = [];

  for (const [index, topic] of pageTopics.entries()) {
    const number = start + index + 1;
    rows.push([
      Markup.button.callback(
        `✏️ Изменить №${number}`,
        `edit_topic_${topic.id}`,
      ),
      Markup.button.callback(
        `🗑 Удалить №${number}`,
        `delete_topic_${topic.id}`,
      ),
    ]);
  }

  if (totalPages > 1) {
    const navigation = [];

    if (currentPage > 0) {
      navigation.push(
        Markup.button.callback(
          '⬅️ Назад',
          `manage_topics_${assignmentId}_${currentPage - 1}`,
        ),
      );
    }

    if (currentPage < totalPages - 1) {
      navigation.push(
        Markup.button.callback(
          'Вперёд ➡️',
          `manage_topics_${assignmentId}_${currentPage + 1}`,
        ),
      );
    }

    if (navigation.length) {
      rows.push(navigation);
    }
  }

  if (topics.length) {
    rows.push([
      Markup.button.callback(
        '🗑 Удалить все темы',
        `delete_all_topics_${assignmentId}`,
      ),
    ]);
  }

  rows.push([
    Markup.button.callback(
      '➕ Добавить темы',
      `add_topics_${assignmentId}`,
    ),
    Markup.button.callback(
      '⬅️ К заданию',
      `edit_assignment_${assignmentId}`,
    ),
  ]);

  return { text, keyboard: Markup.inlineKeyboard(rows) };
}

async function replyWithTopicsMenu(
  ctx,
  assignmentId,
  page = 0,
  prefix = '',
) {
  const menu = await buildTopicsMenu(assignmentId, page);

  if (!menu) {
    return ctx.reply('⚠️ Задание не найдено.');
  }

  const text = prefix ? `${prefix}\n\n${menu.text}` : menu.text;

  return ctx.reply(text, { parse_mode: 'HTML', ...menu.keyboard });
}

async function editMessageWithTopicsMenu(
  ctx,
  assignmentId,
  page = 0,
  prefix = '',
) {
  const menu = await buildTopicsMenu(assignmentId, page);

  if (!menu) {
    await ctx.answerCbQuery('⚠️ Задание не найдено.', { show_alert: true });
    return;
  }

  const text = prefix ? `${prefix}\n\n${menu.text}` : menu.text;

  await ctx.answerCbQuery();

  try {
    return await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...menu.keyboard,
    });
  } catch (error) {
    if ((error.description || '').includes('message is not modified')) {
      return;
    }
    return ctx.reply(text, { parse_mode: 'HTML', ...menu.keyboard });
  }
}

async function promptForState(ctx, state, payload, prompt) {
  await db.setSession(ctx.from.id, state, payload);
  await ctx.answerCbQuery();

  try {
    return await ctx.editMessageText(prompt, Markup.inlineKeyboard([]));
  } catch (error) {
    if ((error.description || '').includes('message is not modified')) {
      return;
    }
    return ctx.reply(prompt);
  }
}

async function onExport(ctx) {
  const assignmentId = parseAssignmentId(getCommandArgs(ctx));

  if (!assignmentId) {
    return ctx.reply('ℹ️ Использование: /export <ID_задания>');
  }

  const assignment = await db.getAssignment(assignmentId);

  if (!assignment) {
    return ctx.reply('⚠️ Задание с таким ID не найдено.');
  }

  const topics = await db.getAssignmentTopics(assignmentId);

  if (!topics.length) {
    return ctx.reply('📭 В этом задании пока нет тем.');
  }

  const header = [
    '№',
    'Тема',
    'Статус',
    'Студент',
    'Telegram ID',
    'Дата брони',
  ];

  const lines = [header.map(csvEscape).join(',')];

  topics.forEach((topic, index) => {
    const row = [
      index + 1,
      topic.title,
      topic.status === 'booked' ? 'Занята' : 'Свободна',
      topic.student_name || '',
      topic.student_id || '',
      topic.claimed_at ? formatDate(topic.claimed_at) : '',
    ];
    lines.push(row.map(csvEscape).join(','));
  });

  const csv = `\uFEFF${lines.join('\r\n')}`;
  const filename = `assignment_${assignmentId}_topics.csv`;

  return ctx.replyWithDocument(
    { source: Buffer.from(csv, 'utf8'), filename },
    {
      caption: `📄 Экспорт задания «${assignment.title}»\nТем: ${topics.length}`,
    },
  );
}

async function onNewAssignmentMenu(ctx) {
  await db.setSession(ctx.from.id, 'awaiting_assignment_title');

  return ctx.reply(
    '📝 Отправь название нового задания (например: Реферат по истории).\n\n' +
      'Для отмены: /cancel',
    mainMenuKeyboard(true),
  );
}

async function onAddTopicsMenu(ctx) {
  await db.clearSession(ctx.from.id);

  const assignments = await db.getActiveAssignments();

  if (!assignments.length) {
    return ctx.reply(
      '📭 Сначала создайте хотя бы одно задание.',
      mainMenuKeyboard(true),
    );
  }

  const rows = assignments.map((assignment) => [
    Markup.button.callback(
      `📚 ${truncate(assignment.title, 40)} (ID: ${assignment.id})`,
      `add_topics_${assignment.id}`,
    ),
  ]);

  return ctx.reply(
    '📚 Выбери задание, к которому добавить темы:',
    Markup.inlineKeyboard(rows),
  );
}

async function onEditAssignmentMenu(ctx) {
  await db.clearSession(ctx.from.id);

  const assignments = await db.getActiveAssignments();

  if (!assignments.length) {
    return ctx.reply(
      '📭 Сначала создайте хотя бы одно задание.',
      mainMenuKeyboard(true),
    );
  }

  const rows = assignments.map((assignment) => [
    Markup.button.callback(
      `⚙️ ${truncate(assignment.title, 40)} (ID: ${assignment.id})`,
      `edit_assignment_${assignment.id}`,
    ),
  ]);

  return ctx.reply(
    'Выбери задание для редактирования:',
    Markup.inlineKeyboard(rows),
  );
}

async function onSelectAssignment(ctx) {
  const assignmentId = parseAssignmentId(ctx.match[1]);
  const assignment = assignmentId
    ? await db.getAssignment(assignmentId)
    : null;

  if (!assignment || !assignment.is_active) {
    await ctx.answerCbQuery('⚠️ Задание не найдено или неактивно.', {
      show_alert: true,
    });
    return;
  }

  await db.setSession(ctx.from.id, 'awaiting_extra_topics_count', {
    assignmentId,
  });

  await ctx.answerCbQuery();

  const text =
    `📚 Задание: «${assignment.title}»\n\n` +
    '🔢 Сколько тем добавить? Отправь число.\n\n' +
    'Новые темы будут называться «Тема N», продолжая нумерацию.\n\n' +
    'Для отмены: /cancel';

  try {
    return await ctx.editMessageText(text, Markup.inlineKeyboard([]));
  } catch (error) {
    if ((error.description || '').includes('message is not modified')) {
      return;
    }
    return ctx.reply(text);
  }
}

async function onShowAssignmentFile(ctx) {
  const assignmentId = parseAssignmentId(ctx.match[1]);
  const assignment = assignmentId
    ? await db.getAssignment(assignmentId)
    : null;

  if (!assignment || !assignment.file_id) {
    await ctx.answerCbQuery('Файл не прикреплён.', {
      show_alert: true,
    });
    return;
  }

  await ctx.answerCbQuery();
  return sendAssignmentFile(ctx, assignment);
}

async function onEditAssignment(ctx) {
  const assignmentId = parseAssignmentId(ctx.match[1]);
  const assignment = assignmentId
    ? await db.getAssignment(assignmentId)
    : null;

  if (!assignment) {
    await ctx.answerCbQuery('⚠️ Задание не найдено.', { show_alert: true });
    return;
  }

  await db.clearSession(ctx.from.id);
  return editMessageWithMenu(ctx, assignmentId);
}

async function onEditDeadline(ctx) {
  const assignmentId = parseAssignmentId(ctx.match[1]);

  if (!assignmentId) {
    await ctx.answerCbQuery('⚠️ Задание не найдено.', { show_alert: true });
    return;
  }

  return promptForState(
    ctx,
    'awaiting_deadline',
    { assignmentId },
    '📅 Отправь дедлайн в формате ДД.ММ.ГГГГ (например, 25.12.2026).\n\n' +
      'Чтобы удалить дедлайн — отправь «-».\n' +
      'Для отмены: /cancel',
  );
}

async function onEditContact(ctx) {
  const assignmentId = parseAssignmentId(ctx.match[1]);

  if (!assignmentId) {
    await ctx.answerCbQuery('⚠️ Задание не найдено.', { show_alert: true });
    return;
  }

  return promptForState(
    ctx,
    'awaiting_teacher_contact',
    { assignmentId },
    '☎️ Отправь почту и/или номер преподавателя одним сообщением.\n\n' +
      'Чтобы удалить контакты — отправь «-».\n' +
      'Для отмены: /cancel',
  );
}

async function onEditLiterature(ctx) {
  const assignmentId = parseAssignmentId(ctx.match[1]);

  if (!assignmentId) {
    await ctx.answerCbQuery('⚠️ Задание не найдено.', { show_alert: true });
    return;
  }

  return promptForState(
    ctx,
    'awaiting_literature',
    { assignmentId },
    '📚 Отправь список литературы одним сообщением.\n' +
      'Каждый источник — с новой строки.\n\n' +
      'Чтобы удалить список — отправь «-».\n' +
      'Для отмены: /cancel',
  );
}

async function onManageTopics(ctx) {
  const assignmentId = parseAssignmentId(ctx.match[1]);
  const page = ctx.match[2] ? Number(ctx.match[2]) : 0;

  if (!assignmentId) {
    await ctx.answerCbQuery('⚠️ Задание не найдено.', { show_alert: true });
    return;
  }

  return editMessageWithTopicsMenu(ctx, assignmentId, page);
}

async function onEditTopic(ctx) {
  const topicId = Number(ctx.match[1]);
  const topic = await db.getTopic(topicId);

  if (!topic) {
    await ctx.answerCbQuery('⚠️ Тема не найдена.', { show_alert: true });
    return;
  }

  return promptForState(
    ctx,
    'awaiting_topic_title',
    { topicId: topic.id, assignmentId: topic.assignment_id },
    `✏️ Отправь новое название темы «${truncate(topic.title, 80)}».\n\n` +
      'Для отмены: /cancel',
  );
}

async function onDeleteTopic(ctx) {
  const topicId = Number(ctx.match[1]);
  const topic = await db.getTopic(topicId);

  if (!topic) {
    await ctx.answerCbQuery('⚠️ Тема не найдена.', { show_alert: true });
    return;
  }

  await ctx.answerCbQuery();

  let text = `🗑 <b>Удалить тему?</b>\n\n«${escapeHtml(topic.title)}»\n`;

  if (topic.status === 'booked') {
    text +=
      `\n🔴 Тема занята: ${escapeHtml(topic.student_name || 'студентом')}.\n`;
  }

  text += '\nДействие нельзя отменить.';

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(
        '✅ Удалить',
        `confirm_delete_topic_${topic.id}`,
      ),
      Markup.button.callback(
        '⬅️ Отмена',
        `manage_topics_${topic.assignment_id}_0`,
      ),
    ],
  ]);

  try {
    return await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...keyboard,
    });
  } catch (error) {
    if ((error.description || '').includes('message is not modified')) {
      return;
    }
    return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

async function onConfirmDeleteTopic(ctx) {
  const topicId = Number(ctx.match[1]);
  const deleted = await db.deleteTopic(topicId);

  if (!deleted) {
    await ctx.answerCbQuery('⚠️ Тема уже удалена.', { show_alert: true });
    return;
  }

  return editMessageWithTopicsMenu(
    ctx,
    deleted.assignment_id,
    0,
    '✅ Тема удалена!',
  );
}

async function onDeleteAllTopics(ctx) {
  const assignmentId = parseAssignmentId(ctx.match[1]);

  if (!assignmentId) {
    await ctx.answerCbQuery('⚠️ Задание не найдено.', { show_alert: true });
    return;
  }

  const assignment = await db.getAssignment(assignmentId);

  if (!assignment) {
    await ctx.answerCbQuery('⚠️ Задание не найдено.', { show_alert: true });
    return;
  }

  const topics = await db.getAssignmentTopics(assignmentId);

  if (!topics.length) {
    await ctx.answerCbQuery('В задании нет тем.', { show_alert: true });
    return;
  }

  await ctx.answerCbQuery();

  const booked = topics.filter((topic) => topic.status === 'booked').length;

  let text =
    `🗑 <b>Удалить все темы?</b>\n\n` +
    `📚 ${escapeHtml(assignment.title)}\n` +
    `Будет удалено тем: ${topics.length}`;

  if (booked) {
    text += `\n🔴 Из них занято: ${booked}`;
  }

  text += '\n\nДействие нельзя отменить.';

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(
        '✅ Удалить все',
        `confirm_delete_all_topics_${assignmentId}`,
      ),
      Markup.button.callback(
        '⬅️ Отмена',
        `manage_topics_${assignmentId}_0`,
      ),
    ],
  ]);

  try {
    return await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...keyboard,
    });
  } catch (error) {
    if ((error.description || '').includes('message is not modified')) {
      return;
    }
    return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

async function onConfirmDeleteAllTopics(ctx) {
  const assignmentId = parseAssignmentId(ctx.match[1]);

  if (!assignmentId) {
    await ctx.answerCbQuery('⚠️ Задание не найдено.', { show_alert: true });
    return;
  }

  const deleted = await db.deleteAllTopics(assignmentId);

  return editMessageWithTopicsMenu(
    ctx,
    assignmentId,
    0,
    `✅ Удалено тем: ${deleted}`,
  );
}

async function onDeleteAssignment(ctx) {
  const assignmentId = parseAssignmentId(ctx.match[1]);
  const assignment = assignmentId
    ? await db.getAssignment(assignmentId)
    : null;

  if (!assignment) {
    await ctx.answerCbQuery('⚠️ Задание не найдено.', { show_alert: true });
    return;
  }

  await ctx.answerCbQuery();

  const text =
    `🗑 <b>Удалить задание?</b>\n\n` +
    `📚 «${escapeHtml(assignment.title)}»\n\n` +
    'Все темы и брони студентов будут удалены. Действие нельзя отменить.';

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(
        '✅ Удалить задание',
        `confirm_delete_assignment_${assignmentId}`,
      ),
      Markup.button.callback(
        '⬅️ Отмена',
        `edit_assignment_${assignmentId}`,
      ),
    ],
  ]);

  try {
    return await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...keyboard,
    });
  } catch (error) {
    if ((error.description || '').includes('message is not modified')) {
      return;
    }
    return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

async function onConfirmDeleteAssignment(ctx) {
  const assignmentId = parseAssignmentId(ctx.match[1]);
  const deleted = assignmentId
    ? await db.deleteAssignment(assignmentId)
    : null;

  if (!deleted) {
    await ctx.answerCbQuery('⚠️ Задание уже удалено.', {
      show_alert: true,
    });
    return;
  }

  await ctx.answerCbQuery('✅ Задание удалено!');

  const text = `✅ Задание «${deleted.title}» удалено.`;
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(
        '⬅️ К заданиям',
        'assignments',
      ),
    ],
  ]);

  try {
    return await ctx.editMessageText(text, keyboard);
  } catch (error) {
    if ((error.description || '').includes('message is not modified')) {
      return;
    }
    return ctx.reply(text, keyboard);
  }
}

async function onAdminAssignmentFile(ctx, next) {
  if (!isAdmin(ctx.from.id)) {
    return next();
  }

  const session = await db.getSession(ctx.from.id);

  if (!session) {
    return next();
  }

  if (session.state === 'awaiting_assignment_title') {
    return ctx.reply('Сначала отправь название задания текстом.');
  }

  if (session.state === 'awaiting_topics_count') {
    return ctx.reply('Сначала отправь количество тем числом.');
  }

  if (session.state !== 'awaiting_assignment_file') {
    return next();
  }

  const file = extractAssignmentFile(ctx);

  if (!file) {
    return next();
  }

  if (file.fileSize > MAX_ASSIGNMENT_FILE_SIZE) {
    return sendFilePrompt(
      ctx,
      session.payload,
      '⚠️ Файл слишком большой. Максимум 20 МБ.',
    );
  }

  const title = String(session.payload?.title || '').trim();
  const expectedCount = Number(session.payload?.expectedCount);

  if (
    !title ||
    !Number.isInteger(expectedCount) ||
    expectedCount <= 0
  ) {
    await db.clearSession(ctx.from.id);
    return ctx.reply(
      '⚠️ Не удалось определить параметры задания. Начни заново.',
      mainMenuKeyboard(true),
    );
  }

  try {
    const result = await db.createAssignmentWithTopics({
      title,
      createdBy: ctx.from.id,
      fileId: file.fileId,
      fileName: file.fileName,
      topicsCount: expectedCount,
    });

    await db.clearSession(ctx.from.id);

    const menuMessage = await finishAssignmentCreation(
      ctx,
      result.assignment.id,
      `✅ Задание создано! Сгенерировано ${result.topicsCount} тем. Файл прикреплен.`,
      session.payload,
    );

    await sendAssignmentFile(ctx, result.assignment);

    return menuMessage;
  } catch (error) {
    console.error('Failed to create assignment with file:', error);
    return ctx.reply(
      '⚠️ Не удалось создать задание. Попробуй ещё раз или отправь /cancel.',
    );
  }
}

async function onAdminUnsupportedFile(ctx, next) {
  if (!isAdmin(ctx.from.id)) {
    return next();
  }

  const session = await db.getSession(ctx.from.id);

  if (!session) {
    return next();
  }

  if (session.state === 'awaiting_assignment_title') {
    return ctx.reply('Сначала отправь название задания текстом.');
  }

  if (session.state === 'awaiting_topics_count') {
    return ctx.reply('Сначала отправь количество тем числом.');
  }

  if (session.state !== 'awaiting_assignment_file') {
    return next();
  }

  return sendFilePrompt(
    ctx,
    session.payload,
    '📎 Нужно прикрепить файл (PDF, DOCX, JPG или другой формат).',
  );
}

function getAssignmentDraft(session) {
  const title = String(session.payload?.title || '').trim();
  const expectedCount = Number(session.payload?.expectedCount);

  if (!title || !Number.isInteger(expectedCount) || expectedCount <= 0) {
    return null;
  }

  return { title, expectedCount };
}

async function createAssignmentWithoutFile(
  ctx,
  session,
  { editCurrentMessage = false, answerCallback = false } = {},
) {
  const draft = getAssignmentDraft(session);

  if (!draft) {
    await db.clearSession(ctx.from.id);
    const text = '⚠️ Не удалось определить параметры задания. Начни заново.';

    if (answerCallback) {
      await ctx.answerCbQuery(text, { show_alert: true });
      return;
    }

    return ctx.reply(text, mainMenuKeyboard(true));
  }

  try {
    const result = await db.createAssignmentWithTopics({
      title: draft.title,
      createdBy: ctx.from.id,
      fileId: null,
      fileName: null,
      topicsCount: draft.expectedCount,
    });

    await db.clearSession(ctx.from.id);

    if (answerCallback) {
      await ctx.answerCbQuery(
        `✅ Создано тем: ${result.topicsCount}`,
      );
    }

    return finishAssignmentCreation(
      ctx,
      result.assignment.id,
      `✅ Задание создано без файла! Сгенерировано ${result.topicsCount} тем.`,
      session.payload,
      { editCurrentMessage },
    );
  } catch (error) {
    console.error('Failed to create assignment without file:', error);
    const text =
      '⚠️ Не удалось создать задание. Попробуй ещё раз или отправь /cancel.';

    if (answerCallback) {
      await ctx.answerCbQuery('⚠️ Не удалось создать задание.', {
        show_alert: true,
      });
      return ctx.reply(text);
    }

    return ctx.reply(text);
  }
}

async function onSkipFile(ctx) {
  const session = await db.getSession(ctx.from.id);

  if (!session || session.state !== 'awaiting_assignment_file') {
    await ctx.answerCbQuery('Сейчас шаг с файлом не активен.', {
      show_alert: true,
    });
    return;
  }

  return createAssignmentWithoutFile(ctx, session, {
    editCurrentMessage: true,
    answerCallback: true,
  });
}

async function onSkipFileCommand(ctx) {
  const session = await db.getSession(ctx.from.id);

  if (!session || session.state !== 'awaiting_assignment_file') {
    return ctx.reply(
      'Сейчас шаг с файлом не активен. Для отмены действия отправь /cancel.',
    );
  }

  return createAssignmentWithoutFile(ctx, session);
}

async function onAdminText(ctx, next) {
  if (!isAdmin(ctx.from.id)) {
    return next();
  }

  const text = ctx.message.text;
  const trimmed = text.trim();

  if (trimmed.startsWith('/') || MENU_LABELS.has(trimmed)) {
    return next();
  }

  const session = await db.getSession(ctx.from.id);

  if (!session) {
    return next();
  }

  try {
    if (session.state === 'awaiting_assignment_title') {
      if (!trimmed) {
        return ctx.reply(
          '⚠️ Название не может быть пустым. Отправь текст ещё раз.',
        );
      }

      if (trimmed.length > MAX_TITLE_LENGTH) {
        return ctx.reply(
          `⚠️ Название слишком длинное. Максимум ${MAX_TITLE_LENGTH} символов.`,
        );
      }

      await db.setSession(ctx.from.id, 'awaiting_topics_count', {
        title: trimmed,
      });

      return ctx.reply(
        '🔢 Сколько всего тем? Отправь число (например: 25).\n\n' +
          'Для отмены: /cancel',
      );
    }

    if (session.state === 'awaiting_topics_count') {
      const title = String(session.payload?.title || '').trim();

      if (!title) {
        await db.clearSession(ctx.from.id);
        return ctx.reply(
          '⚠️ Не удалось определить название задания. Начни заново.',
          mainMenuKeyboard(true),
        );
      }

      if (!/^\d+$/.test(trimmed)) {
        return ctx.reply('⚠️ Нужно ввести целое число. Например: 25');
      }

      const expectedCount = Number(trimmed);

      if (!Number.isInteger(expectedCount) || expectedCount <= 0) {
        return ctx.reply(
          '⚠️ Количество тем должно быть больше нуля. Например: 25',
        );
      }

      return sendFilePrompt(ctx, { title, expectedCount });
    }

    if (session.state === 'awaiting_assignment_file') {
      return sendFilePrompt(ctx, session.payload);
    }

    if (session.state === 'awaiting_extra_topics_count') {
      const assignmentId = parseAssignmentId(
        session.payload?.assignmentId,
      );
      const assignment = assignmentId
        ? await db.getAssignment(assignmentId)
        : null;

      if (!assignment || !assignment.is_active) {
        await db.clearSession(ctx.from.id);
        return ctx.reply(
          '⚠️ Задание не найдено или неактивно. Начни заново.',
          mainMenuKeyboard(true),
        );
      }

      if (!/^\d+$/.test(trimmed)) {
        return ctx.reply('⚠️ Нужно ввести целое число. Например: 5');
      }

      const count = Number(trimmed);

      if (!Number.isInteger(count) || count <= 0) {
        return ctx.reply(
          '⚠️ Количество тем должно быть больше нуля. Например: 5',
        );
      }

      const topics = await db.getAssignmentTopics(assignmentId);
      let maxNumber = 0;

      for (const topic of topics) {
        const match = String(topic.title).match(/^Тема\s+(\d+)$/i);
        if (match) {
          maxNumber = Math.max(maxNumber, Number(match[1]));
        }
      }

      const added = await db.addNumberedTopics(
        assignmentId,
        maxNumber + 1,
        count,
      );

      await db.clearSession(ctx.from.id);

      return replyWithEditMenu(
        ctx,
        assignmentId,
        `✅ Добавлено ${added} тем!`,
      );
    }

    if (session.state === 'awaiting_deadline') {
      const assignmentId = parseAssignmentId(
        session.payload?.assignmentId,
      );

      if (!assignmentId) {
        await db.clearSession(ctx.from.id);
        return ctx.reply(
          '⚠️ Задание не найдено. Начни заново.',
          mainMenuKeyboard(true),
        );
      }

      if (isClearInput(trimmed)) {
        await db.setAssignmentDeadline(assignmentId, null);
        await db.clearSession(ctx.from.id);
        return replyWithEditMenu(ctx, assignmentId, '✅ Дедлайн удалён.');
      }

      const deadline = parseDateInput(trimmed);

      if (!deadline) {
        return ctx.reply(
          '⚠️ Неверный формат даты. Отправь в формате ДД.ММ.ГГГГ, например 25.12.2026.',
        );
      }

      await db.setAssignmentDeadline(assignmentId, deadline);
      await db.clearSession(ctx.from.id);

      return replyWithEditMenu(
        ctx,
        assignmentId,
        `✅ Дедлайн: ${formatDateOnly(deadline)}`,
      );
    }

    if (session.state === 'awaiting_teacher_contact') {
      const assignmentId = parseAssignmentId(
        session.payload?.assignmentId,
      );

      if (!assignmentId) {
        await db.clearSession(ctx.from.id);
        return ctx.reply(
          '⚠️ Задание не найдено. Начни заново.',
          mainMenuKeyboard(true),
        );
      }

      if (isClearInput(trimmed)) {
        await db.setAssignmentContact(assignmentId, null);
        await db.clearSession(ctx.from.id);
        return replyWithEditMenu(
          ctx,
          assignmentId,
          '✅ Контакты преподавателя удалены.',
        );
      }

      if (trimmed.length > MAX_CONTACT_LENGTH) {
        return ctx.reply(
          `⚠️ Слишком длинный текст. Максимум ${MAX_CONTACT_LENGTH} символов.`,
        );
      }

      await db.setAssignmentContact(assignmentId, trimmed);
      await db.clearSession(ctx.from.id);

      return replyWithEditMenu(
        ctx,
        assignmentId,
        '✅ Контакты преподавателя обновлены.',
      );
    }

    if (session.state === 'awaiting_literature') {
      const assignmentId = parseAssignmentId(
        session.payload?.assignmentId,
      );

      if (!assignmentId) {
        await db.clearSession(ctx.from.id);
        return ctx.reply(
          '⚠️ Задание не найдено. Начни заново.',
          mainMenuKeyboard(true),
        );
      }

      if (isClearInput(trimmed)) {
        await db.setAssignmentLiterature(assignmentId, null);
        await db.clearSession(ctx.from.id);
        return replyWithEditMenu(
          ctx,
          assignmentId,
          '✅ Список литературы удалён.',
        );
      }

      if (trimmed.length > MAX_LITERATURE_LENGTH) {
        return ctx.reply(
          `⚠️ Слишком длинный список. Максимум ${MAX_LITERATURE_LENGTH} символов.`,
        );
      }

      await db.setAssignmentLiterature(assignmentId, trimmed);
      await db.clearSession(ctx.from.id);

      return replyWithEditMenu(
        ctx,
        assignmentId,
        '✅ Список литературы обновлён.',
      );
    }

    if (session.state === 'awaiting_topic_title') {
      const topicId = Number(session.payload?.topicId);

      if (!Number.isInteger(topicId) || topicId <= 0) {
        await db.clearSession(ctx.from.id);
        return ctx.reply(
          '⚠️ Тема не найдена. Начни заново.',
          mainMenuKeyboard(true),
        );
      }

      if (!trimmed) {
        return ctx.reply(
          '⚠️ Название темы не может быть пустым. Отправь текст ещё раз.',
        );
      }

      if (trimmed.length > MAX_TITLE_LENGTH) {
        return ctx.reply(
          `⚠️ Название слишком длинное. Максимум ${MAX_TITLE_LENGTH} символов.`,
        );
      }

      const updated = await db.updateTopicTitle(topicId, trimmed);

      if (!updated) {
        await db.clearSession(ctx.from.id);
        return ctx.reply(
          '⚠️ Тема не найдена. Начни заново.',
          mainMenuKeyboard(true),
        );
      }

      await db.clearSession(ctx.from.id);

      return replyWithTopicsMenu(
        ctx,
        updated.assignment_id,
        0,
        '✅ Тема обновлена!',
      );
    }

    await db.clearSession(ctx.from.id);
    return next();
  } catch (error) {
    console.error('Admin FSM error:', error);
    return ctx.reply(
      '⚠️ Не удалось сохранить данные. Попробуйте ещё раз или отправьте /cancel.',
    );
  }
}

function registerAdminHandlers(bot) {
  bot.command('export', adminOnly, onExport);
  bot.command('skip', adminOnly, onSkipFileCommand);

  bot.hears(BUTTONS.newAssignment, adminOnly, onNewAssignmentMenu);
  bot.hears(BUTTONS.addTopics, adminOnly, onAddTopicsMenu);
  bot.hears(BUTTONS.edit, adminOnly, onEditAssignmentMenu);

  bot.action(SKIP_FILE_CALLBACK, adminOnly, onSkipFile);
  bot.action(/^add_topics_(\d+)$/, adminOnly, onSelectAssignment);
  bot.action(/^edit_assignment_(\d+)$/, adminOnly, onEditAssignment);
  bot.action(/^show_file_(\d+)$/, adminOnly, onShowAssignmentFile);
  bot.action(/^edit_deadline_(\d+)$/, adminOnly, onEditDeadline);
  bot.action(/^edit_contact_(\d+)$/, adminOnly, onEditContact);
  bot.action(/^edit_literature_(\d+)$/, adminOnly, onEditLiterature);
  bot.action(
    /^manage_topics_(\d+)(?:_(\d+))?$/,
    adminOnly,
    onManageTopics,
  );
  bot.action(/^edit_topic_(\d+)$/, adminOnly, onEditTopic);
  bot.action(/^delete_topic_(\d+)$/, adminOnly, onDeleteTopic);
  bot.action(
    /^confirm_delete_topic_(\d+)$/,
    adminOnly,
    onConfirmDeleteTopic,
  );
  bot.action(
    /^delete_all_topics_(\d+)$/,
    adminOnly,
    onDeleteAllTopics,
  );
  bot.action(
    /^confirm_delete_all_topics_(\d+)$/,
    adminOnly,
    onConfirmDeleteAllTopics,
  );
  bot.action(
    /^delete_assignment_(\d+)$/,
    adminOnly,
    onDeleteAssignment,
  );
  bot.action(
    /^confirm_delete_assignment_(\d+)$/,
    adminOnly,
    onConfirmDeleteAssignment,
  );

  bot.on('document', onAdminAssignmentFile);
  bot.on('photo', onAdminAssignmentFile);

  for (const type of [
    'video',
    'audio',
    'voice',
    'animation',
    'video_note',
    'sticker',
  ]) {
    bot.on(type, onAdminUnsupportedFile);
  }

  bot.on('text', onAdminText);
}

module.exports = {
  registerAdminHandlers,
  parseDateInput,
};
