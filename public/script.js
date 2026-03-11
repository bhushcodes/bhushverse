/* ============================================
   bhushverse - JavaScript
   Premium Poetry Platform
   ============================================ */

const API_URL = '/api/poems';
const BLOG_API_URL = '/api/blogs';

// State
let currentPoem = null;
let currentBlog = null;
let currentLanguage = 'all';
let adminLanguage = 'all';
let blogLanguage = 'all';
let adminBlogLanguage = 'all';
let previousPage = 'home-page';
let poemsList = [];
let blogsList = [];

// Language config
const LANGUAGES = {
    english: { name: 'English', fontClass: 'lang-english' },
    hindi: { name: 'हिंदी', fontClass: 'lang-hindi' },
    marathi: { name: 'मराठी', fontClass: 'lang-marathi' }
};

// Admin auth
let adminToken = sessionStorage.getItem('adminToken');

function isAdminLoggedIn() { return adminToken !== null; }

function setAdminToken(token) {
    adminToken = token;
    sessionStorage.setItem('adminToken', token);
}

function logoutAdmin() {
    adminToken = null;
    sessionStorage.removeItem('adminToken');
}

function getAuthHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': adminToken };
}

// ==================== Navigation ====================

function showPage(pageId) {
    previousPage = document.querySelector('.page.active')?.id || 'home-page';
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => animatePageElements(pageId), 100);
}

function animatePageElements(pageId) {
    const page = document.getElementById(pageId);
    if (!page) return;
    const cards = page.querySelectorAll('.poem-card, .blog-card, .about-card');
    cards.forEach((card, index) => {
        card.style.animation = 'none';
        card.offsetHeight;
        card.style.animation = `cardIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) backwards`;
        card.style.animationDelay = `${index * 0.1}s`;
    });
}

function showHome() {
    currentLanguage = 'all';
    updateNavLinks('home');
    updateLanguageTabs('home-page');
    showPage('home-page');
    loadPoems();
}

function showBlog() {
    blogLanguage = 'all';
    updateNavLinks('blog');
    showPage('blog-page');
    loadBlogs();
}

function showAbout() {
    updateNavLinks('about');
    showPage('about-page');
    setTimeout(() => animatePageElements('about-page'), 100);
}

function updateNavLinks(page) {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.dataset.page === page) link.classList.add('active');
    });
}

async function showAdmin() {
    if (!isAdminLoggedIn()) {
        document.getElementById('login-modal').classList.add('show');
        return;
    }
    try {
        const response = await fetch('/api/admin/verify', { headers: { 'Authorization': adminToken } });
        if (!response.ok) { logoutAdmin(); showLogin(); showToast('Session expired'); return; }
    } catch (err) { logoutAdmin(); showLogin(); return; }
    
    adminLanguage = 'all';
    adminBlogLanguage = 'all';
    showPage('admin-page');
    loadAdminPoems();
    loadAdminBlogs();
}

function showLogin() { document.getElementById('login-modal').classList.add('show'); }

async function showPoem(id) {
    await loadPoem(id);
    showPage('poem-page');
}

async function showBlogDetail(id) {
    await loadBlog(id);
    showPage('blog-detail-page');
}

function goBack() {
    showPage(previousPage || 'home-page');
    if (previousPage === 'admin-page') { loadAdminPoems(); loadAdminBlogs(); }
    else if (previousPage === 'blog-page') loadBlogs();
    else loadPoems();
}

// ==================== Mobile Menu ====================

function toggleMobileMenu() {
    document.querySelector('.mobile-menu').classList.toggle('active');
    document.querySelector('.mobile-menu-btn').classList.toggle('active');
}

function closeMobileMenu() {
    document.querySelector('.mobile-menu').classList.remove('active');
    document.querySelector('.mobile-menu-btn').classList.remove('active');
}

// ==================== Scroll Effects ====================

