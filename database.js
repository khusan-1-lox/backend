const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run('PRAGMA foreign_keys = ON'); // Enable foreign key constraints
    }
});

// Initialize the database tables
const initDb = () => {
    db.serialize(() => {
        // Users Table
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                first_name TEXT,
                last_name TEXT,
                username TEXT,
                isPro BOOLEAN DEFAULT 0,
                starsBalance INTEGER DEFAULT 150,
                joined TEXT,
                role TEXT DEFAULT 'user',
                proExpiration TEXT
            )
        `);

        // Subscriptions Table
        db.run(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sub_id INTEGER,
                user_id INTEGER,
                name TEXT,
                price REAL,
                date TEXT,
                cycle TEXT,
                color TEXT,
                category TEXT,
                initial TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Promo Codes Table
        db.run(`
            CREATE TABLE IF NOT EXISTS promo_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE,
                days INTEGER,
                maxUses INTEGER,
                uses INTEGER DEFAULT 0
            )
        `);

        // Audit Logs Table
        db.run(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT,
                type TEXT,
                time_added DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    });
};

// Helper function to wrap db.all into a Promise
const allAsync = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// Helper function to wrap db.get into a Promise
const getAsync = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

// Helper function to wrap db.run into a Promise
const runAsync = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

module.exports = {
    db,
    initDb,
    allAsync,
    getAsync,
    runAsync
};
