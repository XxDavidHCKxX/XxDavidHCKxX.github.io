// ═══════════════════════════════════════════════════════════════════════
// AttackHub – Attack page UI logic (separated from app.js)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Switch between L4 (IP) and L7 (URL) pill tabs and sections.
 */
function switchAttackTab(mode) {
    currentMode = mode;

    // Update pill tabs
    document.querySelectorAll('.atk-pill-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    // Toggle sections
    const ipSection = document.getElementById('ipSection');
    const urlSection = document.getElementById('urlSection');
    const ipHistory = document.getElementById('ipHistoryCard');
    const urlHistory = document.getElementById('urlHistoryCard');

    if (ipSection) ipSection.style.display = mode === 'ip' ? '' : 'none';
    if (urlSection) urlSection.style.display = mode === 'url' ? '' : 'none';
    if (ipHistory) ipHistory.style.display = mode === 'ip' ? '' : 'none';
    if (urlHistory) urlHistory.style.display = mode === 'url' ? '' : 'none';

    // Update tool card header
    const toolIcon = document.getElementById('toolIcon');
    const toolTitle = document.getElementById('toolTitle');
    const toolDesc = document.getElementById('toolDesc');

    if (mode === 'ip') {
        if (toolIcon) toolIcon.textContent = '⚡';
        if (toolTitle) toolTitle.textContent = 'Layer 4 Attack';
        if (toolDesc) toolDesc.textContent = 'Send network stress tests to an IP address using L4 protocols.';
    } else {
        if (toolIcon) toolIcon.textContent = '🌐';
        if (toolTitle) toolTitle.textContent = 'Layer 7 Attack';
        if (toolDesc) toolDesc.textContent = 'Send HTTP-based stress tests to a URL target.';
    }
}

/**
 * Show empty state in history when no rows exist.
 */
function updateEmptyState(mode) {
    const bodyId = mode === 'ip' ? 'ipHistoryBody' : 'urlHistoryBody';
    const emptyId = mode === 'ip' ? 'ipEmptyState' : 'urlEmptyState';
    const body = document.getElementById(bodyId);
    const empty = document.getElementById(emptyId);
    if (!body || !empty) return;

    const hasRows = body.querySelectorAll('tr').length > 0;
    empty.style.display = hasRows ? 'none' : '';
}

/**
 * Set active state on sidebar nav item.
 */
function setActiveSidebarItem(page) {
    document.querySelectorAll('.atk-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
}

/**
 * Update user info in sidebar from localStorage.
 */
function updateSidebarUser() {
    const user = localStorage.getItem('ah_user') || 'Usuario';
    const nameEl = document.getElementById('sidebarUserName');
    const avatarEl = document.getElementById('sidebarUserAvatar');
    if (nameEl) nameEl.textContent = user;
    if (avatarEl) avatarEl.textContent = user.charAt(0).toUpperCase();
}

/**
 * Initialize the attack page UI.
 */
function initAttackPageUI() {
    setActiveSidebarItem('attack');
    updateSidebarUser();
    switchAttackTab('ip');

    // After history loads, check empty state
    setTimeout(() => {
        updateEmptyState('ip');
        updateEmptyState('url');
    }, 500);
}
