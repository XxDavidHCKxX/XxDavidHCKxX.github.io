// =======================================================================
// AttackHub - Admin Panel Logic (C# Desktop Style + Firebase)
// =======================================================================

let adminCurrentUser = null;
let adminAllPresence = {};

function initAdminPanel() {
    console.log('[Admin] Initializing admin panel...');

    // Populate role select based on current user's role
    var role = localStorage.getItem('ah_role') || 'user';
    var roleSelect = document.getElementById('adminCreateRole');
    if (roleSelect) {
        if (role === 'creator') {
            roleSelect.innerHTML = '<option value="user">User</option><option value="admin">Admin</option><option value="creator">Creator</option>';
        } else {
            roleSelect.innerHTML = '<option value="user">User</option>';
        }
    }

    // Show creator lockdown controls in Actions section
    if (role === 'creator') {
        var userLockdown = document.getElementById('adminUserLockdown');
        if (userLockdown) userLockdown.style.display = '';
        checkLockdownStatus();
    }

    try {
        // Listen for online users (real-time)
        fbListenOnlineUsers(function(onlineUsers) {
            renderOnlineUsers(onlineUsers);
            adminAllPresence = {};
            onlineUsers.forEach(function(u) { adminAllPresence[u.username] = true; });
            var countEl = document.getElementById('adminOnlineCount');
            var badgeEl = document.getElementById('adminOnlineBadge');
            if (countEl) countEl.textContent = onlineUsers.length + ' online';
            if (badgeEl) badgeEl.textContent = onlineUsers.length;
        });

        // Listen for all users (real-time)
        fbGetAllUsers(function(users) {
            renderAllUsersTable(users);
            var totalEl = document.getElementById('adminTotalUsers');
            if (totalEl) totalEl.textContent = users.length;
        });

        // Refresh online users every 5 seconds
        setInterval(function() {
            fbListenOnlineUsers(function(onlineUsers) {
                renderOnlineUsers(onlineUsers);
                adminAllPresence = {};
                onlineUsers.forEach(function(u) { adminAllPresence[u.username] = true; });
                var countEl = document.getElementById('adminOnlineCount');
                var badgeEl = document.getElementById('adminOnlineBadge');
                if (countEl) countEl.textContent = onlineUsers.length + ' online';
                if (badgeEl) badgeEl.textContent = onlineUsers.length;
            });
        }, 5000);
    } catch(e) {
        console.warn('[Admin] Firebase not available:', e.message);
        var onlineList = document.getElementById('adminOnlineList');
        if (onlineList) onlineList.innerHTML = '<div class="adm-listbox-empty">Firebase not connected. Check config.</div>';
    }

    // Enter key on search
    var input = document.getElementById('adminSearchInput');
    if (input) {
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') adminSearchUser();
        });
    }
}

// == Search user ==
function adminSearchUser() {
    var query = (document.getElementById('adminSearchInput').value || '').trim().toLowerCase();
    if (!query) return;

    var resultEl = document.getElementById('adminSearchResult');
    resultEl.style.display = 'none';

    fbRef('users/' + query).once('value').then(function(snap) {
        if (snap.exists()) {
            showUserResult(query, snap.val());
        } else {
            fbSearchUser(query, function(results) {
                if (results.length > 0) {
                    showUserResult(results[0].key, results[0]);
                } else {
                    resultEl.style.display = 'block';
                    resultEl.innerHTML = '<div class="adm-groupbox" style="margin-top:12px;text-align:center;color:#f85149;padding:20px;">User "' + escHtml(query) + '" not found</div>';
                }
            });
        }
    });
}

