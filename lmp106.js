(function () {
    'use strict';

    console.log('[Streamed Plugin] v10.6 loaded');

    // ─── Streamed ─────────────────────────────────────────────────────────────

    var PRIMARY_API  = 'https://streamed.pk/api';
    var FALLBACK_API = 'https://streamed.st/api';
    var EMBED_DOMAIN = 'https://embed.st';
    var PROXY_URL    = 'http://192.168.0.104:7860';

    // ─── LiveTV-UA ────────────────────────────────────────────────────────────

    var LT_API           = 'https://webapi.livetv-ua.com/api';
    // Адреса локального проксі для livetv (livetv-proxy.js). Можна змінити без правки файлу:
    // Lampa.Storage.set('streamed_livetv_proxy', 'http://192.168.0.104:7861')
    var LT_PROXY_DEFAULT = 'http://192.168.0.104:7861';
    // Максимум матчів за один запит (сервер дозволяє до 20, при 30+ повертає 400)
    var LT_LIMIT         = 20;
    // Додаткові види спорту для меню LiveTV (id як у sport_type_id), якщо їх немає серед топ-матчів дня
    var LT_SPORTS_EXTRA  = [];
    // false = приховувати майбутні матчі, для яких трансляції ще немає (has_streams: false)
    var LT_SHOW_WITHOUT_STREAMS = false;
    // Адреса сторінки-обгортки yt.html на вашому https-хостингу (наприклад,
    // 'https://ВАШ-НІК.github.io/lampa-yt/yt.html'). Потрібна, бо в застосунках Lampa (ТВ, ПК)
    // прямий YouTube-iframe дає помилку 153. Можна задати і без правки файлу:
    // Lampa.Storage.set('streamed_yt_wrapper', 'https://.../yt.html')
    var LT_YT_WRAPPER = 'https://vvilliam1987.github.io/lampa-yt/yt.html';
    // true = показувати Noty-повідомлення про кроки (для діагностики на ТВ)
    var DEBUG            = true;

    var cachedSports = null;

    var SPORTS_TRANSLATE = {
        'football':          'Футбол',
        'basketball':        'Баскетбол',
        'american-football': 'Американський футбол',
        'hockey':            'Хокей',
        'baseball':          'Бейсбол',
        'motor-sports':      'Авто/Мотоспорт',
        'fight':             'Єдиноборства',
        'tennis':            'Теніс',
        'rugby':             'Регбі',
        'cricket':           'Крикет',
        'darts':             'Дартс',
        'golf':              'Гольф',
        'mma':               'Єдиноборства',
        'boxing':            'Бокс',
        'billiards':         'Більярд',
        'volleyball':        'Волейбол',
        'handball':          'Гандбол',
        'futsal':            'Футзал',
        'esports':           'Кіберспорт',
        'table-tennis':      'Настільний теніс',
        'other':             'Інші трансляції'
    };

    // Бажаний порядок категорій
    var SPORTS_ORDER = [
        'football', 'basketball', 'fight', 'mma', 'tennis', 'billiards',
        'motor-sports', 'hockey', 'golf', 'baseball', 'american-football',
        'rugby', 'cricket', 'darts', 'other'
    ];

    // Категорії які приховуємо з меню
    var HIDDEN_CATEGORIES = ['afl'];

    var LANG_NAMES = {
        'uk': 'Українська', 'en': 'English', 'ru': 'Русский', 'ro': 'Română',
        'hr': 'Hrvatski', 'pl': 'Polski', 'de': 'Deutsch', 'es': 'Español',
        'fr': 'Français', 'it': 'Italiano', 'pt': 'Português', 'tr': 'Türkçe',
        'sr': 'Srpski', 'cs': 'Čeština', 'bg': 'Български', 'en-ca': 'English (CA)'
    };

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function toggleLoader(active) {
        try {
            if (window.Lampa && Lampa.Loading) {
                if (active) Lampa.Loading.start();
                else Lampa.Loading.stop();
            }
        } catch (e) {}
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function dbg(msg) {
        console.log('[LiveTV] ' + msg);
        if (DEBUG) {
            try { Lampa.Noty.show('LiveTV: ' + msg); } catch (e) {}
        }
    }

    function copyUrlToClipboard(url) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(function () {
                    Lampa.Noty.show('✅ Посилання скопійовано!');
                });
                return;
            }
        } catch (e) {}
        try {
            var ta = document.createElement('textarea');
            ta.value = url;
            ta.style.position = 'fixed';
            ta.style.opacity  = '0';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            Lampa.Noty.show('✅ Посилання скопійовано!');
        } catch (e) {
            Lampa.Noty.show(url);
        }
    }

    function showOpenDialog(url, title) {
        Lampa.Select.show({
            title: title,
            items: [
                { title: '🌐 Відкрити у браузері', action: 'browser' },
                { title: '📋 Скопіювати посилання', action: 'copy' }
            ],
            onSelect: function (selected) {
                if (selected.action === 'browser') {
                    var w = null;
                    try { w = window.open(url, '_blank'); } catch (e) {}
                    if (!w) {
                        copyUrlToClipboard(url);
                        Lampa.Noty.show('Браузер на цьому пристрої недоступний, посилання скопійовано');
                    }
                } else {
                    copyUrlToClipboard(url);
                }
            },
            onBack: function () { Lampa.Controller.toggle('content'); }
        });
    }

    function requestData(path, onSuccess, onError) {
        var targets = [PRIMARY_API + path, FALLBACK_API + path];
        var urlsToTry = [];

        for (var t = 0; t < targets.length; t++) {
            var url = targets[t];
            urlsToTry.push(url);
            urlsToTry.push('https://corsproxy.io/?' + encodeURIComponent(url));
            urlsToTry.push('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url));
        }

        function tryFetch(index) {
            if (index >= urlsToTry.length) {
                if (onError) onError();
                return;
            }
            fetch(urlsToTry[index], { headers: { 'Accept': 'application/json' } })
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (data) {
                    if (data != null) onSuccess(data);
                    else tryFetch(index + 1);
                })
                .catch(function () { tryFetch(index + 1); });
        }

        tryFetch(0);
    }

    function getBadgeUrl(badgeId) {
        if (!badgeId) return '';
        return PRIMARY_API + '/images/badge/' + badgeId + '.webp';
    }

    function getPosterUrl(match) {
        if (match.poster) {
            return PRIMARY_API + '/images/proxy/' + match.poster + '.webp';
        }
        if (match.teams && match.teams.home && match.teams.away &&
            match.teams.home.badge && match.teams.away.badge) {
            return PRIMARY_API + '/images/poster/' +
                match.teams.home.badge + '/' + match.teams.away.badge + '.webp';
        }
        return '';
    }

    // ─── Компонент списку матчів (Streamed) ──────────────────────────────────

    function StreamedMatchesComponent(object) {
        var comp = this;
        var scroll;
        var category = object.category || { id: 'all', name: 'Всі події' };

        this.create = function () {
            scroll = new Lampa.Scroll({ mask: true, over: true, scroll_by_item: true });
            scroll.render().addClass('category-full');
            scroll.minus();
            toggleLoader(true);
            comp.loadData();
        };

        this.render = function () {
            return scroll.render();
        };

        this.loadData = function () {
            var catId = String(category.id || 'all').toLowerCase();
            var path;

            if (catId === 'live') path = '/matches/live';
            else if (catId === 'all-today') path = '/matches/all-today';
            else if (catId === 'all') path = '/matches/all';
            else path = '/matches/' + catId;

            requestData(path, function (data) {
                toggleLoader(false);
                if (Array.isArray(data) && data.length) comp.buildGrid(data);
                else comp.showEmpty('Зараз немає активних матчів у цій категорії');
            }, function () {
                toggleLoader(false);
                Lampa.Noty.show('Помилка з\'єднання з сервером Streamed');
                comp.showEmpty('Не вдалося завантажити дані');
            });
        };

        this.showEmpty = function (msg) {
            scroll.append((new Lampa.Empty({ title: msg })).render());
        };

        // Карткова сітка з постерами
        this.buildGrid = function (items) {
            var grid = $('<div style="display:flex;flex-wrap:wrap;gap:16px;padding:16px;box-sizing:border-box;width:100%;"></div>');
            var now = Date.now();
            var elements = [];

            for (var i = 0; i < items.length; i++) {
                (function (match, index) {
                    var isLive = match.date && match.date <= now;
                    var timeStr = match.date
                        ? new Date(match.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '';

                    var title = match.title
                        || (match.teams && match.teams.home && match.teams.away
                            ? match.teams.home.name + ' vs ' + match.teams.away.name
                            : 'Трансляція');

                    var posterUrl = getPosterUrl(match);
                    var homeBadge = (match.teams && match.teams.home && match.teams.home.badge)
                        ? getBadgeUrl(match.teams.home.badge) : '';
                    var awayBadge = (match.teams && match.teams.away && match.teams.away.badge)
                        ? getBadgeUrl(match.teams.away.badge) : '';

                    // Постер або плейсхолдер з емблемами команд
                    var imageHtml;
                    if (posterUrl) {
                        imageHtml = '<img src="' + posterUrl + '" loading="lazy"' +
                            ' style="width:100%;height:130px;object-fit:cover;border-radius:8px 8px 0 0;"' +
                            ' onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'">' +
                            '<div style="display:none;width:100%;height:130px;background:rgba(255,255,255,0.05);' +
                            'border-radius:8px 8px 0 0;align-items:center;justify-content:center;gap:12px;">' +
                            (homeBadge ? '<img src="' + homeBadge + '" width="48" height="48" onerror="this.style.display=\'none\'">' : '') +
                            '<span style="color:#aaa;font-size:0.9em;">vs</span>' +
                            (awayBadge ? '<img src="' + awayBadge + '" width="48" height="48" onerror="this.style.display=\'none\'">' : '') +
                            '</div>';
                    } else if (homeBadge || awayBadge) {
                        imageHtml = '<div style="width:100%;height:130px;background:rgba(255,255,255,0.05);' +
                            'border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;gap:12px;">' +
                            (homeBadge ? '<img src="' + homeBadge + '" width="48" height="48" onerror="this.style.display=\'none\'">' : '') +
                            '<span style="color:#aaa;font-size:0.9em;">vs</span>' +
                            (awayBadge ? '<img src="' + awayBadge + '" width="48" height="48" onerror="this.style.display=\'none\'">' : '') +
                            '</div>';
                    } else {
                        imageHtml = '<div style="width:100%;height:130px;background:rgba(255,255,255,0.05);' +
                            'border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;">' +
                            '<span style="font-size:2em;">🏆</span></div>';
                    }

                    var statusHtml = isLive
                        ? '<span style="color:#2ecc71;font-weight:bold;font-size:0.75em;">● LIVE' + (timeStr ? ' ' + timeStr : '') + '</span>'
                        : '<span style="color:#f39c12;font-size:0.75em;">⏰ ' + (timeStr || 'Незабаром') + '</span>';

                    var card = $(
                        '<div class="selector focusable" tabindex="0"' +
                        ' style="width:calc(25% - 12px);min-width:180px;background:rgba(255,255,255,0.05);' +
                        'border-radius:8px;cursor:pointer;outline:none;transition:transform 0.15s,background 0.15s;flex-shrink:0;">' +
                        imageHtml +
                        '<div style="padding:10px;">' +
                        '<div style="font-size:0.9em;font-weight:bold;margin-bottom:4px;line-height:1.3;">' + title + '</div>' +
                        statusHtml +
                        '</div></div>'
                    );

                    card.on('focus mouseenter', function () {
                        $(this).css({ 'background': 'rgba(255,255,255,0.15)', 'transform': 'scale(1.03)' });
                        // Просимо scroll підтягнути картку в зону видимості
                        scroll.update($(this));
                    });
                    card.on('blur mouseleave', function () {
                        $(this).css({ 'background': 'rgba(255,255,255,0.05)', 'transform': 'scale(1)' });
                    });
                    card.on('hover:enter click', function () {
                        comp.selectMatch(match);
                    });
                    card.on('keydown', function (e) {
                        var key = e.keyCode || e.which;
                        var cols = Math.floor(grid.width() / 196) || 4;
                        if (key === 13) { comp.selectMatch(match); }
                        else if (key === 38 && index >= cols) { elements[index - cols].focus(); e.preventDefault(); }
                        else if (key === 40 && index + cols < elements.length) { elements[index + cols].focus(); e.preventDefault(); }
                        else if (key === 37 && index > 0) { elements[index - 1].focus(); e.preventDefault(); }
                        else if (key === 39 && index < elements.length - 1) { elements[index + 1].focus(); e.preventDefault(); }
                        else if (key === 8 || key === 27) { Lampa.Activity.backward(); e.preventDefault(); }
                    });

                    elements.push(card);
                    grid.append(card);
                })(items[i], i);
            }

            scroll.append(grid);
            setTimeout(function () {
                if (elements.length) elements[0].focus();
            }, 150);
            Lampa.Controller.enable('content');
        };

        this.selectMatch = function (match) {
            if (!Array.isArray(match.sources) || !match.sources.length) {
                Lampa.Noty.show('Немає доступних джерел для цього матчу');
                return;
            }

            var items = [];
            for (var i = 0; i < match.sources.length; i++) {
                var src = match.sources[i];
                items.push({
                    title:  'Джерело ' + (i + 1) + ' — ' + src.source.toUpperCase(),
                    source: src.source,
                    id:     src.id
                });
            }

            Lampa.Select.show({
                title:    match.title || 'Оберіть джерело',
                items:    items,
                onSelect: function (selected) { comp.loadStreams(selected, match.title); },
                onBack:   function () { Lampa.Controller.toggle('content'); }
            });
        };

        this.loadStreams = function (src, matchTitle) {
            toggleLoader(true);

            // Спочатку перевіряємо чи доступний проксі-сервер
            fetch(PROXY_URL + '/health')
                .then(function (r) { return r.json(); })
                .then(function () {
                    // Проксі доступний — отримуємо потоки через нього
                    comp.loadStreamsViaProxy(src, matchTitle);
                })
                .catch(function () {
                    // Проксі недоступний — fallback на старий метод (браузер)
                    toggleLoader(false);
                    comp.loadStreamsFallback(src, matchTitle);
                });
        };

        this.loadStreamsViaProxy = function (src, matchTitle) {
            var path = '/stream/' + src.source + '/' + src.id;

            requestData(path, function (streams) {
                toggleLoader(false);
                if (!Array.isArray(streams) || !streams.length) {
                    comp.loadStreamsFallback(src, matchTitle);
                    return;
                }

                if (streams.length === 1) {
                    comp.playViaProxy(streams[0], matchTitle);
                    return;
                }

                var streamItems = [];
                for (var i = 0; i < streams.length; i++) {
                    var s = streams[i];
                    streamItems.push({
                        title:  '#' + s.streamNo + ' ' + (s.language || 'Unknown') + (s.hd ? ' [HD]' : ' [SD]'),
                        stream: s
                    });
                }
                Lampa.Select.show({
                    title:    matchTitle || 'Оберіть потік',
                    items:    streamItems,
                    onSelect: function (sel) { comp.playViaProxy(sel.stream, matchTitle); },
                    onBack:   function () { Lampa.Controller.toggle('content'); }
                });
            }, function () {
                toggleLoader(false);
                comp.loadStreamsFallback(src, matchTitle);
            });
        };

        // Намагаємось отримати m3u8 через проксі і грати напряму в плеєрі
        this.playViaProxy = function (stream, matchTitle) {
            var embedUrl = stream.embedUrl;
            if (!embedUrl) { Lampa.Noty.show('Посилання відсутнє'); return; }

            var title = matchTitle || ('Потік #' + stream.streamNo);
            console.log('[Streamed] playViaProxy embedUrl:', embedUrl);

            toggleLoader(true);

            // Просимо проксі витягнути m3u8 зі сторінки embed.st
            fetch(PROXY_URL + '/m3u8?url=' + encodeURIComponent(embedUrl))
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    toggleLoader(false);
                    if (data.m3u8) {
                        // Є прямий m3u8 — грємо через проксі з правильним Referer
                        var proxyM3u8 = PROXY_URL + '/proxy?url=' + encodeURIComponent(data.m3u8);
                        console.log('[Streamed] Граємо m3u8 через проксі:', proxyM3u8);
                        Lampa.Player.play({ url: proxyM3u8, title: title });
                        Lampa.Player.playlist([]);
                    } else {
                        // m3u8 не знайдено — fallback на браузер
                        comp.playStream(stream, matchTitle);
                    }
                })
                .catch(function () {
                    toggleLoader(false);
                    comp.playStream(stream, matchTitle);
                });
        };

        // Fallback — старий метод через браузер
        this.loadStreamsFallback = function (src, matchTitle) {
            var streamItems = [];
            for (var streamNo = 1; streamNo <= 3; streamNo++) {
                var embedUrl = EMBED_DOMAIN + '/embed/' + src.source + '/' + src.id + '/' + streamNo;
                streamItems.push({
                    title:  'Потік #' + streamNo + ' (' + src.source.toUpperCase() + ')',
                    stream: { embedUrl: embedUrl, streamNo: streamNo }
                });
            }
            Lampa.Select.show({
                title:    matchTitle || 'Оберіть потік',
                items:    streamItems,
                onSelect: function (sel) { comp.playStream(sel.stream, matchTitle); },
                onBack:   function () { Lampa.Controller.toggle('content'); }
            });
        };

        this.playStream = function (stream, matchTitle) {
            var url = stream.embedUrl;
            if (!url) { Lampa.Noty.show('Посилання на потік відсутнє'); return; }

            var title = matchTitle || ('Потік #' + stream.streamNo);
            console.log('[Streamed] embedUrl:', url);

            var isDirectStream = (
                url.indexOf('.m3u8') !== -1 ||
                url.indexOf('.ts')   !== -1 ||
                url.indexOf('rtmp://') === 0 ||
                url.indexOf('rtmps://') === 0
            );

            if (isDirectStream) {
                Lampa.Player.play({ url: url, title: title });
                Lampa.Player.playlist([]);
                return;
            }

            showOpenDialog(url, title);
        };

        this.copyUrl = function (url) {
            copyUrlToClipboard(url);
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
                },
                left:  function () { Lampa.Activity.backward(); },
                up:    function () {
                    var focused = scroll.render().find(':focus');
                    if (focused.length) focused.trigger({ type: 'keydown', keyCode: 38 });
                    else scroll.render().find('.selector').first().focus();
                },
                down:  function () {
                    var focused = scroll.render().find(':focus');
                    if (focused.length) focused.trigger({ type: 'keydown', keyCode: 40 });
                    else scroll.render().find('.selector').first().focus();
                },
                back:  function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause   = function () {};
        this.stop    = function () {};
        this.destroy = function () {};
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  LiveTV-UA провайдер
    // ═════════════════════════════════════════════════════════════════════════

    function ltProxyUrl() {
        var saved = '';
        try { saved = Lampa.Storage.get('streamed_livetv_proxy', '') || ''; } catch (e) {}
        return String(saved || LT_PROXY_DEFAULT).replace(/\/+$/, '');
    }

    function pad2(n) { return n < 10 ? '0' + n : '' + n; }

    function todayStr() {
        var d = new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    // GET JSON з API livetv-ua (CORS для API дозволений)
    function ltJson(path, onSuccess, onError) {
        fetch(LT_API + path, { headers: { 'Accept': 'application/json' } })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                setTimeout(function () { onSuccess(data); }, 0);
            }, function (e) {
                console.log('[LiveTV] помилка запиту', path, e && e.message);
                if (onError) onError(e);
            });
    }

    var ltCache = {};

    // opts: { live: true } — лише прямі; { sport: 'football' } — один вид спорту; {} — усі не завершені
    function ltQuery(opts) {
        opts = opts || {};
        var q = '/v1/match?dates=' + todayStr() + '&lang=uk&order_by=rating%20DESC&limit=' + LT_LIMIT;
        q += opts.live ? '&only_live=true' : '&only_finished=false';
        if (opts.sport) q += '&sport_type=' + encodeURIComponent(opts.sport);
        if (opts.search) q += '&s=' + encodeURIComponent(opts.search);
        return q;
    }

    function ltGetMatches(opts, onSuccess, onError) {
        var q = ltQuery(opts);
        var hit = ltCache[q];
        if (hit && Date.now() - hit.ts < 60000) {
            onSuccess(hit.data);
            return;
        }
        ltJson(q, function (list) {
            if (!Array.isArray(list)) { if (onError) onError(); return; }
            ltCache[q] = { ts: Date.now(), data: list };
            onSuccess(list);
        }, onError);
    }

    // Завершені сервер уже відфільтрував; тут страховка і порядок: живі першими
    function ltPrepare(list) {
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (m.is_finished || m.is_postponed) continue;
            if (!LT_SHOW_WITHOUT_STREAMS && !m.has_streams && !m.is_live) continue;
            out.push({ m: m, i: i });
        }
        out.sort(function (a, b) {
            var la = a.m.is_live ? 0 : 1;
            var lb = b.m.is_live ? 0 : 1;
            return la !== lb ? la - lb : a.i - b.i;
        });
        var res = [];
        for (var k = 0; k < out.length; k++) res.push(out[k].m);
        return res;
    }

    // ─── Меню видів спорту LiveTV ────────────────────────────────────────────

    // Країна змагання = частина назви змагання перед першою крапкою ("Україна. УХЛ" -> "Україна")
    function ltCountryOf(m) {
        var t = (m && m.competition && m.competition.title) ? String(m.competition.title) : '';
        var i = t.indexOf('. ');
        return i > 0 ? t.slice(0, i) : '';
    }

    function ltMerge(base, extra) {
        var seen = {};
        var out = [];
        var i;
        for (i = 0; i < base.length; i++) { seen[base[i].id] = true; out.push(base[i]); }
        for (i = 0; i < extra.length; i++) {
            if (!seen[extra[i].id]) { seen[extra[i].id] = true; out.push(extra[i]); }
        }
        return out;
    }

    // Кілька запитів паралельно; помилки окремих запитів ігноруються
    function ltGetMany(optsList, onSuccess) {
        var pending = optsList.length;
        var merged = [];
        if (!pending) { onSuccess(merged); return; }
        function done() { pending--; if (pending === 0) onSuccess(merged); }
        for (var i = 0; i < optsList.length; i++) {
            ltGetMatches(optsList[i], function (list) {
                merged = ltMerge(merged, list);
                done();
            }, done);
        }
    }

    // Меню країн: збираємо з матчів дня (популярні + по кожному виду спорту)
    function openLivetvCountries() {
        toggleLoader(true);
        ltGetMatches({}, function (first) {
            var sports = [];
            var seen = {};
            var i;
            for (i = 0; i < first.length; i++) {
                var sid = first[i].sport_type_id;
                if (sid && !seen[sid]) { seen[sid] = true; sports.push(sid); }
            }
            for (i = 0; i < LT_SPORTS_EXTRA.length; i++) {
                if (!seen[LT_SPORTS_EXTRA[i]]) { seen[LT_SPORTS_EXTRA[i]] = true; sports.push(LT_SPORTS_EXTRA[i]); }
            }
            var reqs = [];
            for (i = 0; i < sports.length; i++) reqs.push({ sport: sports[i] });

            ltGetMany(reqs, function (more) {
                toggleLoader(false);
                var shown = ltPrepare(ltMerge(first, more));
                var counts = {};
                var names = [];
                for (var k = 0; k < shown.length; k++) {
                    var c = ltCountryOf(shown[k]);
                    if (!c) continue;
                    if (!counts[c]) { counts[c] = 0; names.push(c); }
                    counts[c]++;
                }
                if (!names.length) {
                    Lampa.Noty.show('LiveTV-UA: країн не знайдено');
                    return;
                }
                names.sort(function (a, b) {
                    return (counts[b] - counts[a]) || (a < b ? -1 : 1);
                });
                var items = [];
                for (var j = 0; j < names.length; j++) {
                    items.push({
                        title:    names[j],
                        subtitle: 'Матчів: ' + counts[names[j]],
                        category: { id: 'country:' + names[j], name: names[j] }
                    });
                }
                Lampa.Select.show({
                    title: 'Країни',
                    items: items,
                    onSelect: function (selected) {
                        Lampa.Activity.push({
                            url:       '',
                            title:     selected.title,
                            component: 'livetv_matches',
                            category:  selected.category,
                            page:      1
                        });
                    },
                    onBack: function () { Lampa.Controller.toggle('menu'); }
                });
            });
        }, function () {
            toggleLoader(false);
            Lampa.Noty.show('LiveTV-UA: не вдалося завантажити список матчів');
        });
    }

    // Пошук матчу за текстом (команда, країна, змагання)
    function ltAskSearch() {
        try {
            Lampa.Input.edit({ free: true, title: 'Пошук матчу (команда, країна, змагання)', nosave: true, value: '' }, function (val) {
                var t = String(val || '').replace(/^\s+|\s+$/g, '');
                if (!t) return;
                Lampa.Activity.push({
                    url:       '',
                    title:     'Пошук: ' + t,
                    component: 'livetv_matches',
                    category:  { id: 'search:' + t, name: t },
                    page:      1
                });
            });
        } catch (e) {
            Lampa.Noty.show('Пошук недоступний у цій збірці Lampa');
        }
    }

    function openLivetvMenu() {
        toggleLoader(true);
        ltGetMatches({}, function (list) {
            toggleLoader(false);

            var items = [
                { title: 'Популярні',        category: { id: 'all',  name: 'Популярні'        } },
                { title: 'Прямі трансляції', category: { id: 'live', name: 'Прямі трансляції' } },
                { title: '🔍 Пошук',         action: 'search' },
                { title: '🌍 За країнами',   action: 'countries' }
            ];

            // Види спорту: ті, що є серед матчів дня, плюс LT_SPORTS_EXTRA
            if (DEBUG) {
                items.push({ title: '🔧 Матч за ID', action: 'byid' });
            }

            var seen = {};
            var sports = [];
            var i;
            for (i = 0; i < list.length; i++) {
                var sid = list[i].sport_type_id;
                if (!sid || seen[sid]) continue;
                seen[sid] = true;
                sports.push(sid);
            }
            for (i = 0; i < LT_SPORTS_EXTRA.length; i++) {
                if (!seen[LT_SPORTS_EXTRA[i]]) {
                    seen[LT_SPORTS_EXTRA[i]] = true;
                    sports.push(LT_SPORTS_EXTRA[i]);
                }
            }

            sports.sort(function (a, b) {
                var ia = SPORTS_ORDER.indexOf(a); if (ia === -1) ia = 999;
                var ib = SPORTS_ORDER.indexOf(b); if (ib === -1) ib = 999;
                return ia - ib;
            });

            for (var j = 0; j < sports.length; j++) {
                items.push({
                    title:    SPORTS_TRANSLATE[sports[j]] || sports[j],
                    category: { id: sports[j], name: SPORTS_TRANSLATE[sports[j]] || sports[j] }
                });
            }

            if (!list.length && !sports.length) {
                Lampa.Noty.show('LiveTV-UA: на сьогодні матчів немає');
                return;
            }

            Lampa.Select.show({
                title: 'LiveTV-UA',
                items: items,
                onSelect: function (selected) {
                    if (selected.action === 'byid')      { setTimeout(ltAskMatchId, 10); return; }
                    if (selected.action === 'search')    { setTimeout(ltAskSearch, 10); return; }
                    if (selected.action === 'countries') { setTimeout(openLivetvCountries, 10); return; }
                    Lampa.Activity.push({
                        url:       '',
                        title:     selected.title,
                        component: 'livetv_matches',
                        category:  selected.category,
                        page:      1
                    });
                },
                onBack: function () { Lampa.Controller.toggle('menu'); }
            });
        }, function () {
            toggleLoader(false);
            Lampa.Noty.show('LiveTV-UA: не вдалося завантажити список матчів');
        });
    }

    // ─── Потоки LiveTV ───────────────────────────────────────────────────────

    // Поки що вбудовано відтворюємо лише aliez (потік на сторінці emb.apl614.online)
    function ltIsYoutube(s) {
        return !!s && s.stream_channel_id === 'youtube';
    }

    function ltSupported(s) {
        return !!s && (s.stream_channel_id === 'aliez' || ltIsYoutube(s));
    }

    function ltYoutubeId(url) {
        var m = /(?:youtube\.com\/(?:embed\/|live\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url || '');
        return m ? m[1] : '';
    }

    function ltStreamRank(s) {
        var r = 0;
        if (!ltSupported(s)) r += 4;
        if (s.language_id !== 'uk') r += 2;
        if (!s.is_trusted) r += 1;
        return r;
    }

    function ltSortStreams(streams) {
        var tmp = [];
        for (var i = 0; i < streams.length; i++) tmp.push({ s: streams[i], i: i });
        tmp.sort(function (a, b) {
            var d = ltStreamRank(a.s) - ltStreamRank(b.s);
            return d !== 0 ? d : a.i - b.i;
        });
        var out = [];
        for (var k = 0; k < tmp.length; k++) out.push(tmp[k].s);
        return out;
    }

    function ltStreamTitle(s) {
        var lang = LANG_NAMES[s.language_id] ||
            (s.language_id ? String(s.language_id).toUpperCase() : '');
        var base = ltIsYoutube(s) ? 'YouTube' + (lang ? ' · ' + lang : '') : (lang || 'Без мови');
        return base + (s.author && s.author.name ? ' — ' + s.author.name : '');
    }

    function ltStreamSubtitle(s) {
        if (ltIsYoutube(s)) return 'Відео YouTube (на початку може бути реклама)';
        return ltSupported(s) ? 'Вбудований плеєр Lampa' : 'Відкриється у браузері';
    }

    // Альтернативний YouTube-плеєр: власний iframe на весь екран з явним referrerpolicy
    // (YouTube може відмовляти у відтворенні, якщо не бачить, хто вбудовує відео)
    var ltYtOverlay = null;
    var ltYtKeyHandler = null;

    function ltCloseYoutube() {
        if (ltYtKeyHandler) {
            document.removeEventListener('keydown', ltYtKeyHandler, true);
            ltYtKeyHandler = null;
        }
        if (ltYtOverlay) {
            try { ltYtOverlay.remove(); } catch (e) {}
            ltYtOverlay = null;
        }
        try { Lampa.Controller.toggle('content'); } catch (e) {}
    }

    function ltYtWrapper() {
        var saved = '';
        try { saved = Lampa.Storage.get('streamed_yt_wrapper', '') || ''; } catch (e) {}
        return String(saved || LT_YT_WRAPPER || '');
    }

    function ltOpenYoutubeFrame(id) {
        ltCloseYoutube();

        var wrapper = ltYtWrapper();
        var src = wrapper
            ? wrapper + (wrapper.indexOf('?') === -1 ? '?' : '&') + 'v=' + id
            : 'https://www.youtube.com/embed/' + id +
              '?autoplay=1&playsinline=1&rel=0&origin=' + encodeURIComponent(location.origin);

        var box = $('<div style="position:fixed;left:0;top:0;width:100%;height:100%;background:#000;z-index:99999;"></div>');
        var frame = $('<iframe allowfullscreen referrerpolicy="strict-origin-when-cross-origin"' +
            ' allow="autoplay; encrypted-media; fullscreen"' +
            ' style="width:100%;height:100%;border:0;"></iframe>');
        frame.attr('src', src);
        box.append(frame);
        $('body').append(box);
        ltYtOverlay = box;

        // Пульт: «Назад» закриває плеєр, решта клавіш не потрапляє в меню під ним
        ltYtKeyHandler = function (e) {
            var k = e.keyCode || e.which;
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            if (k === 8 || k === 27 || k === 4 || k === 10009 || k === 461) ltCloseYoutube();
        };
        document.addEventListener('keydown', ltYtKeyHandler, true);

        dbg((wrapper ? 'YouTube через обгортку' : 'альтернативний YouTube-плеєр') + '; «Назад» — закрити');
    }

    function ltPlayYoutube(id, pageUrl, title) {
        try {
            ltOpenYoutubeFrame(id);
        } catch (e) {
            console.log('[LiveTV] помилка YouTube-плеєра', e);
            dbg('не вдалося відкрити YouTube-плеєр');
            showOpenDialog(pageUrl, title);
        }
    }

    function ltExtractM3u8(html) {
        var m = /pl\.init\(\s*['"]([^'"]+)['"]/.exec(html || '');
        if (!m) return '';
        var u = m[1];
        if (u.indexOf('//') === 0) u = 'https:' + u;
        return u;
    }

    // Сторінка плеєра -> m3u8. Спершу напряму (на деяких ТВ CORS може не діяти), потім через проксі.
    function ltResolveAliez(pageUrl, playerId, onOk, onFail) {
        function viaProxy(reason) {
            dbg('напряму не вийшло (' + reason + '), пробую проксі');
            fetch(ltProxyUrl() + '/livetv/stream?id=' + encodeURIComponent(playerId))
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (d) {
                    if (d && d.url) onOk(d.url);
                    else onFail('проксі не знайшов потік');
                }, function (e) {
                    onFail('проксі недоступний (' + (e && e.message ? e.message : 'помилка') + ')');
                });
        }

        fetch(pageUrl)
            .then(function (r) { return r.text(); })
            .then(function (html) {
                var u = ltExtractM3u8(html);
                if (u) onOk(u);
                else viaProxy('на сторінці немає потоку');
            }, function (e) {
                viaProxy(e && e.message ? e.message : 'помилка');
            });
    }

    function ltPlayStream(stream, title) {
        toggleLoader(true);
        ltJson('/v2/stream/' + stream.id + '?lang=uk', function (d) {
            var pageUrl = d && d.url;
            if (!pageUrl) {
                toggleLoader(false);
                Lampa.Noty.show('LiveTV: порожня відповідь для потоку');
                return;
            }

            var yid = ltIsYoutube(stream) ? ltYoutubeId(pageUrl) : '';
            if (yid) {
                toggleLoader(false);
                ltPlayYoutube(yid, pageUrl, title);
                return;
            }

            var idm = /live\.php\?id=(\d+)/.exec(pageUrl);
            if (ltSupported(stream) && idm) {
                dbg('отримано сторінку плеєра, шукаю потік…');
                ltResolveAliez(pageUrl, idm[1], function (m3u8) {
                    toggleLoader(false);
                    dbg('потік знайдено, запускаю');
                    Lampa.Player.play({ url: m3u8, title: title });
                    Lampa.Player.playlist([]);
                }, function (why) {
                    toggleLoader(false);
                    dbg('не вдалося отримати потік: ' + why);
                    showOpenDialog(pageUrl, title);
                });
            } else {
                toggleLoader(false);
                showOpenDialog(pageUrl, title);
            }
        }, function () {
            toggleLoader(false);
            Lampa.Noty.show('LiveTV: не вдалося отримати дані потоку');
        });
    }

    // Налагодження: відкрити матч за ID (число в кінці адреси сторінки матчу на livetv-ua.com)
    function ltAskMatchId() {
        try {
            Lampa.Input.edit({ free: true, title: 'ID матчу livetv-ua', nosave: true, value: '' }, function (val) {
                var id = String(val || '').replace(/\D/g, '');
                if (!id) { try { Lampa.Controller.toggle('menu'); } catch (e) {} return; }
                toggleLoader(true);
                function go(name) {
                    toggleLoader(false);
                    ltSelectMatch({ id: id, name: name || ('Матч ' + id) }, true);
                }
                ltJson('/v1/match/' + id, function (m) {
                    go(m && m.name);
                }, function () {
                    go('');
                });
            });
        } catch (e) {
            Lampa.Noty.show('Ввід ID недоступний у цій збірці Lampa');
        }
    }

    function ltSelectMatch(match, force) {
        if (!force && !match.has_streams && !match.is_live) {
            Lampa.Noty.show('Для цього матчу ще немає трансляції');
            return;
        }

        toggleLoader(true);
        ltJson('/v1/match/' + match.id + '/streams', function (streams) {
            toggleLoader(false);
            if (!Array.isArray(streams) || !streams.length) {
                Lampa.Noty.show('Для цього матчу ще немає потоків');
                return;
            }

            streams = ltSortStreams(streams);
            var items = [];
            for (var i = 0; i < streams.length; i++) {
                items.push({
                    title:    ltStreamTitle(streams[i]),
                    subtitle: ltStreamSubtitle(streams[i]),
                    stream:   streams[i]
                });
            }

            Lampa.Select.show({
                title:    match.name || 'Оберіть потік',
                items:    items,
                onSelect: function (sel) { ltPlayStream(sel.stream, match.name || 'LiveTV'); },
                onBack:   function () { Lampa.Controller.toggle('content'); }
            });
        }, function () {
            toggleLoader(false);
            Lampa.Noty.show('LiveTV: не вдалося завантажити потоки матчу');
        });
    }

    // ─── Картка матчу LiveTV ─────────────────────────────────────────────────

    function ltCardHtml(m) {
        var teams = m.teams || [];
        var home = null, away = null;
        for (var i = 0; i < teams.length; i++) {
            if (teams[i].home_team && !home) home = teams[i];
            else if (!away) away = teams[i];
        }

        function logo(t) {
            return (t && t.avatar_url)
                ? '<img src="' + esc(t.avatar_url) + '" width="52" height="52" style="object-fit:contain;"' +
                  ' onerror="this.style.display=\'none\'">'
                : '';
        }

        var middle = (m.is_live && home && away)
            ? '<span style="font-weight:bold;font-size:1.2em;">' + esc(home.score) + ' : ' + esc(away.score) + '</span>'
            : '<span style="color:#aaa;font-size:0.9em;">vs</span>';

        var imageHtml =
            '<div style="width:100%;height:130px;background:rgba(255,255,255,0.05);' +
            'border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;gap:14px;">' +
            (logo(home) || (home ? '' : '<span style="font-size:2em;">🏆</span>')) + middle + logo(away) +
            '</div>';

        var d = m.date ? new Date(m.date) : null;
        var timeStr = '';
        if (d && !isNaN(d.getTime())) {
            timeStr = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
            var dayStr = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
            if (dayStr !== todayStr()) timeStr = pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + ' ' + timeStr;
        }

        var statusHtml;
        if (m.is_live) {
            var ct = m.current_time ? ' ' + esc(m.current_time) + (/^\d+$/.test(String(m.current_time)) ? '\'' : '') : '';
            statusHtml = '<span style="color:#2ecc71;font-weight:bold;font-size:0.75em;">● LIVE' + ct + '</span>';
        } else {
            statusHtml = '<span style="color:#f39c12;font-size:0.75em;">⏰ ' + (timeStr || 'Незабаром') + '</span>';
            if (!m.has_streams) {
                statusHtml += '<span style="color:#888;font-size:0.75em;"> · трансляції ще немає</span>';
            }
        }

        var comp = (m.competition && m.competition.title)
            ? '<div style="font-size:0.75em;color:#aaa;margin-bottom:4px;">' + esc(m.competition.title) + '</div>'
            : '';

        return imageHtml +
            '<div style="padding:10px;">' +
            '<div style="font-size:0.9em;font-weight:bold;margin-bottom:4px;line-height:1.3;">' + esc(m.name) + '</div>' +
            comp + statusHtml +
            '</div>';
    }

    // ─── Компонент списку матчів (LiveTV) ────────────────────────────────────

    function LivetvMatchesComponent(object) {
        var comp = this;
        var scroll;
        var category = object.category || { id: 'all', name: 'Всі матчі' };

        this.create = function () {
            scroll = new Lampa.Scroll({ mask: true, over: true, scroll_by_item: true });
            scroll.render().addClass('category-full');
            scroll.minus();
            toggleLoader(true);
            comp.loadData();
        };

        this.render = function () {
            return scroll.render();
        };

        this.loadData = function () {
            var cid    = String(category.id || 'all');
            var opts   = {};
            var strict = '';
            if (cid === 'live') opts.live = true;
            else if (cid.indexOf('country:') === 0) { strict = cid.slice(8); opts.search = strict; }
            else if (cid.indexOf('search:') === 0)  { opts.search = cid.slice(7); }
            else if (cid !== 'all') opts.sport = cid;

            ltGetMatches(opts, function (list) {
                toggleLoader(false);
                var items = ltPrepare(list);
                if (strict) {
                    var only = [];
                    for (var n = 0; n < items.length; n++) {
                        if (ltCountryOf(items[n]) === strict) only.push(items[n]);
                    }
                    items = only;
                }
                if (items.length) comp.buildGrid(items);
                else comp.showEmpty('Зараз немає матчів у цій категорії');
            }, function () {
                toggleLoader(false);
                Lampa.Noty.show('Помилка з\'єднання з LiveTV-UA');
                comp.showEmpty('Не вдалося завантажити дані');
            });
        };

        this.showEmpty = function (msg) {
            scroll.append((new Lampa.Empty({ title: msg })).render());
        };

        this.buildGrid = function (items) {
            var grid = $('<div style="display:flex;flex-wrap:wrap;gap:16px;padding:16px;box-sizing:border-box;width:100%;"></div>');
            var elements = [];

            for (var i = 0; i < items.length; i++) {
                (function (match, index) {
                    var card = $(
                        '<div class="selector focusable" tabindex="0"' +
                        ' style="width:calc(25% - 12px);min-width:180px;background:rgba(255,255,255,0.05);' +
                        'border-radius:8px;cursor:pointer;outline:none;transition:transform 0.15s,background 0.15s;flex-shrink:0;">' +
                        ltCardHtml(match) +
                        '</div>'
                    );

                    card.on('focus mouseenter', function () {
                        $(this).css({ 'background': 'rgba(255,255,255,0.15)', 'transform': 'scale(1.03)' });
                        scroll.update($(this));
                    });
                    card.on('blur mouseleave', function () {
                        $(this).css({ 'background': 'rgba(255,255,255,0.05)', 'transform': 'scale(1)' });
                    });
                    card.on('hover:enter click', function () {
                        ltSelectMatch(match);
                    });
                    card.on('keydown', function (e) {
                        var key = e.keyCode || e.which;
                        var cols = Math.floor(grid.width() / 196) || 4;
                        if (key === 13) { ltSelectMatch(match); }
                        else if (key === 38 && index >= cols) { elements[index - cols].focus(); e.preventDefault(); }
                        else if (key === 40 && index + cols < elements.length) { elements[index + cols].focus(); e.preventDefault(); }
                        else if (key === 37 && index > 0) { elements[index - 1].focus(); e.preventDefault(); }
                        else if (key === 39 && index < elements.length - 1) { elements[index + 1].focus(); e.preventDefault(); }
                        else if (key === 8 || key === 27) { Lampa.Activity.backward(); e.preventDefault(); }
                    });

                    elements.push(card);
                    grid.append(card);
                })(items[i], i);
            }

            scroll.append(grid);
            setTimeout(function () {
                if (elements.length) elements[0].focus();
            }, 150);
            Lampa.Controller.enable('content');
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
                },
                left:  function () { Lampa.Activity.backward(); },
                up:    function () {
                    var focused = scroll.render().find(':focus');
                    if (focused.length) focused.trigger({ type: 'keydown', keyCode: 38 });
                    else scroll.render().find('.selector').first().focus();
                },
                down:  function () {
                    var focused = scroll.render().find(':focus');
                    if (focused.length) focused.trigger({ type: 'keydown', keyCode: 40 });
                    else scroll.render().find('.selector').first().focus();
                },
                back:  function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause   = function () {};
        this.stop    = function () {};
        this.destroy = function () {
            try { if (scroll) scroll.destroy(); } catch (e) {}
        };
    }

    // ─── Меню вибору виду спорту (Streamed) ──────────────────────────────────

    function showSportsMenu(sports) {
        var sportsList = [
            { title: 'Всі матчі',        category: { id: 'all-today', name: 'Всі матчі'        } },
            { title: 'Прямі трансляції', category: { id: 'live',      name: 'Прямі трансляції' } }
        ];

        if (Array.isArray(sports)) {
            // Сортуємо згідно SPORTS_ORDER
            var sorted = [];
            var remaining = [];

            for (var i = 0; i < sports.length; i++) {
                var s = sports[i];
                var key = String(s.id || s.name || '').toLowerCase();
                if (HIDDEN_CATEGORIES.indexOf(key) !== -1) continue;
                var orderIndex = SPORTS_ORDER.indexOf(key);
                if (orderIndex !== -1) {
                    sorted[orderIndex] = s;
                } else {
                    remaining.push(s);
                }
            }

            // Додаємо спочатку відсортовані, потім решту
            for (var j = 0; j < SPORTS_ORDER.length; j++) {
                if (sorted[j]) {
                    var sk = String(sorted[j].id || sorted[j].name || '').toLowerCase();
                    sportsList.push({ title: SPORTS_TRANSLATE[sk] || sorted[j].name, category: sorted[j] });
                }
            }
            for (var k = 0; k < remaining.length; k++) {
                var rk = String(remaining[k].id || remaining[k].name || '').toLowerCase();
                sportsList.push({ title: SPORTS_TRANSLATE[rk] || remaining[k].name, category: remaining[k] });
            }
        }

        Lampa.Select.show({
            title: 'Трансляції',
            items: sportsList,
            onSelect: function (selected) {
                Lampa.Activity.push({
                    url:       '',
                    title:     selected.title,
                    component: 'streamed_matches',
                    category:  selected.category,
                    page:      1
                });
            },
            onBack: function () { Lampa.Controller.toggle('menu'); }
        });
    }

    function openSportsMenu() {
        if (cachedSports) { showSportsMenu(cachedSports); return; }
        toggleLoader(true);
        requestData('/sports', function (sports) {
            toggleLoader(false);
            cachedSports = Array.isArray(sports) ? sports : [];
            showSportsMenu(cachedSports);
        }, function () {
            toggleLoader(false);
            showSportsMenu([]);
        });
    }

    // ─── Меню вибору джерела (перший рівень після натискання на «Спорт») ─────

    function openSourceMenu() {
        Lampa.Select.show({
            title: 'Джерело',
            items: [
                {
                    title:    'LiveTV-UA',
                    subtitle: 'Вибір мови коментаторів, зокрема українською. Відтворюється у вбудованому плеєрі Lampa.',
                    source:   'livetv'
                },
                {
                    title:    'Streamed',
                    subtitle: 'Трансляції англійською. Відображаються через браузер — краще підходить для ПК.',
                    source:   'streamed'
                }
            ],
            onSelect: function (selected) {
                setTimeout(function () {
                    if (selected.source === 'livetv') openLivetvMenu();
                    else openSportsMenu();
                }, 10);
            },
            onBack: function () { Lampa.Controller.toggle('menu'); }
        });
    }

    // ─── Підміна вбудованого пункту "Спорт" ──────────────────────────────────

    function hijackSportMenu() {
        // Шукаємо пункт меню по тексту "Спорт" всередині menu__text
        var sportItem = null;
        $('.menu .menu__item').each(function () {
            var text = $(this).find('.menu__text').text().trim();
            if ((text === 'Спорт' || text === 'Sport') && !$(this).data('streamed-hijacked')) {
                sportItem = $(this);
                return false; // break
            }
        });

        if (sportItem) {
            sportItem.data('streamed-hijacked', true);
            sportItem.off('hover:enter').on('hover:enter', function (e) {
                e.stopPropagation();
                openSourceMenu();
            });
            console.log('[Streamed] Підмінено пункт меню Спорт');
            return true;
        }
        return false;
    }

    function injectOrHijack() {
        // Пробуємо підмінити вбудований "Спорт" — якщо вдалося, більше нічого не робимо
        hijackSportMenu();
    }

    // ─── Ініціалізація ────────────────────────────────────────────────────────

    function init() {
        Lampa.Component.add('streamed_matches', StreamedMatchesComponent);
        Lampa.Component.add('livetv_matches',   LivetvMatchesComponent);

        var timer = setInterval(function () {
            if ($('.menu .menu__list').length) injectOrHijack();
        }, 500);
        setTimeout(function () { clearInterval(timer); }, 10000);

        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready' || e.type === 'menu') injectOrHijack();
        });
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });

})();
