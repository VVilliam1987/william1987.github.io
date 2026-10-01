(function () {
    'use strict';

    console.log('[Streamed Plugin] v7.0 loaded');

    const PRIMARY_API   = 'https://streamed.pk/api';
    const FALLBACK_API  = 'https://streamed.st/api';

    let cachedSports = null;

    const SPORTS_TRANSLATE = {
        'football':          '⚽ Футбол',
        'basketball':        '🏀 Баскетбол',
        'american-football': '🏈 Американський футбол',
        'hockey':            '🏒 Хокей',
        'baseball':          '⚾ Бейсбол',
        'motor-sports':      '🏎️ Авто/Мотоспорт',
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
                active ? Lampa.Loading.start() : Lampa.Loading.stop();
            }
        } catch (e) {}
    }

    /**
     * Послідовно пробує кілька URL (проксі + прямі) і повертає перший успішний JSON.
     */
    function requestData(path, onSuccess, onError) {
        const targets = [PRIMARY_API + path, FALLBACK_API + path];
        const proxies = [
            url => 'https://cors-proxy.htmldev.ru/?' + encodeURIComponent(url),
            url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url)
        ];

        const urlsToTry = [];
        targets.forEach(url => {
            proxies.forEach(p => urlsToTry.push(p(url)));
            urlsToTry.push(url); // прямий запит останнім
        });

        function tryFetch(index) {
            if (index >= urlsToTry.length) {
                if (onError) onError();
                return;
            }
            fetch(urlsToTry[index], { headers: { 'Accept': 'application/json' } })
                .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                .then(data => { if (data != null) onSuccess(data); else tryFetch(index + 1); })
                .catch(() => tryFetch(index + 1));
        }

        tryFetch(0);
    }

    // ─── Компонент списку матчів ──────────────────────────────────────────────

    function StreamedMatchesComponent(object) {
        let comp = this;
        let scroll, category;

        category = object.category || { id: 'all', name: 'Всі події' };

        this.create = function () {
            scroll = new Lampa.Scroll({ mask: true, over: true });
            scroll.render().addClass('category-full');
            toggleLoader(true);
            comp.loadData();
        };

        this.render = function () {
            return scroll.render();
        };

        // Визначаємо шлях до API залежно від категорії
        this.loadData = function () {
            const catId = String(category.id || 'all').toLowerCase();

            // Для "all" або невідомих — беремо всі матчі
            const path = (catId === 'all') ? '/matches/all' : '/matches/' + catId;

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
            const body = $('<div class="category-full animate"></div>');

            items.forEach(function (match) {
                const now = Date.now();
                const isLive = match.date && match.date <= now;

                const statusHtml = isLive
                    ? '<span style="color:#2ecc71;font-weight:bold;">● LIVE</span>'
                    : '<span style="color:#f39c12;font-weight:bold;">⏰ Незабаром</span>';

                const timeStr = match.date
                    ? new Date(match.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '';

                const sourcesCount = Array.isArray(match.sources) ? match.sources.length : 0;

                const title = match.title
                    || (match.teams && match.teams.home && match.teams.away
                        ? match.teams.home.name + ' vs ' + match.teams.away.name
                        : 'Трансляція');

                const item = $(`
                    <div class="full-start__item selector focusable"
                         style="padding:15px;margin-bottom:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
                        <div style="font-size:1.1em;font-weight:bold;">${title}</div>
                        <div style="font-size:0.85em;margin-top:5px;color:#aaa;">
                            ${statusHtml}
                            ${timeStr ? '| ' + timeStr : ''}
                            | Джерел: ${sourcesCount}
                        </div>
                    </div>
                `);

                item.on('hover:enter', function () { comp.selectMatch(match); });
                body.append(item);
            });

            scroll.append(body);
            Lampa.Controller.enable('content');
        };

        // Вибір матчу → показуємо список джерел (alpha, bravo…)
        this.selectMatch = function (match) {
            if (!Array.isArray(match.sources) || !match.sources.length) {
                Lampa.Noty.show('Немає доступних джерел для цього матчу');
                return;
            }

            const items = match.sources.map(function (src, i) ({
                title: 'Джерело ' + (i + 1) + ' — ' + src.source.toUpperCase(),
                source: src.source,
                id:     src.id
            }));

            Lampa.Select.show({
                title:    match.title || 'Оберіть джерело',
                items:    items,
                onSelect: function (selected) { comp.loadStreams(selected, match.title); },
                onBack:   function () { Lampa.Controller.toggle('content'); }
            });
        };

        /**
         * Завантажуємо список потоків для обраного джерела.
         * GET /api/stream/{source}/{id}  →  Stream[]
         * Кожен об'єкт містить: streamNo, language, hd, embedUrl
         */
        this.loadStreams = function (src, matchTitle) {
            toggleLoader(true);

            const path = '/stream/' + src.source + '/' + src.id;

            requestData(path, function (streams) {
                toggleLoader(false);

                if (!Array.isArray(streams) || !streams.length) {
                    Lampa.Noty.show('Потоки не знайдено для цього джерела');
                    return;
                }

                if (streams.length === 1) {
                    // Якщо лише один потік — одразу запускаємо
                    comp.playStream(streams[0], matchTitle);
                    return;
                }

                // Кілька потоків → даємо вибір (мова, HD/SD)
                const streamItems = streams.map(function (s) ({
                    title: '#' + s.streamNo + ' ' + (s.language || 'Unknown') + (s.hd ? ' [HD]' : ' [SD]'),
                    stream: s
                }));

                Lampa.Select.show({
                    title:    matchTitle || 'Оберіть потік',
                    items:    streamItems,
                    onSelect: function (sel) { comp.playStream(sel.stream, matchTitle); },
                    onBack:   function () { Lampa.Controller.toggle('content'); }
                });
            }, function () {
                toggleLoader(false);
                Lampa.Noty.show('Помилка завантаження потоку');
            });
        };

        /**
         * Запускаємо відтворення через embedUrl.
         * embedUrl — це зазвичай iframe-посилання, а не прямий HLS.
         * Lampa вміє відкривати такі посилання через вбудований браузер.
         */
        this.playStream = function (stream, matchTitle) {
            const url = stream.embedUrl;

            if (!url) {
                Lampa.Noty.show('Посилання на потік відсутнє');
                return;
            }

            const title = matchTitle || ('Stream #' + stream.streamNo);

            // Спочатку пробуємо як прямий медіапотік
            try {
                Lampa.Player.play({ url: url, title: title });
                Lampa.Player.playlist([]);
            } catch (e) {
                // Якщо плеєр не підтримує — відкриваємо у вбудованому браузері
                if (Lampa.Browser) {
                    Lampa.Browser.open(url);
                } else {
                    Lampa.Noty.show('Не вдалося відкрити потік');
                }
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
        const sportsList = [
            { title: '⚡ Всі матчі', category: { id: 'all', name: 'Всі події' } },
            { title: '🔴 Live зараз', category: { id: 'live', name: 'Live' } },
            { title: '📅 Матчі сьогодні', category: { id: 'all-today', name: 'Сьогодні' } }
        ];

        if (Array.isArray(sports)) {
            sports.forEach(function (s) {
                const key = String(s.id || s.name || '').toLowerCase();
                const label = SPORTS_TRANSLATE[key] || s.name || s.id;
                sportsList.push({ title: label, category: s });
            });
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

    // ─── Пункт меню ──────────────────────────────────────────────────────────

    function createMenuItem() {
        const svg = `<svg height="24" viewBox="0 0 24 24" width="24" fill="currentColor">
            <path d="M0 0h24v24H0z" fill="none"/>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1
            17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2
            2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55
            0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0
            2.08-.8 3.97-2.1 5.39z"/>
        </svg>`;

        const item = $(`
            <div class="menu__item selector" data-action="streamed_sports">
                <div class="menu__ico">${svg}</div>
                <div class="menu__text">Трансляції</div>
            </div>
        `);

        item.on('hover:enter', openSportsMenu);
        return item;
    }

    function injectMenu() {
        if ($('.menu .menu__item[data-action="streamed_sports"]').length) return;
        const menuList = $('.menu .menu__list');
        if (!menuList.length) return;
        const settingsItem = menuList.find('.menu__item[data-action="settings"]');
        const item = createMenuItem();
        if (settingsItem.length) settingsItem.before(item);
        else menuList.append(item);
    }

    // ─── Ініціалізація ────────────────────────────────────────────────────────

    function init() {
        Lampa.Component.add('streamed_matches', StreamedMatchesComponent);
        Lampa.Noty.show('Плагін Трансляції підключено (v7.0)');

        // Намагаємося вставити пункт меню доти, доки меню не з'явиться
        const timer = setInterval(function () {
            if ($('.menu .menu__list').length) injectMenu();
        }, 500);
        setTimeout(function () { clearInterval(timer); }, 10000);

        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready' || e.type === 'menu') injectMenu();
        });
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });

})();