function scrollToPoems() {
    document.getElementById('poems-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    navbar.classList.toggle('scrolled', window.scrollY > 50);
});

// ==================== Language Tabs ====================

function switchLanguage(lang) {
    currentLanguage = lang;
    updateLanguageTabs('home-page');
    loadPoems();
}

function switchBlogLanguage(lang) {
    blogLanguage = lang;
    updateBlogLanguageTabs();
    loadBlogs();
}

function switchAdminLanguage(lang) {
    adminLanguage = lang;
    updateLanguageTabs('tab-poems');
    loadAdminPoems();
}

function switchAdminBlogLanguage(lang) {
    adminBlogLanguage = lang;
    updateBlogAdminTabs();
    loadAdminBlogs();
}

function updateLanguageTabs(pageId) {
    const lang = pageId === 'tab-poems' ? adminLanguage : currentLanguage;
    document.querySelectorAll(`#${pageId} .lang-tab`).forEach(tab => {
        tab.classList.toggle('active', tab.dataset.lang === lang);
    });
}

function updateBlogLanguageTabs() {
    document.querySelectorAll('#blog-page .lang-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.lang === blogLanguage);
    });
}

function updateBlogAdminTabs() {
    document.querySelectorAll('#tab-blogs .lang-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.lang === adminBlogLanguage);
    });
}

// ==================== Admin Tabs ====================

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.admin-nav-btn[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');
}

// ==================== Poems API ====================