function showUserResult(username, userData) {
    adminCurrentUser = { username: username, role: userData.role, plan: userData.plan, banned: userData.banned, createdAt: userData.createdAt };
    var resultEl = document.getElementById('adminSearchResult');
    resultEl.style.display = 'block';

    // Avatar + Name
    document.getElementById('adminResAvatar').textContent = username.charAt(0).toUpperCase();
    document.getElementById('adminResName').textContent = username;

    // PropertyGrid values
    var el = document.getElementById('adminPropName');
    if (el) el.textContent = username;

    // Role
    var role = userData.role || 'user';
    var roleEl = document.getElementById('adminResRole');
    var roleIcon = role === 'creator' ? '\u2B50' : (role === 'admin' ? '\u2605' : '');
    roleEl.textContent = roleIcon + (roleIcon ? ' ' : '') + role.charAt(0).toUpperCase() + role.slice(1);
    roleEl.className = 'adm-badge adm-badge-role' + (role === 'user' ? ' user' : '');

    var propRole = document.getElementById('adminPropRole');
    if (propRole) {
        var roleHtml = role === 'creator' 
            ? '<span style="color:#f59e0b;">\u2B50 Creator</span>'
            : (role === 'admin' ? '<span style="color:#d29922;">\u2605 Admin</span>' : '<span style="color:#8b949e;">User</span>');
        propRole.innerHTML = roleHtml;
    }

    // Plan
    var planEl = document.getElementById('adminResPlan');
    if (planEl) planEl.innerHTML = '<span style="color:#bc8cff;">\u2B50 ' + escHtml(userData.plan || 'Free') + '</span>';

    // Plan Expiry
    var expiryEl = document.getElementById('adminResPlanExpiry');
    var expiryInfoEl = document.getElementById('adminPlanExpiryInfo');
    if (expiryEl) {
        if (userData.planExpiresAt && typeof userData.planExpiresAt === 'number') {
            var expiryDate = new Date(userData.planExpiresAt);
            var remaining = userData.planExpiresAt - Date.now();
            if (remaining <= 0) {
                expiryEl.innerHTML = '<span style="color:#f85149;">\u26A0 EXPIRED ' + expiryDate.toLocaleString() + '</span>';
                if (expiryInfoEl) expiryInfoEl.innerHTML = '<span style="color:#f85149;">\u26A0 Plan expired! User reverted to Free.</span>';
            } else {
                var daysLeft = Math.ceil(remaining / (24*60*60*1000));
                expiryEl.innerHTML = '<span style="color:#d29922;">' + expiryDate.toLocaleString() + ' (' + daysLeft + 'd left)</span>';
                if (expiryInfoEl) expiryInfoEl.innerHTML = '\u23F0 Expires: ' + expiryDate.toLocaleString() + ' (' + daysLeft + ' days left)';
            }
        } else {
            expiryEl.innerHTML = '<span style="color:#3fb950;">\u221E No expiry</span>';
            if (expiryInfoEl) expiryInfoEl.textContent = '';
        }
    }

    // IP Address
    var ipEl = document.getElementById('adminResIP');
    if (ipEl) ipEl.innerHTML = userData.lastIP ? '<span style="color:#06b6d4;">' + escHtml(userData.lastIP) + '</span>' : '<span style="color:#484f58;">Unknown</span>';

    // Banned
    var banned = userData.banned || false;
    var bannedEl = document.getElementById('adminResBanned');
    if (bannedEl) bannedEl.innerHTML = banned ? '<span style="color:#f85149;">\uD83D\uDD34 BANNED</span>' : '<span style="color:#3fb950;">\uD83D\uDFE2 No</span>';

    // Ban / Unban buttons
    var banBtn = document.getElementById('adminBanBtn');
    var unbanBtn = document.getElementById('adminUnbanBtn');
    if (banned) {
        banBtn.style.display = 'none';
        unbanBtn.style.display = 'inline-flex';
    } else {
        banBtn.style.display = 'inline-flex';
        unbanBtn.style.display = 'none';
    }

    // Lockdown Exempt buttons (creator only)
    var currentRole = localStorage.getItem('ah_role') || 'user';
    var lockdownExempt = userData.lockdownExempt || false;
    var lockdownExemptBtn = document.getElementById('adminLockdownExemptBtn');

    // Show/hide lockdown exempt row and button (creator only)
    var lockdownExemptRow = document.getElementById('adminResLockdownExemptRow');
    var lockdownExemptVal = document.getElementById('adminResLockdownExempt');
    if (currentRole === 'creator') {
        if (lockdownExemptRow) lockdownExemptRow.style.display = '';
        if (lockdownExemptVal) {
            lockdownExemptVal.innerHTML = lockdownExempt
                ? '<span style="color:#3fb950;">&#9989; Yes — can bypass lockdown</span>'
                : '<span style="color:#8b949e;">&#10060; No</span>';
        }
        if (lockdownExemptBtn) {
            lockdownExemptBtn.style.display = '';
            lockdownExemptBtn.innerHTML = lockdownExempt
                ? '&#128274; Remove Lockdown Bypass from this User'
                : '&#128275; Grant Lockdown Bypass to this User';
            lockdownExemptBtn.style.background = lockdownExempt ? 'linear-gradient(135deg,#7f1d1d,#dc2626)' : 'linear-gradient(135deg,#3b1f6e,#8b5cf6)';
        }
    } else {
        if (lockdownExemptRow) lockdownExemptRow.style.display = 'none';
        if (lockdownExemptBtn) lockdownExemptBtn.style.display = 'none';
    }

    // Plan select
    var planSelect = document.getElementById('adminPlanSelect');
    planSelect.value = userData.plan || 'Free';

    // Created
    var createdEl = document.getElementById('adminResCreated');
    if (createdEl) createdEl.textContent = userData.createdAt ? new Date(userData.createdAt).toLocaleString() : '\u2014';

    // Get live presence
    fbGetPresence(username, function(pres) {
        var statusBadge = document.getElementById('adminResStatus');
        var propStatus = document.getElementById('adminPropStatus');
        if (pres.online) {
            statusBadge.textContent = '\u25CF Online';
            statusBadge.className = 'adm-badge adm-badge-online';
            if (propStatus) propStatus.innerHTML = '<span style="color:#3fb950;">\u25CF Online</span>';
        } else {
            statusBadge.textContent = '\u25CF Offline';
            statusBadge.className = 'adm-badge adm-badge-offline';
            if (propStatus) propStatus.innerHTML = '<span style="color:#484f58;">\u25CF Offline</span>';
        }

        var lastSeenEl = document.getElementById('adminResLastSeen');
        if (lastSeenEl) lastSeenEl.textContent = pres.lastSeen ? timeAgo(pres.lastSeen) : '\u2014';

        var activeEl = document.getElementById('adminResActiveTime');
        if (activeEl) {
            if (pres.online && pres.loginAt && typeof pres.loginAt === 'number') {
                var diff = Date.now() - pres.loginAt;
                if (diff < 1000) diff = 1000;
                activeEl.innerHTML = '<span style="color:#3fb950;">' + formatDuration(diff) + '</span>';
            } else {
                activeEl.textContent = '\u2014';
            }
        }
    });

    // Load sessions
    fbGetUserSessions(username, function(sessions) {
        renderUserSessions(sessions);
    });
}

