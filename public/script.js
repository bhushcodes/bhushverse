/* ============================================
   bhushverse - JavaScript
   Premium Poetry Platform
   ============================================ */

const API_URL = '/api/poems';
const BLOG_API_URL = '/api/blogs';
const COMMUNITY_API_URL = '/api/community/posts';
const AUTH_API_URL = '/api/auth';
const INTERACTIONS_API_URL = '/api/interactions';
const USERS_API_URL = '/api/users';

// State
let currentPoem = null;
let currentBlog = null;
let currentCommunityPost = null;
let currentLanguage = 'all';
let adminLanguage = 'all';
let blogLanguage = 'all';
let adminBlogLanguage = 'all';
let previousPage = 'home-page';
let communityFeedType = 'all';
let communityPostsList = [];
let communityDraftsList = [];
let currentUser = null;
let activeProfileUserId = null;
let activeProfileData = null;
let profileEditOpen = false;
let activeProfileListMode = 'followers';
let currentProfileTab = 'poetry';
let userAuthMode = 'login';
let userToken = localStorage.getItem('userToken');
let googleAuthReady = false;
let googleSignInEnabled = true;
let pendingProfilePicture = null;
let isNavigating = false;

// ==================== Router ====================

const routes = {
    '': { page: 'home-page', fn: showHome },
    '/': { page: 'home-page', fn: showHome },
    '/index.html': { page: 'home-page', fn: showHome },
    '/poems': { page: 'home-page', fn: showHome },
    '/poems/:lang': { page: 'home-page', fn: showHome },
    '/poem/:id': { page: 'poem-page', fn: showPoemById },
    '/blogs': { page: 'blog-page', fn: showBlog },
    '/blog/:id': { page: 'blog-detail-page', fn: showBlogById },
    '/community': { page: 'community-page', fn: showCommunity },
    '/community/post/:id': { page: 'community-post-page', fn: showCommunityPostById },
    '/profile': { page: 'profile-page', fn: showOwnProfile },
    '/profile/:username': { page: 'profile-page', fn: showUserProfile },
    '/about': { page: 'about-page', fn: showAbout },
    '/terms': { page: 'terms-page', fn: showTerms },
    '/admin': { page: 'admin-page', fn: showAdmin }
};

function parseRoute(pathname) {
    // Remove trailing slash except for root
    let path = pathname.replace(/\/$/, '') || '/';
    // Remove leading slash for matching
    const pathWithoutSlash = path === '/' ? '/' : path.replace(/^\//, '');
    
    for (const [route, config] of Object.entries(routes)) {
        // Exact match
        if (route === path || route === pathWithoutSlash) {
            return { ...config, params: {} };
        }
        
        const routeParts = route.split('/').filter(Boolean);
        const pathParts = pathWithoutSlash.split('/').filter(Boolean);
        
        if (routeParts.length === pathParts.length) {
            const params = {};
            let matches = true;
            
            for (let i = 0; i < routeParts.length; i++) {
                if (routeParts[i].startsWith(':')) {
                    params[routeParts[i].slice(1)] = pathParts[i];
                } else if (routeParts[i] !== pathParts[i]) {
                    matches = false;
                    break;
                }
            }
            
            if (matches) {
                return { ...config, params };
            }
        }
    }
    
    // Default to home
    return { page: 'home-page', fn: showHome, params: {} };
}

function navigateTo(url, addToHistory = true) {
    if (isNavigating) return;
    isNavigating = true;
    
    const route = parseRoute(url);
    
    if (addToHistory) {
        window.history.pushState({ path: url }, '', url);
    }
    
    route.fn(route.params);
    
    isNavigating = false;
}

function handlePopState(event) {
    if (event.state && event.state.path) {
        navigateTo(event.state.path, false);
    } else {
        navigateTo(window.location.pathname, false);
    }
}

window.addEventListener('popstate', handlePopState);

function initRouter() {
    const path = window.location.pathname;
    navigateTo(path, false);
}

// Language config
const LANGUAGES = {
    english: { name: 'English', fontClass: 'lang-english' },
    hindi: { name: 'हिंदी', fontClass: 'lang-hindi' },
    marathi: { name: 'मराठी', fontClass: 'lang-marathi' },
    hinglish: { name: 'Hinglish', fontClass: 'lang-hinglish' }
};

// Admin auth
let adminToken = sessionStorage.getItem('adminToken');

function isAdminLoggedIn() { return adminToken !== null; }
function isUserLoggedIn() { return userToken !== null; }

function setAdminToken(token) {
    adminToken = token;
    sessionStorage.setItem('adminToken', token);
}

function logoutAdmin() {
    adminToken = null;
    sessionStorage.removeItem('adminToken');
}

function setUserToken(token) {
    userToken = token;
    localStorage.setItem('userToken', token);
}

function logoutUser() {
    userToken = null;
    currentUser = null;
    pendingProfilePicture = null;
    activeProfileUserId = null;
    activeProfileData = null;
    localStorage.removeItem('userToken');
    updateUserAuthUI();
    renderCommunityAuthState();
    renderProfileGuestState();
    if (document.getElementById('community-page').classList.contains('active')) loadCommunityFeed();
    if (document.getElementById('profile-page').classList.contains('active')) loadProfilePage();
}

function getAuthHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': adminToken };
}

function getUserAuthHeaders(includeJson = true) {
    const headers = {};
    if (includeJson) headers['Content-Type'] = 'application/json';
    if (userToken) headers['Authorization'] = `Bearer ${userToken}`;
    return headers;
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
    const cards = page.querySelectorAll('.poem-card, .blog-card, .about-card, .community-card, .stat-card, .profile-card');
    cards.forEach((card, index) => {
        card.style.animation = 'none';
        card.offsetHeight;
        card.style.animation = `cardIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) backwards`;
        card.style.animationDelay = `${index * 0.1}s`;
    });
}

function showHome(params = {}) {
    currentLanguage = params.lang || 'all';
    clearDetailUrls();
    updateNavLinks('home');
    updateLanguageTabs('home-page');
    showPage('home-page');
    loadPoems();
}

function showBlog() {
    blogLanguage = 'all';
    clearDetailUrls();
    updateNavLinks('blog');
    showPage('blog-page');
    loadBlogs();
}

function showCommunity() {
    clearDetailUrls();
    updateNavLinks('community');
    showPage('community-page');
    loadCommunityFeed();
}

async function showOwnProfile() {
    await showProfile(currentUser?.id || null);
}

async function showUserProfile(params = {}) {
    if (params.username) {
        const userId = await getUserIdByUsername(params.username);
        if (userId) {
            await showProfile(userId);
        } else {
            showToast('User not found');
            navigateTo('/');
        }
    } else {
        await showProfile(currentUser?.id || null);
    }
}

async function showProfile(userId = currentUser?.id || null, initialTab = 'posts') {
    activeProfileUserId = userId;
    activeProfileListMode = initialTab === 'following' ? 'following' : 'followers';
    profileEditOpen = false;
    updateNavLinks('profile');
    showPage('profile-page');
    await loadProfilePage();
    // Update URL after profile loads
    if (activeProfileData && activeProfileData.user && activeProfileData.user.username) {
        history.replaceState({}, '', `/profile/${activeProfileData.user.username}`);
    }
}

function showAbout() {
    clearDetailUrls();
    updateNavLinks('about');
    showPage('about-page');
    setTimeout(() => animatePageElements('about-page'), 100);
}

function showTerms() {
    clearDetailUrls();
    updateNavLinks('terms');
    showPage('terms-page');
}

function updateNavLinks(page) {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.dataset.page === page) link.classList.add('active');
    });
}

function getInitials(name) {
    return String(name || 'U')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toUpperCase())
        .join('') || 'U';
}

