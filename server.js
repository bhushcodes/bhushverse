require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { createClient } = require('@libsql/client');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3001;

// Turso database connection
const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const SUPPORTED_LANGUAGES = ['english', 'hindi', 'marathi', 'hinglish'];

// Email configuration
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = process.env.EMAIL_PORT || 587;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@bhushverse.com';

// Verification code storage (in-memory) - in production, use Redis or database
const verificationCodes = new Map();
const VERIFICATION_EXPIRY = 10 * 60 * 1000; // 10 minutes

// Create email transporter
let emailTransporter = null;
if (EMAIL_USER && EMAIL_PASS) {
    emailTransporter = nodemailer.createTransport({
        host: EMAIL_HOST,
        port: EMAIL_PORT,
        secure: false,
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS
        }
    });
}

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginEmbedderPolicy: false,
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
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', loginLimiter);

function getTokenFromRequest(req) {
    const header = req.headers['authorization'];
    if (!header) return null;
    return header.startsWith('Bearer ') ? header.slice(7) : header;
}

// JWT middleware
function verifyAdminToken(req, res, next) {
    const token = getTokenFromRequest(req);
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    jwt.verify(token, JWT_SECRET, (err, payload) => {
        if (err || payload?.role !== 'admin') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        req.admin = payload;
        next();
    });
}

function verifyUserToken(req, res, next) {
    const token = getTokenFromRequest(req);
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    jwt.verify(token, JWT_SECRET, (err, payload) => {
        if (err || payload?.role !== 'user') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        req.user = payload;
        next();
    });
}

function attachUserIfPresent(req, _res, next) {
    const token = getTokenFromRequest(req);
    if (!token) {
        next();
        return;
    }
    jwt.verify(token, JWT_SECRET, (err, payload) => {
        if (!err && payload?.role === 'user') {
            req.user = payload;
        }
        next();
    });
}

function mapUser(row) {
    if (!row) return null;
    return {
        id: row.uid,
        googleId: row.uid,
        username: row.username || '',
        personalId: row.username || '',
        name: row.display_name || row.name || '',
        email: row.email,
        profilePicture: row.photo_url || row.profile_picture || '',
        bio: row.bio || '',
        gender: row.gender || '',
        age: row.age !== null && row.age !== undefined ? Number(row.age) : null,
        createdAt: row.created_at
    };
}

function normalizeUsernameInput(value) {
    const normalized = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9._]/g, '')
        .replace(/^[._]+|[._]+$/g, '')
        .slice(0, 24);
    return normalized;
}

function maskedEmail(email) {
    if (!email || !email.includes('@')) return email;
    const [local, domain] = email.split('@');
    if (local.length <= 2) return email;
    return local[0] + '*'.repeat(local.length - 2) + local[local.length - 1] + '@' + domain;
}

function mapCommunityPost(row) {
    if (!row) return null;
    return {
        id: row.id,
        contentType: 'community',
        title: row.title,
        content: row.content,
        postType: row.post_type,
        authorId: row.author_id,
        createdAt: row.created_at,
        language: row.language || 'english',
        status: row.status || 'published',
        author: {
            id: row.author_id,
            name: row.author_name,
            profilePicture: row.author_profile_picture || '',
            username: row.author_username || '',
            personalId: row.author_username || ''
        },
        likeCount: Number(row.like_count || 0),
        saveCount: Number(row.save_count || 0),
        likedByCurrentUser: Boolean(Number(row.liked_by_current_user || 0)),
        savedByCurrentUser: Boolean(Number(row.saved_by_current_user || 0)),
        authorIsFollowing: Boolean(Number(row.author_is_following || 0))
    };
}

function mapSavedContent(row) {
    if (!row) return null;
    return {
        id: row.content_id,
        contentType: row.content_type,
        title: row.title,
        content: row.content,
        authorId: row.author_id || '',
        createdAt: row.created_at,
        language: row.language || 'english',
        status: row.status || 'published',
        postType: row.post_type || (row.content_type === 'poem' ? 'poetry' : 'blog'),
        author: {
            id: row.author_id || '',
            name: row.author_name || row.author || 'Anonymous',
            profilePicture: row.author_profile_picture || ''
        },
        likeCount: Number(row.like_count || 0),
        saveCount: Number(row.save_count || 0),
        likedByCurrentUser: Boolean(Number(row.liked_by_current_user || 0)),
        savedByCurrentUser: true
    };
}

async function verifyGoogleCredential(idToken) {
    if (!GOOGLE_CLIENT_ID) {
        throw new Error('Google client ID not configured');
    }

    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!response.ok) {
        throw new Error('Invalid Google token');
    }

    const payload = await response.json();
    if (payload.aud !== GOOGLE_CLIENT_ID) {
        throw new Error('Google token audience mismatch');
    }
    if (payload.email_verified !== 'true') {
        throw new Error('Google email not verified');
    }

    return {
        sub: payload.sub,
        name: payload.name || payload.email,
        email: payload.email,
        picture: payload.picture || ''
    };
}

async function getUserById(userId) {
    const result = await turso.execute({
        sql: 'SELECT * FROM users WHERE uid = ?',
        args: [userId]
    });
    return result.rows[0] || null;
}

function normalizeUsernameSeed(value) {
    const base = normalizeUsernameInput(String(value || '').replace(/\s+/g, '_')) || String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
    return (base || 'writer').slice(0, 18);
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
    if (!passwordHash || !passwordHash.includes(':')) return false;
    const [salt, storedHash] = passwordHash.split(':');
    const derived = crypto.scryptSync(password, salt, 64);
    const stored = Buffer.from(storedHash, 'hex');
    if (stored.length !== derived.length) return false;
    return crypto.timingSafeEqual(stored, derived);
}

async function usernameExists(username, excludeUserId = '') {
    const result = await turso.execute({
        sql: `
            SELECT 1
            FROM users
            WHERE username = ?
              AND (? = '' OR uid != ?)
            LIMIT 1
        `,
        args: [username, excludeUserId, excludeUserId]
    });
    return result.rows.length > 0;
}

async function generateUniqueUsername(seed, excludeUserId = '') {
    const base = normalizeUsernameSeed(seed);
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const suffix = attempt === 0 ? '' : `_${attempt + 1}`;
        const trimmedBase = base.slice(0, Math.max(3, 24 - suffix.length));
        const candidate = `${trimmedBase}${suffix}`;
        if (!(await usernameExists(candidate, excludeUserId))) {
            return candidate;
        }
    }
    return `${base.slice(0, 16)}_${Date.now().toString().slice(-6)}`;
}

async function ensureUserUsername(userId, preferredSeed = '') {
    const user = await getUserById(userId);
    if (!user) return null;
    if (user.username) return user.username;

    const username = await generateUniqueUsername(
        preferredSeed || user.display_name || user.email || user.uid,
        userId
    );

    await turso.execute({
        sql: 'UPDATE users SET username = ?, updated_at = strftime(\'%s\', \'now\') WHERE uid = ?',
        args: [username, userId]
    });

    return username;
}