// == Ban / Unban ==
function adminToggleBan() {
    if (!adminCurrentUser) return;
    var currentLoggedIn = localStorage.getItem('ah_user');
    if (adminCurrentUser.username === currentLoggedIn) {
        showToast('\u26D4 You cannot ban yourself.', 'error');
        return;
    }
    if (adminCurrentUser.role === 'admin' || adminCurrentUser.role === 'creator') {
        showToast('\u26D4 You cannot ban another admin or creator.', 'error');
        return;
    }
    var newBanned = !(adminCurrentUser.banned || false);
    fbBanUser(adminCurrentUser.username, newBanned).then(function() {
        adminCurrentUser.banned = newBanned;
        showUserResult(adminCurrentUser.username, adminCurrentUser);
        showToast((newBanned ? '\uD83D\uDEAB ' : '\u2705 ') + adminCurrentUser.username + (newBanned ? ' has been banned' : ' has been unbanned'), newBanned ? 'error' : 'success');
    });
}

// == Kick User (close all sessions, force logout) ==
function adminKickUser() {
    if (!adminCurrentUser) return;
    var currentLoggedIn = localStorage.getItem('ah_user');
    if (adminCurrentUser.username === currentLoggedIn) {
        showToast('\u26D4 You cannot kick yourself.', 'error');
        return;
    }
    var currentRole = localStorage.getItem('ah_role') || 'user';
    if (currentRole !== 'creator' && (adminCurrentUser.role === 'admin' || adminCurrentUser.role === 'creator')) {
        showToast('\u26D4 Only creator can kick admins/creators.', 'error');
        return;
    }
    if (!confirm('Kick "' + adminCurrentUser.username + '" from ALL devices?')) return;

    var username = adminCurrentUser.username;
    Promise.all([
        fbRef('presence/' + username).set({ online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP, kicked: true }),
        fbRef('sessions/' + username).orderByChild('logoutAt').equalTo(null).once('value').then(function(snap) {
            var updates = {};
            snap.forEach(function(child) {
                updates[child.key + '/logoutAt'] = firebase.database.ServerValue.TIMESTAMP;
            });
            return fbRef('sessions/' + username).update(updates);
        })
    ]).then(function() {
        showToast('\u26A1 Kicked ' + username + ' from all devices', 'success');
        adminSearchUser();
    }).catch(function(err) {
        showToast('Error: ' + err.message, 'error');
    });
}

