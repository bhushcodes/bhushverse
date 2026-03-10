/* ============================================
   Poetry Blog - JavaScript
   ============================================ */

const API_URL = '/api/poems';

// Store current poem for sharing
let currentPoem = null;
let currentLanguage = 'all';
let adminLanguage = 'all';
let previousPage = 'home-page';

// Language configuration
const LANGUAGES = {
    english: { name: 'English', fontClass: 'lang-english' },
    hindi: { name: 'हिंदी', fontClass: 'lang-hindi' },
    marathi: { name: 'मराठी', fontClass: 'lang-marathi' }
};

// Admin authentication using JWT
let adminToken = sessionStorage.getItem('adminToken');

function isAdminLoggedIn() {
    return adminToken !== null;
}

function setAdminToken(token) {
    adminToken = token;
    sessionStorage.setItem('adminToken', token);
}

// Get auth headers for API calls
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': adminToken
    };
}

function logoutAdmin() {
    adminToken = null;
    sessionStorage.removeItem('adminToken');
}

// ============================================
// Page Navigation
// ============================================

function showPage(pageId) {
    previousPage = document.querySelector('.page.active')?.id || 'home-page';
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(pageId).classList.add('active');
    window.scrollTo(0, 0);
}

function showHome() {
    currentLanguage = 'all';
    updateLanguageTabs('home-page');
    showPage('home-page');
    loadPoems();
}

async function showAdmin() {
    if (!isAdminLoggedIn()) {
        document.getElementById('login-modal').classList.add('show');
        return;
    }
    
    // Verify token is still valid
    try {
        const response = await fetch('/api/admin/verify', {
            headers: { 'Authorization': adminToken }
        });
        
        if (!response.ok) {
            // Token expired or invalid
            logoutAdmin();
            document.getElementById('login-modal').classList.add('show');
            showToast('Session expired. Please login again.');
            return;
        }
    } catch (err) {
        logoutAdmin();
        document.getElementById('login-modal').classList.add('show');
        return;
    }
    
    adminLanguage = 'all';
    updateLanguageTabs('admin-page');
    showPage('admin-page');
    loadAdminPoems();
}

function showPoem(id) {
    loadPoem(id);
    showPage('poem-page');
}

function goBack() {
    showPage(previousPage || 'home-page');
    if (previousPage === 'admin-page') {
        loadAdminPoems();
    } else {
        loadPoems();
    }
}

// ============================================
// Language Tabs
// ============================================

function switchLanguage(lang) {
    currentLanguage = lang;
    updateLanguageTabs('home-page');
    loadPoems();
}

function switchAdminLanguage(lang) {
    adminLanguage = lang;
    updateLanguageTabs('admin-page');
    loadAdminPoems();
}

function updateLanguageTabs(pageId) {
    const prefix = pageId === 'admin-page' ? 'admin-page' : '';
    const lang = pageId === 'admin-page' ? adminLanguage : currentLanguage;
    
    document.querySelectorAll(`#${pageId} .lang-tab`).forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.lang === lang) {
            tab.classList.add('active');
        }
    });
}

// ============================================
// API Functions - Get Poems
// ============================================

