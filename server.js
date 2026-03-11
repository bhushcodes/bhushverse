require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { createClient } = require('@libsql/client');
const path = require('path');

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
app.use(express.json({ limit: '10mb' }));

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
    max: 60,
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/poems', adminLimiter);
app.use('/api/blogs', adminLimiter);
app.use('/api/layouts', adminLimiter);
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

// Initialize database tables
async function initDatabase() {
    try {
        // Poems table
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
        
        // Blogs table
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS blogs (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                excerpt TEXT,
                author TEXT DEFAULT 'Anonymous',
                date TEXT,
                language TEXT DEFAULT 'english',
                status TEXT DEFAULT 'draft',
                featured_image TEXT,
                tags TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);
        
        // Visual layouts table (for Canva-like editor)
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS layouts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                elements TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);
        
        console.log('Database tables ready');
    } catch (err) {
        console.error('Database init error:', err);
    }
}

// ==================== POEMS API ====================

app.get('/api/poems', async (req, res) => {
    try {
        const result = await turso.execute('SELECT * FROM poems ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch poems' });
    }
});

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

app.get('/api/admin/verify', verifyToken, (req, res) => {
    res.json({ valid: true });
});

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

app.delete('/api/poems/:id', verifyToken, async (req, res) => {
    try {
        await turso.execute({
            sql: 'DELETE FROM poems WHERE id = ?',
            args: [req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete poem' });
    }
});

// ==================== BLOGS API ====================

app.get('/api/blogs', async (req, res) => {
    try {
        const status = req.query.status;
        let query = 'SELECT * FROM blogs';
        if (status) {
            query += ` WHERE status = '${status}'`;
        }
        query += ' ORDER BY created_at DESC';
        const result = await turso.execute(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch blogs' });
    }
});

app.get('/api/blogs/:id', async (req, res) => {
    try {
        const result = await turso.execute({
            sql: 'SELECT * FROM blogs WHERE id = ?',
            args: [req.params.id]
        });
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'Blog not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch blog' });
    }
});

app.post('/api/blogs', verifyToken, async (req, res) => {
    try {
        const { title, content, excerpt, author, date, language, status, featured_image, tags } = req.body;
        const id = Date.now().toString();
        const blogDate = date || new Date().toISOString().split('T')[0];
        
        await turso.execute({
            sql: `INSERT INTO blogs (id, title, content, excerpt, author, date, language, status, featured_image, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [id, title, content, excerpt || '', author || 'Anonymous', blogDate, language || 'english', status || 'draft', featured_image || '', tags || '']
        });
        
        res.status(201).json({ id, title, content, excerpt, author: author || 'Anonymous', date: blogDate, language: language || 'english', status: status || 'draft', featured_image, tags });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create blog' });
    }
});

app.put('/api/blogs/:id', verifyToken, async (req, res) => {
    try {
        const { title, content, excerpt, author, date, language, status, featured_image, tags } = req.body;
        
        await turso.execute({
            sql: `UPDATE blogs SET title = ?, content = ?, excerpt = ?, author = ?, date = ?, language = ?, status = ?, featured_image = ?, tags = ? WHERE id = ?`,
            args: [title, content, excerpt || '', author, date, language || 'english', status || 'draft', featured_image || '', tags || '', req.params.id]
        });
        
        const result = await turso.execute({
            sql: 'SELECT * FROM blogs WHERE id = ?',
            args: [req.params.id]
        });
        
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'Blog not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to update blog' });
    }
});

app.delete('/api/blogs/:id', verifyToken, async (req, res) => {
    try {
        await turso.execute({
            sql: 'DELETE FROM blogs WHERE id = ?',
            args: [req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete blog' });
    }
});

// ==================== LAYOUTS API (Visual Editor) ====================

app.get('/api/layouts', async (req, res) => {
    try {
        const type = req.query.type;
        let query = 'SELECT * FROM layouts';
        if (type) {
            query += ` WHERE type = '${type}'`;
        }
        query += ' ORDER BY updated_at DESC';
        const result = await turso.execute(query);
        // Parse elements JSON
        const layouts = result.rows.map(row => ({
            ...row,
            elements: row.elements ? JSON.parse(row.elements) : []
        }));
        res.json(layouts);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch layouts' });
    }
});

app.get('/api/layouts/:id', async (req, res) => {
    try {
        const result = await turso.execute({
            sql: 'SELECT * FROM layouts WHERE id = ?',
            args: [req.params.id]
        });
        if (result.rows.length > 0) {
            const layout = result.rows[0];
            layout.elements = layout.elements ? JSON.parse(layout.elements) : [];
            res.json(layout);
        } else {
            res.status(404).json({ error: 'Layout not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch layout' });
    }
});

app.post('/api/layouts', verifyToken, async (req, res) => {
    try {
        const { name, type, elements } = req.body;
        const id = Date.now().toString();
        
        await turso.execute({
            sql: `INSERT INTO layouts (id, name, type, elements) VALUES (?, ?, ?, ?)`,
            args: [id, name, type, JSON.stringify(elements || [])]
        });
        
        res.status(201).json({ id, name, type, elements: elements || [] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create layout' });
    }
});

app.put('/api/layouts/:id', verifyToken, async (req, res) => {
    try {
        const { name, type, elements } = req.body;
        
        await turso.execute({
            sql: `UPDATE layouts SET name = ?, type = ?, elements = ?, updated_at = strftime('%s', 'now') WHERE id = ?`,
            args: [name, type, JSON.stringify(elements || []), req.params.id]
        });
        
        const result = await turso.execute({
            sql: 'SELECT * FROM layouts WHERE id = ?',
            args: [req.params.id]
        });
        
        if (result.rows.length > 0) {
            const layout = result.rows[0];
            layout.elements = layout.elements ? JSON.parse(layout.elements) : [];
            res.json(layout);
        } else {
            res.status(404).json({ error: 'Layout not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to update layout' });
    }
});

app.delete('/api/layouts/:id', verifyToken, async (req, res) => {
    try {
        await turso.execute({
            sql: 'DELETE FROM layouts WHERE id = ?',
            args: [req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete layout' });
    }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize and start
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Poetry blog running at http://localhost:${PORT}`);
    });
});
