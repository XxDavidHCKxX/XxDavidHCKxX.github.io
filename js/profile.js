// ═══════════════════════════════════════════════════════════════════════
// AttackHub – Profile Page Logic (Firebase)
// ═══════════════════════════════════════════════════════════════════════

let profCurrentUser = null;
let profUserData = null;

function initProfilePage(username) {
    profCurrentUser = username;
    const role = localStorage.getItem('ah_role') || 'user';

    // Show admin-only sections if admin
    function showAdminFields() {
        var createBox = document.getElementById('profCreateUserBox');
        var rs = document.getElementById('adminCreateRole');
        var ps = document.getElementById('adminCreatePlan');
        if (createBox) createBox.style.display = '';
        if (rs) rs.style.display = '';
        if (ps) ps.style.display = '';
    }
    if (role === 'admin') showAdminFields();

    // Check Firebase for role too
    fbRef('users/' + username).once('value').then(function(snap) {
        if (snap.exists() && snap.val().role === 'admin') showAdminFields();
    });

    // Search input enter key
    var si = document.getElementById('profSearchInput');
    if (si) si.addEventListener('keydown', function(e) { if (e.key === 'Enter') profSearchUser(); });

    // Load profile from Firebase
    loadProfileData(username);
    loadProfilePresence(username);
    loadProfileSessions(username);
    loadProfilePlan(username);
    checkNameCooldown(username);
}

// ── Load profile data ──────────────────────────────────────────────
function loadProfileData(username) {
    // Show localStorage data immediately (so it's never empty)
    setText('profAvatar', username.charAt(0).toUpperCase());
    setText('profName', username);
    setText('profUsername', username);
    var lsRole = localStorage.getItem('ah_role') || 'user';
    var lsPlan = localStorage.getItem('ah_plan') || 'Free';
    updateProfileUI(username, lsRole, lsPlan, null);
    // Load cached photo instantly
    var cachedPhoto = localStorage.getItem('ah_photo');
    if (cachedPhoto) applyProfilePhoto(cachedPhoto);

    // Then load from Firebase (real-time)
    fbRef('users/' + username).on('value', function(snap) {
        if (!snap.exists()) {
            // Create user in Firebase if missing
            fbRef('users/' + username).set({
                username: username,
                role: lsRole,
                plan: lsPlan,
                banned: false,
                createdAt: firebase.database.ServerValue.TIMESTAMP
            });
            return;
        }
        profUserData = snap.val();
        var d = profUserData;
        setText('profName', d.displayName || username);
        updateProfileUI(username, d.role || 'user', d.plan || 'Free', d.createdAt);
        // Load profile photo
        if (d.photoUrl) {
            applyProfilePhoto(d.photoUrl);
        }
        // Show IP
        if (d.lastIP) {
            setHtml('profIP', '<span style="color:#06b6d4;">' + escH(d.lastIP) + '</span>');
        }
    });
}

function updateProfileUI(username, role, plan, createdAt) {
    setText('profAvatar', username.charAt(0).toUpperCase());
    setText('profUsername', username);

    var roleEl = document.getElementById('profRole');
    if (roleEl) {
        roleEl.textContent = (role === 'admin' ? '\u2605 ' : '') + role.charAt(0).toUpperCase() + role.slice(1);
        roleEl.className = 'adm-badge adm-badge-role' + (role === 'user' ? ' user' : '');
    }
    setHtml('profRoleVal', role === 'admin'
        ? '<span style="color:#d29922;">\u2605 Admin</span>'
        : '<span style="color:#8b949e;">User</span>');

    setText('profPlanBadge', '\u2B50 ' + plan);
    setHtml('profPlan', '<span style="color:#bc8cff;">\u2B50 ' + escH(plan) + '</span>');

    setText('profRegistered', createdAt ? new Date(createdAt).toLocaleString() : '\u2014');
}