async function loadPoems() {
    const container = document.getElementById('poems-list');
    container.innerHTML = '<div class="loading">Loading poems...</div>';
    
    try {
        const response = await fetch(API_URL);
        let poems = await response.json();
        
        // Filter by language
        if (currentLanguage !== 'all') {
            poems = poems.filter(p => p.language === currentLanguage);
        }
        
        if (poems.length === 0) {
            const langName = currentLanguage === 'all' ? '' : LANGUAGES[currentLanguage]?.name || currentLanguage;
            container.innerHTML = `
                <div class="empty-state">
                    <p>${langName ? `No ${langName} poems yet.` : 'No poems yet. Add your first poem in the admin panel.'}</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = poems.map(poem => `
            <div class="poem-card" onclick="showPoem('${poem.id}')">
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
        container.innerHTML = `
            <div class="empty-state">
                <p>Failed to load poems. Please try again.</p>
            </div>
        `;
        console.error('Error loading poems:', err);
    }
}

async function loadPoem(id) {
    try {
        const response = await fetch(`${API_URL}/${id}`);
        const poem = await response.json();
        
        currentPoem = poem;
        
        // Set language badge
        const badge = document.getElementById('poem-language-badge');
        badge.textContent = LANGUAGES[poem.language]?.name || poem.language;
        
        // Set language class for typography
        const poemContent = document.getElementById('poem-content');
        poemContent.className = 'poem-content ' + (LANGUAGES[poem.language]?.fontClass || 'lang-english');
        
        document.getElementById('poem-title').textContent = poem.title;
        document.getElementById('poem-author').textContent = poem.author;
        document.getElementById('poem-date').textContent = formatDate(poem.date);
        document.getElementById('poem-content').textContent = poem.content;
    } catch (err) {
        console.error('Error loading poem:', err);
        showToast('Failed to load poem');
    }
}

// ============================================
// Admin Functions
// ============================================

async function loadAdminPoems() {
    const container = document.getElementById('admin-poems');
    container.innerHTML = '<div class="loading">Loading poems...</div>';
    
    try {
        const response = await fetch(API_URL);
        let poems = await response.json();
        
        // Filter by language
        if (adminLanguage !== 'all') {
            poems = poems.filter(p => p.language === adminLanguage);
        }
        
        if (poems.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No poems yet. Add your first poem below.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = poems.map(poem => `
            <div class="admin-poem-item">
                <div class="admin-poem-info">
                    <h3>${escapeHtml(poem.title)}</h3>
                    <p>
                        ${escapeHtml(poem.author)} 
                        <span class="separator">•</span> 
                        ${formatDate(poem.date)}
                        <span class="lang-tag">${LANGUAGES[poem.language]?.name || poem.language}</span>
                    </p>
                </div>
                <div class="admin-poem-actions">
                    <button class="edit-btn" onclick="editPoem('${poem.id}')">Edit</button>
                    <button class="delete-btn" onclick="deletePoem('${poem.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `
            <div class="empty-state">
                <p>Failed to load poems.</p>
            </div>
        `;
        console.error('Error loading admin poems:', err);
    }
}

// ============================================
// Form Handling
// ============================================

function setupFormHandler() {
    const form = document.getElementById('poem-form');
    if (!form) return;
    
    form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('poem-id').value;
    const title = document.getElementById('title').value;
    const author = document.getElementById('author').value || 'Anonymous';
    const content = document.getElementById('content').value;
    const date = document.getElementById('date').value || new Date().toISOString().split('T')[0];
    const language = document.getElementById('language').value;
    
    const poemData = { title, author, content, date, language };
    const headers = { 
        'Content-Type': 'application/json',
        'Authorization': adminToken
    };
    
    try {
        if (id) {
            const response = await fetch(`${API_URL}/${id}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(poemData)
            });
            
            if (response.ok) {
                showToast('Poem updated successfully');
            }
        } else {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(poemData)
            });
            
            if (response.ok) {
                showToast('Poem created successfully');
            }
        }
        
        resetForm();
        loadAdminPoems();
    } catch (err) {
        showToast('Failed to save poem');
        console.error('Error saving poem:', err);
    }
    });
}

function editPoem(id) {
    fetch(`${API_URL}/${id}`)
        .then(res => res.json())
        .then(poem => {
            document.getElementById('poem-id').value = poem.id;
            document.getElementById('title').value = poem.title;
            document.getElementById('author').value = poem.author;
            document.getElementById('content').value = poem.content;
            document.getElementById('date').value = poem.date;
            document.getElementById('language').value = poem.language || 'english';
            
            document.getElementById('form-title').textContent = 'Edit Poem';
            document.querySelector('.cancel-btn').style.display = 'block';
            
            window.scrollTo({ top: 0, behavior: 'smooth' });
        })
        .catch(err => {
            showToast('Failed to load poem for editing');
            console.error(err);
        });
}