function createUserToken(user) {
    return jwt.sign(
        { id: user.uid, email: user.email || '', role: 'user' },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

async function fetchCommunityPost(postId, currentUserId = '') {
    const result = await turso.execute({
        sql: `
            SELECT
                p.id,
                p.title,
                p.content,
                p.post_type,
                p.author_id,
                p.language,
                COALESCE(p.status, 'published') AS status,
                p.created_at,
                COALESCE(u.display_name, 'Anonymous') AS author_name,
                COALESCE(u.photo_url, '') AS author_profile_picture,
                COALESCE(u.username, '') AS author_username,
                COALESCE(l.like_count, 0) AS like_count,
                COALESCE(s.save_count, 0) AS save_count,
                CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_current_user,
                CASE WHEN my_save.user_id IS NULL THEN 0 ELSE 1 END AS saved_by_current_user,
                CASE WHEN f.follower_id IS NULL THEN 0 ELSE 1 END AS author_is_following
            FROM user_posts p
            JOIN users u ON u.uid = p.author_id
            LEFT JOIN (
                SELECT post_id, COUNT(*) AS like_count
                FROM post_likes
                GROUP BY post_id
            ) l ON l.post_id = p.id
            LEFT JOIN (
                SELECT post_id, COUNT(*) AS save_count
                FROM saved_posts
                GROUP BY post_id
            ) s ON s.post_id = p.id
            LEFT JOIN post_likes my_like ON my_like.post_id = p.id AND my_like.user_id = ?
            LEFT JOIN saved_posts my_save ON my_save.post_id = p.id AND my_save.user_id = ?
            LEFT JOIN followers f ON f.following_id = p.author_id AND f.follower_id = ?
            WHERE p.id = ?
        `,
        args: [currentUserId, currentUserId, currentUserId, postId]
    });

    return mapCommunityPost(result.rows[0]);
}

function mapProfileRelationshipUser(row, currentUserId = '') {
    return {
        id: row.uid,
        username: row.username || '',
        personalId: row.username || '',
        name: row.display_name || '',
        profilePicture: row.photo_url || '',
        bio: row.bio || '',
        isFollowing: row.uid === currentUserId ? null : Boolean(Number(row.is_following || 0))
    };
}

async function fetchPublishedPostsByAuthor(authorId, currentUserId = '') {
    const result = await turso.execute({
        sql: `
            SELECT
                p.id,
                p.title,
                p.content,
                p.post_type,
                p.author_id,
                p.language,
                COALESCE(p.status, 'published') AS status,
                p.created_at,
                COALESCE(u.display_name, 'Anonymous') AS author_name,
                COALESCE(u.photo_url, '') AS author_profile_picture,
                COALESCE(u.username, '') AS author_username,
                COALESCE(l.like_count, 0) AS like_count,
                COALESCE(s.save_count, 0) AS save_count,
                CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_current_user,
                CASE WHEN my_save.user_id IS NULL THEN 0 ELSE 1 END AS saved_by_current_user,
                CASE WHEN f.follower_id IS NULL THEN 0 ELSE 1 END AS author_is_following
            FROM user_posts p
            JOIN users u ON u.uid = p.author_id
            LEFT JOIN (
                SELECT post_id, COUNT(*) AS like_count
                FROM post_likes
                GROUP BY post_id
            ) l ON l.post_id = p.id
            LEFT JOIN (
                SELECT post_id, COUNT(*) AS save_count
                FROM saved_posts
                GROUP BY post_id
            ) s ON s.post_id = p.id
            LEFT JOIN post_likes my_like ON my_like.post_id = p.id AND my_like.user_id = ?
            LEFT JOIN saved_posts my_save ON my_save.post_id = p.id AND my_save.user_id = ?
            LEFT JOIN followers f ON f.following_id = p.author_id AND f.follower_id = ?
            WHERE p.author_id = ? AND COALESCE(p.status, 'published') = 'published'
            ORDER BY p.created_at DESC
        `,
        args: [currentUserId, currentUserId, currentUserId, authorId]
    });

    return result.rows.map(mapCommunityPost);
}

async function fetchRelationshipUsers(userId, currentUserId = '', relation = 'followers') {
    const relationshipJoin = relation === 'followers' ? 'f.follower_id' : 'f.following_id';
    const relationshipFilter = relation === 'followers' ? 'f.following_id' : 'f.follower_id';
    const result = await turso.execute({
        sql: `
            SELECT
                u.uid,
                COALESCE(u.username, '') AS username,
                COALESCE(u.display_name, '') AS display_name,
                COALESCE(u.photo_url, '') AS photo_url,
                COALESCE(u.bio, '') AS bio,
                CASE WHEN my_follow.follower_id IS NULL THEN 0 ELSE 1 END AS is_following
            FROM followers f
            JOIN users u ON u.uid = ${relationshipJoin}
            LEFT JOIN followers my_follow ON my_follow.following_id = u.uid AND my_follow.follower_id = ?
            WHERE ${relationshipFilter} = ?
            ORDER BY f.created_at DESC
        `,
        args: [currentUserId, userId]
    });

    return result.rows.map((row) => mapProfileRelationshipUser(row, currentUserId));
}

async function getTableSql(tableName) {
    const result = await turso.execute({
        sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        args: [tableName]
    });
    return result.rows[0]?.sql || '';
}

async function getTableColumns(tableName) {
    const result = await turso.execute(`PRAGMA table_info(${tableName})`);
    return result.rows.map((row) => row.name);
}

async function ensureColumn(tableName, columnName, definition) {
    const columns = await getTableColumns(tableName);
    if (!columns.includes(columnName)) {
        await turso.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

function normalizeContentType(contentType) {
    return String(contentType || '').toLowerCase();
}

async function contentExists(contentType, contentId) {
    if (contentType === 'poem') {
        const result = await turso.execute({
            sql: 'SELECT 1 FROM poems WHERE id = ?',
            args: [contentId]
        });
        return result.rows.length > 0;
    }
    if (contentType === 'blog') {
        const result = await turso.execute({
            sql: 'SELECT 1 FROM blogs WHERE id = ?',
            args: [contentId]
        });
        return result.rows.length > 0;
    }
    return false;
}

async function getGenericInteractionSummary(contentType, contentId, currentUserId = '') {
    const [likeCountResult, saveCountResult, likedResult, savedResult] = await Promise.all([
        turso.execute({
            sql: 'SELECT COUNT(*) AS count FROM content_likes WHERE content_type = ? AND content_id = ?',
            args: [contentType, contentId]
        }),
        turso.execute({
            sql: 'SELECT COUNT(*) AS count FROM saved_items WHERE content_type = ? AND content_id = ?',
            args: [contentType, contentId]
        }),
        currentUserId ? turso.execute({
            sql: 'SELECT 1 FROM content_likes WHERE content_type = ? AND content_id = ? AND user_id = ?',
            args: [contentType, contentId, currentUserId]
        }) : Promise.resolve({ rows: [] }),
        currentUserId ? turso.execute({
            sql: 'SELECT 1 FROM saved_items WHERE content_type = ? AND content_id = ? AND user_id = ?',
            args: [contentType, contentId, currentUserId]
        }) : Promise.resolve({ rows: [] })
    ]);

    return {
        likeCount: Number(likeCountResult.rows[0]?.count || 0),
        saveCount: Number(saveCountResult.rows[0]?.count || 0),
        likedByCurrentUser: likedResult.rows.length > 0,
        savedByCurrentUser: savedResult.rows.length > 0
    };
}

async function decorateGenericContent(contentType, row, currentUserId = '') {
    if (!row) return null;
    const interaction = await getGenericInteractionSummary(contentType, row.id, currentUserId);
    return {
        ...row,
        contentType,
        likeCount: interaction.likeCount,
        saveCount: interaction.saveCount,
        likedByCurrentUser: interaction.likedByCurrentUser,
        savedByCurrentUser: interaction.savedByCurrentUser
    };
}

async function rebuildCommunityTable(tableName, createSql, columnList) {
    const backupName = `${tableName}_backup_${Date.now()}`;
    const columns = columnList.join(', ');

    await turso.execute('PRAGMA foreign_keys=OFF');
    try {
        await turso.execute(`ALTER TABLE ${tableName} RENAME TO ${backupName}`);
        await turso.execute(createSql);
        await turso.execute(`INSERT INTO ${tableName} (${columns}) SELECT ${columns} FROM ${backupName}`);
        await turso.execute(`DROP TABLE ${backupName}`);
    } finally {
        await turso.execute('PRAGMA foreign_keys=ON');
    }
}

async function migrateCommunitySchemaIfNeeded() {
    const userPostsSql = await getTableSql('user_posts');
    if (userPostsSql && userPostsSql.includes('REFERENCES users(id)')) {
        await rebuildCommunityTable(
            'user_posts',
            `CREATE TABLE user_posts (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                post_type TEXT NOT NULL,
                author_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            )`,
            ['id', 'title', 'content', 'post_type', 'author_id', 'created_at']
        );
    }

    const postLikesSql = await getTableSql('post_likes');
    if (postLikesSql && postLikesSql.includes('REFERENCES users(id)')) {
        await rebuildCommunityTable(
            'post_likes',
            `CREATE TABLE post_likes (
                post_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (post_id, user_id)
            )`,
            ['post_id', 'user_id', 'created_at']
        );
    }

    const savedPostsSql = await getTableSql('saved_posts');
    if (savedPostsSql && savedPostsSql.includes('REFERENCES users(id)')) {
        await rebuildCommunityTable(
            'saved_posts',
            `CREATE TABLE saved_posts (
                post_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (post_id, user_id)
            )`,
            ['post_id', 'user_id', 'created_at']
        );
    }

    await ensureColumn('user_posts', 'language', "TEXT DEFAULT 'english'");
    await ensureColumn('user_posts', 'status', "TEXT DEFAULT 'published'");
    await ensureColumn('users', 'username', 'TEXT');
    await ensureColumn('users', 'password_hash', 'TEXT');
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

        // User profiles
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS users (
                uid TEXT PRIMARY KEY,
                email TEXT UNIQUE,
                display_name TEXT,
                username TEXT UNIQUE,
                photo_url TEXT,
                age INTEGER,
                gender TEXT,
                hobbies TEXT,
                bio TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // User generated posts
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS user_posts (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                post_type TEXT NOT NULL,
                author_id TEXT NOT NULL,
                language TEXT DEFAULT 'english',
                status TEXT DEFAULT 'published',
                created_at TEXT NOT NULL,
                FOREIGN KEY (author_id) REFERENCES users(uid)
            )
        `);

        // Post likes
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS post_likes (
                post_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (post_id, user_id),
                FOREIGN KEY (post_id) REFERENCES user_posts(id),
                FOREIGN KEY (user_id) REFERENCES users(uid)
            )
        `);

        // Saved posts
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS saved_posts (
                post_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (post_id, user_id),
                FOREIGN KEY (post_id) REFERENCES user_posts(id),
                FOREIGN KEY (user_id) REFERENCES users(uid)
            )
        `);

        await turso.execute(`
            CREATE TABLE IF NOT EXISTS content_likes (
                content_type TEXT NOT NULL,
                content_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (content_type, content_id, user_id),
                FOREIGN KEY (user_id) REFERENCES users(uid)
            )
        `);

        await turso.execute(`
            CREATE TABLE IF NOT EXISTS saved_items (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                content_type TEXT NOT NULL,
                content_id TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (user_id) REFERENCES users(uid),
                UNIQUE(user_id, content_type, content_id)
            )
        `);

        // Followers table
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS followers (
                follower_id TEXT NOT NULL,
                following_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (follower_id, following_id),
                FOREIGN KEY (follower_id) REFERENCES users(uid),
                FOREIGN KEY (following_id) REFERENCES users(uid)
            )
        `);

        await migrateCommunitySchemaIfNeeded();
        
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

app.get('/api/poems/:id', attachUserIfPresent, async (req, res) => {
    try {
        const result = await turso.execute({
            sql: 'SELECT * FROM poems WHERE id = ?',
            args: [req.params.id]
        });
        if (result.rows.length > 0) {
            res.json(await decorateGenericContent('poem', result.rows[0], req.user?.id || ''));
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
    
    const token = jwt.sign({ id: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token });
});

app.get('/api/admin/verify', verifyAdminToken, (req, res) => {
    res.json({ valid: true });
});

app.post('/api/poems', verifyAdminToken, async (req, res) => {
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

app.put('/api/poems/:id', verifyAdminToken, async (req, res) => {
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

app.delete('/api/poems/:id', verifyAdminToken, async (req, res) => {
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

app.get('/api/blogs/:id', attachUserIfPresent, async (req, res) => {
    try {
        const result = await turso.execute({
            sql: 'SELECT * FROM blogs WHERE id = ?',
            args: [req.params.id]
        });
        if (result.rows.length > 0) {
            res.json(await decorateGenericContent('blog', result.rows[0], req.user?.id || ''));
        } else {
            res.status(404).json({ error: 'Blog not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch blog' });
    }
});

app.post('/api/blogs', verifyAdminToken, async (req, res) => {
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

app.put('/api/blogs/:id', verifyAdminToken, async (req, res) => {
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

app.delete('/api/blogs/:id', verifyAdminToken, async (req, res) => {
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

app.post('/api/layouts', verifyAdminToken, async (req, res) => {
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

app.put('/api/layouts/:id', verifyAdminToken, async (req, res) => {
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

app.delete('/api/layouts/:id', verifyAdminToken, async (req, res) => {
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

// ==================== USER AUTH & PROFILE API ====================

app.get('/api/auth/config', (_req, res) => {
    res.json({
        clientId: GOOGLE_CLIENT_ID || '',
        googleEnabled: Boolean(GOOGLE_CLIENT_ID),
        passwordEnabled: true,
        emailVerificationEnabled: Boolean(emailTransporter)
    });
});

// Send verification code to email
app.post('/api/auth/send-verification', async (req, res) => {
    try {
        const { email } = req.body;
        const trimmedEmail = String(email || '').trim().toLowerCase();

        if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            res.status(400).json({ error: 'Please enter a valid email address' });
            return;
        }

        const disposableDomains = [
            'tempmail.com', 'throwaway.email', 'guerrillamail.com', 'mailinator.com',
            '10minutemail.com', 'trashmail.com', 'fakeinbox.com', 'yopmail.com',
            'sharklasers.com', 'spamgourmet.com', 'getnada.com', 'mohmal.com',
            'temp-mail.io', 'dispostable.com', 'mailcatch.com', 'mintemail.com',
            'emailondeck.com', 'tempr.email', 'throwawaymail.com', 'mytrashmail.com'
        ];
        const emailDomain = trimmedEmail.split('@')[1];
        if (disposableDomains.includes(emailDomain)) {
            res.status(400).json({ error: 'Please use a permanent email address, not a temporary one' });
            return;
        }

        // Check if email already exists
        const existingEmail = await turso.execute({
            sql: 'SELECT uid FROM users WHERE email = ? LIMIT 1',
            args: [trimmedEmail]
        });
        if (existingEmail.rows.length > 0) {
            res.status(409).json({ error: 'An account with this email already exists' });
            return;
        }

        // Check if email transporter is configured
        if (!emailTransporter) {
            res.status(503).json({ error: 'Email service is not configured. Please contact admin.' });
            return;
        }

        // Generate random 6-digit code
        const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
        
        // Store verification code
        verificationCodes.set(trimmedEmail, {
            code: verificationCode,
            expires: Date.now() + VERIFICATION_EXPIRY
        });

        // Send email
        const mailOptions = {
            from: `bhushverse <${EMAIL_FROM}>`,
            to: trimmedEmail,
            subject: 'Your bhushverse Verification Code',
            html: `
                <div style="font-family: 'Georgia', serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #F5F1E8 0%, #EBE5D5 100%); padding: 30px; border-radius: 12px; text-align: center;">
                        <h1 style="color: #8B4513; margin: 0 0 20px 0; font-size: 28px;">✦ bhushverse</h1>
                        <p style="color: #5D4E37; font-size: 16px; margin: 0 0 20px 0;">Your verification code is:</p>
                        <div style="background: #fff; padding: 20px; border-radius: 8px; display: inline-block;">
                            <span style="font-size: 36px; font-weight: bold; color: #8B4513; letter-spacing: 8px;">${verificationCode}</span>
                        </div>
                        <p style="color: #8B7355; font-size: 14px; margin: 20px 0 0 0;">This code expires in 10 minutes.</p>
                        <p style="color: #A69070; font-size: 12px; margin: 20px 0 0 0;">If you didn't request this, please ignore this email.</p>
                    </div>
                </div>
            `
        };

        await emailTransporter.sendMail(mailOptions);

        res.json({ 
            success: true, 
            message: 'Verification code sent to your email',
            email: maskedEmail(trimmedEmail)
        });
    } catch (err) {
        console.error('Email send error:', err);
        res.status(500).json({ error: 'Failed to send verification code' });
    }
});

// Verify code and create account
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name = '', username = '', password = '', email = '', verificationCode = '' } = req.body;
        const normalizedUsername = normalizeUsernameInput(username);
        const trimmedName = String(name || '').trim();
        const trimmedPassword = String(password || '');
        const trimmedEmail = String(email || '').trim().toLowerCase();
        const trimmedCode = String(verificationCode || '').trim();

        if (trimmedName.length < 2) {
            res.status(400).json({ error: 'Name must be at least 2 characters' });
            return;
        }
        if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            res.status(400).json({ error: 'Please enter a valid email address' });
            return;
        }

        const disposableDomains = [
            'tempmail.com', 'throwaway.email', 'guerrillamail.com', 'mailinator.com',
            '10minutemail.com', 'trashmail.com', 'fakeinbox.com', 'yopmail.com',
            'sharklasers.com', 'spamgourmet.com', 'getnada.com', 'mohmal.com',
            'temp-mail.io', 'dispostable.com', 'mailcatch.com', 'mintemail.com',
            'emailondeck.com', 'tempr.email', 'throwawaymail.com', 'mytrashmail.com'
        ];
        const emailDomain = trimmedEmail.split('@')[1];
        if (disposableDomains.includes(emailDomain)) {
            res.status(400).json({ error: 'Please use a permanent email address, not a temporary one' });
            return;
        }

        // Verify the code
        if (!trimmedCode) {
            res.status(400).json({ error: 'Verification code is required' });
            return;
        }

        // Check stored verification code
        const storedData = verificationCodes.get(trimmedEmail);
        if (!storedData) {
            res.status(400).json({ error: 'No verification code found. Please request a new code.' });
            return;
        }
        if (Date.now() > storedData.expires) {
            verificationCodes.delete(trimmedEmail);
            res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
            return;
        }
        if (storedData.code !== trimmedCode) {
            res.status(400).json({ error: 'Invalid verification code' });
            return;
        }

        // Clear verification code after successful verification
        verificationCodes.delete(trimmedEmail);

        if (normalizedUsername.length < 3) {
            res.status(400).json({ error: 'Username must be at least 3 characters and use letters, numbers, dot, or underscore' });
            return;
        }
        if (trimmedPassword.length < 6) {
            res.status(400).json({ error: 'Password must be at least 6 characters' });
            return;
        }

        const existingEmail = await turso.execute({
            sql: 'SELECT uid FROM users WHERE email = ? LIMIT 1',
            args: [trimmedEmail]
        });
        if (existingEmail.rows.length > 0) {
            res.status(409).json({ error: 'An account with this email already exists' });
            return;
        }

        const existing = await turso.execute({
            sql: 'SELECT uid FROM users WHERE username = ? LIMIT 1',
            args: [normalizedUsername]
        });
        if (existing.rows.length > 0) {
            res.status(409).json({ error: 'Username is already taken' });
            return;
        }

        const userId = crypto.randomUUID();
        const passwordHash = hashPassword(trimmedPassword);
        await turso.execute({
            sql: `
                INSERT INTO users (uid, username, email, display_name, password_hash, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
            `,
            args: [userId, normalizedUsername, trimmedEmail, trimmedName, passwordHash]
        });

        const user = await getUserById(userId);
        res.status(201).json({
            success: true,
            token: createUserToken(user),
            user: mapUser(user)
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create account' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username = '', password = '' } = req.body;
        const normalizedUsername = normalizeUsernameInput(username);
        const trimmedPassword = String(password || '');

        if (!normalizedUsername || !trimmedPassword) {
            res.status(400).json({ error: 'Username and password are required' });
            return;
        }

        const result = await turso.execute({
            sql: 'SELECT * FROM users WHERE username = ? LIMIT 1',
            args: [normalizedUsername]
        });
        const user = result.rows[0];
        if (!user || !user.password_hash || !verifyPassword(trimmedPassword, user.password_hash)) {
            res.status(401).json({ error: 'Invalid username or password' });
            return;
        }

        res.json({
            success: true,
            token: createUserToken(user),
            user: mapUser(user)
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to sign in' });
    }
});

app.post('/api/auth/google', async (req, res) => {
    try {
        const { credential } = req.body;
        if (!credential) {
            res.status(400).json({ error: 'Google credential is required' });
            return;
        }

        const googleUser = await verifyGoogleCredential(credential);
        const existingResult = await turso.execute({
            sql: 'SELECT * FROM users WHERE uid = ? OR email = ? LIMIT 1',
            args: [googleUser.sub, googleUser.email]
        });

        const existingUser = existingResult.rows[0];
        const userId = existingUser?.uid || googleUser.sub;
        let isNewUser = !existingUser;

        if (existingUser) {
            await turso.execute({
                sql: `
                    UPDATE users
                    SET
                        uid = ?,
                        display_name = ?,
                        email = ?,
                        photo_url = CASE
                            WHEN photo_url IS NULL OR photo_url = '' THEN ?
                            ELSE photo_url
                        END
                    WHERE uid = ?
                `,
                args: [googleUser.sub, googleUser.name, googleUser.email, googleUser.picture, userId]
            });
        } else {
            await turso.execute({
                sql: `
                    INSERT INTO users (uid, email, display_name, photo_url, created_at, updated_at)
                    VALUES (?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
                `,
                args: [userId, googleUser.email, googleUser.name, googleUser.picture]
            });
        }

        // Check if username is set
        const userAfter = await getUserById(userId);
        const needsUsername = !userAfter.username;

        if (needsUsername) {
            // Return need username flag for new users
            res.json({
                success: true,
                needsUsername: true,
                user: mapUser(userAfter),
                tempToken: createUserToken({ uid: userId, email: googleUser.email, role: 'user' })
            });
            return;
        }

        await ensureUserUsername(userId, googleUser.name || googleUser.email);
        const user = await getUserById(userId);

        res.json({
            success: true,
            token: createUserToken(user),
            user: mapUser(user)
        });
    } catch (err) {
        console.error('Google auth error:', err);
        res.status(401).json({ error: err.message || 'Google login failed' });
    }
});

// Setup username for new users
app.post('/api/auth/setup-username', verifyUserToken, async (req, res) => {
    try {
        const { username } = req.body;
        
        if (!username || username.trim().length < 3) {
            res.status(400).json({ error: 'Username must be at least 3 characters' });
            return;
        }

        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
            return;
        }

        // Check if username exists
        const existing = await turso.execute({
            sql: 'SELECT uid FROM users WHERE username = ? AND uid != ?',
            args: [username.trim().toLowerCase(), req.user.id]
        });

        if (existing.rows.length > 0) {
            res.status(400).json({ error: 'Username is already taken' });
            return;
        }

        // Set username
        await turso.execute({
            sql: 'UPDATE users SET username = ?, updated_at = strftime(\'%s\', \'now\') WHERE uid = ?',
            args: [username.trim().toLowerCase(), req.user.id]
        });

        const user = await getUserById(req.user.id);
        res.json({
            success: true,
            token: createUserToken(user),
            user: mapUser(user)
        });
    } catch (err) {
        console.error('Setup username error:', err);
        res.status(500).json({ error: 'Failed to setup username' });
    }
});

app.get('/api/auth/me', verifyUserToken, async (req, res) => {
    try {
        await ensureUserUsername(req.user.id);
        const user = await getUserById(req.user.id);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json({ user: mapUser(user) });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load user' });
    }
});

app.get('/api/profile/me', verifyUserToken, async (req, res) => {
    try {
        await ensureUserUsername(req.user.id);
        const [
            userResult,
            statsResult,
            postsResult,
            draftsResult,
            savedCommunityResult,
            savedGenericResult,
            followersCountResult,
            followingCountResult,
            followersResult,
            followingResult
        ] = await Promise.all([
            turso.execute({
                sql: 'SELECT * FROM users WHERE uid = ?',
                args: [req.user.id]
            }),
            turso.execute({
                sql: `
                    SELECT
                        COUNT(DISTINCT p.id) AS total_posts,
                        COUNT(l.post_id) AS total_likes
                    FROM user_posts p
                    LEFT JOIN post_likes l ON l.post_id = p.id
                    WHERE p.author_id = ? AND COALESCE(p.status, 'published') = 'published'
                `,
                args: [req.user.id]
            }),
            turso.execute({
                sql: `
                    SELECT
                        p.id,
                        p.title,
                        p.content,
                        p.post_type,
                        p.author_id,
                        p.language,
                        COALESCE(p.status, 'published') AS status,
                        p.created_at,
                        COALESCE(u.display_name, 'Anonymous') AS author_name,
                        COALESCE(u.photo_url, '') AS author_profile_picture,
                        COALESCE(u.username, '') AS author_username,
                        COALESCE(l.like_count, 0) AS like_count,
                        COALESCE(s.save_count, 0) AS save_count,
                        CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_current_user,
                        CASE WHEN my_save.user_id IS NULL THEN 0 ELSE 1 END AS saved_by_current_user,
                        CASE WHEN f.follower_id IS NULL THEN 0 ELSE 1 END AS author_is_following
                    FROM user_posts p
                    JOIN users u ON u.uid = p.author_id
                    LEFT JOIN (
                        SELECT post_id, COUNT(*) AS like_count
                        FROM post_likes
                        GROUP BY post_id
                    ) l ON l.post_id = p.id
                    LEFT JOIN (
                        SELECT post_id, COUNT(*) AS save_count
                        FROM saved_posts
                        GROUP BY post_id
                    ) s ON s.post_id = p.id
                    LEFT JOIN post_likes my_like ON my_like.post_id = p.id AND my_like.user_id = ?
                    LEFT JOIN saved_posts my_save ON my_save.post_id = p.id AND my_save.user_id = ?
                    LEFT JOIN followers f ON f.following_id = p.author_id AND f.follower_id = ?
                    WHERE p.author_id = ? AND COALESCE(p.status, 'published') = 'published'
                    ORDER BY p.created_at DESC
                `,
                args: [req.user.id, req.user.id, req.user.id, req.user.id]
            }),
            turso.execute({
                sql: `
                    SELECT
                        p.id,
                        p.title,
                        p.content,
                        p.post_type,
                        p.author_id,
                        p.language,
                        COALESCE(p.status, 'published') AS status,
                        p.created_at,
                        COALESCE(u.display_name, 'Anonymous') AS author_name,
                        COALESCE(u.photo_url, '') AS author_profile_picture,
                        COALESCE(u.username, '') AS author_username,
                        COALESCE(l.like_count, 0) AS like_count,
                        COALESCE(s.save_count, 0) AS save_count,
                        CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_current_user,
                        CASE WHEN my_save.user_id IS NULL THEN 0 ELSE 1 END AS saved_by_current_user,
                        CASE WHEN f.follower_id IS NULL THEN 0 ELSE 1 END AS author_is_following
                    FROM user_posts p
                    JOIN users u ON u.uid = p.author_id
                    LEFT JOIN (
                        SELECT post_id, COUNT(*) AS like_count
                        FROM post_likes
                        GROUP BY post_id
                    ) l ON l.post_id = p.id
                    LEFT JOIN (
                        SELECT post_id, COUNT(*) AS save_count
                        FROM saved_posts
                        GROUP BY post_id
                    ) s ON s.post_id = p.id
                    LEFT JOIN post_likes my_like ON my_like.post_id = p.id AND my_like.user_id = ?
                    LEFT JOIN saved_posts my_save ON my_save.post_id = p.id AND my_save.user_id = ?
                    LEFT JOIN followers f ON f.following_id = p.author_id AND f.follower_id = ?
                    WHERE p.author_id = ? AND COALESCE(p.status, 'published') = 'draft'
                    ORDER BY p.created_at DESC
                `,
                args: [req.user.id, req.user.id, req.user.id, req.user.id]
            }),
            turso.execute({
                sql: `
                    SELECT
                        p.id,
                        p.title,
                        p.content,
                        p.post_type,
                        p.author_id,
                        p.language,
                        COALESCE(p.status, 'published') AS status,
                        p.created_at,
                        COALESCE(u.display_name, 'Anonymous') AS author_name,
                        COALESCE(u.photo_url, '') AS author_profile_picture,
                        COALESCE(u.username, '') AS author_username,
                        COALESCE(l.like_count, 0) AS like_count,
                        COALESCE(s.save_count, 0) AS save_count,
                        CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_current_user,
                        1 AS saved_by_current_user,
                        CASE WHEN f.follower_id IS NULL THEN 0 ELSE 1 END AS author_is_following
                    FROM saved_posts sp
                    JOIN user_posts p ON p.id = sp.post_id
                    JOIN users u ON u.uid = p.author_id
                    LEFT JOIN (
                        SELECT post_id, COUNT(*) AS like_count
                        FROM post_likes
                        GROUP BY post_id
                    ) l ON l.post_id = p.id
                    LEFT JOIN (
                        SELECT post_id, COUNT(*) AS save_count
                        FROM saved_posts
                        GROUP BY post_id
                    ) s ON s.post_id = p.id
                    LEFT JOIN post_likes my_like ON my_like.post_id = p.id AND my_like.user_id = ?
                    LEFT JOIN followers f ON f.following_id = p.author_id AND f.follower_id = ?
                    WHERE sp.user_id = ?
                    ORDER BY sp.created_at DESC
                `,
                args: [req.user.id, req.user.id, req.user.id]
            }),
            turso.execute({
                sql: `
                    SELECT
                        si.content_id,
                        si.content_type,
                        COALESCE(p.title, b.title) AS title,
                        COALESCE(p.content, b.content) AS content,
                        COALESCE(p.author, b.author, 'Anonymous') AS author_name,
                        '' AS author_profile_picture,
                        '' AS author_id,
                        COALESCE(p.language, b.language, 'english') AS language,
                        COALESCE(b.status, 'published') AS status,
                        CASE
                            WHEN si.content_type = 'poem' THEN 'poetry'
                            ELSE 'blog'
                        END AS post_type,
                        COALESCE(p.date, b.date, si.created_at) AS created_at,
                        COALESCE(pl.count, bl.count, 0) AS like_count,
                        COALESCE(ps.count, bs.count, 0) AS save_count,
                        CASE
                            WHEN si.content_type = 'poem' AND my_poem_like.user_id IS NOT NULL THEN 1
                            WHEN si.content_type = 'blog' AND my_blog_like.user_id IS NOT NULL THEN 1
                            ELSE 0
                        END AS liked_by_current_user
                    FROM saved_items si
                    LEFT JOIN poems p ON si.content_type = 'poem' AND p.id = si.content_id
                    LEFT JOIN blogs b ON si.content_type = 'blog' AND b.id = si.content_id
                    LEFT JOIN (
                        SELECT content_id, COUNT(*) AS count
                        FROM content_likes
                        WHERE content_type = 'poem'
                        GROUP BY content_id
                    ) pl ON pl.content_id = si.content_id AND si.content_type = 'poem'
                    LEFT JOIN (
                        SELECT content_id, COUNT(*) AS count
                        FROM content_likes
                        WHERE content_type = 'blog'
                        GROUP BY content_id
                    ) bl ON bl.content_id = si.content_id AND si.content_type = 'blog'
                    LEFT JOIN (
                        SELECT content_id, COUNT(*) AS count
                        FROM saved_items
                        WHERE content_type = 'poem'
                        GROUP BY content_id
                    ) ps ON ps.content_id = si.content_id AND si.content_type = 'poem'
                    LEFT JOIN (
                        SELECT content_id, COUNT(*) AS count
                        FROM saved_items
                        WHERE content_type = 'blog'
                        GROUP BY content_id
                    ) bs ON bs.content_id = si.content_id AND si.content_type = 'blog'
                    LEFT JOIN content_likes my_poem_like ON my_poem_like.content_type = 'poem' AND my_poem_like.content_id = si.content_id AND my_poem_like.user_id = ?
                    LEFT JOIN content_likes my_blog_like ON my_blog_like.content_type = 'blog' AND my_blog_like.content_id = si.content_id AND my_blog_like.user_id = ?
                    WHERE si.user_id = ? AND si.content_type IN ('poem', 'blog')
                    ORDER BY si.created_at DESC
                `,
                args: [req.user.id, req.user.id, req.user.id]
            }),
            turso.execute({
                sql: 'SELECT COUNT(*) AS count FROM followers WHERE following_id = ?',
                args: [req.user.id]
            }),
            turso.execute({
                sql: 'SELECT COUNT(*) AS count FROM followers WHERE follower_id = ?',
                args: [req.user.id]
            }),
            fetchRelationshipUsers(req.user.id, req.user.id, 'followers'),
            fetchRelationshipUsers(req.user.id, req.user.id, 'following')
        ]);

        const user = userResult.rows[0];
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const stats = statsResult.rows[0] || {};
        res.json({
            user: mapUser(user),
            stats: {
                totalPosts: Number(stats.total_posts || 0),
                totalLikes: Number(stats.total_likes || 0),
                followersCount: Number(followersCountResult.rows[0]?.count || 0),
                followingCount: Number(followingCountResult.rows[0]?.count || 0)
            },
            isOwnProfile: true,
            posts: postsResult.rows.map(mapCommunityPost),
            drafts: draftsResult.rows.map(mapCommunityPost),
            followers: followersResult,
            following: followingResult,
            savedPosts: [
                ...savedCommunityResult.rows.map(mapCommunityPost),
                ...savedGenericResult.rows.map(mapSavedContent)
            ]
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

app.put('/api/profile/me', verifyUserToken, async (req, res) => {
    try {
        const { bio = '', gender = '', age = null, profilePicture = '' } = req.body;
        const parsedAge = age === null || age === '' ? null : Number(age);
        if (parsedAge !== null && (!Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > 120)) {
            res.status(400).json({ error: 'Age must be between 0 and 120' });
            return;
        }

        await turso.execute({
            sql: `
                UPDATE users
                SET bio = ?, gender = ?, age = ?, photo_url = ?, updated_at = strftime('%s', 'now')
                WHERE uid = ?
            `,
            args: [bio.trim(), gender.trim(), parsedAge, profilePicture, req.user.id]
        });

        const user = await getUserById(req.user.id);
        res.json({
            success: true,
            user: mapUser(user)
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// ==================== GENERIC CONTENT INTERACTIONS ====================

app.post('/api/interactions/:contentType/:contentId/like', verifyUserToken, async (req, res) => {
    try {
        const contentType = normalizeContentType(req.params.contentType);
        if (!['poem', 'blog'].includes(contentType)) {
            res.status(400).json({ error: 'Unsupported content type' });
            return;
        }
        const exists = await contentExists(contentType, req.params.contentId);
        if (!exists) {
            res.status(404).json({ error: 'Content not found' });
            return;
        }

        const existing = await turso.execute({
            sql: 'SELECT 1 FROM content_likes WHERE content_type = ? AND content_id = ? AND user_id = ?',
            args: [contentType, req.params.contentId, req.user.id]
        });

        if (existing.rows.length > 0) {
            await turso.execute({
                sql: 'DELETE FROM content_likes WHERE content_type = ? AND content_id = ? AND user_id = ?',
                args: [contentType, req.params.contentId, req.user.id]
            });
        } else {
            await turso.execute({
                sql: 'INSERT INTO content_likes (content_type, content_id, user_id, created_at) VALUES (?, ?, ?, ?)',
                args: [contentType, req.params.contentId, req.user.id, new Date().toISOString()]
            });
        }

        const rowResult = await turso.execute({
            sql: `SELECT * FROM ${contentType === 'poem' ? 'poems' : 'blogs'} WHERE id = ?`,
            args: [req.params.contentId]
        });

        res.json(await decorateGenericContent(contentType, rowResult.rows[0], req.user.id));
    } catch (err) {
        res.status(500).json({ error: 'Failed to update like' });
    }
});

app.post('/api/interactions/:contentType/:contentId/save', verifyUserToken, async (req, res) => {
    try {
        const contentType = normalizeContentType(req.params.contentType);
        if (!['poem', 'blog'].includes(contentType)) {
            res.status(400).json({ error: 'Unsupported content type' });
            return;
        }
        const exists = await contentExists(contentType, req.params.contentId);
        if (!exists) {
            res.status(404).json({ error: 'Content not found' });
            return;
        }

        const existing = await turso.execute({
            sql: 'SELECT id FROM saved_items WHERE content_type = ? AND content_id = ? AND user_id = ?',
            args: [contentType, req.params.contentId, req.user.id]
        });

        if (existing.rows.length > 0) {
            await turso.execute({
                sql: 'DELETE FROM saved_items WHERE content_type = ? AND content_id = ? AND user_id = ?',
                args: [contentType, req.params.contentId, req.user.id]
            });
        } else {
            await turso.execute({
                sql: 'INSERT INTO saved_items (id, user_id, content_type, content_id) VALUES (?, ?, ?, ?)',
                args: [`${Date.now()}-${contentType}-${req.params.contentId}`, req.user.id, contentType, req.params.contentId]
            });
        }

        const rowResult = await turso.execute({
            sql: `SELECT * FROM ${contentType === 'poem' ? 'poems' : 'blogs'} WHERE id = ?`,
            args: [req.params.contentId]
        });

        res.json(await decorateGenericContent(contentType, rowResult.rows[0], req.user.id));
    } catch (err) {
        res.status(500).json({ error: 'Failed to update saved content' });
    }
});

// ==================== COMMUNITY POSTS API ====================

app.get('/api/community/posts', attachUserIfPresent, async (req, res) => {
    try {
        const currentUserId = req.user?.id || '';
        const result = await turso.execute({
            sql: `
                SELECT
                    p.id,
                    p.title,
                    p.content,
                    p.post_type,
                    p.author_id,
                    p.language,
                    COALESCE(p.status, 'published') AS status,
                p.created_at,
                COALESCE(u.display_name, 'Anonymous') AS author_name,
                COALESCE(u.photo_url, '') AS author_profile_picture,
                COALESCE(u.username, '') AS author_username,
                COALESCE(l.like_count, 0) AS like_count,
                COALESCE(s.save_count, 0) AS save_count,
                    CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_current_user,
                    CASE WHEN my_save.user_id IS NULL THEN 0 ELSE 1 END AS saved_by_current_user,
                    CASE WHEN f.follower_id IS NULL THEN 0 ELSE 1 END AS author_is_following
                FROM user_posts p
                JOIN users u ON u.uid = p.author_id
                LEFT JOIN (
                    SELECT post_id, COUNT(*) AS like_count
                    FROM post_likes
                    GROUP BY post_id
                ) l ON l.post_id = p.id
                LEFT JOIN (
                    SELECT post_id, COUNT(*) AS save_count
                    FROM saved_posts
                    GROUP BY post_id
                ) s ON s.post_id = p.id
                LEFT JOIN post_likes my_like ON my_like.post_id = p.id AND my_like.user_id = ?
                LEFT JOIN saved_posts my_save ON my_save.post_id = p.id AND my_save.user_id = ?
                LEFT JOIN followers f ON f.following_id = p.author_id AND f.follower_id = ?
                WHERE COALESCE(p.status, 'published') = 'published'
                ORDER BY p.created_at DESC
            `,
            args: [currentUserId, currentUserId, currentUserId]
        });

        res.json(result.rows.map(mapCommunityPost));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch community posts' });
    }
});

// Feed endpoint - posts from followed users (must be before /posts/:id)
app.get('/api/community/feed', verifyUserToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        
        const result = await turso.execute({
            sql: `
                SELECT
                    p.id,
                    p.title,
                    p.content,
                    p.post_type,
                    p.author_id,
                    p.language,
                    COALESCE(p.status, 'published') AS status,
                    p.created_at,
                    COALESCE(u.display_name, 'Anonymous') AS author_name,
                    COALESCE(u.photo_url, '') AS author_profile_picture,
                    COALESCE(u.username, '') AS author_username,
                    COALESCE(l.like_count, 0) AS like_count,
                    COALESCE(s.save_count, 0) AS save_count,
                    CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_current_user,
                    CASE WHEN my_save.user_id IS NULL THEN 0 ELSE 1 END AS saved_by_current_user,
                    CASE WHEN f.follower_id IS NULL THEN 0 ELSE 1 END AS author_is_following
                FROM user_posts p
                JOIN users u ON u.uid = p.author_id
                LEFT JOIN (
                    SELECT post_id, COUNT(*) AS like_count
                    FROM post_likes
                    GROUP BY post_id
                ) l ON l.post_id = p.id
                LEFT JOIN (
                    SELECT post_id, COUNT(*) AS save_count
                    FROM saved_posts
                    GROUP BY post_id
                ) s ON s.post_id = p.id
                LEFT JOIN post_likes my_like ON my_like.post_id = p.id AND my_like.user_id = ?
                LEFT JOIN saved_posts my_save ON my_save.post_id = p.id AND my_save.user_id = ?
                LEFT JOIN followers f ON f.following_id = p.author_id AND f.follower_id = ?
                WHERE p.status = 'published' AND (f.follower_id = ? OR p.author_id = ?)
                ORDER BY p.created_at DESC
                LIMIT ? OFFSET ?
            `,
            args: [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, limit, offset]
        });
        
        res.json(result.rows.map(mapCommunityPost));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch feed' });
    }
});

app.get('/api/community/posts/:id', attachUserIfPresent, async (req, res) => {
    try {
        const post = await fetchCommunityPost(req.params.id, req.user?.id || '');
        if (!post) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }
        res.json(post);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch post' });
    }
});

app.post('/api/community/posts', verifyUserToken, async (req, res) => {
    try {
        const { title, content, postType, language, status } = req.body;
        const normalizedType = String(postType || '').toLowerCase();
        const normalizedLanguage = String(language || 'english').toLowerCase();
        const normalizedStatus = String(status || 'published').toLowerCase();
        if (!title || !content || !['poetry', 'blog'].includes(normalizedType)) {
            res.status(400).json({ error: 'Title, content, and valid post type are required' });
            return;
        }
        if (!SUPPORTED_LANGUAGES.includes(normalizedLanguage)) {
            res.status(400).json({ error: 'Valid language is required' });
            return;
        }
        if (!['draft', 'published'].includes(normalizedStatus)) {
            res.status(400).json({ error: 'Valid status is required' });
            return;
        }

        const id = Date.now().toString();
        const createdAt = new Date().toISOString();
        await turso.execute({
            sql: `
                INSERT INTO user_posts (id, title, content, post_type, author_id, language, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [id, title.trim(), content.trim(), normalizedType, req.user.id, normalizedLanguage, normalizedStatus, createdAt]
        });

        const post = await fetchCommunityPost(id, req.user.id);
        res.status(201).json(post);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create post' });
    }
});

app.put('/api/community/posts/:id', verifyUserToken, async (req, res) => {
    try {
        const { title, content, postType, language, status } = req.body;
        const normalizedType = String(postType || '').toLowerCase();
        const normalizedLanguage = String(language || 'english').toLowerCase();
        const normalizedStatus = String(status || 'published').toLowerCase();
        if (!title || !content || !['poetry', 'blog'].includes(normalizedType)) {
            res.status(400).json({ error: 'Title, content, and valid post type are required' });
            return;
        }
        if (!SUPPORTED_LANGUAGES.includes(normalizedLanguage)) {
            res.status(400).json({ error: 'Valid language is required' });
            return;
        }
        if (!['draft', 'published'].includes(normalizedStatus)) {
            res.status(400).json({ error: 'Valid status is required' });
            return;
        }

        const existing = await turso.execute({
            sql: 'SELECT author_id FROM user_posts WHERE id = ?',
            args: [req.params.id]
        });
        if (existing.rows.length === 0) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }
        if (existing.rows[0].author_id !== req.user.id) {
            res.status(403).json({ error: 'You can only update your own posts' });
            return;
        }

        await turso.execute({
            sql: `
                UPDATE user_posts
                SET title = ?, content = ?, post_type = ?, language = ?, status = ?
                WHERE id = ? AND author_id = ?
            `,
            args: [title.trim(), content.trim(), normalizedType, normalizedLanguage, normalizedStatus, req.params.id, req.user.id]
        });

        const post = await fetchCommunityPost(req.params.id, req.user.id);
        res.json(post);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update post' });
    }
});

app.post('/api/community/posts/:id/like', verifyUserToken, async (req, res) => {
    try {
        const targetPost = await turso.execute({
            sql: 'SELECT 1 FROM user_posts WHERE id = ?',
            args: [req.params.id]
        });
        if (targetPost.rows.length === 0) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        const existing = await turso.execute({
            sql: 'SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?',
            args: [req.params.id, req.user.id]
        });

        if (existing.rows.length > 0) {
            await turso.execute({
                sql: 'DELETE FROM post_likes WHERE post_id = ? AND user_id = ?',
                args: [req.params.id, req.user.id]
            });
        } else {
            await turso.execute({
                sql: 'INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)',
                args: [req.params.id, req.user.id, new Date().toISOString()]
            });
        }

        const post = await fetchCommunityPost(req.params.id, req.user.id);
        if (!post) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        res.json(post);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update like' });
    }
});

app.post('/api/community/posts/:id/save', verifyUserToken, async (req, res) => {
    try {
        const targetPost = await turso.execute({
            sql: 'SELECT 1 FROM user_posts WHERE id = ?',
            args: [req.params.id]
        });
        if (targetPost.rows.length === 0) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        const existing = await turso.execute({
            sql: 'SELECT 1 FROM saved_posts WHERE post_id = ? AND user_id = ?',
            args: [req.params.id, req.user.id]
        });

        if (existing.rows.length > 0) {
            await turso.execute({
                sql: 'DELETE FROM saved_posts WHERE post_id = ? AND user_id = ?',
                args: [req.params.id, req.user.id]
            });
        } else {
            await turso.execute({
                sql: 'INSERT INTO saved_posts (post_id, user_id, created_at) VALUES (?, ?, ?)',
                args: [req.params.id, req.user.id, new Date().toISOString()]
            });
        }

        const post = await fetchCommunityPost(req.params.id, req.user.id);
        if (!post) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        res.json(post);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update saved post' });
    }
});

// Follow/Unfollow endpoints
app.post('/api/users/:id/follow', verifyUserToken, async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const currentUserId = req.user.id;
        
        if (targetUserId === currentUserId) {
            res.status(400).json({ error: 'Cannot follow yourself' });
            return;
        }
        
        const targetUser = await turso.execute({
            sql: 'SELECT uid FROM users WHERE uid = ?',
            args: [targetUserId]
        });
        
        if (targetUser.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        
        const existing = await turso.execute({
            sql: 'SELECT 1 FROM followers WHERE follower_id = ? AND following_id = ?',
            args: [currentUserId, targetUserId]
        });
        
        if (existing.rows.length > 0) {
            await turso.execute({
                sql: 'DELETE FROM followers WHERE follower_id = ? AND following_id = ?',
                args: [currentUserId, targetUserId]
            });
            res.json({ following: false });
        } else {
            await turso.execute({
                sql: 'INSERT INTO followers (follower_id, following_id, created_at) VALUES (?, ?, ?)',
                args: [currentUserId, targetUserId, new Date().toISOString()]
            });
            res.json({ following: true });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to update follow status' });
    }
});

app.get('/api/users/:id/profile', attachUserIfPresent, async (req, res) => {
    try {
        await ensureUserUsername(req.params.id);
        const currentUserId = req.user?.id || '';
        const [userResult, statsResult, followersCountResult, followingCountResult, posts, followers, following] = await Promise.all([
            turso.execute({
                sql: 'SELECT uid, username, display_name, photo_url, bio, gender, age, created_at FROM users WHERE uid = ?',
                args: [req.params.id]
            }),
            turso.execute({
                sql: `
                    SELECT
                        COUNT(DISTINCT p.id) AS total_posts,
                        COUNT(l.post_id) AS total_likes
                    FROM user_posts p
                    LEFT JOIN post_likes l ON l.post_id = p.id
                    WHERE p.author_id = ? AND COALESCE(p.status, 'published') = 'published'
                `,
                args: [req.params.id]
            }),
            turso.execute({
                sql: 'SELECT COUNT(*) AS count FROM followers WHERE following_id = ?',
                args: [req.params.id]
            }),
            turso.execute({
                sql: 'SELECT COUNT(*) AS count FROM followers WHERE follower_id = ?',
                args: [req.params.id]
            }),
            fetchPublishedPostsByAuthor(req.params.id, currentUserId),
            fetchRelationshipUsers(req.params.id, currentUserId, 'followers'),
            fetchRelationshipUsers(req.params.id, currentUserId, 'following')
        ]);

        if (userResult.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const row = userResult.rows[0];
        let isFollowing = null;
        if (currentUserId && currentUserId !== req.params.id) {
            const followCheck = await turso.execute({
                sql: 'SELECT 1 FROM followers WHERE follower_id = ? AND following_id = ?',
                args: [currentUserId, req.params.id]
            });
            isFollowing = followCheck.rows.length > 0;
        }

        res.json({
            user: {
                id: row.uid,
                username: row.username || '',
                personalId: row.username || '',
                name: row.display_name || '',
                profilePicture: row.photo_url || '',
                bio: row.bio || '',
                gender: row.gender || '',
                age: row.age,
                createdAt: row.created_at,
                isFollowing
            },
            stats: {
                totalPosts: Number(statsResult.rows[0]?.total_posts || 0),
                totalLikes: Number(statsResult.rows[0]?.total_likes || 0),
                followersCount: Number(followersCountResult.rows[0]?.count || 0),
                followingCount: Number(followingCountResult.rows[0]?.count || 0)
            },
            isOwnProfile: currentUserId === req.params.id,
            posts,
            followers,
            following,
            drafts: [],
            savedPosts: []
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});

app.get('/api/users/:id/followers', attachUserIfPresent, async (req, res) => {
    try {
        res.json(await fetchRelationshipUsers(req.params.id, req.user?.id || '', 'followers'));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch followers' });
    }
});

app.get('/api/users/:id/following', attachUserIfPresent, async (req, res) => {
    try {
        res.json(await fetchRelationshipUsers(req.params.id, req.user?.id || '', 'following'));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch following' });
    }
});

app.get('/api/users/:id/is-following', verifyUserToken, async (req, res) => {
    try {
        const result = await turso.execute({
            sql: 'SELECT 1 FROM followers WHERE follower_id = ? AND following_id = ?',
            args: [req.user.id, req.params.id]
        });
        res.json({ isFollowing: result.rows.length > 0 });
    } catch (err) {
        res.status(500).json({ error: 'Failed to check follow status' });
    }
});

app.get('/api/users/:id', attachUserIfPresent, async (req, res) => {
    try {
        const userIdOrUsername = req.params.id;
        
        // Check if it's a UUID or username
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userIdOrUsername);
        const query = isUUID 
            ? 'SELECT uid, username, display_name, photo_url, bio, gender, age, created_at FROM users WHERE uid = ?'
            : 'SELECT uid, username, display_name, photo_url, bio, gender, age, created_at FROM users WHERE username = ?';
        
        const result = await turso.execute({
            sql: query,
            args: [userIdOrUsername]
        });
        
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        
        const row = result.rows[0];
        
        // Get followers count
        const followersCount = await turso.execute({
            sql: 'SELECT COUNT(*) as count FROM followers WHERE following_id = ?',
            args: [row.uid]
        });
        
        // Get following count
        const followingCount = await turso.execute({
            sql: 'SELECT COUNT(*) as count FROM followers WHERE follower_id = ?',
            args: [req.params.id]
        });
        
        // Get posts count
        const postsCount = await turso.execute({
            sql: "SELECT COUNT(*) as count FROM user_posts WHERE author_id = ? AND status = 'published'",
            args: [req.params.id]
        });
        
        const currentUserId = req.user?.id || '';
        let isFollowing = false;
        if (currentUserId && currentUserId !== req.params.id) {
            const followCheck = await turso.execute({
                sql: 'SELECT 1 FROM followers WHERE follower_id = ? AND following_id = ?',
                args: [currentUserId, req.params.id]
            });
            isFollowing = followCheck.rows.length > 0;
        }
        
        res.json({
            id: row.uid,
            username: row.username || '',
            personalId: row.username || '',
            name: row.display_name || '',
            profilePicture: row.photo_url || '',
            bio: row.bio || '',
            gender: row.gender || '',
            age: row.age,
            createdAt: row.created_at,
            followersCount: Number(followersCount.rows[0]?.count || 0),
            followingCount: Number(followingCount.rows[0]?.count || 0),
            postsCount: Number(postsCount.rows[0]?.count || 0),
            isFollowing: req.params.id === currentUserId ? null : isFollowing
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
});

// Serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize and start
initDatabase().then(() => {
    const server = app.listen(PORT, () => {
        console.log(`Poetry blog running at http://localhost:${PORT}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is already in use. Stop the existing process or start with a different PORT.`);
            process.exit(1);
            return;
        }
        console.error('Server startup error:', err);
        process.exit(1);
    });
});
