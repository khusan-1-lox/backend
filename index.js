require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const { validateInitData } = require('./validate');

const app = express();
const port = process.env.PORT || 3001;
const bot = new Telegraf(process.env.BOT_TOKEN);

// --- Middleware ---
app.use(cors());
app.use(express.json());

// Auth Middleware (Mocked for easy testing if no token provided)
const authMiddleware = (req, res, next) => {
    const initData = req.headers['x-telegram-init-data'];

    // Skip validation if we don't have a token yet (for development)
    if (!process.env.BOT_TOKEN || process.env.BOT_TOKEN === 'YOUR_BOT_TOKEN') {
        req.user = { id: 123, first_name: 'Test', last_name: 'User' };
        return next();
    }

    const validatedData = validateInitData(initData, process.env.BOT_TOKEN);
    if (validatedData) {
        req.user = validatedData.user;
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// --- API Endpoints ---

// Initial data load
app.get('/api/v1/user/init', authMiddleware, (req, res) => {
    // In a real app, fetch from DB
    res.json({
        user: req.user,
        subscriptions: [], // Start with empty list
        isPro: false,
        starsBalance: 150
    });
});

// Save subscriptions
app.post('/api/v1/user/subs', authMiddleware, (req, res) => {
    const { subs } = req.body;
    // In a real app, save to DB
    console.log(`Saving ${subs.length} subs for user ${req.user.id}`);
    res.json({ success: true, count: subs.length });
});

// --- Bot Logic ---

bot.start((ctx) => {
    ctx.reply('Welcome to SubZero! 📓❄️\nManage your subscriptions with zero effort.\n\nClick the button below to start:', {
        reply_markup: {
            inline_keyboard: [[
                { text: 'Open App 🚀', web_app: { url: process.env.WEBAPP_URL || 'https://subzero-12.onrender.com' } }
            ]]
        }
    });
});

bot.help((ctx) => ctx.reply('SubZero helps you track and optimize your digital spends. Use the Mini App to add and manage your services.'));

// Launch Server & Bot
app.listen(port, () => {
    console.log(`[Server] SubZero API running at http://localhost:${port}`);
});

if (process.env.BOT_TOKEN && process.env.BOT_TOKEN !== 'YOUR_BOT_TOKEN') {
    bot.launch().then(() => {
        console.log('[Bot] SubZero Telegram Bot is active!');
    }).catch(err => {
        console.error('[Bot] Failed to launch:', err.message);
    });
} else {
    console.warn('[Warning] BOT_TOKEN is missing. Bot features are disabled.');
}

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

