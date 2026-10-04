const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 7860;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// ─── Допоміжна функція — fetch через https ───────────────────────────────────

function fetchUrl(targetUrl, headers) {
    return new Promise(function (resolve, reject) {
        const parsed = url.parse(targetUrl);
        const options = {
            hostname: parsed.hostname,
            path:     parsed.path,
            method:   'GET',
            headers:  headers || {}
        };

        const req = https.request(options, function (res) {
            const chunks = [];
            res.on('data', function (chunk) { chunks.push(chunk); });
            res.on('end', function () {
                resolve({
                    status:  res.statusCode,
                    headers: res.headers,
                    body:    Buffer.concat(chunks)
                });
            });
        });

        req.on('error', reject);
        req.end();
    });
}

// ─── Витягуємо m3u8 через Puppeteer ─────────────────────────────────────────

async function getM3u8WithPuppeteer(embedUrl) {
    const puppeteer = require('puppeteer-core');

    console.log('[Puppeteer] Відкриваємо:', embedUrl);

    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless:       true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--mute-audio'
        ]
    });

    try {
        const page = await browser.newPage();

        // Перехоплюємо мережеві запити — шукаємо m3u8
        let m3u8Url = null;

        page.on('request', function (request) {
            var reqUrl = request.url();
            if (reqUrl.indexOf('.m3u8') !== -1 && reqUrl.indexOf('strmd.st') !== -1) {
                if (!m3u8Url) {
                    m3u8Url = reqUrl;
                    console.log('[Puppeteer] Знайдено m3u8:', reqUrl);
                }
            }
        });

        await page.setExtraHTTPHeaders({
            'Referer': 'https://embed.st/'
        });

        await page.goto(embedUrl, {
            waitUntil: 'networkidle2',
            timeout:   20000
        });

        // Чекаємо до 10 секунд поки плеєр не завантажить m3u8
        if (!m3u8Url) {
            await new Promise(function (resolve) { setTimeout(resolve, 5000); });
        }

        // Якщо не знайшли через перехоплення — спробуємо через jwplayer
        if (!m3u8Url) {
            try {
                m3u8Url = await page.evaluate(function () {
                    if (window.jwplayer) {
                        var item = jwplayer().getPlaylistItem();
                        return item ? item.file : null;
                    }
                    return null;
                });
                if (m3u8Url) console.log('[Puppeteer] m3u8 з jwplayer:', m3u8Url);
            } catch (e) {
                console.log('[Puppeteer] jwplayer недоступний:', e.message);
            }
        }

        return m3u8Url;
    } finally {
        await browser.close();
    }
}

// ─── Сервер ───────────────────────────────────────────────────────────────────

const server = http.createServer(function (req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsed = url.parse(req.url, true);

    // ── /stream?source=alpha&id=match-id ─────────────────────────────────────
    if (parsed.pathname === '/stream') {
        const source  = parsed.query.source;
        const matchId = parsed.query.id;

        if (!source || !matchId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'source and id are required' }));
            return;
        }

        const apiUrl = 'https://streamed.pk/api/stream/' + source + '/' + matchId;
        console.log('[Proxy] Запит до API:', apiUrl);

        fetchUrl(apiUrl, {
            'Accept':     'application/json',
            'User-Agent': 'Mozilla/5.0'
        })
        .then(function (apiRes) {
            if (apiRes.status !== 200) {
                res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'API returned ' + apiRes.status }));
                return;
            }

            var streams;
            try { streams = JSON.parse(apiRes.body.toString()); }
            catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(streams));
        })
        .catch(function (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        });

        return;
    }

    // ── /m3u8?url=https://embed.st/... ───────────────────────────────────────
    if (parsed.pathname === '/m3u8') {
        var embedUrl = parsed.query.url;

        if (!embedUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'url is required' }));
            return;
        }

        console.log('[Proxy] Отримуємо m3u8 для:', embedUrl);

        getM3u8WithPuppeteer(embedUrl)
            .then(function (m3u8Url) {
                if (m3u8Url) {
                    // Будуємо проксі-URL для m3u8
                    var proxyM3u8 = 'http://192.168.0.104:' + PORT +
                        '/proxy?url=' + encodeURIComponent(m3u8Url);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ m3u8: proxyM3u8, original: m3u8Url }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'm3u8 not found' }));
                }
            })
            .catch(function (err) {
                console.error('[Puppeteer] Помилка:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            });

        return;
    }

    // ── /proxy?url=https://... ────────────────────────────────────────────────
    if (parsed.pathname === '/proxy') {
        var proxyUrl = parsed.query.url;

        if (!proxyUrl) {
            res.writeHead(400);
            res.end('url is required');
            return;
        }

        fetchUrl(proxyUrl, {
            'Referer':    'https://embed.st/',
            'Origin':     'https://embed.st',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        .then(function (proxyRes) {
            var contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
            res.writeHead(proxyRes.status, {
                'Content-Type':                contentType,
                'Access-Control-Allow-Origin': '*'
            });

            if (contentType.indexOf('mpegurl') !== -1 || proxyUrl.indexOf('.m3u8') !== -1) {
                var m3u8Content = proxyRes.body.toString();
                var baseUrl = proxyUrl.substring(0, proxyUrl.lastIndexOf('/') + 1);

                m3u8Content = m3u8Content.replace(/^(?!#)(.+)$/gm, function (line) {
                    var absUrl = line.startsWith('http') ? line : baseUrl + line;
                    return 'http://192.168.0.104:' + PORT +
                        '/proxy?url=' + encodeURIComponent(absUrl);
                });

                res.end(m3u8Content);
            } else {
                res.end(proxyRes.body);
            }
        })
        .catch(function (err) {
            res.writeHead(500);
            res.end(err.message);
        });

        return;
    }

    // ── /health ───────────────────────────────────────────────────────────────
    if (parsed.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', port: PORT }));
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, '0.0.0.0', function () {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║     Streamed Proxy Server v2.0         ║');
    console.log('╠════════════════════════════════════════╣');
    console.log('║  Статус:  ✓ Працює                     ║');
    console.log('║  Порт:    ' + PORT + '                          ║');
    console.log('║  Chrome:  ✓ Знайдено                   ║');
    console.log('║                                        ║');
    console.log('║  Не закривайте це вікно!               ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
});