// == Delete User (admin only, cannot delete admins/creators) ==
function adminDeleteUser() {
    if (!adminCurrentUser) return;
    var currentLoggedIn = localStorage.getItem('ah_user');
    if (adminCurrentUser.username === currentLoggedIn) {
        showToast('\u26D4 You cannot delete your own account from here.', 'error');
        return;
    }
    if (adminCurrentUser.role === 'admin' || adminCurrentUser.role === 'creator') {
        showToast('\u26D4 You cannot delete another admin or creator account.', 'error');
        return;
    }
    if (!confirm('Are you sure you want to permanently delete the account "' + adminCurrentUser.username + '"? This cannot be undone!')) return;

    var username = adminCurrentUser.username;
    Promise.all([
        fbRef('users/' + username).remove(),
        fbRef('presence/' + username).remove(),
        fbRef('sessions/' + username).remove()
    ]).then(function() {
        adminCurrentUser = null;
        document.getElementById('adminSearchResult').style.display = 'none';
        document.getElementById('adminSearchInput').value = '';
        showToast('\uD83D\uDDD1 Account "' + username + '" deleted permanently.', 'success');
    }).catch(function(err) {
        showToast('Error deleting user: ' + err.message, 'error');
    });
}

// == Set Plan (with expiration) ==
function adminSetPlan() {
    if (!adminCurrentUser) return;
    var plan = document.getElementById('adminPlanSelect').value;
    var expiryDays = parseInt(document.getElementById('adminPlanExpiry').value) || 0;
    var updates = { plan: plan };
    if (expiryDays > 0) {
        updates.planExpiresAt = Date.now() + (expiryDays * 24 * 60 * 60 * 1000);
    } else {
        updates.planExpiresAt = null;
    }
    fbRef('users/' + adminCurrentUser.username).update(updates).then(function() {
        adminCurrentUser.plan = plan;
        adminCurrentUser.planExpiresAt = updates.planExpiresAt;
        showUserResult(adminCurrentUser.username, adminCurrentUser);
        var msg = '\u2B50 Plan set to ' + plan + ' for ' + adminCurrentUser.username;
        if (expiryDays > 0) msg += ' (expires in ' + expiryDays + ' days)';
        showToast(msg, 'success');
    });
}