// ── Load presence ──────────────────────────────────────────────────
var _profActiveInterval = null;
function loadProfilePresence(username) {
    fbRef('presence/' + username).on('value', function(snap) {
        var p = snap.val() || { online: false };
        var statusEl = document.getElementById('profStatus');
        // Clear old interval
        if (_profActiveInterval) { clearInterval(_profActiveInterval); _profActiveInterval = null; }

        if (p.online) {
            if (statusEl) { statusEl.textContent = '\u25CF Online'; statusEl.className = 'adm-badge adm-badge-online'; }
            setHtml('profOnline', '<span style="color:#3fb950;">\u25CF Online</span>');
            if (p.loginAt && typeof p.loginAt === 'number') {
                // Update active time immediately and every second
                function updateActive() {
                    var diff = Date.now() - p.loginAt;
                    if (diff < 1000) diff = 1000;
                    setHtml('profActiveTime', '<span style="color:#3fb950;">' + fmtDur(diff) + '</span>');
                }
                updateActive();
                _profActiveInterval = setInterval(updateActive, 1000);
            } else {
                setText('profActiveTime', '\u2014');
            }
        } else {
            if (statusEl) { statusEl.textContent = '\u25CF Offline'; statusEl.className = 'adm-badge adm-badge-offline'; }
            setHtml('profOnline', '<span style="color:#484f58;">\u25CF Offline</span>');
            setText('profActiveTime', '\u2014');
        }
        setText('profLastSeen', p.lastSeen ? new Date(p.lastSeen).toLocaleString() : '\u2014');
    });
}

// ── Load sessions ──────────────────────────────────────────────────
function loadProfileSessions(username) {
    var container = document.getElementById('profSessions');
    var loaded = false;

    setTimeout(function() {
        if (!loaded) {
            container.innerHTML = '<div class="adm-sessions-empty">No sessions recorded</div>';
        }
    }, 5000);

    try {
        fbGetUserSessions(username, function(sessions) {
            loaded = true;
            if (!sessions || sessions.length === 0) {
                container.innerHTML = '<div class="adm-sessions-empty">No sessions recorded</div>';
                setText('profTotalTime', '\u2014');
                return;
            }

            // Calculate total session time
            var totalMs = 0;
            var now = Date.now();
            for (var j = 0; j < sessions.length; j++) {
                var sess = sessions[j];
                if (sess.loginAt) {
                    var endTime = sess.logoutAt || now;
                    totalMs += (endTime - sess.loginAt);
                }
            }
            setHtml('profTotalTime', '<span style="color:#06b6d4;">' + fmtDur(totalMs) + '</span>');

            // Render sessions
            var html = '';
            for (var i = 0; i < sessions.length; i++) {
                var s = sessions[i];
                var loginAt = s.loginAt ? new Date(s.loginAt).toLocaleString() : '\u2014';
                var logoutAt = s.logoutAt ? new Date(s.logoutAt).toLocaleString() : null;
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
                var isActive = !s.logoutAt;
                html += '<div class="adm-session-card" style="background:#161b22;border:1px solid #21262d;border-radius:6px;padding:10px 14px;margin-bottom:8px;">';
                // Login line
                html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
                    '<span style="color:#3fb950;font-size:11px;font-weight:700;">&#9654; LOGIN</span>' +
                    '<span style="color:#c9d1d9;font-size:12px;">' + loginAt + '</span>' +
                    '</div>';
                // Logout line
                if (isActive) {
                    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
                        '<span style="color:#d29922;font-size:11px;font-weight:700;">&#9679; ACTIVE</span>' +
                        '<span style="color:#c9d1d9;font-size:12px;">Still connected...</span>' +
                        '</div>';
                } else {
                    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
                        '<span style="color:#f85149;font-size:11px;font-weight:700;">&#9632; LOGOUT</span>' +
                        '<span style="color:#c9d1d9;font-size:12px;">' + logoutAt + '</span>' +
                        '</div>';
                }
                // Duration
                if (duration) {
                    if (isActive) {
                        html += '<div style="display:flex;align-items:center;gap:6px;">' +
                            '<span style="color:#8b949e;font-size:11px;">&#9200; Duration:</span>' +
                            '<span id="sessDur' + i + '" style="color:#3fb950;font-size:12px;font-weight:600;" data-login="' + s.loginAt + '">' + duration + '</span>' +
                            '</div>';
                    } else {
                        html += '<div style="display:flex;align-items:center;gap:6px;">' +
                            '<span style="color:#8b949e;font-size:11px;">&#9200; Duration:</span>' +
                            '<span style="color:#06b6d4;font-size:12px;font-weight:600;">' + duration + '</span>' +
                            '</div>';
                    }
                }
                // Device info
                var deviceInfo = '';
                if (s.ip) deviceInfo += '\uD83C\uDF10 ' + escH(s.ip);
                if (s.platform) deviceInfo += (deviceInfo ? '  \u2022  ' : '') + '\uD83D\uDCBB ' + escH(s.platform);
                if (s.userAgent) {
                    var browser = 'Unknown';
                    var ua = s.userAgent;
                    if (ua.indexOf('Edg/') > -1) browser = 'Edge';
                    else if (ua.indexOf('Chrome/') > -1) browser = 'Chrome';
                    else if (ua.indexOf('Firefox/') > -1) browser = 'Firefox';
                    else if (ua.indexOf('Safari/') > -1) browser = 'Safari';
                    deviceInfo += (deviceInfo ? '  \u2022  ' : '') + '\uD83D\uDD0D ' + browser;
                }
                if (deviceInfo) {
                    html += '<div style="font-size:10px;color:#6e7681;margin-top:2px;">' + deviceInfo + '</div>';
                }
                html += '</div>';
            }
            container.innerHTML = html;

            // Start live timer for active session durations
            if (window._profSessDurInterval) clearInterval(window._profSessDurInterval);
            window._profSessDurInterval = setInterval(function() {
                var els = container.querySelectorAll('[id^="sessDur"]');
                for (var k = 0; k < els.length; k++) {
                    var loginTs = parseInt(els[k].getAttribute('data-login'));
                    if (loginTs) {
                        var d = Date.now() - loginTs;
                        if (d < 1000) d = 1000;
                        els[k].textContent = fmtDur(d);
                    }
                }
            }, 1000);
        });
    } catch(e) {
        loaded = true;
        container.innerHTML = '<div class="adm-sessions-empty">No sessions recorded</div>';
    }
}

