(function () {
    'use strict';

    console.log('[Streamed Plugin] v8.1 loaded');

    var PRIMARY_API  = 'https://streamed.pk/api';
    var FALLBACK_API = 'https://streamed.st/api';

    var cachedSports = null;

    var SPORTS_TRANSLATE = {
        'football':          '⚽ Футбол',
        'basketball':        '🏀 Баскетбол',
        'american-football': '🏈 Американський футбол',
        'hockey':            '🏒 Хокей',
        'baseball':          '⚾ Бейсбол',
        'motor-sports':      '🏎 Авто/Мотоспорт',
        'fight':             '🥊 Єдиноборства / UFC',
        'tennis':            '🎾 Теніс',
        'rugby':             '🏉 Регбі',
        'cricket':           '🏏 Крикет',
        'darts':             '🎯 Дартс',
        'golf':              '⛳ Гольф',
        'mma':               '🥋 MMA',
        'boxing':            '🥊 Бокс',
        'other':             '🎬 Інші трансляції'
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

    function encodeUrl(url) {
        return encodeURIComponent(url);
    }

    /**
     * Послідовно пробує кілька URL (проксі + прямі) і повертає перший успішний JSON.
     */
    function requestData(path, onSuccess, onError) {
        var targets = [PRIMARY_API + path, FALLBACK_API + path];
        var urlsToTry = [];

        for (var t = 0; t < targets.length; t++) {
            var url = targets[t];
            // Прямий запит — першим, бо проксі часто падають
            urlsToTry.push(url);
            urlsToTry.push('https://corsproxy.io/?' + encodeUrl(url));
            urlsToTry.push('https://api.codetabs.com/v1/proxy?quest=' + encodeUrl(url));
            urlsToTry.push('https://thingproxy.freeboard.io/fetch/' + url);
        }

        function tryFetch(index) {
            if (index >= urlsToTry.length) {
                if (onError) onError();
                return;
            }

            console.log('[Streamed] Спроба #' + index + ':', urlsToTry[index]);

            fetch(urlsToTry[index], { headers: { 'Accept': 'application/json' } })
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (data) {
                    if (data != null) {
                        console.log('[Streamed] Успіх на спробі #' + index);
                        onSuccess(data);
                    } else {
                        tryFetch(index + 1);
                    }
                })
                .catch(function () {
                    tryFetch(index + 1);
                });
        }

        tryFetch(0);
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

            if (catId === 'live') {
                path = '/matches/live';
            } else if (catId === 'all-today') {
                path = '/matches/all-today';
            } else if (catId === 'all') {
                path = '/matches/all';
            } else {
                path = '/matches/' + catId;
            }

            requestData(path, function (data) {
                toggleLoader(false);
                if (Array.isArray(data) && data.length) {
                    comp.buildList(data);
                } else {
                    comp.showEmpty('Зараз немає активних матчів у цій категорії');
                }
            }, function () {
                toggleLoader(false);
                Lampa.Noty.show('Помилка з\'єднання з сервером Streamed');
                comp.showEmpty('Не вдалося завантажити дані');
            });
        };

        this.showEmpty = function (msg) {
            scroll.append((new Lampa.Empty({ title: msg })).render());
        };

        this.buildList = function (items) {
            var body = $('<div class="category-full animate"></div>');
            var now = Date.now();

            for (var i = 0; i < items.length; i++) {
                (function (match) {
                    var isLive = match.date && match.date <= now;

                    var statusHtml = isLive
                        ? '<span style="color:#2ecc71;font-weight:bold;">● LIVE</span>'
                        : '<span style="color:#f39c12;font-weight:bold;">⏰ Незабаром</span>';

                    var timeStr = match.date
                        ? new Date(match.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '';

                    var sourcesCount = Array.isArray(match.sources) ? match.sources.length : 0;

                    var title = match.title
                        || (match.teams && match.teams.home && match.teams.away
                            ? match.teams.home.name + ' vs ' + match.teams.away.name
                            : 'Трансляція');

                    var timeBlock = timeStr ? ('| ' + timeStr + ' ') : '';

                    var item = $(
                        '<div class="full-start__item selector focusable"' +
                        ' style="padding:15px;margin-bottom:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">' +
                        '<div style="font-size:1.1em;font-weight:bold;">' + title + '</div>' +
                        '<div style="font-size:0.85em;margin-top:5px;color:#aaa;">' +
                        statusHtml + ' ' + timeBlock + '| Джерел: ' + sourcesCount +
                        '</div></div>'
                    );

                    item.on('hover:enter', function () { comp.selectMatch(match); });
                    body.append(item);
                })(items[i]);
            }

            scroll.append(body);
            Lampa.Controller.enable('content');
        };

        // Вибір матчу → показуємо список джерел (alpha, bravo…)
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

        /**
         * GET /api/stream/{source}/{id} → Stream[]
         * Кожен об'єкт: { id, streamNo, language, hd, embedUrl, source }
         * Пробуємо спочатку прямий запит, потім через проксі.
         */
        this.loadStreams = function (src, matchTitle) {
            toggleLoader(true);

            var path = '/stream/' + src.source + '/' + src.id;

            requestData(path, function (streams) {
                toggleLoader(false);

                if (!Array.isArray(streams) || !streams.length) {
                    // Fallback: будуємо embedUrl вручну якщо API нічого не повернув
                    comp.buildStreamsManually(src, matchTitle);
                    return;
                }

                if (streams.length === 1) {
                    comp.playStream(streams[0], matchTitle);
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
                    onSelect: function (sel) { comp.playStream(sel.stream, matchTitle); },
                    onBack:   function () { Lampa.Controller.toggle('content'); }
                });
            }, function () {
                toggleLoader(false);
                // Fallback: будуємо embedUrl вручну
                comp.buildStreamsManually(src, matchTitle);
            });
        };

        // Запасний варіант — будуємо embed.st URL вручну
        this.buildStreamsManually = function (src, matchTitle) {
            var streamItems = [];
            for (var streamNo = 1; streamNo <= 3; streamNo++) {
                var embedUrl = 'https://embed.st/embed/' + src.source + '/' + src.id + '/' + streamNo;
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

        /**
         * Показуємо діалог з посиланням на трансляцію.
         * Оскільки embedUrl захищений від iframe та прямого відтворення,
         * пропонуємо скопіювати посилання або відкрити у системному браузері.
         */
        this.playStream = function (stream, matchTitle) {
            var url = stream.embedUrl;

            if (!url) {
                Lampa.Noty.show('Посилання на потік відсутнє');
                return;
            }

            var title = matchTitle || ('Потік #' + stream.streamNo);

            console.log('[Streamed] embedUrl:', url);

            var urlWithAutoplay = comp.addAutoplay(url);

            // Спробуємо спочатку Lampa.Iframe з autoplay
            if (window.Lampa && Lampa.Iframe && typeof Lampa.Iframe.show === 'function') {
                try {
                    Lampa.Iframe.show(urlWithAutoplay);
                    return;
                } catch(e) {}
            }

            // Fallback — показуємо меню
            Lampa.Select.show({
                title: title,
                items: [
                    { title: '🌐 Відкрити у браузері', action: 'browser' },
                    { title: '📋 Скопіювати посилання', action: 'copy' }
                ],
                onSelect: function (selected) {
                    if (selected.action === 'browser') {
                        try {
                            window.open(urlWithAutoplay, '_blank');
                        } catch (e) {
                            comp.copyUrl(url);
                        }
                    } else {
                        comp.copyUrl(url);
                    }
                },
                onBack: function () { Lampa.Controller.toggle('content'); }
            });
        };

        this.addAutoplay = function (url) {
            if (url.indexOf('?') !== -1) return url + '&autoplay=1';
            return url + '?autoplay=1';
        };

        this.copyUrl = function (url) {
            var copied = false;

            // Спроба 1: сучасний Clipboard API
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url).then(function () {
                        Lampa.Noty.show('✅ Посилання скопійовано! Вставте у браузер.');
                    });
                    copied = true;
                }
            } catch (e) {}

            // Спроба 2: старий метод через textarea
            if (!copied) {
                try {
                    var ta = document.createElement('textarea');
                    ta.value = url;
                    ta.style.position = 'fixed';
                    ta.style.opacity  = '0';
                    document.body.appendChild(ta);
                    ta.focus();
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    Lampa.Noty.show('✅ Посилання скопійовано! Вставте у браузер.');
                    copied = true;
                } catch (e) {}
            }

            // Спроба 3: показати URL текстом
            if (!copied) {
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
            { title: '⚡ Всі матчі',       category: { id: 'all',       name: 'Всі події' } },
            { title: '🔴 Live зараз',      category: { id: 'live',      name: 'Live'      } },
            { title: '📅 Матчі сьогодні', category: { id: 'all-today', name: 'Сьогодні'  } }
        ];

        if (Array.isArray(sports)) {
            for (var i = 0; i < sports.length; i++) {
                var s = sports[i];
                var key = String(s.id || s.name || '').toLowerCase();
                var label = SPORTS_TRANSLATE[key] || s.name || s.id;
                sportsList.push({ title: label, category: s });
            }
        }

        Lampa.Select.show({
            title: 'Трансляції — категорія',
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
        if (cachedSports) {
            showSportsMenu(cachedSports);
            return;
        }

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

    // ─── Пункт меню ──────────────────────────────────────────────────────────

    function createMenuItem() {
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
        return item;
    }

    function injectMenu() {
        if ($('.menu .menu__item[data-action="streamed_sports"]').length) return;
        var menuList = $('.menu .menu__list');
        if (!menuList.length) return;
        var settingsItem = menuList.find('.menu__item[data-action="settings"]');
        var item = createMenuItem();
        if (settingsItem.length) settingsItem.before(item);
        else menuList.append(item);
    }

    // ─── Ініціалізація ────────────────────────────────────────────────────────

    function init() {
        Lampa.Component.add('streamed_matches', StreamedMatchesComponent);
        Lampa.Noty.show('Плагін Трансляції підключено (v8.1)');

        var timer = setInterval(function () {
            if ($('.menu .menu__list').length) injectMenu();
        }, 500);
        setTimeout(function () { clearInterval(timer); }, 10000);

        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready' || e.type === 'menu') injectMenu();
        });
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }

})();
