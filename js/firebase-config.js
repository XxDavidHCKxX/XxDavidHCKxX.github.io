// ═══════════════════════════════════════════════════════════════════════
// AttackHub – Firebase Realtime Database Configuration
// ═══════════════════════════════════════════════════════════════════════
//
// Firebase DB structure:
//   /users/{username}
//       - username, role, plan, banned, createdAt
//   /presence/{username}
//       - online: true/false, lastSeen: timestamp, loginAt: timestamp
//   /sessions/{username}
//       - array of { loginAt, logoutAt }
//
// ⚠ Replace the config below with your own Firebase project credentials
// ═══════════════════════════════════════════════════════════════════════

const firebaseConfig = {
    apiKey: "AIzaSyAAQvBUy6jlywDUQyxg56LN00weJ1hc2vs",
    authDomain: "el-apaga-perras.firebaseapp.com",
    databaseURL: "https://el-apaga-perras-default-rtdb.firebaseio.com",
    projectId: "el-apaga-perras",
    storageBucket: "el-apaga-perras.firebasestorage.app",
    messagingSenderId: "493234212424",
    appId: "1:493234212424:web:9c0c336f467374816e127d",
    measurementId: "G-Q4C5HPTHRB"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ── Optimize Firebase connection ───────────────────────────────────
// Enable logging only in dev (comment out in production)
// firebase.database.enableLogging(true);

// Keep critical paths synced for faster reads
db.ref('users').keepSynced(true);
db.ref('presence').keepSynced(true);

// Connection state monitoring
var fbConnected = false;
db.ref('.info/connected').on('value', function(snap) {
    fbConnected = snap.val() === true;
    console.log('[Firebase] Connected:', fbConnected);
});

// ── Helper: get ref ────────────────────────────────────────────────
function fbRef(path) { return db.ref(path); }

// ── Presence: mark user online ─────────────────────────────────────
function fbSetOnline(username) {
    if (!username) return;
    const presRef = fbRef('presence/' + username);
    presRef.once('value').then(function(snap) {
        var current = snap.val();
        if (current && current.online && current.loginAt) {
            presRef.update({
                online: true,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
        } else {
            presRef.set({
                online: true,
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
                loginAt: firebase.database.ServerValue.TIMESTAMP
            });
        }
    }).catch(function() {
        presRef.set({
            online: true,
            lastSeen: firebase.database.ServerValue.TIMESTAMP,
            loginAt: firebase.database.ServerValue.TIMESTAMP
        });
    });
    presRef.onDisconnect().update({
        online: false,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
    });
}

// ── Presence: mark user offline ────────────────────────────────────
function fbSetOffline(username) {
    if (!username) return;
    fbRef('presence/' + username).update({
        online: false,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
    });
}

// ── Users: ensure user profile exists ──────────────────────────────
function fbEnsureUser(username, plan) {
    if (!username) return;
    const userRef = fbRef('users/' + username);
    userRef.once('value').then(snap => {
        if (!snap.exists()) {
            userRef.set({
                username: username,
                role: 'user',
                plan: plan || 'Free',
                banned: false,
                createdAt: firebase.database.ServerValue.TIMESTAMP
            });
        } else {
            // Update plan if changed
            if (plan) userRef.update({ plan: plan });
        }
    });
}

// ── Sessions: log login event ──────────────────────────────────────
var _lastSessionRef = null;
function fbLogLogin(username) {
    if (!username) return;
    var sessionData = {
        loginAt: firebase.database.ServerValue.TIMESTAMP,
        logoutAt: null,
        userAgent: navigator.userAgent || 'Unknown',
        platform: navigator.platform || 'Unknown',
        language: navigator.language || 'Unknown'
    };
    _lastSessionRef = fbRef('sessions/' + username).push(sessionData);
    // Auto-set logoutAt on disconnect (tab close / network loss)
    _lastSessionRef.child('logoutAt').onDisconnect().set(firebase.database.ServerValue.TIMESTAMP);
    // Also fetch and store IP
    fetch('https://api.ipify.org?format=json').then(function(r) { return r.json(); }).then(function(d) {
        if (d.ip) _lastSessionRef.update({ ip: d.ip });
    }).catch(function() {});
}

// ── Sessions: log logout event ─────────────────────────────────────
function fbLogLogout(username) {
    if (!username) return;
    // Use cached ref if available (faster, no query)
    if (_lastSessionRef) {
        _lastSessionRef.child('logoutAt').onDisconnect().cancel();
        _lastSessionRef.update({ logoutAt: firebase.database.ServerValue.TIMESTAMP });
        _lastSessionRef = null;
        return;
    }
    // Fallback: query for sessions with null logoutAt
    var sessRef = fbRef('sessions/' + username);
    sessRef.orderByChild('logoutAt').equalTo(null).limitToLast(1).once('value').then(function(snap) {
        snap.forEach(function(child) {
            child.ref.update({ logoutAt: firebase.database.ServerValue.TIMESTAMP });
        });
    });
}

// ── Admin: get all users ───────────────────────────────────────────
function fbGetAllUsers(callback) {
    fbRef('users').on('value', snap => {
        const users = [];
        snap.forEach(child => {
            users.push({ key: child.key, ...child.val() });
        });
        callback(users);
    });
}

// ── Admin: search user by username ─────────────────────────────────
function fbSearchUser(query, callback) {
    fbRef('users').orderByChild('username').startAt(query).endAt(query + '\uf8ff').once('value').then(snap => {
        const results = [];
        snap.forEach(child => {
            results.push({ key: child.key, ...child.val() });
        });
        callback(results);
    });
}

// ── Admin: ban / unban ─────────────────────────────────────────────
function fbBanUser(username, banned) {
    return fbRef('users/' + username).update({ banned: banned });
}

// ── Admin: set plan ────────────────────────────────────────────────
function fbSetUserPlan(username, plan) {
    return fbRef('users/' + username).update({ plan: plan });
}

// ── Admin: set role ────────────────────────────────────────────────
function fbSetUserRole(username, role) {
    return fbRef('users/' + username).update({ role: role });
}

// ── Online users listener ──────────────────────────────────────────
function fbListenOnlineUsers(callback) {
    fbRef('presence').on('value', snap => {
        const online = [];
        snap.forEach(child => {
            const val = child.val();
            if (val && val.online) {
                online.push({ username: child.key, ...val });
            }
        });
        callback(online);
    });
}

// ── Get user sessions ──────────────────────────────────────────────
function fbGetUserSessions(username, callback) {
    fbRef('sessions/' + username).orderByChild('loginAt').limitToLast(50).once('value').then(snap => {
        const sessions = [];
        snap.forEach(child => {
            sessions.push(child.val());
        });
        callback(sessions.reverse());
    }).catch(function() { callback([]); });
}

// ── Get single user presence ───────────────────────────────────────
function fbGetPresence(username, callback) {
    fbRef('presence/' + username).on('value', snap => {
        callback(snap.val() || { online: false });
    });
}
