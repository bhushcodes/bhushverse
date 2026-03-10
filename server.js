require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3001;

// Turso database connection
const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate limiting
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many login attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/poems', adminLimiter);
app.use('/api/admin', adminLimiter);

// JWT middleware
function verifyToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    jwt.verify(token, JWT_SECRET, (err) => {
        if (err) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        next();
    });
}

// Initialize database table
async function initDatabase() {
    try {
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS poems (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                author TEXT DEFAULT 'Anonymous',
                date TEXT,
                language TEXT DEFAULT 'english',
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);
        console.log('Database table ready');
    } catch (err) {
        console.error('Database init error:', err);
    }
}

// Get all poems
app.get('/api/poems', async (req, res) => {
    try {
        const result = await turso.execute('SELECT * FROM poems ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch poems' });
    }
});

// Get single poem
app.get('/api/poems/:id', async (req, res) => {
    try {
        const result = await turso.execute({
            sql: 'SELECT * FROM poems WHERE id = ?',
            args: [req.params.id]
        });
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'Poem not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch poem' });
    }
});

// Admin login
app.post('/api/admin/login', loginLimiter, async (req, res) => {
    if (!ADMIN_PASSWORD) {
        res.status(500).json({ error: 'Admin password not configured' });
        return;
    }
    
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        res.status(401).json({ error: 'Invalid password' });
        return;
    }
    
    const token = jwt.sign({ id: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token });
});

// Verify token
app.get('/api/admin/verify', verifyToken, (req, res) => {
    res.json({ valid: true });
});

// Add new poem
app.post('/api/poems', verifyToken, async (req, res) => {
    try {
        const { title, content, author, date, language } = req.body;
        const id = Date.now().toString();
        const poemDate = date || new Date().toISOString().split('T')[0];
        
        await turso.execute({
            sql: `INSERT INTO poems (id, title, content, author, date, language) VALUES (?, ?, ?, ?, ?, ?)`,
            args: [id, title, content, author || 'Anonymous', poemDate, language || 'english']
        });
        
        res.status(201).json({ id, title, content, author: author || 'Anonymous', date: poemDate, language: language || 'english' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create poem' });
    }
});

// Update poem
app.put('/api/poems/:id', verifyToken, async (req, res) => {
    try {
        const { title, content, author, date, language } = req.body;
        
        await turso.execute({
            sql: `UPDATE poems SET title = ?, content = ?, author = ?, date = ?, language = ? WHERE id = ?`,
            args: [title, content, author, date, language || 'english', req.params.id]
        });
        
        const result = await turso.execute({
            sql: 'SELECT * FROM poems WHERE id = ?',
            args: [req.params.id]
        });
        
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'Poem not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to update poem' });
    }
});

// Delete poem
app.delete('/api/poems/:id', verifyToken, async (req, res) => {
    try {
        const result = await turso.execute({
            sql: 'DELETE FROM poems WHERE id = ?',
            args: [req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete poem' });
    }
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize and start
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Poetry blog running at http://localhost:${PORT}`);
    });
});
