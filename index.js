require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const { validateInitData } = require('./validate');
const { initDb, getAsync, allAsync, runAsync } = require('./database');

const app = express();
const port = process.env.PORT || 3001;
const bot = new Telegraf(process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN');

// --- Initialization ---
initDb();

// --- Middleware ---
app.use(cors());
app.use(express.json());

// Auth Middleware
const authMiddleware = async (req, res, next) => {
    const initData = req.headers['x-telegram-init-data'];

    let userData = null;
    if (!process.env.BOT_TOKEN || process.env.BOT_TOKEN === 'YOUR_BOT_TOKEN') {
        userData = { id: 123456789, first_name: 'Test Admin', last_name: 'User', username: 'test_admin' };
    } else {
        const validatedData = validateInitData(initData, process.env.BOT_TOKEN);
        if (validatedData) {
            userData = validatedData.user;
        }
    }

    if (userData) {
        req.user = userData;

        // Ensure user exists in DB
        try {
            const existingUser = await getAsync('SELECT * FROM users WHERE id = ?', [req.user.id]);
            if (!existingUser) {
                const joined = new Date().toISOString().split('T')[0];
                await runAsync(
                    'INSERT INTO users (id, first_name, last_name, username, joined) VALUES (?, ?, ?, ?, ?)',
                    [req.user.id, req.user.first_name, req.user.last_name, req.user.username, joined]
                );
                await runAsync('INSERT INTO audit_logs (action, type) VALUES (?, ?)', [`New user joined: ${req.user.first_name}`, 'system']);
            } else {
                // Update username/name if changed
                await runAsync(
                    'UPDATE users SET first_name = ?, last_name = ?, username = ? WHERE id = ?',
                    [req.user.first_name, req.user.last_name, req.user.username, req.user.id]
                );
            }
        } catch (e) {
            console.error('DB Error in auth:', e);
        }
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

const adminMiddleware = async (req, res, next) => {
    try {
        const user = await getAsync('SELECT role FROM users WHERE id = ?', [req.user.id]);
        if (user && user.role === 'admin' || req.user.id === 123456789) {
            next();
        } else {
            res.status(403).json({ error: 'Forbidden. Admin only.' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
}

// --- API Endpoints ---

// Initial data load
app.get('/api/v1/user/init', authMiddleware, async (req, res) => {
    try {
        const userDb = await getAsync('SELECT * FROM users WHERE id = ?', [req.user.id]);
        const subs = await allAsync('SELECT sub_id as id, name, price, date, cycle, color, category, initial FROM subscriptions WHERE user_id = ?', [req.user.id]);

        res.json({
            user: req.user,
            subscriptions: subs || [],
            isPro: userDb.isPro === 1 || userDb.isPro === true,
            starsBalance: userDb.starsBalance,
            proExpiration: userDb.proExpiration,
            role: userDb.role || 'user'
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to initialize' });
    }
});

// Save subscriptions
app.post('/api/v1/user/subs', authMiddleware, async (req, res) => {
    const { subs } = req.body;
    try {
        await runAsync('BEGIN TRANSACTION');
        await runAsync('DELETE FROM subscriptions WHERE user_id = ?', [req.user.id]);

        for (const sub of subs) {
            await runAsync(
                'INSERT INTO subscriptions (sub_id, user_id, name, price, date, cycle, color, category, initial) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [sub.id, req.user.id, sub.name, sub.price, sub.date, sub.cycle, sub.color, sub.category, sub.initial]
            );
        }
        await runAsync('COMMIT');

        await runAsync('INSERT INTO audit_logs (action, type) VALUES (?, ?)', [`User ${req.user.first_name} updated subscriptions`, 'user']);

        res.json({ success: true, count: subs.length });
    } catch (e) {
        await runAsync('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: 'Failed to save subscriptions' });
    }
});

// Update profile stats (pro, stars)
app.post('/api/v1/user/update', authMiddleware, async (req, res) => {
    const { isPro, starsBalance, proExpiration } = req.body;
    try {
        await runAsync(
            'UPDATE users SET isPro = ?, starsBalance = ?, proExpiration = ? WHERE id = ?',
            [isPro ? 1 : 0, starsBalance, proExpiration, req.user.id]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.post('/api/v1/user/audit', authMiddleware, async (req, res) => {
    const { action, type } = req.body;
    try {
        await runAsync('INSERT INTO audit_logs (action, type) VALUES (?, ?)', [action, type]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});


// --- Admin Endpoints ---

app.get('/api/v1/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const usersCountRes = await getAsync('SELECT COUNT(*) as count FROM users');
        const proCountRes = await getAsync('SELECT COUNT(*) as count FROM users WHERE isPro = 1');

        const subscriptionsRes = await allAsync('SELECT price FROM subscriptions');
        let totalRevenueMonthly = 0;
        subscriptionsRes.forEach(s => {
            totalRevenueMonthly += (s.price || 0);
        });

        res.json({
            totalRevenue: totalRevenueMonthly,
            activeUsers: usersCountRes.count,
            proUsers: proCountRes.count,
            avgSpend: usersCountRes.count > 0 ? (totalRevenueMonthly / usersCountRes.count).toFixed(2) : 0,
            predictedRevenue: totalRevenueMonthly * 1.2
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.get('/api/v1/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const users = await allAsync('SELECT id, first_name as name, username, CASE WHEN isPro = 1 THEN "Pro" ELSE "Free" END as status, joined FROM users');
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.get('/api/v1/admin/audit', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const logs = await allAsync('SELECT * FROM audit_logs ORDER BY time_added DESC LIMIT 50');
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.get('/api/v1/admin/promo', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const promos = await allAsync('SELECT * FROM promo_codes ORDER BY id DESC');
        res.json(promos);
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.post('/api/v1/admin/promo', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { code, days, maxUses } = req.body;
        await runAsync('INSERT INTO promo_codes (code, days, maxUses) VALUES (?, ?, ?)', [code, days, maxUses]);
        await runAsync('INSERT INTO audit_logs (action, type) VALUES (?, ?)', [`Generated promo code: ${code} (${days} days)`, 'admin']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.delete('/api/v1/admin/promo/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        await runAsync('DELETE FROM promo_codes WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

// Broadcast state (mocked in memory for simplicity, or we could save to db)
let activeBroadcast = null;
app.post('/api/v1/admin/broadcast', authMiddleware, adminMiddleware, async (req, res) => {
    const { text, time } = req.body;
    activeBroadcast = { id: Date.now(), text, time };
    await runAsync('INSERT INTO audit_logs (action, type) VALUES (?, ?)', [`Global broadcast sent: ${text.substring(0, 20)}...`, 'admin']);
    res.json({ success: true });
});

app.get('/api/v1/broadcast', authMiddleware, (req, res) => {
    res.json({ broadcast: activeBroadcast });
});

// Redeem Promo
app.post('/api/v1/user/promo/redeem', authMiddleware, async (req, res) => {
    const { code } = req.body;
    try {
        const promo = await getAsync('SELECT * FROM promo_codes WHERE code = ?', [code]);
        if (!promo) return res.status(400).json({ error: 'Invalid promo code' });
        if (promo.uses >= promo.maxUses) return res.status(400).json({ error: 'Promo code reached max uses' });

        await runAsync('UPDATE promo_codes SET uses = uses + 1 WHERE id = ?', [promo.id]);

        let user = await getAsync('SELECT * FROM users WHERE id = ?', [req.user.id]);

        let newExpDate = new Date();
        if (user.proExpiration && new Date(user.proExpiration) > new Date()) {
            newExpDate = new Date(user.proExpiration);
        }
        newExpDate.setDate(newExpDate.getDate() + promo.days);
        const expStr = newExpDate.toISOString();

        await runAsync('UPDATE users SET isPro = 1, proExpiration = ? WHERE id = ?', [expStr, req.user.id]);
        await runAsync('INSERT INTO audit_logs (action, type) VALUES (?, ?)', [`User ${req.user.first_name} redeemed promo code: ${code}`, 'promo']);

        res.json({ success: true, days: promo.days, proExpiration: expStr });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed' });
    }
});


// --- Bot Logic ---

bot.start((ctx) => {
    ctx.reply('Welcome to SubZero! 📓❄️\nManage your subscriptions with zero effort.\n\nClick the button below to start:', {
        reply_markup: {
            inline_keyboard: [[
                { text: 'Open App 🚀', web_app: { url: process.env.WEBAPP_URL || 'http://localhost:5173' } }
            ]]
        }
    });
});

bot.command('admin', async (ctx) => {
    try {
        const user = await getAsync('SELECT role FROM users WHERE id = ?', [ctx.from.id]);
        if (user && user.role === 'admin' || ctx.from.id === 123456789) {
            ctx.reply('Admin panel access link:', {
                reply_markup: {
                    inline_keyboard: [[
                        { text: 'Open Admin App 🚀', web_app: { url: process.env.WEBAPP_URL || 'http://localhost:5173' } }
                    ]]
                }
            })
        } else {
            ctx.reply('Unauthorized');
        }
    } catch (e) {

    }
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