// == Change Password (admin) ==
async function adminChangePassword() {
    if (!adminCurrentUser) return;
    var newPass = document.getElementById('adminNewPass').value;
    if (!newPass || newPass.length < 4) { showToast('Password must be at least 4 characters.', 'error'); return; }

    var encoder = new TextEncoder();
    var data = encoder.encode(newPass + '_attackhub_salt');
    var hash = await crypto.subtle.digest('SHA-256', data);
    var passHash = Array.from(new Uint8Array(hash)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');

    fbRef('users/' + adminCurrentUser.username).update({ passwordHash: passHash }).then(function() {
        document.getElementById('adminNewPass').value = '';
        showToast('\uD83D\uDD12 Password changed for ' + adminCurrentUser.username, 'success');
    }).catch(function(err) {
        showToast('Error: ' + err.message, 'error');
    });
}

// == Change Username (admin) ==
async function adminChangeUsername() {
    if (!adminCurrentUser) return;
    var newName = (document.getElementById('adminNewUsername').value || '').trim().toLowerCase();
    if (!newName) { showToast('Enter a new username.', 'error'); return; }
    if (newName.length < 3) { showToast('Username must be at least 3 characters.', 'error'); return; }
    if (newName.length > 20) { showToast('Username max 20 characters.', 'error'); return; }
    if (!/^[a-z0-9_]+$/.test(newName)) { showToast('Only lowercase letters, numbers, underscore.', 'error'); return; }
    var oldName = adminCurrentUser.username;
    if (newName === oldName) { showToast('Same username.', 'error'); return; }

    // Check if taken
    var snap = await fbRef('users/' + newName).once('value');
    if (snap.exists()) { showToast('Username "' + newName + '" is already taken.', 'error'); return; }

    if (!confirm('Rename "' + oldName + '" to "' + newName + '"?')) return;

    try {
        // Copy user data
        var oldSnap = await fbRef('users/' + oldName).once('value');
        var oldData = oldSnap.val();
        oldData.username = newName;
        oldData.previousNames = oldData.previousNames || [];
        oldData.previousNames.push(oldName);

        // Create new, delete old
        await fbRef('users/' + newName).set(oldData);
        await fbRef('users/' + oldName).remove();

        // Copy presence
        var presSnap = await fbRef('presence/' + oldName).once('value');
        if (presSnap.exists()) {
            await fbRef('presence/' + newName).set(presSnap.val());
            await fbRef('presence/' + oldName).remove();
        }

        // Copy sessions
        var sessSnap = await fbRef('sessions/' + oldName).once('value');
        if (sessSnap.exists()) {
            await fbRef('sessions/' + newName).set(sessSnap.val());
            await fbRef('sessions/' + oldName).remove();
        }

        // Update current admin's localStorage if renaming self
        if (oldName === localStorage.getItem('ah_user')) {
            localStorage.setItem('ah_user', newName);
        }

        document.getElementById('adminNewUsername').value = '';
        document.getElementById('adminSearchInput').value = newName;
        showToast('\u2705 Renamed "' + oldName + '" \u2192 "' + newName + '"', 'success');
        adminSearchUser();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// == Render online users (ListBox style) ==
function renderOnlineUsers(onlineUsers) {
    var container = document.getElementById('adminOnlineList');
    if (onlineUsers.length === 0) {
        container.innerHTML = '<div class="adm-listbox-empty">No users online</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < onlineUsers.length; i++) {
        var u = onlineUsers[i];
        var since = u.loginAt ? timeAgo(u.loginAt) : '';
        html += '<div class="adm-listbox-item" onclick="adminQuickSearch(\'' + escHtml(u.username) + '\')">' +
            '<div class="adm-listbox-dot"></div>' +
            '<div class="adm-listbox-name">' + escHtml(u.username) + '</div>' +
            '<div class="adm-listbox-since">' + since + '</div>' +
            '</div>';
    }
    container.innerHTML = html;
}

// == Render all users (DataGridView style) ==
function renderAllUsersTable(users) {
    var body = document.getElementById('adminAllUsersBody');
    if (users.length === 0) {
        body.innerHTML = '<tr><td colspan="6" class="adm-datagrid-empty">No users found</td></tr>';
        return;
    }
    var html = '';
    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        var online = adminAllPresence[u.username] || false;
        var statusHtml = online
            ? '<span style="color:#3fb950;">\u25CF Online</span>'
            : '<span style="color:#484f58;">\u25CF Offline</span>';
        var bannedHtml = u.banned
            ? '<span style="color:#f85149;">Banned</span>'
            : '<span style="color:#3fb950;">Active</span>';
        var roleStr = u.role === 'creator' ? '\u2B50 Creator' : (u.role === 'admin' ? '\u2605 Admin' : 'User');
        var roleColor = u.role === 'creator' ? '#f59e0b' : (u.role === 'admin' ? '#d29922' : '#8b949e');
        var currentLoggedIn = localStorage.getItem('ah_user');
        var isTargetSelf = (u.username === currentLoggedIn);
        var isTargetProtected = (u.role === 'admin' || u.role === 'creator');
        var actionHtml = '<button class="adm-grid-btn view" onclick="adminQuickSearch(\'' + escHtml(u.username) + '\')">View</button>';
        if (!isTargetSelf && !isTargetProtected) {
            actionHtml += u.banned
                ? '<button class="adm-grid-btn unban" onclick="adminQuickUnban(\'' + escHtml(u.username) + '\')">Unban</button>'
                : '<button class="adm-grid-btn ban" onclick="adminQuickBan(\'' + escHtml(u.username) + '\')">Ban</button>';
        }
        html += '<tr>' +
            '<td style="font-weight:700;color:#f0f6fc;">' + escHtml(u.username) + '</td>' +
            '<td style="color:' + roleColor + ';">' + roleStr + '</td>' +
            '<td style="color:#bc8cff;">' + escHtml(u.plan || 'Free') + '</td>' +
            '<td>' + statusHtml + '</td>' +
            '<td>' + bannedHtml + '</td>' +
            '<td>' + actionHtml + '</td>' +
            '</tr>';
    }
    body.innerHTML = html;
}

// == Quick actions from table ==
function adminQuickSearch(username) {
    document.getElementById('adminSearchInput').value = username;
    adminSearchUser();
    document.getElementById('adminPanel').scrollIntoView({ behavior: 'smooth' });
}

function adminQuickBan(username) {
    var currentLoggedIn = localStorage.getItem('ah_user');
    if (username === currentLoggedIn) {
        showToast('\u26D4 You cannot ban yourself.', 'error');
        return;
    }
    fbRef('users/' + username).once('value').then(function(snap) {
        if (snap.exists() && (snap.val().role === 'admin' || snap.val().role === 'creator')) {
            showToast('\u26D4 You cannot ban another admin or creator.', 'error');
            return;
        }
        fbBanUser(username, true).then(function() {
            showToast('\uD83D\uDEAB ' + username + ' banned', 'error');
        });
    });
}

function adminQuickUnban(username) {
    var currentLoggedIn = localStorage.getItem('ah_user');
    fbRef('users/' + username).once('value').then(function(snap) {
        if (snap.exists() && (snap.val().role === 'admin' || snap.val().role === 'creator')) {
            showToast('\u26D4 Cannot modify another admin or creator.', 'error');
            return;
        }
        fbBanUser(username, false).then(function() {
            showToast('\u2705 ' + username + ' unbanned', 'success');
        });
    });
}

// == Render user sessions (ListView style) ==
function renderUserSessions(sessions) {
    var container = document.getElementById('adminResSessions');
    if (!sessions || sessions.length === 0) {
        container.innerHTML = '<div class="adm-sessions-empty">No sessions recorded</div>';
        return;
    }
    var now = Date.now();
    var html = '';
    for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        var loginAt = s.loginAt ? new Date(s.loginAt).toLocaleString() : '\u2014';
        var logoutAt = s.logoutAt ? new Date(s.logoutAt).toLocaleString() : null;
        var isActive = !s.logoutAt;
        var duration = '';
        if (s.loginAt) {
            var endT = s.logoutAt || now;
            var dur = Math.floor((endT - s.loginAt) / 1000);
            if (dur < 0) dur = 0;
            if (dur >= 86400) duration = Math.floor(dur/86400) + 'd ' + Math.floor((dur%86400)/3600) + 'h';
            else if (dur >= 3600) duration = Math.floor(dur/3600) + 'h ' + Math.floor((dur%3600)/60) + 'm';
            else if (dur >= 60) duration = Math.floor(dur/60) + 'm ' + (dur%60) + 's';
            else duration = dur + 's';
        }
        // Device info
        var deviceInfo = '';
        if (s.ip) deviceInfo += '\uD83C\uDF10 ' + escHtml(s.ip);
        if (s.platform) deviceInfo += (deviceInfo ? '  \u2022  ' : '') + '\uD83D\uDCBB ' + escHtml(s.platform);
        if (s.userAgent) {
            var browser = 'Unknown';
            var ua = s.userAgent;
            if (ua.indexOf('Edg/') > -1) browser = 'Edge';
            else if (ua.indexOf('Chrome/') > -1) browser = 'Chrome';
            else if (ua.indexOf('Firefox/') > -1) browser = 'Firefox';
            else if (ua.indexOf('Safari/') > -1) browser = 'Safari';
            deviceInfo += (deviceInfo ? '  \u2022  ' : '') + '\uD83D\uDD0D ' + browser;
        }

        html += '<div style="background:#161b22;border:1px solid #21262d;border-radius:6px;padding:10px 14px;margin-bottom:8px;">';
        // Login
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
            '<span style="color:#3fb950;font-size:11px;font-weight:700;">\u25B6 LOGIN</span>' +
            '<span style="color:#c9d1d9;font-size:12px;">' + loginAt + '</span></div>';
        // Logout / Active
        if (isActive) {
            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
                '<span style="color:#d29922;font-size:11px;font-weight:700;">\u25CF ACTIVE</span>' +
                '<span style="color:#c9d1d9;font-size:12px;">Still connected...</span></div>';
        } else {
            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
                '<span style="color:#f85149;font-size:11px;font-weight:700;">\u25A0 LOGOUT</span>' +
                '<span style="color:#c9d1d9;font-size:12px;">' + logoutAt + '</span></div>';
        }
        // Duration
        if (duration) {
            html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
                '<span style="color:#8b949e;font-size:11px;">\u23F0 Duration:</span>' +
                '<span style="color:' + (isActive ? '#3fb950' : '#06b6d4') + ';font-size:12px;font-weight:600;">' + duration + '</span></div>';
        }
        // Device / IP info
        if (deviceInfo) {
            html += '<div style="font-size:10px;color:#6e7681;margin-top:2px;">' + deviceInfo + '</div>';
        }
        html += '</div>';
    }
    container.innerHTML = html;
}

// == Helpers ==
function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function timeAgo(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
}

function formatDuration(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function showToast(msg, type) {
    if (typeof toast === 'function') {
        toast(msg, type);
    }
}

// == Global Lockdown (creator only) ==
function checkLockdownStatus() {
    fbRef('system/lockdown').on('value', function(snap) {
        var lockdown = snap.val() || { enabled: false };
        var lockBtn = document.getElementById('lockdownBtn2');
        var unlockBtn = document.getElementById('unlockBtn2');
        var statusEl = document.getElementById('lockdownStatus2');
        var activeBadge = document.getElementById('lockdownActiveBadge');
        var offBadge = document.getElementById('lockdownOffBadge');

        if (lockdown.enabled) {
            if (lockBtn) lockBtn.style.display = 'none';
            if (unlockBtn) unlockBtn.style.display = '';
            if (activeBadge) activeBadge.style.display = '';
            if (offBadge) offBadge.style.display = 'none';
            if (statusEl) {
                statusEl.style.display = '';
                statusEl.innerHTML =
                    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
                        '<span style="font-size:18px;">&#128274;</span>' +
                        '<span style="font-weight:700;font-size:13px;color:#f87171;letter-spacing:.5px;">LOCKDOWN ACTIVE</span>' +
                    '</div>' +
                    '<div style="font-size:12px;color:#fca5a5;background:#2d0f0f;border-radius:6px;padding:8px 10px;">' +
                        (lockdown.message || 'No message set') +
                    '</div>';
            }
        } else {
            if (lockBtn) lockBtn.style.display = '';
            if (unlockBtn) unlockBtn.style.display = 'none';
            if (activeBadge) activeBadge.style.display = 'none';
            if (offBadge) offBadge.style.display = '';
            if (statusEl) { statusEl.style.display = 'none'; statusEl.innerHTML = ''; }
        }
    });
}

function adminLockdown() {
    var role = localStorage.getItem('ah_role') || 'user';
    if (role !== 'creator') { showToast('\u26D4 Only creator can lockdown.', 'error'); return; }
    var msg = prompt('Lockdown message (shown to users):') || 'System maintenance in progress.';
    if (!confirm('\u26A0 This will lock out ALL users except you. Continue?')) return;

    fbRef('system/lockdown').set({
        enabled: true,
        message: msg,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    }).then(function() {
        showToast('\uD83D\uDD12 LOCKDOWN ACTIVATED', 'error');
    }).catch(function(err) {
        showToast('Error: ' + err.message, 'error');
    });
}

function adminUnlock() {
    var role = localStorage.getItem('ah_role') || 'user';
    if (role !== 'creator') { showToast('\u26D4 Only creator can unlock.', 'error'); return; }
    if (!confirm('Unlock system for all users?')) return;

    fbRef('system/lockdown').set({
        enabled: false,
        message: null,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    }).then(function() {
        showToast('\uD83D\uDD13 System unlocked — all users can access now', 'success');
    }).catch(function(err) {
        showToast('Error: ' + err.message, 'error');
    });
}

// == Grant Lockdown Bypass to specific user (creator only) ==
function adminToggleLockdownExempt() {
    if (!adminCurrentUser) return;
    var role = localStorage.getItem('ah_role') || 'user';
    if (role !== 'creator') { showToast('\u26D4 Only creator can grant lockdown bypass.', 'error'); return; }

    var currentExempt = adminCurrentUser.lockdownExempt || false;
    if (currentExempt) {
        // Already has bypass — remove only this user
        if (!confirm('Remove lockdown bypass from "' + adminCurrentUser.username + '"?')) return;
        fbRef('users/' + adminCurrentUser.username).update({ lockdownExempt: false }).then(function() {
            adminCurrentUser.lockdownExempt = false;
            showUserResult(adminCurrentUser.username, adminCurrentUser);
            showToast('\uD83D\uDD12 Bypass removed from ' + adminCurrentUser.username, 'success');
        }).catch(function(err) { showToast('Error: ' + err.message, 'error'); });
    } else {
        if (!confirm('Grant lockdown bypass to "' + adminCurrentUser.username + '"?')) return;
        fbRef('users/' + adminCurrentUser.username).update({ lockdownExempt: true }).then(function() {
            adminCurrentUser.lockdownExempt = true;
            showUserResult(adminCurrentUser.username, adminCurrentUser);
            showToast('\uD83D\uDD13 ' + adminCurrentUser.username + ' can now bypass lockdown', 'success');
        }).catch(function(err) { showToast('Error: ' + err.message, 'error'); });
    }
}

// == Remove Lockdown Bypass from ALL users at once (creator only) ==
function adminRemoveAllBypass() {
    var role = localStorage.getItem('ah_role') || 'user';
    if (role !== 'creator') { showToast('\u26D4 Only creator can do this.', 'error'); return; }
    if (!confirm('Remove lockdown bypass from ALL users? This cannot be undone.')) return;

    fbRef('users').once('value').then(function(snap) {
        var updates = {};
        snap.forEach(function(child) {
            if (child.val().lockdownExempt === true) {
                updates[child.key + '/lockdownExempt'] = false;
            }
        });
        if (Object.keys(updates).length === 0) {
            showToast('No users have lockdown bypass.', 'info');
            return;
        }
        return fbRef('users').update(updates).then(function() {
            showToast('\uD83D\uDD12 Lockdown bypass removed from all users (' + Object.keys(updates).length + ')', 'success');
            // Refresh current user view if open
            if (adminCurrentUser) {
                adminCurrentUser.lockdownExempt = false;
                showUserResult(adminCurrentUser.username, adminCurrentUser);
            }
        });
    }).catch(function(err) {
        showToast('Error: ' + err.message, 'error');
    });
}