function getAvatarSrc(profilePicture, name) {
    if (profilePicture) return profilePicture;
    const initials = getInitials(name);
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
            <rect width="100%" height="100%" fill="#FFFCF7"/>
            <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
                font-family="Libre Baskerville, serif" font-size="42" fill="#8B4513">${initials}</text>
        </svg>
    `;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function updateUserAuthUI() {
    const signInButton = document.getElementById('user-signin-button');
    const userActions = document.getElementById('user-nav-actions');
    const navUserName = document.getElementById('nav-user-name');
    const navUserAvatar = document.getElementById('nav-user-avatar');
    const mobileMenuFooter = document.getElementById('mobile-menu-footer');

    if (currentUser) {
        signInButton.style.display = 'none';
        userActions.style.display = 'flex';
        navUserName.textContent = currentUser.name;
        navUserAvatar.src = getAvatarSrc(currentUser.profilePicture, currentUser.name);
        
        if (mobileMenuFooter) {
            mobileMenuFooter.innerHTML = `
                <div class="mobile-user-info">
                    <img src="${getAvatarSrc(currentUser.profilePicture, currentUser.name)}" alt="${currentUser.name}" class="mobile-user-avatar">
                    <div>
                        <strong>${currentUser.name}</strong>
                        <span>${currentUser.email}</span>
                    </div>
                </div>
                <button class="mobile-logout-btn" onclick="logoutUser()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                    Logout
                </button>
            `;
        }
    } else {
        signInButton.style.display = 'inline-flex';
        userActions.style.display = 'none';
        
        if (mobileMenuFooter) {
            mobileMenuFooter.innerHTML = `
                <button class="mobile-login-btn" onclick="openUserAuthModal('login'); closeMobileMenu();">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>
                    Sign In
                </button>
            `;
        }
    }
}

function copyProfilePersonalId() {
    const username = activeProfileData?.user?.username || currentUser?.username;
    if (!username) {
        showToast('Personal ID is not available yet');
        return;
    }
    copyToClipboard(`@${username}`);
}

function switchUserAuthMode(mode) {
    userAuthMode = mode === 'register' ? 'register' : 'login';
    const isRegister = userAuthMode === 'register';
    document.getElementById('auth-tab-login').classList.toggle('active', !isRegister);
    document.getElementById('auth-tab-register').classList.toggle('active', isRegister);
    document.getElementById('user-login-section').style.display = isRegister ? 'none' : 'block';
    document.getElementById('user-register-section').style.display = isRegister ? 'block' : 'none';
    document.getElementById('user-auth-error').textContent = '';
    
    // Reset verification steps
    document.getElementById('register-step-1').style.display = 'block';
    document.getElementById('register-step-2').style.display = 'none';
    document.getElementById('code-sent-msg').style.display = 'none';
}

function openUserAuthModal(mode = 'login') {
    switchUserAuthMode(mode);
    document.getElementById('user-auth-modal').classList.add('show');
}

function closeUserAuthModal() {
    document.getElementById('user-auth-modal').classList.remove('show');
    document.getElementById('user-auth-error').textContent = '';
}

function applyUserSession(data, successMessage = 'Signed in successfully') {
    setUserToken(data.token);
    currentUser = data.user;
    pendingProfilePicture = null;
    updateUserAuthUI();
    renderCommunityAuthState();
    closeUserAuthModal();
    showToast(successMessage);

    const activePage = document.querySelector('.page.active')?.id;
    if (activePage === 'profile-page') loadProfilePage();
    else if (activePage === 'community-page') loadCommunityFeed();
}

function openUserProfile(userId, event, initialTab = 'posts') {
    if (event) event.stopPropagation();
    if (!userId) return;
    // Get username from the user data if available, otherwise use ID
    const user = activeProfileData?.user;
    if (user && user.id === userId && user.username) {
        navigateTo(`/profile/${user.username}`);
    } else {
        showProfile(userId, initialTab);
    }
}

async function loadCurrentUser() {
    if (!isUserLoggedIn()) {
        currentUser = null;
        updateUserAuthUI();
        return null;
    }

    try {
        const response = await fetch(`${AUTH_API_URL}/me`, {
            headers: getUserAuthHeaders(false)
        });
        const data = await readJsonResponse(response, 'Failed to load user');

        if (!response.ok) {
            logoutUser();
            return null;
        }

        currentUser = data.user;
        updateUserAuthUI();
        return currentUser;
    } catch (err) {
        logoutUser();
        return null;
    }
}

async function handleGoogleCredential(response) {
    try {
        const loginResponse = await fetch(`${AUTH_API_URL}/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential })
        });
        const data = await readJsonResponse(loginResponse, 'Google sign in failed');
        if (!loginResponse.ok) {
            throw new Error(data.error || 'Google sign in failed');
        }
        applyUserSession(data, 'Signed in with Google');
    } catch (err) {
        showToast(err.message || 'Google sign in failed');
    }
}

async function initGoogleAuth() {
    try {
        const response = await fetch(`${AUTH_API_URL}/config`);
        const config = await readJsonResponse(response, 'Failed to load auth config');
        if (!response.ok) {
            throw new Error(config.error || 'Failed to load auth config');
        }
        googleSignInEnabled = Boolean(config.googleEnabled);
        document.getElementById('user-google-auth').style.display = config.googleEnabled ? 'block' : 'none';
        if (!config.googleEnabled) return;

        const waitForGoogle = () => {
            if (!window.google?.accounts?.id) {
                window.setTimeout(waitForGoogle, 150);
                return;
            }

            window.google.accounts.id.initialize({
                client_id: config.clientId,
                callback: handleGoogleCredential
            });

            window.google.accounts.id.renderButton(
                document.getElementById('user-google-signin-button'),
                { theme: 'outline', size: 'medium', text: 'signin_with', shape: 'pill' }
            );

            googleAuthReady = true;
        };

        waitForGoogle();
    } catch (err) {
        googleSignInEnabled = false;
        document.getElementById('user-google-auth').style.display = 'none';
    }
}

function promptGoogleSignIn() {
    if (!googleAuthReady || !window.google?.accounts?.id) {
        showToast('Google sign in is not available right now');
        return;
    }
    window.google.accounts.id.prompt();
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
    history.replaceState({}, '', '/admin');
    loadAdminPoems();
    loadAdminBlogs();
}

function showLogin() { document.getElementById('login-modal').classList.add('show'); }

async function showPoemById(params = {}) {
    if (params.id) {
        await loadPoem(params.id);
        showPage('poem-page');
        setDetailUrl('poem', params.id);
    }
}

async function showBlogById(params = {}) {
    if (params.id) {
        await loadBlog(params.id);
        showPage('blog-detail-page');
        setDetailUrl('blog', params.id);
    }
}

async function showCommunityPostById(params = {}) {
    if (params.id) {
        const loaded = await loadCommunityPost(params.id);
        if (!loaded) {
            navigateTo('/community');
            return;
        }
        updateNavLinks('community');
        showPage('community-post-page');
        setDetailUrl('post', params.id);
    }
}

async function showPoem(id) {
    await loadPoem(id);
    showPage('poem-page');
    setDetailUrl('poem', id);
}

async function showBlogDetail(id) {
    await loadBlog(id);
    showPage('blog-detail-page');
    setDetailUrl('blog', id);
}

async function showCommunityPost(id) {
    const loaded = await loadCommunityPost(id);
    if (!loaded) return;
    updateNavLinks('community');
    showPage('community-post-page');
    setDetailUrl('post', id);
}

async function getUserIdByUsername(username) {
    try {
        const response = await fetch(`${USERS_API_URL}/${username}`);
        if (response.ok) {
            const data = await response.json();
            return data.id;
        }
    } catch (err) {
        console.error('Error fetching user:', err);
    }
    return null;
}

function goBack() {
    // Try to go back in browser history first
    if (window.history.length > 1) {
        window.history.back();
    } else {
        // Fallback to navigating to home
        navigateTo('/');
    }
}

// ==================== Mobile Menu ====================

function toggleMobileMenu() {
    document.querySelector('.mobile-menu').classList.toggle('active');
    document.querySelector('.mobile-menu-btn').classList.toggle('active');
    document.body.style.overflow = document.querySelector('.mobile-menu').classList.contains('active') ? 'hidden' : '';
}

function closeMobileMenu() {
    document.querySelector('.mobile-menu').classList.remove('active');
    document.querySelector('.mobile-menu-btn').classList.remove('active');
    document.body.style.overflow = '';
}

// ==================== Search ====================

function toggleSearch() {
    const searchBar = document.getElementById('search-bar');
    searchBar.classList.toggle('active');
    if (searchBar.classList.contains('active')) {
        document.getElementById('search-input').focus();
    }
}

function handleSearch(event) {
    const query = event.target.value.toLowerCase().trim();
    if (query.length < 2) return;
    
    const poems = document.querySelectorAll('.poem-card');
    const blogs = document.querySelectorAll('.blog-card');
    
    poems.forEach(card => {
        const title = card.querySelector('h3')?.textContent.toLowerCase() || '';
        const preview = card.querySelector('.poem-card-preview')?.textContent.toLowerCase() || '';
        card.style.display = (title.includes(query) || preview.includes(query)) ? '' : 'none';
    });
    
    blogs.forEach(card => {
        const title = card.querySelector('h3')?.textContent.toLowerCase() || '';
        const excerpt = card.querySelector('.blog-card-excerpt')?.textContent.toLowerCase() || '';
        card.style.display = (title.includes(query) || excerpt.includes(query)) ? '' : 'none';
    });
}