// ── Change Name (30-day cooldown for non-admins) ───────────────────
function checkNameCooldown(username) {
    fbRef('users/' + username).once('value').then(function(snap) {
        if (!snap.exists()) return;
        var d = snap.val();
        var role = d.role || 'user';
        var lastChange = d.lastNameChange || 0;
        var cooldownMs = 30 * 24 * 60 * 60 * 1000; // 30 days
        var now = Date.now();
        var cdEl = document.getElementById('profNameCooldown');
        var btn = document.getElementById('profNameBtn');

        if (role === 'admin') {
            // Admins can change anytime
            if (cdEl) cdEl.style.display = 'none';
            if (btn) btn.disabled = false;
            return;
        }

        if (lastChange && (now - lastChange) < cooldownMs) {
            var nextDate = new Date(lastChange + cooldownMs);
            var daysLeft = Math.ceil((lastChange + cooldownMs - now) / (24*60*60*1000));
            if (cdEl) {
                cdEl.style.display = 'block';
                cdEl.innerHTML = '\u23F3 You can change your name again on <b>' + nextDate.toLocaleDateString() + '</b> (' + daysLeft + ' days left)';
            }
            if (btn) btn.disabled = true;
        } else {
            if (cdEl) cdEl.style.display = 'none';
            if (btn) btn.disabled = false;
        }
    });
}

async function profChangeName() {
    var newName = (document.getElementById('profNewName').value || '').trim().toLowerCase();
    if (!newName) { profShowError('Enter a new username.'); return; }
    if (newName.length < 3) { profShowError('Username must be at least 3 characters.'); return; }
    if (newName.length > 20) { profShowError('Username must be max 20 characters.'); return; }
    if (!/^[a-z0-9_]+$/.test(newName)) { profShowError('Only lowercase letters, numbers, underscore.'); return; }
    if (newName === profCurrentUser) { profShowError('That is already your username.'); return; }

    // Check if taken
    var snap = await fbRef('users/' + newName).once('value');
    if (snap.exists()) { profShowError('Username "' + newName + '" is already taken.'); return; }

    // Copy user data to new key
    var oldSnap = await fbRef('users/' + profCurrentUser).once('value');
    var oldData = oldSnap.val();
    oldData.username = newName;
    oldData.displayName = newName;
    oldData.lastNameChange = firebase.database.ServerValue.TIMESTAMP;
    oldData.previousNames = oldData.previousNames || [];
    oldData.previousNames.push(profCurrentUser);

    // Create new, delete old
    await fbRef('users/' + newName).set(oldData);
    await fbRef('users/' + profCurrentUser).remove();

    // Copy presence
    var presSnap = await fbRef('presence/' + profCurrentUser).once('value');
    if (presSnap.exists()) {
        await fbRef('presence/' + newName).set(presSnap.val());
        await fbRef('presence/' + profCurrentUser).remove();
    }

    // Copy sessions
    var sessSnap = await fbRef('sessions/' + profCurrentUser).once('value');
    if (sessSnap.exists()) {
        await fbRef('sessions/' + newName).set(sessSnap.val());
        await fbRef('sessions/' + profCurrentUser).remove();
    }

    // Update localStorage
    localStorage.setItem('ah_user', newName);
    profShowSuccess('Username changed to "' + newName + '"! Reloading...');
    setTimeout(function() { location.reload(); }, 1500);
}

