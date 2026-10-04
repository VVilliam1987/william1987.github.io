(function () {
    'use strict';

    console.log('[Streamed Plugin] v9.4 loaded');

    var PRIMARY_API  = 'https://streamed.pk/api';
    var FALLBACK_API = 'https://streamed.st/api';
    var EMBED_DOMAIN = 'https://embed.st';

    var cachedSports = null;

    var SPORTS_TRANSLATE = {
        'football':          'Футбол',
        'basketball':        'Баскетбол',
        'american-football': 'Американський футбол',
        'hockey':            'Хокей',
        'baseball':          'Бейсбол',
        'motor-sports':      'Авто/Мотоспорт',
        'fight':             'Єдиноборства / UFC',
        'tennis':            'Теніс',
        'rugby':             'Регбі',
        'cricket':           'Крикет',
        'darts':             'Дартс',
        'golf':              'Гольф',
        'mma':               'MMA',
        'boxing':            'Бокс',
        'other':             'Інші трансляції'
    };

    // Категорії які приховуємо з меню
    var HIDDEN_CATEGORIES = ['afl'];

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function toggleLoader(active) {
        try {
            if (window.Lampa && Lampa.Loading) {
                if (active) Lampa.Loading.start();
                else Lampa.Loading.stop();
            }
        } catch (e) {}
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

    // ─── Компонент списку матчів ──────────────────────────────────────────────

    function StreamedMatchesComponent(object) {
        var comp = this;
        var scroll;
        var category = object.category || { id: 'all', name: 'Всі події' };

        this.create = function () {
            scroll = new Lampa.Scroll({ mask: true, over: true });
            scroll.render().addClass('category-full');
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
            var wrap = $('<div class="items-line" style="padding:16px;"></div>');
            var grid = $('<div style="display:flex;flex-wrap:wrap;gap:16px;"></div>');
            wrap.append(grid);
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

            scroll.append(wrap);
            scroll.update();
            setTimeout(function () { if (elements.length) elements[0].focus(); }, 150);
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
            var path = '/stream/' + src.source + '/' + src.id;

            requestData(path, function (streams) {
                toggleLoader(false);
                if (!Array.isArray(streams) || !streams.length) {
                    comp.buildStreamsManually(src, matchTitle);
                    return;
                }
                if (streams.length === 1) { comp.playStream(streams[0], matchTitle); return; }

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
                    onSelect: function (sel) { comp.playStream(sel.stream, matchTitle); },
                    onBack:   function () { Lampa.Controller.toggle('content'); }
                });
            }, function () {
                toggleLoader(false);
                comp.buildStreamsManually(src, matchTitle);
            });
        };

        this.buildStreamsManually = function (src, matchTitle) {
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

            Lampa.Select.show({
                title: title,
                items: [
                    { title: '🌐 Відкрити у браузері', action: 'browser' },
                    { title: '📋 Скопіювати посилання', action: 'copy' }
                ],
                onSelect: function (selected) {
                    if (selected.action === 'browser') {
                        try { window.open(url, '_blank'); }
                        catch (e) { comp.copyUrl(url); }
                    } else {
                        comp.copyUrl(url);
                    }
                },
                onBack: function () { Lampa.Controller.toggle('content'); }
            });
        };

        this.copyUrl = function (url) {
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
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
                },
                left:  function () { Lampa.Activity.backward(); },
                up:    function () { Lampa.Navigate.up(); },
                down:  function () { Lampa.Navigate.down(); },
                back:  function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause   = function () {};
        this.stop    = function () {};
        this.destroy = function () {};
    }

    // ─── Меню вибору виду спорту ─────────────────────────────────────────────

    function showSportsMenu(sports) {
        var sportsList = [
            { title: 'Прямі трансляції', category: { id: 'live',      name: 'Прямі трансляції' } },
            { title: 'Всі матчі',        category: { id: 'all-today', name: 'Всі матчі'        } }
        ];

        if (Array.isArray(sports)) {
            for (var i = 0; i < sports.length; i++) {
                var s = sports[i];
                var key = String(s.id || s.name || '').toLowerCase();
                if (HIDDEN_CATEGORIES.indexOf(key) !== -1) continue;
                var label = SPORTS_TRANSLATE[key] || s.name || s.id;
                sportsList.push({ title: label, category: s });
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
                openSportsMenu();
            });
            console.log('[Streamed] Підмінено пункт меню Спорт');
            return true;
        }
        return false;
    }

    function injectOrHijack() {
        // Спочатку пробуємо підмінити вбудований "Спорт"
        if (hijackSportMenu()) return;

        // Якщо вбудованого "Спорт" немає — додаємо свій пункт
        if ($('.menu .menu__item[data-action="streamed_sports"]').length) return;
        var menuList = $('.menu .menu__list');
        if (!menuList.length) return;

        var svgIcon = '<svg height="24" viewBox="0 0 24 24" width="24" fill="currentColor">' +
            '<path d="M0 0h24v24H0z" fill="none"/>' +
            '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 ' +
            '17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 ' +
            '2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 ' +
            '0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 ' +
            '2.08-.8 3.97-2.1 5.39z"/></svg>';

        var item = $(
            '<div class="menu__item selector" data-action="streamed_sports">' +
            '<div class="menu__ico">' + svgIcon + '</div>' +
            '<div class="menu__text">Трансляції</div>' +
            '</div>'
        );
        item.on('hover:enter', openSportsMenu);

        var settingsItem = menuList.find('.menu__item[data-action="settings"]');
        if (settingsItem.length) settingsItem.before(item);
        else menuList.append(item);
    }

    // ─── Ініціалізація ────────────────────────────────────────────────────────

    function init() {
        Lampa.Component.add('streamed_matches', StreamedMatchesComponent);

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