async function loadPoems() {
    const container = document.getElementById('poems-list');
    container.innerHTML = '<div class="loading">Loading poems...</div>';
    try {
        const response = await fetch(API_URL);
        let poems = await response.json();
        poemsList = poems;
        if (currentLanguage !== 'all') poems = poems.filter(p => p.language === currentLanguage);
        
        if (poems.length === 0) {
            const langName = currentLanguage === 'all' ? '' : LANGUAGES[currentLanguage]?.name || currentLanguage;
            container.innerHTML = `<div class="empty-state"><p>${langName ? `No ${langName} poems yet.` : 'No poems yet.'}</p></div>`;
            return;
        }
        
        container.innerHTML = poems.map((poem, index) => `
            <div class="poem-card" onclick="showPoem('${poem.id}')" style="animation-delay: ${index * 0.08}s">
                <span class="card-lang-badge">${LANGUAGES[poem.language]?.name || poem.language}</span>
                <h3>${escapeHtml(poem.title)}</h3>
                <p class="poem-card-preview">${escapeHtml(poem.content)}</p>
                <div class="poem-card-meta">
                    <span>${escapeHtml(poem.author)}</span>
                    <span class="separator">•</span>
                    <span>${formatDate(poem.date)}</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = '<div class="empty-state"><p>Failed to load poems.</p></div>';
    }
}

async function loadPoem(id) {
    try {
        const response = await fetch(`${API_URL}/${id}`);
        const poem = await response.json();
        currentPoem = poem;
        
        const badge = document.getElementById('poem-language-badge');
        badge.textContent = LANGUAGES[poem.language]?.name || poem.language;
        
        const poemContent = document.getElementById('poem-content');
        poemContent.className = 'poem-content ' + (LANGUAGES[poem.language]?.fontClass || 'lang-english');
        
        document.getElementById('poem-title').textContent = poem.title;
        document.getElementById('poem-author').textContent = poem.author;
        document.getElementById('poem-date').textContent = formatDate(poem.date);
        document.getElementById('poem-content').textContent = poem.content;
        
        updatePoemNavigation();
    } catch (err) { showToast('Failed to load poem'); }
}

function updatePoemNavigation() {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    if (!currentPoem || poemsList.length === 0) {
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        return;
    }
    const currentIndex = poemsList.findIndex(p => p.id === currentPoem.id);
    const total = poemsList.length;
    document.getElementById('poem-progress').textContent = `${currentIndex + 1} of ${total}`;
    document.getElementById('prev-btn').style.display = currentIndex === 0 ? 'none' : 'flex';
    document.getElementById('next-btn').style.display = currentIndex === total - 1 ? 'none' : 'flex';
}

function navigatePoem(direction) {
    if (!currentPoem || poemsList.length === 0) return;
    const currentIndex = poemsList.findIndex(p => p.id === currentPoem.id);
    let newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (newIndex >= 0 && newIndex < poemsList.length) showPoem(poemsList[newIndex].id);
}

document.addEventListener('keydown', (e) => {
    if (document.getElementById('poem-page').classList.contains('active')) {
        if (e.key === 'ArrowLeft') navigatePoem('prev');
        else if (e.key === 'ArrowRight') navigatePoem('next');
    }
});

// ==================== Blogs API ====================

async function loadBlogs() {
    const container = document.getElementById('blog-list');
    container.innerHTML = '<div class="loading">Loading blogs...</div>';
    try {
        const response = await fetch(`${BLOG_API_URL}?status=published`);
        let blogs = await response.json();
        blogsList = blogs;
        
        if (blogLanguage !== 'all') blogs = blogs.filter(b => b.language === blogLanguage);
        
        if (blogs.length === 0) {
            container.innerHTML = `<div class="blog-empty"><div class="empty-icon">✍</div><h3>Coming Soon</h3><p>New blog posts will appear here!</p></div>`;
            return;
        }
        
        container.innerHTML = blogs.map((blog, index) => `
            <div class="blog-card" onclick="showBlogDetail('${blog.id}')" style="animation-delay: ${index * 0.08}s">
                <span class="card-lang-badge">${LANGUAGES[blog.language]?.name || blog.language}</span>
                <div class="blog-card-content">
                    <h3>${escapeHtml(blog.title)}</h3>
                    <p class="blog-card-excerpt">${escapeHtml(blog.excerpt || blog.content.substring(0, 150))}...</p>
                </div>
                <div class="blog-card-meta">
                    <span>${escapeHtml(blog.author)}</span>
                    <span class="separator">•</span>
                    <span>${formatDate(blog.date)}</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = '<div class="blog-empty"><p>Failed to load blogs.</p></div>';
    }
}

async function loadBlog(id) {
    try {
        const response = await fetch(`${BLOG_API_URL}/${id}`);
        const blog = await response.json();
        currentBlog = blog;
        
        document.getElementById('blog-language-badge').textContent = LANGUAGES[blog.language]?.name || blog.language;
        document.getElementById('blog-status-badge').textContent = blog.status;
        
        const blogContent = document.getElementById('blog-content');
        blogContent.className = 'blog-content ' + (LANGUAGES[blog.language]?.fontClass || 'lang-english');
        
        document.getElementById('blog-title').textContent = blog.title;
        document.getElementById('blog-author').textContent = blog.author;
        document.getElementById('blog-date').textContent = formatDate(blog.date);
        document.getElementById('blog-content').textContent = blog.content;
    } catch (err) { showToast('Failed to load blog'); }
}

function shareBlog() {
    if (!currentBlog) return;
    const text = `${currentBlog.title}\n\n${currentBlog.content.substring(0, 100)}...`;
    if (navigator.share) navigator.share({ title: currentBlog.title, text, url: window.location.href }).catch(() => copyToClipboard(currentBlog.title + '\n\n' + currentBlog.content));
    else copyToClipboard(currentBlog.title + '\n\n' + currentBlog.content);
}

// ==================== Admin Poems ====================

async function loadAdminPoems() {
    const container = document.getElementById('admin-poems');
    container.innerHTML = '<div class="loading">Loading...</div>';
    try {
        const response = await fetch(API_URL);
        let poems = await response.json();
        if (adminLanguage !== 'all') poems = poems.filter(p => p.language === adminLanguage);
        
        if (poems.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No poems yet.</p></div>';
            return;
        }
        
        container.innerHTML = poems.map(poem => `
            <div class="admin-poem-item">
                <div class="admin-poem-info">
                    <h3>${escapeHtml(poem.title)}</h3>
                    <p>${escapeHtml(poem.author)} <span class="separator">•</span> ${formatDate(poem.date)} <span class="lang-tag">${LANGUAGES[poem.language]?.name || poem.language}</span></p>
                </div>
                <div class="admin-poem-actions">
                    <button class="edit-btn" onclick="editPoem('${poem.id}')">Edit</button>
                    <button class="delete-btn" onclick="deletePoem('${poem.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (err) { container.innerHTML = '<div class="empty-state"><p>Failed to load.</p></div>'; }
}

function setupPoemForm() {
    document.getElementById('poem-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('poem-id').value;
        const data = {
            title: document.getElementById('poem-title-input').value,
            author: document.getElementById('poem-author-input').value || 'Anonymous',
            content: document.getElementById('poem-content-input').value,
            date: document.getElementById('poem-date-input').value || new Date().toISOString().split('T')[0],
            language: document.getElementById('poem-language').value
        };
        
        try {
            const method = id ? 'PUT' : 'POST';
            const url = id ? `${API_URL}/${id}` : API_URL;
            await fetch(url, { method, headers: getAuthHeaders(), body: JSON.stringify(data) });
            showToast(id ? 'Poem updated' : 'Poem created');
            resetPoemForm();
            loadAdminPoems();
        } catch (err) { showToast('Failed to save poem'); }
    });
}

function editPoem(id) {
    fetch(`${API_URL}/${id}`).then(res => res.json()).then(poem => {
        document.getElementById('poem-id').value = poem.id;
        document.getElementById('poem-title-input').value = poem.title;
        document.getElementById('poem-author-input').value = poem.author;
        document.getElementById('poem-content-input').value = poem.content;
        document.getElementById('poem-date-input').value = poem.date;
        document.getElementById('poem-language').value = poem.language || 'english';
        document.getElementById('poem-form-title').textContent = 'Edit Poem';
        document.querySelector('#tab-poems .cancel-btn').style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

function deletePoem(id) {
    if (!confirm('Delete this poem?')) return;
    fetch(`${API_URL}/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
        .then(() => { showToast('Poem deleted'); loadAdminPoems(); })
        .catch(() => showToast('Failed to delete'));
}

function resetPoemForm() {
    document.getElementById('poem-form').reset();
    document.getElementById('poem-id').value = '';
    document.getElementById('poem-form-title').textContent = 'Add New Poem';
    document.querySelector('#tab-poems .cancel-btn').style.display = 'none';
}

// ==================== Admin Blogs ====================

async function loadAdminBlogs() {
    const container = document.getElementById('admin-blogs');
    container.innerHTML = '<div class="loading">Loading...</div>';
    try {
        const response = await fetch(BLOG_API_URL);
        let blogs = await response.json();
        if (adminBlogLanguage !== 'all') blogs = blogs.filter(b => b.language === adminBlogLanguage);
        
        if (blogs.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No blogs yet.</p></div>';
            return;
        }
        
        container.innerHTML = blogs.map(blog => `
            <div class="admin-poem-item">
                <div class="admin-poem-info">
                    <h3>${escapeHtml(blog.title)}</h3>
                    <p>${escapeHtml(blog.author)} <span class="separator">•</span> ${formatDate(blog.date)} <span class="lang-tag">${LANGUAGES[blog.language]?.name || blog.language}</span> <span class="blog-status ${blog.status}">${blog.status}</span></p>
                </div>
                <div class="admin-poem-actions">
                    <button class="edit-btn" onclick="editBlog('${blog.id}')">Edit</button>
                    <button class="delete-btn" onclick="deleteBlog('${blog.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (err) { container.innerHTML = '<div class="empty-state"><p>Failed to load.</p></div>'; }
}

function setupBlogForm() {
    document.getElementById('blog-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('blog-id').value;
        const data = {
            title: document.getElementById('blog-title-input').value,
            author: document.getElementById('blog-author-input').value || 'Anonymous',
            excerpt: document.getElementById('blog-excerpt-input').value,
            content: document.getElementById('blog-content-input').value,
            date: document.getElementById('blog-date-input').value || new Date().toISOString().split('T')[0],
            language: document.getElementById('blog-language').value,
            status: document.getElementById('blog-status').value
        };
        
        try {
            const method = id ? 'PUT' : 'POST';
            const url = id ? `${BLOG_API_URL}/${id}` : BLOG_API_URL;
            await fetch(url, { method, headers: getAuthHeaders(), body: JSON.stringify(data) });
            showToast(id ? 'Blog updated' : 'Blog created');
            resetBlogForm();
            loadAdminBlogs();
        } catch (err) { showToast('Failed to save blog'); }
    });
}

function editBlog(id) {
    fetch(`${BLOG_API_URL}/${id}`).then(res => res.json()).then(blog => {
        document.getElementById('blog-id').value = blog.id;
        document.getElementById('blog-title-input').value = blog.title;
        document.getElementById('blog-author-input').value = blog.author;
        document.getElementById('blog-excerpt-input').value = blog.excerpt || '';
        document.getElementById('blog-content-input').value = blog.content;
        document.getElementById('blog-date-input').value = blog.date;
        document.getElementById('blog-language').value = blog.language || 'english';
        document.getElementById('blog-status').value = blog.status || 'draft';
        document.getElementById('blog-form-title').textContent = 'Edit Blog';
        document.querySelector('#tab-blogs .cancel-btn').style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

function deleteBlog(id) {
    if (!confirm('Delete this blog?')) return;
    fetch(`${BLOG_API_URL}/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
        .then(() => { showToast('Blog deleted'); loadAdminBlogs(); })
        .catch(() => showToast('Failed to delete'));
}

function resetBlogForm() {
    document.getElementById('blog-form').reset();
    document.getElementById('blog-id').value = '';
    document.getElementById('blog-form-title').textContent = 'Add New Blog';
    document.querySelector('#tab-blogs .cancel-btn').style.display = 'none';
}

// ==================== Share & Download ====================

function sharePoem() {
    if (!currentPoem) return;
    const langName = LANGUAGES[currentPoem.language]?.name || '';
    const text = `${currentPoem.title}\n\n${langName} poem by ${currentPoem.author}\n\n${currentPoem.content.substring(0, 100)}...`;
    if (navigator.share) navigator.share({ title: currentPoem.title, text, url: window.location.href }).catch(() => copyToClipboard(currentPoem.title + '\n\n' + currentPoem.content));
    else copyToClipboard(currentPoem.title + '\n\n' + currentPoem.content);
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard')).catch(() => showToast('Failed to copy'));
}

async function downloadPoemAsImage() {
    if (!currentPoem) return;
    const canvas = document.getElementById('poem-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1080; canvas.height = 1350;
    
    // Warm literary theme colors
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Border
    ctx.strokeStyle = '#E0DAD3';
    ctx.lineWidth = 24;
    ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);
    
    // Inner border
    ctx.strokeStyle = '#D0CAC3';
    ctx.lineWidth = 1;
    ctx.strokeRect(45, 45, canvas.width - 90, canvas.height - 90);
    
    const langName = LANGUAGES[currentPoem.language]?.name || '';
    if (langName) {
        ctx.font = '600 13px Outfit, sans-serif';
        const badgeWidth = ctx.measureText(langName).width + 24;
        ctx.fillStyle = 'rgba(122, 92, 62, 0.08)';
        ctx.beginPath(); ctx.roundRect(canvas.width/2 - badgeWidth/2, 80, badgeWidth, 24, 12); ctx.fill();
        ctx.fillStyle = '#7A5C3E';
        ctx.textAlign = 'center';
        ctx.fillText(langName.toUpperCase(), canvas.width/2, 96);
    }
    
    ctx.fillStyle = '#1A1816';
    ctx.font = 'italic 500 48px Fraunces, Georgia, serif';
    ctx.textAlign = 'center';
    const titleLines = wrapText(ctx, currentPoem.title, canvas.width - 140);
    let titleY = currentPoem.language !== 'english' ? 170 : 150;
    titleLines.forEach(line => { ctx.fillText(line, canvas.width / 2, titleY); titleY += 60; });
    
    ctx.font = '22px Outfit, sans-serif';
    ctx.fillStyle = '#7A5C3E';
    ctx.fillText(`— ${currentPoem.author}`, canvas.width / 2, titleY + 25);
    
    let contentFont = '26px Lora, Georgia, serif';
    if (currentPoem.language === 'hindi' || currentPoem.language === 'marathi') contentFont = '400 28px Hind, sans-serif';
    ctx.font = contentFont; ctx.fillStyle = '#1A1816';
    
    const lines = currentPoem.content.split('\n');
    let y = titleY + 80; const lineHeight = currentPoem.language === 'english' ? 44 : 50;
    lines.forEach(line => {
        if (line.trim() === '') y += lineHeight * 0.5;
        else { const wrappedLines = wrapText(ctx, line, 800); wrappedLines.forEach(w => { ctx.fillText(w, canvas.width / 2, y); y += lineHeight; }); }
    });
    
    ctx.font = '14px Outfit, sans-serif'; ctx.fillStyle = '#8A8580';
    ctx.fillText('bhushverse', canvas.width / 2, canvas.height - 50);
    
    const link = document.createElement('a');
    link.download = `${currentPoem.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('Image downloaded!');
}

function wrapText(ctx, text, maxWidth) {
    const words = text.split(' '), lines = []; let currentLine = '';
    words.forEach(word => {
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) { lines.push(currentLine); currentLine = word; }
        else currentLine = testLine;
    });
    if (currentLine) lines.push(currentLine);
    return lines;
}

// ==================== Login ====================

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('admin-password').value;
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        if (response.ok) {
            const data = await response.json();
            setAdminToken(data.token);
            document.getElementById('login-modal').classList.remove('show');
            document.getElementById('login-form').reset();
            showAdmin();
            showToast('Logged in successfully');
        } else { document.getElementById('login-error').textContent = 'Invalid password'; }
    } catch (err) { document.getElementById('login-error').textContent = 'Login failed'; }
});

document.getElementById('login-modal').addEventListener('click', (e) => {
    if (e.target.id === 'login-modal') document.getElementById('login-modal').classList.remove('show');
});

// ==================== Utilities ====================

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ==================== Secret Admin ====================

let keySequence = '';
document.addEventListener('keydown', (e) => {
    keySequence += e.key.toLowerCase();
    if (keySequence.length > 10) keySequence = keySequence.slice(-10);
    if (keySequence.includes('admin') || keySequence.includes('bhushan')) { keySequence = ''; showAdmin(); }
});

let logoClickCount = 0, logoClickTimer = null;
document.querySelector('.logo').addEventListener('click', (e) => {
    e.preventDefault();
    logoClickCount++;
    if (logoClickTimer) clearTimeout(logoClickTimer);
    logoClickTimer = setTimeout(() => logoClickCount = 0, 2000);
    if (logoClickCount >= 5) { logoClickCount = 0; showAdmin(); }
});

// ==================== Init ====================

document.addEventListener('DOMContentLoaded', () => {
    loadPoems();
    
    const urlParams = new URLSearchParams(window.location.search);
    if (window.location.hash === '#admin' || urlParams.get('admin') === 'true') {
        window.location.hash = ''; showAdmin();
    }
    
    setupPoemForm();
    setupBlogForm();
});