// ── Change Password ────────────────────────────────────────────────
async function profChangePassword() {
    var oldPass = document.getElementById('profOldPass').value;
    var newPass = document.getElementById('profNewPass').value;
    var newPass2 = document.getElementById('profNewPass2').value;

    if (!oldPass || !newPass || !newPass2) { profShowError('Fill in all password fields.'); return; }
    if (newPass.length < 4) { profShowError('New password must be at least 4 characters.'); return; }
    if (newPass !== newPass2) { profShowError('New passwords do not match.'); return; }

    var snap = await fbRef('users/' + profCurrentUser).once('value');
    if (!snap.exists()) { profShowError('User not found.'); return; }
    var userData = snap.val();

    var oldHash = await simpleHash(oldPass);
    if (userData.passwordHash !== oldHash) { profShowError('Current password is incorrect.'); return; }

    var newHash = await simpleHash(newPass);
    await fbRef('users/' + profCurrentUser).update({ passwordHash: newHash });

    document.getElementById('profOldPass').value = '';
    document.getElementById('profNewPass').value = '';
    document.getElementById('profNewPass2').value = '';
    profShowSuccess('Password updated successfully!');
}

// ── Delete Account ─────────────────────────────────────────────────
async function profDeleteAccount() {
    var pass = document.getElementById('profDeletePass').value;
    if (!pass) { profShowError('Enter your password to confirm deletion.'); return; }

    var snap = await fbRef('users/' + profCurrentUser).once('value');
    if (!snap.exists()) { profShowError('User not found.'); return; }
    var userData = snap.val();

    var hash = await simpleHash(pass);
    if (userData.passwordHash !== hash) { profShowError('Password is incorrect.'); return; }

    if (!confirm('Are you sure? This will permanently delete your account "' + profCurrentUser + '". This cannot be undone!')) return;

    // Delete all data
    await fbRef('users/' + profCurrentUser).remove();
    await fbRef('presence/' + profCurrentUser).remove();
    await fbRef('sessions/' + profCurrentUser).remove();

    // Clear localStorage and redirect
    localStorage.clear();
    alert('Account deleted. Goodbye!');
    window.location.href = 'login.html';
}

// ── Admin: Create User ─────────────────────────────────────────────
async function profAdminCreateUser() {
    var username = (document.getElementById('adminCreateUser').value || '').trim().toLowerCase();
    var pass = document.getElementById('adminCreatePass').value;
    var roleSelect = document.getElementById('adminCreateRole');
    var planSelect = document.getElementById('adminCreatePlan');
    // Non-admins: role=user, plan=Free (selects are hidden)
    var role = (roleSelect && roleSelect.style.display !== 'none') ? roleSelect.value : 'user';
    var plan = (planSelect && planSelect.style.display !== 'none') ? planSelect.value : 'Free';

    if (!username || !pass) { profShowError('Fill in username and password.'); return; }
    if (username.length < 3) { profShowError('Username must be at least 3 characters.'); return; }
    if (!/^[a-z0-9_]+$/.test(username)) { profShowError('Username: only lowercase letters, numbers, underscore.'); return; }
    if (pass.length < 4) { profShowError('Password must be at least 4 characters.'); return; }

    var snap = await fbRef('users/' + username).once('value');
    if (snap.exists()) { profShowError('Username "' + username + '" already exists.'); return; }

    var passHash = await simpleHash(pass);
    await fbRef('users/' + username).set({
        username: username,
        passwordHash: passHash,
        role: role,
        plan: plan,
        banned: false,
        createdAt: firebase.database.ServerValue.TIMESTAMP
    });

    document.getElementById('adminCreateUser').value = '';
    document.getElementById('adminCreatePass').value = '';
    profShowSuccess('User "' + username + '" created!');
}

