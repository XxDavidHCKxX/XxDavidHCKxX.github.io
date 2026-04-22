// ═══════════════════════════════════════════════════════════════════════
// AttackHub – Global Language System (EN/ES)
// ═══════════════════════════════════════════════════════════════════════

var TRANSLATIONS = {
    en: {
        // Nav
        nav_dashboard: 'Dashboard', nav_profile: 'Profile', logout: 'Logout',
        // Dashboard
        dashboard: 'Dashboard', welcome_back: 'Welcome back,', hello: 'Hello',
        your_ip: 'Your IP', date: 'Date', time: 'Time', online_now: 'Online Now',
        news: 'News & Updates',
        news1: 'New admin panel with Firebase real-time users',
        news2_title: 'User Profiles', news2: 'Change name, password, view account details',
        news3_title: 'Admin Tools', news3: 'Ban/Unban, Set Plans, Create users',
        news4_title: 'Multi-language', news4: 'English and Spanish support',
        users: 'Users', total_attacks: 'Total Attacks', active_now: 'Active Now', today: 'Today',
        search_users: 'Search Users',
        online_users: 'Online Users',
        // Profile
        my_profile: 'My Profile', profile_sub: 'Manage your account settings and view your details.',
        account_details: 'Account Details', my_plan: 'My Plan', minutes: 'Minutes',
        my_sessions: 'My Sessions', create_user: 'Create User',
        change_name: 'Change Display Name',
        change_name_desc: 'You can change your username once every 30 days. Admins can change anytime.',
        change_password: 'Change Password', update_password: 'Update Password',
        delete_account: 'Delete Account', delete_desc: 'This action is permanent and cannot be undone.',
        change: 'Change', delete: 'Delete'
    },
    es: {
        // Nav
        nav_dashboard: 'Inicio', nav_profile: 'Perfil', logout: 'Salir',
        // Dashboard
        dashboard: 'Panel Principal', welcome_back: 'Bienvenido de nuevo,', hello: 'Hola',
        your_ip: 'Tu IP', date: 'Fecha', time: 'Hora', online_now: 'En L\u00ednea',
        news: 'Novedades',
        news1: 'Nuevo panel admin con usuarios en tiempo real',
        news2_title: 'Perfiles', news2: 'Cambia nombre, contrase\u00f1a, ver detalles',
        news3_title: 'Admin', news3: 'Banear/Desbanear, Planes, Crear usuarios',
        news4_title: 'Multi-idioma', news4: 'Soporte en ingl\u00e9s y espa\u00f1ol',
        users: 'Usuarios', total_attacks: 'Ataques Totales', active_now: 'Activos', today: 'Hoy',
        search_users: 'Buscar Usuarios',
        online_users: 'Usuarios En L\u00ednea',
        // Profile
        my_profile: 'Mi Perfil', profile_sub: 'Administra tu cuenta y revisa tus datos.',
        account_details: 'Detalles de Cuenta', my_plan: 'Mi Plan', minutes: 'Minutos',
        my_sessions: 'Mis Sesiones', create_user: 'Crear Usuario',
        change_name: 'Cambiar Nombre',
        change_name_desc: 'Puedes cambiar tu nombre cada 30 d\u00edas. Los admins pueden cambiar en cualquier momento.',
        change_password: 'Cambiar Contrase\u00f1a', update_password: 'Actualizar Contrase\u00f1a',
        delete_account: 'Eliminar Cuenta', delete_desc: 'Esta acci\u00f3n es permanente y no se puede deshacer.',
        change: 'Cambiar', delete: 'Eliminar'
    }
};

function initLang() {
    var lang = localStorage.getItem('ah_lang') || 'en';
    applyLang(lang);
}

function toggleLang() {
    var current = localStorage.getItem('ah_lang') || 'en';
    var next = current === 'en' ? 'es' : 'en';
    localStorage.setItem('ah_lang', next);
    applyLang(next);
}

function applyLang(lang) {
    var t = TRANSLATIONS[lang] || TRANSLATIONS.en;
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
        var key = el.getAttribute('data-i18n');
        if (t[key]) el.textContent = t[key];
    });
    var btn = document.getElementById('langBtn');
    if (btn) btn.textContent = '\uD83C\uDF10 ' + lang.toUpperCase();
    // Update date/time with locale if elements exist
    var locale = lang === 'es' ? 'es' : 'en';
    var now = new Date();
    var dateEl = document.getElementById('bannerDate');
    var timeEl = document.getElementById('bannerTime');
    if (dateEl) dateEl.textContent = now.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (timeEl) timeEl.textContent = now.toLocaleTimeString(locale);
}