function deletePoem(id) {
    if (!confirm('Are you sure you want to delete this poem?')) {
        return;
    }
    
    fetch(`${API_URL}/${id}`, { 
        method: 'DELETE',
        headers: { 'Authorization': adminToken }
    })
        .then(() => {
            showToast('Poem deleted');
            loadAdminPoems();
        })
        .catch(err => {
            showToast('Failed to delete poem');
            console.error(err);
        });
}

function resetForm() {
    document.getElementById('poem-form').reset();
    document.getElementById('poem-id').value = '';
    document.getElementById('language').value = 'english';
    document.getElementById('form-title').textContent = 'Add New Poem';
    document.querySelector('.cancel-btn').style.display = 'none';
}

// ============================================
// Share Functionality
// ============================================

function sharePoem() {
    if (!currentPoem) return;
    
    const langName = LANGUAGES[currentPoem.language]?.name || '';
    const shareData = {
        title: currentPoem.title,
        text: `${currentPoem.title}\n\n${langName} poem by ${currentPoem.author}\n\n${currentPoem.content.substring(0, 100)}...`,
        url: window.location.href
    };
    
    if (navigator.share) {
        navigator.share(shareData)
            .then(() => showToast('Shared successfully'))
            .catch(err => {
                if (err.name !== 'AbortError') {
                    copyToClipboard();
                }
            });
    } else {
        copyToClipboard();
    }
}

function copyToClipboard() {
    if (!currentPoem) return;
    
    const langName = LANGUAGES[currentPoem.language]?.name || '';
    const text = `${currentPoem.title}\n\n${langName} by ${currentPoem.author}\n\n${currentPoem.content}`;
    
    navigator.clipboard.writeText(text)
        .then(() => showToast('Copied to clipboard'))
        .catch(() => showToast('Failed to copy'));
}

async function shareToInstagram() {
    if (!currentPoem) return;
    
    // First download the image
    await downloadPoemAsImage();
    
    // Show message to share
    showToast('Image downloaded! Open Instagram → Create → Select the image to share');
}

// ============================================
// Login Handler
// ============================================

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('admin-password').value;
    const errorEl = document.getElementById('login-error');
    
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        
        if (response.ok) {
            const data = await response.json();
            setAdminToken(data.token);
            document.getElementById('login-modal').classList.remove('show');
            document.getElementById('login-form').reset();
            showAdmin();
            showToast('Logged in successfully');
        } else {
            errorEl.textContent = 'Invalid password';
        }
    } catch (err) {
        errorEl.textContent = 'Login failed. Try again.';
    }
});

// Close modal on outside click
document.getElementById('login-modal').addEventListener('click', (e) => {
    if (e.target.id === 'login-modal') {
        document.getElementById('login-modal').classList.remove('show');
    }
});

// ============================================
// Download Poem as Image
// ============================================

