const bot = require('../bot');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('TopicSlotsBot webhook is running');
    return;
  }

  const secret = process.env.WEBHOOK_SECRET;

  if (secret) {
    const provided = req.headers['x-telegram-bot-api-secret-token'];

    if (provided !== secret) {
      res.status(401).send('Unauthorized');
      return;
    }
  }

  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
};