// Close search on escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const searchBar = document.getElementById('search-bar');
        if (searchBar?.classList.contains('active')) {
            toggleSearch();
            document.getElementById('search-input').value = '';
            // Reset display of all cards
            document.querySelectorAll('.poem-card, .blog-card').forEach(card => card.style.display = '');
        }
    }
});

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
            <a href="/poem/${poem.id}" onclick="navigateTo('/poem/${poem.id}'); return false;" class="poem-card" style="animation-delay: ${index * 0.08}s">
                <span class="card-lang-badge">${LANGUAGES[poem.language]?.name || poem.language}</span>
                <h3>${escapeHtml(poem.title)}</h3>
                <p class="poem-card-preview">${escapeHtml(poem.content)}</p>
                <div class="poem-card-meta">
                    <span>${escapeHtml(poem.author)}</span>
                    <span class="separator">•</span>
                    <span>${formatDate(poem.date)}</span>
                </div>
            </a>
        `).join('');
    } catch (err) {
        container.innerHTML = '<div class="empty-state"><p>Failed to load poems.</p></div>';
    }
}

async function loadPoem(id) {
    try {
        const response = await fetch(`${API_URL}/${id}`, {
            headers: getUserAuthHeaders(false)
        });
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
        updateGenericInteractionButtons('poem', poem);
        
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
            <a href="/blog/${blog.id}" onclick="navigateTo('/blog/${blog.id}'); return false;" class="blog-card" style="animation-delay: ${index * 0.08}s">
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
            </a>
        `).join('');
    } catch (err) {
        container.innerHTML = '<div class="blog-empty"><p>Failed to load blogs.</p></div>';
    }
}

async function loadBlog(id) {
    try {
        const response = await fetch(`${BLOG_API_URL}/${id}`, {
            headers: getUserAuthHeaders(false)
        });
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
        updateGenericInteractionButtons('blog', blog);
    } catch (err) { showToast('Failed to load blog'); }
}

function shareBlog() {
    if (!currentBlog) return;
    copyToClipboard(buildDetailUrl('blog', currentBlog.id));
}

