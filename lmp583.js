(function () {
    'use strict';

    console.log('[Streamed Plugin] v5.8.1 loaded');

    const API_BASE = 'https://streamed.pk/api';

    let cachedSports = null;

    const SPORTS_TRANSLATE = {
        '24-7': '📺 Цілодобові канали (24/7)',
        'football': 'Футбол',
        'basketball': 'Баскетбол',
        'american-football': 'Американський футбол',
        'hockey': 'Хокей',
        'baseball': 'Бейсбол',
        'motor-sports': 'Авто/Мотоспорт',
        'fight': 'Єдиноборства / UFC',
        'tennis': 'Теніс',
        'rugby': 'Регбі',
        'cricket': 'Крикет',
        'darts': 'Дартс',
        'golf': 'Гольф',
        'other': 'Інші трансляції'
    };

    function requestData(path, onSuccess, onError) {
        let url = API_BASE + path;
        
        Lampa.Network.silent(url, function (res) {
            if (res) {
                if (typeof res === 'string') {
                    try { res = JSON.parse(res); } catch (e) {}
                }
                if (typeof res === 'object') {
                    onSuccess(res);
                    return;
                }
            }
            if (onError) onError();
        }, function () {
            if (onError) onError();
        });
    }

    function StreamedMatchesComponent(object) {
        let comp = this;
        let scroll, items_container;
        let category = object.category;

        this.create = function () {
            scroll = new Lampa.Scroll({ mask: true, over: true });
            items_container = new Lampa.Empty();
            scroll.render().addClass('category-full');
            scroll.append(items_container.render());
            this.loadData();
        };

        this.render = function () {
            return scroll.render();
        };

        this.loadData = function () {
            let catId = category && category.id ? String(category.id).toLowerCase() : 'all';
            let path = '/matches/all';

            if (catId === '247' || catId === '24-7') {
                path = '/matches/24-7';
            } else if (catId !== 'all') {
                path = '/matches/' + catId;
            }

            requestData(path, function (data) {
                if (data && Array.isArray(data) && data.length) {
                    comp.buildList(data);
                } else {
                    scroll.append((new Lampa.Empty({ title: 'Зараз немає активних матчів у цій категорії' })).render());
                }
            }, function () {
                Lampa.Noty.show('Помилка з’єднання з сервером Streamed');
                scroll.append((new Lampa.Empty({ title: 'Не вдалося завантажити дані' })).render());
            });
        };

        this.buildList = function (items) {
            let body = $('<div class="category-full animate"></div>');
            let is247 = category && (category.id === '247' || category.id === '24-7');

            items.forEach(function (match) {
                let statusText = is247 
                    ? '<span style="color:#2ecc71;font-weight:bold;">● 24/7 LIVE</span>' 
                    : (match.date && match.date < Date.now() 
                        ? '<span style="color:#2ecc71;font-weight:bold;">● LIVE</span>' 
                        : '● LIVE / Незабаром');
                
                let timeStr = match.date ? new Date(match.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'LIVE';
                let sourcesCount = match.sources ? match.sources.length : (match.stream ? 1 : 0);

                let title = match.title || match.name || (match.teams ? (match.teams.home.name + ' vs ' + match.teams.away.name) : 'Трансляція');

                let item = $(`
                    <div class="full-start__item selector focusable" style="padding: 15px; margin-bottom: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                        <div style="font-size: 1.1em; font-weight: bold;">${title}</div>
                        <div style="font-size: 0.85em; margin-top: 5px; color: #aaa;">
                            ${statusText} | Початок: ${timeStr} | Джерел: ${sourcesCount}
                        </div>
                    </div>
                `);

                item.on('hover:enter', function () { comp.selectMatch(match); });
                body.append(item);
            });
            scroll.append(body);
            Lampa.Controller.enable('content');
        };

        this.selectMatch = function (match) {
            if (match.stream) {
                comp.playUrl(match.stream, match.title || match.name);
                return;
            }

            if (!match.sources || !match.sources.length) {
                Lampa.Noty.show('Немає доступних джерел для цього матчу');
                return;
            }

            let sourcesModal = match.sources.map((src, index) => ({
                title: `Джерело ${index + 1} (${(src.source || src.name || 'STREAM').toUpperCase()})`,
                source: src
            }));

            Lampa.Select.show({
                title: match.title || match.name || 'Оберіть джерело',
                items: sourcesModal,
                onSelect: function (selected) { comp.loadStreamUrl(selected.source); },
                onBack: function () { Lampa.Controller.toggle('content'); }
            });
        };

        this.loadStreamUrl = function (source) {
            let path = '';
            if (typeof source === 'string') {
                path = '/stream/' + source;
            } else if (source.source && source.id) {
                path = '/stream/' + source.source + '/' + source.id;
            } else if (source.id) {
                path = '/stream/' + source.id;
            } else if (source.url) {
                comp.playUrl(source.url, 'Live Stream');
                return;
            }

            requestData(path, function (res) {
                let streamUrl = null;

                if (typeof res === 'string') streamUrl = res;
                else if (Array.isArray(res) && res.length) streamUrl = res[0].url || res[0].stream || res[0];
                else if (res && typeof res === 'object') streamUrl = res.stream || res.url || res.hls || res.link;

                if (streamUrl) {
                    comp.playUrl(streamUrl, source.title || 'Live Stream');
                } else {
                    Lampa.Noty.show('Не вдалося отримати потік з цього джерела');
                }
            }, function () {
                Lampa.Noty.show('Помилка завантаження медіапотоку');
            });
        };

        this.playUrl = function(url, title) {
            if (typeof url !== 'string') return;

            // Якщо повернулося iframe посилання замість безпосередньо потоку .m3u8
            if (url.includes('embed') || url.includes('.html')) {
                Lampa.Noty.show('Відкриваємо через Webview / Плеєр');
            }

            Lampa.Player.play({ 
                url: url, 
                title: title || 'Трансляція' 
            });
            Lampa.Player.playlist([]);
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
                },
                left: function () { Lampa.Activity.backward(); },
                up: function () { Lampa.Navigate.up(); },
                down: function () { Lampa.Navigate.down(); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {};
    }

    function showSportsMenu(sports) {
        let sportsList = [
            { title: '📺 Цілодобові канали (24/7)', category: { id: '24-7', name: '24/7 Канали' } },
            { title: '⚡ Всі матчі та події', category: { id: 'all', name: 'Всі події' } }
        ];

        if (sports && Array.isArray(sports)) {
            sports.forEach(s => {
                let key = s.id || s.name || '';
                if (key !== '24-7' && key !== '247') {
                    let translatedName = SPORTS_TRANSLATE[key.toLowerCase()] || s.name || s.id;
                    sportsList.push({ title: translatedName, category: s });
                }
            });
        }

        Lampa.Select.show({
            title: 'Оберіть категорію',
            items: sportsList,
            onSelect: function (selected) {
                Lampa.Activity.push({
                    url: '',
                    title: 'Трансляції - ' + selected.title,
                    component: 'streamed_matches',
                    category: selected.category,
                    page: 1
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

        requestData('/sports', function (sports) {
            if (sports) {
                cachedSports = sports;
                showSportsMenu(sports);
            } else {
                showSportsMenu([]);
            }
        }, function () {
            showSportsMenu([]);
        });
    }

    function createMenuItem() {
        let svgIcon = `<svg height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`;
        let item = $(`<div class="menu__item selector" data-action="streamed_sports"><div class="menu__ico">${svgIcon}</div><div class="menu__text">Трансляції</div></div>`);
        item.on('hover:enter', openSportsMenu);
        return item;
    }

    function injectMenu() {
        if ($('.menu .menu__item[data-action="streamed_sports"]').length > 0) return;
        let menuList = $('.menu .menu__list');
        if (menuList.length) {
            let settingsItem = menuList.find('.menu__item[data-action="settings"]');
            let item = createMenuItem();
            if (settingsItem.length) settingsItem.before(item);
            else menuList.append(item);
        }
    }

    function init() {
        Lampa.Component.add('streamed_matches', StreamedMatchesComponent);
        Lampa.Noty.show('Плагін Трансляції підключено (v5.8.1)');

        let timer = setInterval(function () {
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