async function downloadPoemAsImage() {
    if (!currentPoem) return;
    
    const canvas = document.getElementById('poem-canvas');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size (Instagram portrait 1080x1350)
    canvas.width = 1080;
    canvas.height = 1350;
    
    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#FAF8F5');
    gradient.addColorStop(1, '#F3EEE6');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Add decorative border
    ctx.strokeStyle = '#E5DFD5';
    ctx.lineWidth = 24;
    ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);
    
    // Inner border
    ctx.strokeStyle = '#D5CFC5';
    ctx.lineWidth = 1;
    ctx.strokeRect(55, 55, canvas.width - 110, canvas.height - 110);
    
    // Language badge
    const langName = LANGUAGES[currentPoem.language]?.name || '';
    if (langName) {
        ctx.font = '500 14px sans-serif';
        ctx.fillStyle = '#7A6347';
        const badgeWidth = ctx.measureText(langName).width + 30;
        ctx.fillStyle = '#F3EEE6';
        ctx.roundRect(canvas.width/2 - badgeWidth/2, 100, badgeWidth, 28, 14);
        ctx.fill();
        ctx.fillStyle = '#7A6347';
        ctx.textAlign = 'center';
        ctx.fillText(langName.toUpperCase(), canvas.width/2, 119);
    }
    
    // Title
    ctx.fillStyle = '#1A1A1A';
    ctx.font = 'italic 500 52px Georgia, serif';
    ctx.textAlign = 'center';
    
    // Wrap title if too long
    const titleLines = wrapText(ctx, currentPoem.title, canvas.width - 160);
    let titleY = currentPoem.language !== 'english' ? 200 : 180;
    titleLines.forEach(line => {
        ctx.fillText(line, canvas.width / 2, titleY);
        titleY += 65;
    });
    
    // Author
    ctx.font = '24px Georgia, serif';
    ctx.fillStyle = '#7A6347';
    ctx.fillText(`— ${currentPoem.author}`, canvas.width / 2, titleY + 30);
    
    // Poem content - use appropriate font based on language
    let contentFont = '28px Georgia, serif';
    if (currentPoem.language === 'hindi' || currentPoem.language === 'marathi') {
        contentFont = '500 32px "Noto Sans Devanagari", sans-serif';
    }
    
    ctx.font = contentFont;
    ctx.fillStyle = '#1A1A1A';
    
    const lines = currentPoem.content.split('\n');
    let y = titleY + 100;
    const lineHeight = currentPoem.language === 'english' ? 48 : 56;
    const maxWidth = 880;
    
    lines.forEach(line => {
        if (line.trim() === '') {
            y += lineHeight * 0.5;
        } else {
            const wrappedLines = wrapText(ctx, line, maxWidth);
            wrappedLines.forEach(wrappedLine => {
                ctx.fillText(wrappedLine, canvas.width / 2, y);
                y += lineHeight;
            });
        }
    });
    
    // Footer
    ctx.font = '16px Georgia, serif';
    ctx.fillStyle = '#8A8A8A';
    ctx.fillText('bhushverse', canvas.width / 2, canvas.height - 70);
    
    // Download
    const link = document.createElement('a');
    link.download = `${currentPoem.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    
    showToast('Image downloaded!');
}

// Helper function to wrap text
function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    words.forEach(word => {
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    });
    
    if (currentLine) {
        lines.push(currentLine);
    }
    
    return lines;
}

// ============================================
// Utility Functions
// ============================================

function formatDate(dateString) {
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(dateString).toLocaleDateString('en-US', options);
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
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ============================================
// Initialize
// ============================================

// ============================================
// Secret Admin Access (for you only)
// ============================================

let keySequence = '';

document.addEventListener('keydown', (e) => {
    // Secret key: press 'a' then 'd' then 'm' quickly
    keySequence += e.key.toLowerCase();
    
    // Keep only last 10 characters
    if (keySequence.length > 10) {
        keySequence = keySequence.slice(-10);
    }
    
    // Check for secret sequence
    if (keySequence.includes('admin') || keySequence.includes('bhushan')) {
        keySequence = '';
        showAdmin();
    }
});

// Also allow clicking logo 5 times
let logoClickCount = 0;
let logoClickTimer = null;

document.querySelector('.logo').addEventListener('click', (e) => {
    e.preventDefault();
    logoClickCount++;
    
    if (logoClickTimer) clearTimeout(logoClickTimer);
    
    logoClickTimer = setTimeout(() => {
        logoClickCount = 0;
    }, 2000);
    
    if (logoClickCount >= 5) {
        logoClickCount = 0;
        showAdmin();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    loadPoems();
    
    // Check for admin hash in URL or query parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (window.location.hash === '#admin' || urlParams.get('admin') === 'true') {
        window.location.hash = '';
        showAdmin();
    }
    
    // Setup logo click listener
    const logo = document.querySelector('.logo');
    if (logo) {
        logo.addEventListener('click', (e) => {
            e.preventDefault();
            logoClickCount++;
            if (logoClickTimer) clearTimeout(logoClickTimer);
            
            logoClickTimer = setTimeout(() => {
                logoClickCount = 0;
            }, 2000);
            
            if (logoClickCount >= 5) {
                logoClickCount = 0;
                showAdmin();
            }
        });
    }
    
    // Setup form handler
    setupFormHandler();
});
