const { Markup } = require('telegraf');

const BUTTONS = Object.freeze({
  topics: '📋 Список тем',
  my: '📝 Мои брони',
  newAssignment: '➕ Новое задание',
  addTopics: '➕ Добавить темы',
  edit: '✏️ Редактировать',
});

function mainMenuKeyboard(admin = false) {
  const rows = [[BUTTONS.topics, BUTTONS.my]];

  if (admin) {
    rows.push([BUTTONS.newAssignment, BUTTONS.addTopics]);
    rows.push([BUTTONS.edit]);
  }

  return Markup.keyboard(rows).resize().persistent();
}

function startText(admin = false) {
  let text =
    '👋 <b>Добро пожаловать!</b>\n\n' +
    'Я помогаю группе бронировать темы для рефератов и курсовых.\n\n' +
    '📋 <b>Меню:</b>\n' +
    '• «📋 Список тем» — активные задания и темы\n' +
    '• «📝 Мои брони» — ваши забронированные темы\n\n' +
    'Выберите задание, нажмите «Занять» — тема закрепится за вами.';

  if (admin) {
    text +=
      '\n\n👑 <b>Для старосты:</b>\n' +
      '• «➕ Новое задание» — создать задание, темы и файл (файл можно пропустить)\n' +
      '• «➕ Добавить темы» — добавить ещё темы по количеству\n' +
      '• «✏️ Редактировать» — дедлайн, контакты, литература и темы\n' +
      '• /cancel — отменить текущее действие';
  }

  return text;
}

module.exports = {
  BUTTONS,
  mainMenuKeyboard,
  startText,
};
