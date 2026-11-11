async function sendAssignmentFile(ctx, assignment) {
  if (!assignment?.file_id) {
    return false;
  }

  const options = {
    caption: `📎 ${assignment.file_name || 'Файл'} — задание «${assignment.title}»`,
  };

  try {
    await ctx.replyWithDocument(assignment.file_id, options);
    return true;
  } catch (documentError) {
    try {
      await ctx.replyWithPhoto(assignment.file_id, options);
      return true;
    } catch (photoError) {
      console.error('Failed to send assignment file:', photoError);
      await ctx.reply('⚠️ Не удалось отправить файл задания.');
      return false;
    }
  }
}

module.exports = { sendAssignmentFile };