// ── Hash (same as login.html) ──────────────────────────────────────
async function simpleHash(str) {
    var encoder = new TextEncoder();
    var data = encoder.encode(str + '_attackhub_salt');
    var hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

// ── Helpers ────────────────────────────────────────────────────────
function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
function setHtml(id, val) { var el = document.getElementById(id); if (el) el.innerHTML = val; }
function escH(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtDur(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 0) s = 0;
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    if (h < 24) return h + 'h ' + m + 'm';
    var d2 = Math.floor(h / 24);
    return d2 + 'd ' + (h % 24) + 'h ' + m + 'm';
}

// ── Profile Photo Upload ───────────────────────────────────────────
function profUploadPhoto(input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    if (file.size > 150 * 1024) {
        profShowError('Image must be under 150KB. Please use a smaller image.');
        return;
    }
    if (!file.type.startsWith('image/')) {
        profShowError('Please select an image file.');
        return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
            // Resize to 128x128 max
            var canvas = document.createElement('canvas');
            var size = 128;
            canvas.width = size;
            canvas.height = size;
            var ctx = canvas.getContext('2d');
            var sx = 0, sy = 0, sw = img.width, sh = img.height;
            // Crop to square
            if (sw > sh) { sx = (sw - sh) / 2; sw = sh; }
            else { sy = (sh - sw) / 2; sh = sw; }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            // Save to Firebase
            fbRef('users/' + profCurrentUser).update({ photoUrl: dataUrl }).then(function() {
                applyProfilePhoto(dataUrl);
                profShowSuccess('Profile photo updated!');
            }).catch(function(err) {
                profShowError('Error saving photo: ' + err.message);
            });
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function applyProfilePhoto(dataUrl) {
    var avatar = document.getElementById('profAvatar');
    if (avatar && dataUrl) {
        avatar.style.backgroundImage = 'url(' + dataUrl + ')';
        avatar.style.backgroundSize = 'cover';
        avatar.style.backgroundPosition = 'center';
        avatar.textContent = '';
        avatar.title = 'Click to change photo';
        // Cache locally for faster load
        try { localStorage.setItem('ah_photo', dataUrl); } catch(e) {}
    }
    // Show delete button
    var delBtn = document.getElementById('profPhotoDeleteBtn');
    if (delBtn) delBtn.style.display = dataUrl ? 'block' : 'none';
    // Also update navbar avatar
    var navAvatar = document.getElementById('sidebarUserAvatar');
    if (navAvatar && dataUrl) {
        navAvatar.style.backgroundImage = 'url(' + dataUrl + ')';
        navAvatar.style.backgroundSize = 'cover';
        navAvatar.style.backgroundPosition = 'center';
        navAvatar.textContent = '';
    }
}

function profDeletePhoto() {
    if (!confirm('Remove your profile photo?')) return;
    fbRef('users/' + profCurrentUser).update({ photoUrl: null }).then(function() {
        var avatar = document.getElementById('profAvatar');
        if (avatar) {
            avatar.style.backgroundImage = '';
            avatar.textContent = profCurrentUser.charAt(0).toUpperCase();
        }
        var navAvatar = document.getElementById('sidebarUserAvatar');
        if (navAvatar) {
            navAvatar.style.backgroundImage = '';
            navAvatar.textContent = profCurrentUser.charAt(0).toUpperCase();
        }
        var delBtn = document.getElementById('profPhotoDeleteBtn');
        if (delBtn) delBtn.style.display = 'none';
        try { localStorage.removeItem('ah_photo'); } catch(e) {}
        profShowSuccess('Profile photo removed.');
    });
}

function profShowError(msg) {
    var el = document.getElementById('profError');
    el.textContent = msg; el.style.display = 'block';
    document.getElementById('profSuccess').style.display = 'none';
    setTimeout(function() { el.style.display = 'none'; }, 5000);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function profShowSuccess(msg) {
    var el = document.getElementById('profSuccess');
    el.textContent = msg; el.style.display = 'block';
    document.getElementById('profError').style.display = 'none';
    setTimeout(function() { el.style.display = 'none'; }, 5000);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Logout ─────────────────────────────────────────────────────────
function profLogout() {
    try {
        fbSetOffline(profCurrentUser);
        fbLogLogout(profCurrentUser);
    } catch(e) {}
    localStorage.removeItem('ah_token');
    localStorage.removeItem('ah_user');
    localStorage.removeItem('ah_plan');
    localStorage.removeItem('ah_role');
    window.location.href = 'login.html';
}

// ── Search User (read-only for normal users) ───────────────────────
function profSearchUser() {
    var query = (document.getElementById('profSearchInput').value || '').trim().toLowerCase();
    if (!query) { profShowError('Enter a username to search.'); return; }

    var resultDiv = document.getElementById('profSearchResult');
    var emptyDiv = document.getElementById('profSearchEmpty');
    resultDiv.style.display = 'none';
    emptyDiv.style.display = 'none';

    fbRef('users/' + query).once('value').then(function(snap) {
        if (!snap.exists()) {
            emptyDiv.style.display = 'block';
            return;
        }
        var d = snap.val();
        resultDiv.style.display = 'block';

        setText('profSrchAvatar', query.charAt(0).toUpperCase());
        setText('profSrchName', d.displayName || query);
        setText('profSrchUsername', query);

        var role = d.role || 'user';
        var roleEl = document.getElementById('profSrchRole');
        if (roleEl) {
            roleEl.textContent = (role === 'admin' ? '\u2605 ' : '') + role.charAt(0).toUpperCase() + role.slice(1);
            roleEl.className = 'adm-badge adm-badge-role' + (role === 'user' ? ' user' : '');
        }
        setHtml('profSrchRoleVal', role === 'admin'
            ? '<span style="color:#d29922;">\u2605 Admin</span>'
            : '<span style="color:#8b949e;">User</span>');

        var plan = d.plan || 'Free';
        setText('profSrchPlan', '\u2B50 ' + plan);
        setHtml('profSrchPlanVal', '<span style="color:#bc8cff;">\u2B50 ' + escH(plan) + '</span>');
        setText('profSrchCreated', d.createdAt ? new Date(d.createdAt).toLocaleString() : '\u2014');

        // Load presence for searched user
        fbRef('presence/' + query).once('value').then(function(pSnap) {
            var p = pSnap.val() || { online: false };
            var sEl = document.getElementById('profSrchStatus');
            if (p.online) {
                if (sEl) { sEl.textContent = '\u25CF Online'; sEl.className = 'adm-badge adm-badge-online'; }
                setHtml('profSrchOnline', '<span style="color:#3fb950;">\u25CF Online</span>');
            } else {
                if (sEl) { sEl.textContent = '\u25CF Offline'; sEl.className = 'adm-badge adm-badge-offline'; }
                setHtml('profSrchOnline', '<span style="color:#484f58;">\u25CF Offline</span>');
            }
            setText('profSrchLastSeen', p.lastSeen ? new Date(p.lastSeen).toLocaleString() : '\u2014');
        });
    }).catch(function() {
        emptyDiv.style.display = 'block';
    });
}

// ── Load Plan Info ─────────────────────────────────────────────────
var PLAN_DETAILS = {
    Free:    { time: '1 min',   conc: '1' },
    Basic:   { time: '2 min',   conc: '2' },
    Premium: { time: '5 min',   conc: '3' },
    VIP:     { time: '10 min',  conc: '5' },
    Admin:   { time: 'Unlimited', conc: 'Unlimited' }
};

function loadProfilePlan(username) {
    var lsPlan = localStorage.getItem('ah_plan') || 'Free';
    updatePlanUI(lsPlan);

    fbRef('users/' + username).on('value', function(snap) {
        if (snap.exists()) {
            var plan = snap.val().plan || 'Free';
            updatePlanUI(plan);
        }
    });
}

function updatePlanUI(plan) {
    var info = PLAN_DETAILS[plan] || PLAN_DETAILS.Free;
    setText('profMyPlanName', plan);
    setText('profMyPlanTime', info.time);
    setText('profMyPlanConc', info.conc);
}