async function downloadBlogAsImage() {
    if (!currentBlog) return;

    const canvas = document.getElementById('poem-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1080;
    canvas.height = 1350;

    const langName = LANGUAGES[currentBlog.language]?.name || '';
    const maxWidth = 820;
    const contentFont = (currentBlog.language === 'hindi' || currentBlog.language === 'marathi')
        ? '400 26px Hind, sans-serif'
        : '24px Lora, Georgia, serif';
    const lineHeight = (currentBlog.language === 'hindi' || currentBlog.language === 'marathi') ? 45 : 40;

    // Flatten content into drawable lines with wrapping
    ctx.font = contentFont;
    const allLines = [];
    currentBlog.content.split('\n').forEach((line) => {
        if (line.trim() === '') {
            allLines.push('');
        } else {
            wrapText(ctx, line, maxWidth).forEach((wrapped) => allLines.push(wrapped));
        }
    });

    function pageCapacity(startY) {
        const maxY = canvas.height - 90;
        let y = startY;
        let count = 0;
        while (count < allLines.length) {
            const increment = allLines[count] === '' ? lineHeight * 0.5 : lineHeight;
            if (y + increment > maxY) break;
            y += increment;
            count += 1;
        }
        return count;
    }

    // First page has bigger heading space, next pages are compact
    const titleProbeFont = 'italic 500 46px Playfair Display, Georgia, serif';
    ctx.font = titleProbeFont;
    const titleLines = wrapText(ctx, currentBlog.title, canvas.width - 150);
    const firstStartY = 150 + (titleLines.length * 58) + 24 + 54;
    const otherStartY = 245;

    const pages = [];
    let cursor = 0;
    while (cursor < allLines.length) {
        const startY = pages.length === 0 ? firstStartY : otherStartY;
        const slice = allLines.slice(cursor);
        // temp assign to reuse capacity logic
        const prev = allLines.splice(0, allLines.length, ...slice);
        let take = pageCapacity(startY);
        allLines.splice(0, allLines.length, ...prev);
        if (take <= 0) take = 1;
        pages.push(allLines.slice(cursor, cursor + take));
        cursor += take;
    }

    const totalPages = Math.max(1, pages.length);

    function drawBase() {
        ctx.fillStyle = '#F5F1E8';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = '#D9D2C5';
        ctx.lineWidth = 24;
        ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);

        ctx.strokeStyle = '#C9C1B3';
        ctx.lineWidth = 1;
        ctx.strokeRect(45, 45, canvas.width - 90, canvas.height - 90);

        if (langName) {
            ctx.font = '600 13px Source Sans 3, sans-serif';
            const badgeWidth = ctx.measureText(langName).width + 24;
            ctx.fillStyle = 'rgba(139, 69, 19, 0.08)';
            ctx.beginPath();
            ctx.roundRect(canvas.width / 2 - badgeWidth / 2, 80, badgeWidth, 24, 12);
            ctx.fill();
            ctx.fillStyle = '#8B4513';
            ctx.textAlign = 'center';
            ctx.fillText(langName.toUpperCase(), canvas.width / 2, 96);
        }
    }

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
        drawBase();

        let contentStartY;
        if (pageIndex === 0) {
            ctx.fillStyle = '#2C2416';
            ctx.font = 'italic 500 46px Libre Baskerville, Georgia, serif';
            ctx.textAlign = 'center';
            let titleY = 150;
            titleLines.forEach((line) => {
                ctx.fillText(line, canvas.width / 2, titleY);
                titleY += 58;
            });

            ctx.font = '22px Source Sans 3, sans-serif';
            ctx.fillStyle = '#8B4513';
            ctx.fillText(`— ${currentBlog.author}`, canvas.width / 2, titleY + 24);
            contentStartY = titleY + 78;
        } else {
            ctx.fillStyle = '#2C2416';
            ctx.font = 'italic 500 30px Libre Baskerville, Georgia, serif';
            ctx.textAlign = 'center';
            const compactTitle = wrapText(ctx, currentBlog.title, canvas.width - 180)[0] || currentBlog.title;
            ctx.fillText(compactTitle, canvas.width / 2, 150);
            ctx.font = '500 14px Source Sans 3, sans-serif';
            ctx.fillStyle = '#8A7F6C';
            ctx.fillText(`continued`, canvas.width / 2, 180);
            contentStartY = otherStartY;
        }

        ctx.font = contentFont;
        ctx.fillStyle = '#2C2416';
        let y = contentStartY;
        pages[pageIndex].forEach((line) => {
            if (line === '') {
                y += lineHeight * 0.5;
            } else {
                ctx.fillText(line, canvas.width / 2, y);
                y += lineHeight;
            }
        });

        ctx.font = '14px Source Sans 3, sans-serif';
        ctx.fillStyle = '#8A7F6C';
        ctx.fillText(`bhushverse • ${pageIndex + 1}/${totalPages}`, canvas.width / 2, canvas.height - 45);

        const link = document.createElement('a');
        const safeTitle = makeDownloadFileName(currentBlog.title, 'blog');
        link.download = totalPages === 1
            ? `${safeTitle}.png`
            : `${safeTitle}-part-${pageIndex + 1}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        // small gap so multiple downloads trigger reliably
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 180));
    }

    showToast(totalPages === 1 ? 'Blog image downloaded!' : `${totalPages} blog images downloaded!`);
}

function updateGenericInteractionButtons(type, content) {
    const likeButton = document.getElementById(`${type}-like-btn`);
    const saveButton = document.getElementById(`${type}-save-btn`);
    const likeCount = document.getElementById(`${type}-like-count`);
    if (!likeButton || !saveButton || !likeCount || !content) return;

    likeCount.textContent = content.likeCount || 0;
    likeButton.classList.toggle('active', Boolean(content.likedByCurrentUser));
    saveButton.classList.toggle('active', Boolean(content.savedByCurrentUser));
    likeButton.querySelector('span').textContent = content.likedByCurrentUser ? 'Liked' : 'Like';
    saveButton.querySelector('span').textContent = content.savedByCurrentUser ? 'Saved' : 'Save';
}

async function toggleContentLike(contentType, contentId, event) {
    if (event) event.stopPropagation();
    if (!contentId || !ensureUserLoggedIn()) return;

    try {
        const response = await fetch(`${INTERACTIONS_API_URL}/${contentType}/${contentId}/like`, {
            method: 'POST',
            headers: getUserAuthHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to update like');

        if (contentType === 'poem') currentPoem = data;
        if (contentType === 'blog') currentBlog = data;
        updateGenericInteractionButtons(contentType, data);
        if (document.getElementById('profile-page').classList.contains('active')) await loadProfilePage();
        showToast(data.likedByCurrentUser ? 'Post liked' : 'Like removed');
    } catch (err) {
        showToast(err.message || 'Failed to update like');
    }
}

async function toggleContentSave(contentType, contentId, event) {
    if (event) event.stopPropagation();
    if (!contentId || !ensureUserLoggedIn()) return;

    try {
        const response = await fetch(`${INTERACTIONS_API_URL}/${contentType}/${contentId}/save`, {
            method: 'POST',
            headers: getUserAuthHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to update saved content');

        if (contentType === 'poem') currentPoem = data;
        if (contentType === 'blog') currentBlog = data;
        updateGenericInteractionButtons(contentType, data);
        if (document.getElementById('profile-page').classList.contains('active')) await loadProfilePage();
        showToast(data.savedByCurrentUser ? 'Post saved' : 'Post removed from saved');
    } catch (err) {
        showToast(err.message || 'Failed to update saved content');
    }
}

// ==================== Community & Profile ====================

function ensureUserLoggedIn() {
    if (isUserLoggedIn()) return true;
    showToast('Sign in to continue');
    openUserAuthModal('login');
    return false;
}

async function readJsonResponse(response, fallbackMessage = 'Request failed') {
    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();

    if (contentType.includes('application/json')) {
        try {
            return raw ? JSON.parse(raw) : {};
        } catch (_err) {
            throw new Error(fallbackMessage);
        }
    }

    if (raw.trim().startsWith('<!DOCTYPE') || raw.trim().startsWith('<html')) {
        throw new Error('The app returned HTML instead of API data. Restart or redeploy the backend.');
    }

    try {
        return raw ? JSON.parse(raw) : {};
    } catch (_err) {
        throw new Error(fallbackMessage);
    }
}

function buildProfileFromLegacyEndpoints(user, posts, followers, following, options = {}) {
    const isOwnProfile = options.isOwnProfile ?? Boolean(currentUser && user.id === currentUser.id);
    const baseUser = options.baseUser || null;
    return {
        user: {
            id: user.id,
            username: user.username || user.personalId || '',
            personalId: user.personalId || user.username || '',
            name: user.name || '',
            email: user.email || baseUser?.email || '',
            profilePicture: user.profilePicture || '',
            bio: user.bio || '',
            gender: user.gender || '',
            age: user.age ?? null,
            createdAt: user.createdAt,
            isFollowing: user.isFollowing ?? null
        },
        stats: {
            totalPosts: Number(user.postsCount || posts.length || 0),
            totalLikes: posts.reduce((sum, post) => sum + Number(post.likeCount || 0), 0),
            followersCount: Number(user.followersCount || followers.length || 0),
            followingCount: Number(user.followingCount || following.length || 0)
        },
        isOwnProfile,
        posts,
        followers,
        following,
        drafts: [],
        savedPosts: []
    };
}

async function fetchLegacyPublicProfile(userId, options = {}) {
    const encodedUserId = encodeURIComponent(userId);
    const [userResponse, followersResponse, followingResponse, postsResponse] = await Promise.all([
        fetch(`${USERS_API_URL}/${encodedUserId}`, { headers: getUserAuthHeaders(false) }),
        fetch(`${USERS_API_URL}/${encodedUserId}/followers`, { headers: getUserAuthHeaders(false) }),
        fetch(`${USERS_API_URL}/${encodedUserId}/following`, { headers: getUserAuthHeaders(false) }),
        fetch(COMMUNITY_API_URL, { headers: getUserAuthHeaders(false) })
    ]);

    const [user, followers, following, allPosts] = await Promise.all([
        readJsonResponse(userResponse, 'Failed to load profile'),
        readJsonResponse(followersResponse, 'Failed to load followers'),
        readJsonResponse(followingResponse, 'Failed to load following'),
        readJsonResponse(postsResponse, 'Failed to load posts')
    ]);

    if (!userResponse.ok) {
        throw new Error(user.error || 'Failed to load profile');
    }

    const posts = Array.isArray(allPosts) ? allPosts.filter((post) => post.authorId === userId) : [];
    return buildProfileFromLegacyEndpoints(
        user,
        posts,
        Array.isArray(followers) ? followers : [],
        Array.isArray(following) ? following : [],
        options
    );
}

async function fetchProfileData(targetUserId, isOwnProfile) {
    if (isOwnProfile) {
        try {
            const response = await fetch('/api/profile/me', {
                headers: getUserAuthHeaders(false)
            });
            const data = await readJsonResponse(response, 'Failed to load profile');
            if (!response.ok) {
                if (response.status === 401) {
                    logoutUser();
                    const authError = new Error(data.error || 'Please sign in again');
                    authError.status = 401;
                    throw authError;
                }
                let errorMessage = data.error || 'Failed to load profile';
                if (response.status === 404 && !data.error) errorMessage = 'Profile not found';
                const profileError = new Error(errorMessage);
                profileError.status = response.status;
                throw profileError;
            }
            return data;
        } catch (err) {
            if (err.status === 401) throw err;
            return fetchLegacyPublicProfile(targetUserId, {
                isOwnProfile: true,
                baseUser: currentUser
            });
        }
    }

    const encodedUserId = encodeURIComponent(targetUserId);
    try {
        const response = await fetch(`${USERS_API_URL}/${encodedUserId}/profile`, {
            headers: getUserAuthHeaders(false)
        });
        const data = await readJsonResponse(response, 'Failed to load profile');
        if (!response.ok) {
            let errorMessage = data.error || 'Failed to load profile';
            if (response.status === 404 && !data.error) errorMessage = 'Profile not found';
            throw new Error(errorMessage);
        }
        return data;
    } catch (err) {
        return fetchLegacyPublicProfile(targetUserId);
    }
}

function buildDetailUrl(param, id) {
    const url = new URL(window.location.href);
    url.searchParams.delete('poem');
    url.searchParams.delete('blog');
    url.searchParams.delete('post');
    url.searchParams.set(param, id);
    return url.toString();
}

function getProfileUrl(username) {
    return `/profile/${username}`;
}

function getPoemUrl(id) {
    return `/poem/${id}`;
}

function getBlogUrl(id) {
    return `/blog/${id}`;
}

function getCommunityPostUrl(id) {
    return `/community/post/${id}`;
}

function setDetailUrl(type, id) {
    let url;
    switch(type) {
        case 'poem':
            url = getPoemUrl(id);
            break;
        case 'blog':
            url = getBlogUrl(id);
            break;
        case 'post':
            url = getCommunityPostUrl(id);
            break;
        default:
            return;
    }
    history.replaceState({}, '', url);
}

function clearDetailUrls() {
    // Only clear if we're on a detail page
    const path = window.location.pathname;
    if (path.match(/^\/(poem|blog|community\/post)\//)) {
        // Get the base page
        if (path.startsWith('/community/post/')) {
            navigateTo('/community', false);
        } else if (path.startsWith('/poem/')) {
            navigateTo('/poems', false);
        } else if (path.startsWith('/blog/')) {
            navigateTo('/blogs', false);
        }
    }
}

function formatDateTime(dateString) {
    return normalizeDateValue(dateString).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function formatPostType(postType) {
    return postType === 'poetry' ? 'Poetry' : 'Blog';
}

function getContentBadgeLabel(item) {
    if (item.contentType === 'poem') return 'Poem';
    if (item.contentType === 'blog') return 'Blog';
    return formatPostType(item.postType);
}

function openContentItem(item) {
    if (item.contentType === 'poem') return showPoem(item.id);
    if (item.contentType === 'blog') return showBlogDetail(item.id);
    return showCommunityPost(item.id);
}

function openContentItemByType(contentType, id) {
    return openContentItem({ contentType, id });
}

function getLikeHandler(item) {
    if (item.contentType === 'poem' || item.contentType === 'blog') {
        return `toggleContentLike('${item.contentType}', '${item.id}', event)`;
    }
    return `togglePostLike('${item.id}', event)`;
}

function getSaveHandler(item) {
    if (item.contentType === 'poem' || item.contentType === 'blog') {
        return `toggleContentSave('${item.contentType}', '${item.id}', event)`;
    }
    return `togglePostSave('${item.id}', event)`;
}

function getShareHandler(item) {
    if (item.contentType === 'poem') return `event.stopPropagation(); copyToClipboard(buildDetailUrl('poem', '${item.id}'))`;
    if (item.contentType === 'blog') return `event.stopPropagation(); copyToClipboard(buildDetailUrl('blog', '${item.id}'))`;
    return `shareCommunityPost('${item.id}', event)`;
}

function renderCommunityAuthState() {
    const banner = document.getElementById('community-auth-banner');
    const composer = document.getElementById('community-composer');

    if (currentUser) {
        banner.innerHTML = `
            <p>Signed in as <strong>${escapeHtml(currentUser.name)}</strong>. Share poetry, blogs, and thoughtful writing with the community.</p>
        `;
        composer.style.display = 'block';
    } else {
        banner.innerHTML = `
            <p>Create an account or sign in to publish posts, like writing, and save posts to your profile.</p>
            <button type="button" class="btn btn-primary" onclick="openUserAuthModal('register')">Create Account</button>
        `;
        composer.style.display = 'none';
    }
}

function renderContentCard(item, options = {}) {
    const {
        footerActions = '',
        clickable = true,
        showDefaultActions = true
    } = options;
    const preview = escapeHtml(item.content).replace(/\n/g, '<br>');
    const linkUrl = `/community/post/${item.id}`;
    const clickHandler = clickable ? `onclick="navigateTo('${linkUrl}'); return false;"` : '';
    const isFollowing = item.authorIsFollowing;
    const showFollowBtn = currentUser && item.authorId && item.authorId !== currentUser?.id;
    const authorUsername = item.author?.username || '';
    const authorClickHandler = item.authorId ? `onclick="event.stopPropagation(); navigateTo('/profile/${authorUsername}'); return false;"` : '';
    
    return `
        <article class="community-card ${clickable ? 'community-card-clickable' : ''}" ${clickHandler}>
            <div class="community-card-header">
                <a href="/profile/${authorUsername}" class="community-author ${item.authorId ? 'profile-link-trigger' : ''}" ${authorClickHandler}>
                    <img class="community-author-avatar" src="${getAvatarSrc(item.author.profilePicture, item.author.name)}" alt="${escapeHtml(item.author.name)}">
                    <div class="community-author-meta">
                        <strong>${escapeHtml(item.author.name)}</strong>
                        <span>${item.author.personalId ? `@${escapeHtml(item.author.personalId)} • ` : ''}${formatDateTime(item.createdAt)}</span>
                    </div>
                </a>
                <div class="community-card-actions">
                    <span class="post-type-badge">${getContentBadgeLabel(item)}${item.status === 'draft' ? ' Draft' : ''}</span>
                    ${showFollowBtn ? `
                        <button class="follow-btn ${isFollowing ? 'following' : ''}" 
                                data-user-id="${item.authorId}" 
                                data-following="${isFollowing}"
                                onclick="event.stopPropagation(); toggleFollow('${item.authorId}', event)">
                            ${isFollowing 
                                ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Following'
                                : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg> Follow'}
                        </button>
                    ` : ''}
                </div>
            </div>
            <h3>${escapeHtml(item.title)}</h3>
            <p class="community-preview">${preview}</p>
            <div class="community-interactions">
                ${showDefaultActions ? `
                    <span class="community-stat">${item.likeCount} like${item.likeCount === 1 ? '' : 's'}</span>
                    <button class="community-action-btn ${item.likedByCurrentUser ? 'active' : ''}" onclick="${getLikeHandler(item)}">
                        ${item.likedByCurrentUser ? 'Liked' : 'Like'}
                    </button>
                    <button class="community-action-btn ${item.savedByCurrentUser ? 'active' : ''}" onclick="${getSaveHandler(item)}">
                        ${item.savedByCurrentUser ? 'Saved' : 'Save'}
                    </button>
                    <button class="community-action-btn" onclick="${getShareHandler(item)}">Share</button>
                ` : ''}
                ${footerActions}
            </div>
        </article>
    `;
}

function renderContentList(containerId, posts, emptyMessage, options = {}) {
    const container = document.getElementById(containerId);
    if (!posts.length) {
        container.innerHTML = `<div class="empty-state"><p>${emptyMessage}</p></div>`;
        return;
    }
    container.innerHTML = posts.map((post) => renderContentCard(post, options)).join('');
}

function renderDraftList(containerId, drafts, emptyMessage) {
    const container = document.getElementById(containerId);
    if (!drafts.length) {
        container.innerHTML = `<div class="empty-state"><p>${emptyMessage}</p></div>`;
        return;
    }
    container.innerHTML = drafts.map((draft) => renderContentCard(draft, {
        clickable: false,
        showDefaultActions: false,
        footerActions: `
            <button class="community-action-btn" onclick="editDraft('${draft.id}')">Edit</button>
            <button class="community-action-btn" onclick="publishDraft('${draft.id}')">Publish</button>
        `
    })).join('');
}

function switchCommunityFeed(type) {
    communityFeedType = type;
    document.querySelectorAll('[data-feed]').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.feed === type);
    });
    loadCommunityFeed();
}

async function loadCommunityFeed() {
    renderCommunityAuthState();
    const container = document.getElementById('community-feed');
    
    // Check if user wants following feed
    if (communityFeedType === 'following') {
        if (!currentUser) {
            container.innerHTML = '<div class="empty-state"><p>Please sign in to see posts from people you follow.</p></div>';
            return;
        }
        await loadFeed();
        return;
    }
    
    container.innerHTML = '<div class="loading">Loading community posts...</div>';

    try {
        const response = await fetch(COMMUNITY_API_URL, {
            headers: getUserAuthHeaders(false)
        });
        if (!response.ok) throw new Error('Failed to load posts');

        communityPostsList = await response.json();
        renderContentList('community-feed', communityPostsList, 'No community posts yet. Be the first to write.');
    } catch (err) {
        container.innerHTML = '<div class="empty-state"><p>Failed to load community posts.</p></div>';
    }
}

async function loadCommunityPost(id) {
    try {
        const response = await fetch(`${COMMUNITY_API_URL}/${id}`, {
            headers: getUserAuthHeaders(false)
        });
        if (!response.ok) throw new Error('Failed to load post');

        currentCommunityPost = await response.json();
        document.getElementById('community-post-type-badge').textContent = formatPostType(currentCommunityPost.postType);
        document.getElementById('community-post-title-display').textContent = currentCommunityPost.title;
        document.getElementById('community-post-author-avatar').src = getAvatarSrc(currentCommunityPost.author.profilePicture, currentCommunityPost.author.name);
        document.getElementById('community-post-author-name').textContent = currentCommunityPost.author.personalId
            ? `${currentCommunityPost.author.name} · @${currentCommunityPost.author.personalId}`
            : currentCommunityPost.author.name;
        document.getElementById('community-post-date').textContent = formatDateTime(currentCommunityPost.createdAt);
        document.getElementById('community-post-content-display').innerHTML = escapeHtml(currentCommunityPost.content).replace(/\n/g, '<br>');

        const likeButton = document.getElementById('community-detail-like-btn');
        const saveButton = document.getElementById('community-detail-save-btn');
        document.getElementById('community-detail-like-count').textContent = currentCommunityPost.likeCount;
        likeButton.classList.toggle('active', currentCommunityPost.likedByCurrentUser);
        saveButton.classList.toggle('active', currentCommunityPost.savedByCurrentUser);
        likeButton.querySelector('span').textContent = currentCommunityPost.likedByCurrentUser ? 'Liked' : 'Like';
        saveButton.querySelector('span').textContent = currentCommunityPost.savedByCurrentUser ? 'Saved' : 'Save';
        return true;
    } catch (err) {
        showToast('Failed to load post');
        return false;
    }
}

async function refreshCommunityViews(postId) {
    const activePage = document.querySelector('.page.active')?.id;
    if (activePage === 'community-page') await loadCommunityFeed();
    if (activePage === 'profile-page' && currentUser) await loadProfilePage();
    if (activePage === 'community-post-page' && postId) await loadCommunityPost(postId);
}

async function togglePostLike(id, event) {
    if (event) event.stopPropagation();
    if (!id || !ensureUserLoggedIn()) return;

    try {
        const response = await fetch(`${COMMUNITY_API_URL}/${id}/like`, {
            method: 'POST',
            headers: getUserAuthHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to update like');
        showToast(data.likedByCurrentUser ? 'Post liked' : 'Like removed');
        await refreshCommunityViews(id);
    } catch (err) {
        showToast(err.message || 'Failed to update like');
    }
}

async function togglePostSave(id, event) {
    if (event) event.stopPropagation();
    if (!id || !ensureUserLoggedIn()) return;

    try {
        const response = await fetch(`${COMMUNITY_API_URL}/${id}/save`, {
            method: 'POST',
            headers: getUserAuthHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to update saved post');
        showToast(data.savedByCurrentUser ? 'Post saved' : 'Post removed from saved');
        await refreshCommunityViews(id);
    } catch (err) {
        showToast(err.message || 'Failed to update saved post');
    }
}

async function toggleFollow(userId, event) {
    if (event) event.stopPropagation();
    if (!userId || !ensureUserLoggedIn()) return;
    if (userId === currentUser?.id) {
        showToast("You can't follow yourself");
        return;
    }

    const btn = event.target.closest('.follow-btn');
    if (btn) btn.disabled = true;

    try {
        const response = await fetch(`${USERS_API_URL}/${userId}/follow`, {
            method: 'POST',
            headers: getUserAuthHeaders()
        });
        const data = await readJsonResponse(response, 'Failed to update follow');
        if (!response.ok) throw new Error(data.error || 'Failed to update follow');
        
        showToast(data.following ? 'Following user' : 'Unfollowed user');
        
        // Update UI
        document.querySelectorAll(`.follow-btn[data-user-id="${userId}"]`).forEach(el => {
            el.classList.toggle('following', data.following);
            el.dataset.following = data.following;
            el.innerHTML = data.following 
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Following'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg> Follow';
        });

        if (document.getElementById('community-page').classList.contains('active')) {
            await loadCommunityFeed();
        }
        if (document.getElementById('profile-page').classList.contains('active') && currentUser) {
            await loadProfilePage();
        }
    } catch (err) {
        showToast(err.message || 'Failed to update follow');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function loadFeed() {
    if (!currentUser) {
        showToast('Please sign in to see your feed');
        switchCommunityFeed('all');
        return;
    }

    const container = document.getElementById('community-feed');
    container.innerHTML = '<div class="loading">Loading your feed...</div>';

    try {
        const response = await fetch('/api/community/feed', {
            headers: getUserAuthHeaders()
        });
        
        if (!response.ok) {
            const text = await response.text();
            if (text.startsWith('<')) {
                throw new Error('Server error. Please refresh the page.');
            }
            throw new Error('Failed to load feed');
        }

        const posts = await response.json();
        renderContentList('community-feed', posts, 'No posts from people you follow yet. Explore the community!');
    } catch (err) {
        console.error('Feed error:', err);
        container.innerHTML = '<div class="empty-state"><p>Failed to load feed. Please refresh the page.</p></div>';
    }
}

function shareCommunityPost(id, event) {
    if (event) event.stopPropagation();
    if (!id) return;
    copyToClipboard(buildDetailUrl('post', id));
}

function renderProfileGuestState() {
    const guestState = document.getElementById('profile-guest-state');
    const profileContent = document.getElementById('profile-content');
    activeProfileData = null;
    closeProfileModal();

    if (currentUser && !activeProfileUserId) {
        guestState.style.display = 'none';
        profileContent.style.display = 'block';
        return;
    }

    profileContent.style.display = 'none';
    guestState.style.display = 'block';
    guestState.innerHTML = `
        <p>Create an account or sign in to see your profile, followers, following, and posts.</p>
        <button type="button" class="btn btn-primary" onclick="openUserAuthModal('register')">Create Account</button>
    `;
}

function focusProfilePosts() {
    const grid = document.getElementById('profile-dynamic-list');
    if (grid) {
        grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function closeProfileModal() {
    document.getElementById('profile-list-modal').classList.remove('show');
}

async function openProfileConnections(type) {
    activeProfileListMode = type === 'following' ? 'following' : 'followers';
    if (!activeProfileData && document.getElementById('profile-page').classList.contains('active')) {
        await loadProfilePage();
    }
    if (!activeProfileData) {
        showToast('Profile is still loading');
        return;
    }
    const isFollowers = activeProfileListMode === 'followers';
    const users = Array.isArray(isFollowers ? activeProfileData.followers : activeProfileData.following)
        ? (isFollowers ? activeProfileData.followers : activeProfileData.following)
        : [];
    const profileName = activeProfileData.user.name || 'This writer';

    document.getElementById('profile-list-modal-title').textContent = isFollowers ? 'Followers' : 'Following';
    renderUserList(
        'profile-list-modal-body',
        users,
        isFollowers ? `${profileName} does not have followers yet.` : `${profileName} is not following anyone yet.`
    );
    document.getElementById('profile-list-modal').classList.add('show');
}

function toggleProfileEditPanel(forceValue) {
    profileEditOpen = typeof forceValue === 'boolean' ? forceValue : !profileEditOpen;
    const editCard = document.getElementById('profile-edit-card');
    if (!activeProfileData?.isOwnProfile) {
        editCard.style.display = 'none';
        return;
    }
    editCard.style.display = profileEditOpen ? 'block' : 'none';
    const toggleButton = document.getElementById('profile-edit-toggle-btn');
    if (toggleButton) toggleButton.textContent = profileEditOpen ? 'Close Edit' : 'Edit Profile';
}

function renderProfileHeaderActions(profileData) {
    const container = document.getElementById('profile-header-actions');
    if (profileData.isOwnProfile) {
        container.innerHTML = `
            <button type="button" class="profile-header-btn" id="profile-edit-toggle-btn" onclick="toggleProfileEditPanel()">
                ${profileEditOpen ? 'Close Edit' : 'Edit Profile'}
            </button>
        `;
        return;
    }

    if (profileData.user.isFollowing !== null) {
        container.innerHTML = `
            <button class="follow-btn ${profileData.user.isFollowing ? 'following' : ''}"
                    data-user-id="${profileData.user.id}"
                    data-following="${Boolean(profileData.user.isFollowing)}"
                    onclick="toggleFollow('${profileData.user.id}', event)">
                ${profileData.user.isFollowing
                    ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Following'
                    : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg> Follow'}
            </button>
        `;
        return;
    }

    container.innerHTML = '<button type="button" class="profile-header-btn" onclick="openUserAuthModal(\'login\')">Sign In to Follow</button>';
}

function renderProfilePostGrid(posts, emptyMessage) {
    const container = document.getElementById('profile-dynamic-list');
    if (!posts.length) {
        container.innerHTML = `<div class="empty-state profile-grid-empty"><p>${emptyMessage}</p></div>`;
        return;
    }

    container.innerHTML = posts.map((post) => {
        const excerpt = escapeHtml(post.content).replace(/\n/g, '<br>');
        return `
            <a href="/community/post/${post.id}" onclick="navigateTo('/community/post/${post.id}'); return false;" class="profile-post-tile">
                <div class="profile-post-tile-surface">
                    <span class="profile-post-type">${escapeHtml(formatPostType(post.postType))}</span>
                    <h3>${escapeHtml(post.title)}</h3>
                    <p>${excerpt}</p>
                </div>
                <div class="profile-post-overlay">
                    <span>${post.likeCount} like${post.likeCount === 1 ? '' : 's'}</span>
                    <span>${formatDate(post.createdAt)}</span>
                </div>
            </a>
        `;
    }).join('');
}

function renderUserList(containerId, users, emptyMessage) {
    const container = document.getElementById(containerId);
    if (!users.length) {
        container.innerHTML = `<div class="empty-state"><p>${emptyMessage}</p></div>`;
        return;
    }

    container.innerHTML = users.map((user) => {
        const canFollow = user.isFollowing !== null;
        const username = user.username || '';
        return `
            <a href="/profile/${username}" onclick="navigateTo('/profile/${username}'); return false;" class="profile-user-card">
                <div class="profile-user-card-main">
                    <img class="community-author-avatar" src="${getAvatarSrc(user.profilePicture, user.name)}" alt="${escapeHtml(user.name)}">
                    <div class="profile-user-copy">
                        <strong>${escapeHtml(user.name)}</strong>
                        <span>${user.personalId ? `@${escapeHtml(user.personalId)}` : 'Writer'}</span>
                        <p>${escapeHtml(user.bio || 'No bio yet.')}</p>
                    </div>
                </div>
                ${canFollow ? `
                    <button class="follow-btn ${user.isFollowing ? 'following' : ''}"
                            data-user-id="${user.id}"
                            data-following="${Boolean(user.isFollowing)}"
                            onclick="event.preventDefault(); event.stopPropagation(); toggleFollow('${user.id}', event)">
                        ${user.isFollowing
                            ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Following'
                            : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg> Follow'}
                    </button>
                ` : ''}
            </a>
        `;
    }).join('');
}

function renderProfilePageData(profileData) {
    const { user, stats } = profileData;
    const isOwnProfile = profileData.isOwnProfile;

    document.getElementById('profile-avatar-preview').src = getAvatarSrc(user.profilePicture, user.name);
    document.getElementById('profile-name').textContent = user.name || 'Profile';
    document.getElementById('profile-personal-id').textContent = user.username ? `@${user.username}` : '@writer';
    document.getElementById('profile-email').textContent = '';
    document.getElementById('profile-email').style.display = 'none';
    document.getElementById('profile-created-at').textContent = user.createdAt ? `Joined ${formatDate(user.createdAt)}` : '';
    document.getElementById('profile-bio-display').textContent = user.bio || (isOwnProfile ? 'Add a bio so people know what you write about.' : 'No bio yet.');
    document.getElementById('profile-meta-chips').innerHTML = [
        isOwnProfile && user.email ? `<span class="profile-meta-chip">${escapeHtml(user.email)}</span>` : '',
        user.gender ? `<span class="profile-meta-chip">${escapeHtml(user.gender)}</span>` : '',
        user.age ? `<span class="profile-meta-chip">${escapeHtml(String(user.age))} years</span>` : ''
    ].filter(Boolean).join('');

    const poetryPosts = profileData.posts.filter(p => p.postType === 'poetry');
    const blogPosts = profileData.posts.filter(p => p.postType === 'blog');
    profileData.poetryPosts = poetryPosts;
    profileData.blogPosts = blogPosts;
    profileData.statsPoetry = stats.totalPoems || poetryPosts.length;
    profileData.statsBlogs = stats.totalBlogs || blogPosts.length;

    document.getElementById('stat-total-posts').textContent = profileData.statsPoetry + profileData.statsBlogs;
    document.getElementById('stat-followers').textContent = stats.followersCount;
    document.getElementById('stat-following').textContent = stats.followingCount;

    document.querySelectorAll('.profile-grid-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === currentProfileTab);
    });

    renderProfileHeaderActions(profileData);
    const currentPosts = currentProfileTab === 'poetry' ? poetryPosts : blogPosts;
    const currentCount = currentProfileTab === 'poetry' ? profileData.statsPoetry : profileData.statsBlogs;
    document.getElementById('stat-total-posts').textContent = currentCount;
    const emptyMessage = currentProfileTab === 'poetry' 
        ? (isOwnProfile ? 'You have not published any poetry yet.' : `${user.name || 'This writer'} has not published any poetry yet.`)
        : (isOwnProfile ? 'You have not published any blogs yet.' : `${user.name || 'This writer'} has not published any blogs yet.`);
    renderProfilePostGrid(currentPosts, emptyMessage);

    document.getElementById('profile-bio').value = isOwnProfile ? (user.bio || '') : '';
    document.getElementById('profile-gender').value = isOwnProfile ? (user.gender || '') : '';
    document.getElementById('profile-age').value = isOwnProfile ? (user.age || '') : '';
    document.getElementById('profile-edit-card').style.display = isOwnProfile && profileEditOpen ? 'block' : 'none';
}

function switchProfileTab(tab) {
    currentProfileTab = tab;
    if (!activeProfileData) return;
    
    document.querySelectorAll('.profile-grid-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    
    const posts = tab === 'poetry' ? activeProfileData.poetryPosts : activeProfileData.blogPosts;
    const count = tab === 'poetry' ? activeProfileData.statsPoetry : activeProfileData.statsBlogs;
    document.getElementById('stat-total-posts').textContent = count;
    
    const isOwnProfile = activeProfileData.isOwnProfile;
    const user = activeProfileData.user;
    const emptyMessage = tab === 'poetry' 
        ? (isOwnProfile ? 'You have not published any poetry yet.' : `${user.name || 'This writer'} has not published any poetry yet.`)
        : (isOwnProfile ? 'You have not published any blogs yet.' : `${user.name || 'This writer'} has not published any blogs yet.`);
    renderProfilePostGrid(posts, emptyMessage);
}

async function loadProfilePage() {
    if (!currentUser && isUserLoggedIn()) {
        await loadCurrentUser();
    }

    const targetUserId = activeProfileUserId || currentUser?.id || null;
    if (!targetUserId) {
        renderProfileGuestState();
        return;
    }

    const guestState = document.getElementById('profile-guest-state');
    const profileContent = document.getElementById('profile-content');
    guestState.style.display = 'none';
    profileContent.style.display = 'block';

    try {
        const isOwnProfile = Boolean(currentUser && targetUserId === currentUser.id);
        const data = await fetchProfileData(targetUserId, isOwnProfile);
        activeProfileData = data;
        activeProfileUserId = data.user.id;
        communityDraftsList = data.drafts || [];

        if (data.isOwnProfile) {
            currentUser = data.user;
            pendingProfilePicture = null;
            updateUserAuthUI();
        }

        renderProfilePageData(data);
        if (document.getElementById('profile-list-modal').classList.contains('show')) {
            openProfileConnections(activeProfileListMode);
        }
    } catch (err) {
        activeProfileData = null;
        closeProfileModal();
        const guestState = document.getElementById('profile-guest-state');
        const profileContent = document.getElementById('profile-content');
        profileContent.style.display = 'none';
        guestState.style.display = 'block';
        guestState.innerHTML = `<p>${escapeHtml(err.message || 'Failed to load profile')}</p>`;
        showToast(err.message || 'Failed to load profile');
    }
}

function resetCommunityComposer() {
    const form = document.getElementById('community-post-form');
    form.reset();
    document.getElementById('community-post-id').value = '';
    document.getElementById('community-post-language').value = 'english';
    document.getElementById('community-form-title').textContent = 'Write Something';
    document.getElementById('community-form-cancel').style.display = 'none';
}

async function saveCommunityPost(status) {
    if (!ensureUserLoggedIn()) return false;

    const id = document.getElementById('community-post-id').value;
    const payload = {
        title: document.getElementById('community-post-title').value.trim(),
        content: document.getElementById('community-post-content').value.trim(),
        postType: document.getElementById('community-post-type').value,
        language: document.getElementById('community-post-language').value,
        status
    };

    try {
        const response = await fetch(id ? `${COMMUNITY_API_URL}/${id}` : COMMUNITY_API_URL, {
            method: id ? 'PUT' : 'POST',
            headers: getUserAuthHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to save post');

        resetCommunityComposer();
        if (status === 'draft') {
            showToast(id ? 'Draft updated' : 'Draft saved');
            await loadProfilePage();
        } else {
            showToast(id ? 'Post updated' : 'Post published');
            await loadCommunityFeed();
            await loadProfilePage();
        }
        return true;
    } catch (err) {
        showToast(err.message || 'Failed to save post');
        return false;
    }
}

function saveCommunityDraft() {
    saveCommunityPost('draft');
}

async function editDraft(id) {
    if (!ensureUserLoggedIn()) return;
    try {
        const response = await fetch(`${COMMUNITY_API_URL}/${id}`, {
            headers: getUserAuthHeaders(false)
        });
        const draft = await response.json();
        if (!response.ok) throw new Error(draft.error || 'Failed to load draft');

        showCommunity();
        document.getElementById('community-post-id').value = draft.id;
        document.getElementById('community-post-title').value = draft.title;
        document.getElementById('community-post-type').value = draft.postType;
        document.getElementById('community-post-language').value = draft.language || 'english';
        document.getElementById('community-post-content').value = draft.content;
        document.getElementById('community-form-title').textContent = 'Edit Draft';
        document.getElementById('community-form-cancel').style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
        showToast(err.message || 'Failed to load draft');
    }
}

async function publishDraft(id) {
    if (!ensureUserLoggedIn()) return;
    try {
        const response = await fetch(`${COMMUNITY_API_URL}/${id}`, {
            headers: getUserAuthHeaders(false)
        });
        const draft = await response.json();
        if (!response.ok) throw new Error(draft.error || 'Failed to load draft');

        const publishResponse = await fetch(`${COMMUNITY_API_URL}/${id}`, {
            method: 'PUT',
            headers: getUserAuthHeaders(),
            body: JSON.stringify({
                title: draft.title,
                content: draft.content,
                postType: draft.postType,
                language: draft.language || 'english',
                status: 'published'
            })
        });
        const published = await publishResponse.json();
        if (!publishResponse.ok) throw new Error(published.error || 'Failed to publish draft');

        showToast('Draft published');
        await loadProfilePage();
        if (document.getElementById('community-page').classList.contains('active')) await loadCommunityFeed();
    } catch (err) {
        showToast(err.message || 'Failed to publish draft');
    }
}

function setupCommunityPostForm() {
    const form = document.getElementById('community-post-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveCommunityPost('published');
    });
}

function setupProfilePictureInput() {
    const input = document.getElementById('profile-picture-input');
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 1024 * 1024) {
            showToast('Please choose an image smaller than 1MB');
            input.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            pendingProfilePicture = reader.result;
            document.getElementById('profile-avatar-preview').src = pendingProfilePicture;
        };
        reader.readAsDataURL(file);
    });
}

function setupProfileForm() {
    const form = document.getElementById('profile-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!ensureUserLoggedIn()) return;

        const payload = {
            bio: document.getElementById('profile-bio').value.trim(),
            gender: document.getElementById('profile-gender').value.trim(),
            age: document.getElementById('profile-age').value.trim(),
            profilePicture: pendingProfilePicture || currentUser?.profilePicture || ''
        };

        try {
            const response = await fetch('/api/profile/me', {
                method: 'PUT',
                headers: getUserAuthHeaders(),
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to save profile');

            currentUser = data.user;
            pendingProfilePicture = null;
            updateUserAuthUI();
            showToast('Profile updated');
            await loadProfilePage();
        } catch (err) {
            showToast(err.message || 'Failed to save profile');
        }
    });
}

function setupUserAuthForms() {
    const loginForm = document.getElementById('user-login-form');
    const registerForm = document.getElementById('user-register-form');
    const errorEl = document.getElementById('user-auth-error');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.textContent = '';
        try {
            const response = await fetch(`${AUTH_API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: document.getElementById('user-login-username').value.trim(),
                    password: document.getElementById('user-login-password').value
                })
            });
            const data = await readJsonResponse(response, 'Failed to sign in');
            if (!response.ok) throw new Error(data.error || 'Failed to sign in');
            loginForm.reset();
            applyUserSession(data, 'Signed in successfully');
        } catch (err) {
            errorEl.textContent = err.message || 'Failed to sign in';
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.textContent = '';
        try {
            const response = await fetch(`${AUTH_API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: document.getElementById('user-register-name').value.trim(),
                    email: document.getElementById('user-register-email').value.trim(),
                    username: document.getElementById('user-register-username').value.trim(),
                    password: document.getElementById('user-register-password').value,
                    verificationCode: document.getElementById('user-register-code').value.trim()
                })
            });
            const data = await readJsonResponse(response, 'Failed to create account');
            if (!response.ok) throw new Error(data.error || 'Failed to create account');
            registerForm.reset();
            applyUserSession(data, 'Account created successfully');
        } catch (err) {
            errorEl.textContent = err.message || 'Failed to create account';
        }
    });
}

async function sendVerificationCode() {
    const emailInput = document.getElementById('user-register-email');
    const email = emailInput.value.trim();
    const errorEl = document.getElementById('user-auth-error');
    const sendBtn = document.getElementById('send-code-btn');
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errorEl.textContent = 'Please enter a valid email address';
        return;
    }
    
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    errorEl.textContent = '';
    
    try {
        const response = await fetch(`${AUTH_API_URL}/send-verification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await readJsonResponse(response, 'Failed to send code');
        if (!response.ok) throw new Error(data.error || 'Failed to send code');
        
        document.getElementById('sent-email').textContent = data.email;
        document.getElementById('code-sent-msg').style.display = 'block';
        document.getElementById('register-step-1').style.display = 'none';
        document.getElementById('register-step-2').style.display = 'block';
        document.getElementById('user-register-code').focus();
    } catch (err) {
        errorEl.textContent = err.message || 'Failed to send verification code';
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Verification Code';
    }
}

function showEmailStep() {
    document.getElementById('register-step-1').style.display = 'block';
    document.getElementById('register-step-2').style.display = 'none';
    document.getElementById('code-sent-msg').style.display = 'none';
    document.getElementById('user-auth-error').textContent = '';
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
    copyToClipboard(buildDetailUrl('poem', currentPoem.id));
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard')).catch(() => showToast('Failed to copy'));
}

async function downloadPoemAsImage() {
    if (!currentPoem) return;
    const canvas = document.getElementById('poem-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1080; canvas.height = 1350;
    
    // Paper theme colors
    ctx.fillStyle = '#F5F1E8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Border
    ctx.strokeStyle = '#D9D2C5';
    ctx.lineWidth = 24;
    ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);
    
    // Inner border
    ctx.strokeStyle = '#C9C1B3';
    ctx.lineWidth = 1;
    ctx.strokeRect(45, 45, canvas.width - 90, canvas.height - 90);
    
    const langName = LANGUAGES[currentPoem.language]?.name || '';
    if (langName) {
        ctx.font = '600 13px Source Sans 3, sans-serif';
        const badgeWidth = ctx.measureText(langName).width + 24;
        ctx.fillStyle = 'rgba(139, 69, 19, 0.08)';
        ctx.beginPath(); ctx.roundRect(canvas.width/2 - badgeWidth/2, 80, badgeWidth, 24, 12); ctx.fill();
        ctx.fillStyle = '#8B4513';
        ctx.textAlign = 'center';
        ctx.fillText(langName.toUpperCase(), canvas.width/2, 96);
    }
    
    ctx.fillStyle = '#2C2416';
    ctx.font = 'italic 500 48px Libre Baskerville, Georgia, serif';
    ctx.textAlign = 'center';
    const titleLines = wrapText(ctx, currentPoem.title, canvas.width - 140);
    let titleY = currentPoem.language !== 'english' ? 170 : 150;
    titleLines.forEach(line => { ctx.fillText(line, canvas.width / 2, titleY); titleY += 60; });
    
    ctx.font = '22px Source Sans 3, sans-serif';
    ctx.fillStyle = '#8B4513';
    ctx.fillText(`— ${currentPoem.author}`, canvas.width / 2, titleY + 25);
    
    let contentFont = '26px Lora, Georgia, serif';
    if (currentPoem.language === 'hindi' || currentPoem.language === 'marathi') contentFont = '400 28px Hind, sans-serif';
    ctx.font = contentFont; ctx.fillStyle = '#2C2416';
    
    const lines = currentPoem.content.split('\n');
    let y = titleY + 80; const lineHeight = currentPoem.language === 'english' ? 44 : 50;
    lines.forEach(line => {
        if (line.trim() === '') y += lineHeight * 0.5;
        else { const wrappedLines = wrapText(ctx, line, 800); wrappedLines.forEach(w => { ctx.fillText(w, canvas.width / 2, y); y += lineHeight; }); }
    });
    
    ctx.font = '14px Source Sans 3, sans-serif'; ctx.fillStyle = '#8A7F6C';
    ctx.fillText('bhushverse', canvas.width / 2, canvas.height - 50);
    
    const link = document.createElement('a');
    link.download = `${makeDownloadFileName(currentPoem.title, 'poem')}.png`;
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

document.getElementById('user-auth-modal').addEventListener('click', (e) => {
    if (e.target.id === 'user-auth-modal') closeUserAuthModal();
});

document.getElementById('profile-list-modal').addEventListener('click', (e) => {
    if (e.target.id === 'profile-list-modal') closeProfileModal();
});

// ==================== Utilities ====================

function formatDate(dateString) {
    const normalizedDate = normalizeDateValue(dateString);
    return normalizedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function normalizeDateValue(value) {
    const numericValue = Number(value);
    if (!Number.isNaN(numericValue) && String(value).trim() !== '' && numericValue < 1000000000000) {
        return new Date(numericValue * 1000);
    }
    return new Date(value);
}

function makeDownloadFileName(title, fallback = 'download') {
    const cleaned = String(title || '')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '');
    return cleaned || fallback;
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
    // Initialize router
    initRouter();
    
    // Handle admin param
    const urlParams = new URLSearchParams(window.location.search);
    if (window.location.hash === '#admin' || urlParams.get('admin') === 'true') {
        window.location.hash = ''; 
        navigateTo('/admin');
    }
    
    setupPoemForm();
    setupBlogForm();
    setupCommunityPostForm();
    setupProfileForm();
    setupUserAuthForms();
    setupProfilePictureInput();
    initGoogleAuth();
    loadCurrentUser().then(() => {
        renderCommunityAuthState();
        renderProfileGuestState();
    });
});
