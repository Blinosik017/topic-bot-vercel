function getAdminIds() {
  return (process.env.ADMIN_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function isAdmin(id) {
  return getAdminIds().includes(String(id));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(value, maxLength = 60) {
  const text = String(value ?? '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function getTimeZone() {
  const raw = String(process.env.TZ || 'Europe/Moscow').replace(/^:/, '');

  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: raw }).format(new Date());
    return raw;
  } catch (error) {
    return 'Europe/Moscow';
  }
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('ru-RU', {
    timeZone: getTimeZone(),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateOnly(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('ru-RU', {
    timeZone: getTimeZone(),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function assignmentDetailsHtml(assignment, literatureLimit = 500) {
  const lines = [];

  if (assignment.deadline) {
    lines.push(`📅 Дедлайн: ${formatDateOnly(assignment.deadline)}`);
  }

  if (assignment.teacher_contact) {
    lines.push(
      `☎️ Контакты преподавателя: ${escapeHtml(assignment.teacher_contact)}`,
    );
  }

  if (assignment.literature) {
    lines.push('📚 <b>Литература:</b>');
    lines.push(escapeHtml(truncate(assignment.literature, literatureLimit)));
  }

  if (assignment.file_id) {
    lines.push(
      `📎 Файл: ${escapeHtml(assignment.file_name || 'прикреплён')}`,
    );
  }

  return lines.join('\n');
}

function getCommandArgs(ctx) {
  const text = ctx.message?.text || '';
  return text.replace(/^\/[^\s@]+(?:@\S+)?\s*/u, '').trim();
}

function displayName(from) {
  const parts = [from?.first_name, from?.last_name].filter(Boolean);
  return parts.join(' ').trim() || from?.username || String(from?.id ?? '');
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = {
  getAdminIds,
  isAdmin,
  escapeHtml,
  truncate,
  formatDate,
  formatDateOnly,
  assignmentDetailsHtml,
  getCommandArgs,
  displayName,
  csvEscape,
};
