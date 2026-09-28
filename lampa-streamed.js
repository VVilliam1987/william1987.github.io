
(function () {
    'use strict';

    console.log('[Streamed Plugin] Файл плагіна версії 3.0 (CORS Fixed) завантажено!');

    // Базовий URL API та проксі для обходу CORS
    const API_ORIGINAL = 'https://streamed.st/api';
    const PROXY_URL = 'https://corsproxy.io/?';

    function getProxyUrl(path) {
        return PROXY_URL + encodeURIComponent(API_ORIGINAL + path);
    }

    // Компонент перегляду списку матчів
    function StreamedMatchesComponent(object) {
        let comp = this;
        let scroll, items_container;
        let category = object.category;

        this.create = function () {
            this.activity.loader(true);

            scroll = new Lampa.Scroll({ mask: true, over: true });
            items_container = new Lampa.Empty();

            scroll.render().addClass('category-full');
            scroll.append(items_container.render());

            this.loadData();

            return scroll.render();
        };

        this.loadData = function () {
            let path = category && category.id !== 'all' 
                ? '/matches/' + category.id + '/all' 
                : '/matches/all';

            let url = getProxyUrl(path);

            console.log('[Streamed Plugin] Запит матчів через проксі:', url);

            Lampa.Network.silent(url, function (data) {
                comp.activity.loader(false);
                console.log('[Streamed Plugin] Отримано матчі:', data);

                if (data && Array.isArray(data) && data.length) {
                    comp.buildList(data);
                } else {
                    let empty = new Lampa.Empty({ title: 'Немає доступних трансляцій' });
                    scroll.append(empty.render());
                }
            }, function (err) {
                comp.activity.loader(false);
                console.error('[Streamed Plugin] Помилка завантаження матчів:', err);
                Lampa.Noty.show('Помилка завантаження даних Streamed.st');
            });
        };

        this.buildList = function (matches) {
            let body = $('<div class="category-full animate"></div>');

            matches.forEach(function (match) {
                let isLive = match.date < Date.now();
                let statusText = isLive ? '<span style="color:#2ecc71;font-weight:bold;">● LIVE</span>' : 'Незабаром';
                let timeStr = new Date(match.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                let item = $(`
                    <div class="full-start__item selector focusable" style="padding: 15px; margin-bottom: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                        <div style="font-size: 1.1em; font-weight: bold;">${match.title || 'Трансляція'}</div>
                        <div style="font-size: 0.85em; margin-top: 5px; color: #aaa;">
                            ${statusText} | Початок: ${timeStr} | Джерел: ${match.sources ? match.sources.length : 0}
                        </div>
                    </div>
                `);

                item.on('hover:enter', function () {
                    comp.selectMatch(match);
                });

                body.append(item);
            });

            scroll.append(body);
            Lampa.Controller.enable('content');
        };

        this.selectMatch = function (match) {
            if (!match.sources || !match.sources.length) {
                Lampa.Noty.show('Немає доступних джерел для цього матчу');
                return;
            }

            let sourcesModal = match.sources.map((src, index) => {
                return {
                    title: `Джерело ${index + 1} (${(src.source || 'STREAM').toUpperCase()}) - ${src.quality || 'HD'}`,
                    source: src
                };
            });

            Lampa.Select.show({
                title: match.title,
                items: sourcesModal,
                onSelect: function (selected) {
                    comp.loadStreamUrl(selected.source);
                },
                onBack: function () {
                    Lampa.Controller.toggle('content');
                }
            });
        };

        this.loadStreamUrl = function (source) {
            Lampa.Activity.loader(true);

            let streamUrl = getProxyUrl('/stream/' + source.source + '/' + source.id);

            console.log('[Streamed Plugin] Отримання потоку:', streamUrl);

            Lampa.Network.silent(streamUrl, function (res) {
                Lampa.Activity.loader(false);
                if (res && res.stream) {
                    Lampa.Player.play({
                        url: res.stream,
                        title: source.title || 'Live Stream'
                    });
                    Lampa.Player.playlist([]);
                } else {
                    Lampa.Noty.show('Не вдалося отримати потік для відтворення');
                }
            }, function (err) {
                Lampa.Activity.loader(false);
                console.error('[Streamed Plugin] Помилка потоку:', err);
                Lampa.Noty.show('Помилка отримання медіапотоку');
            });
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
                },
                left: function () {
                    Lampa.Activity.backward();
                },
                up: function () {
                    Lampa.Navigate.up();
                },
                down: function () {
                    Lampa.Navigate.down();
                },
                back: function () {
                    Lampa.Activity.backward();
                }
            });

            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {};
    }

    // Відкриття вибору видів спорту
    function openSportsMenu() {
        try {
            Lampa.Activity.loader(true);
            let url = getProxyUrl('/sports');
            console.log('[Streamed Plugin] Отримуємо види спорту через проксі:', url);

            Lampa.Network.silent(url, function (sports) {
                Lampa.Activity.loader(false);

                let sportsList = [
                    { title: 'Всі трансляції', category: { id: 'all', name: 'Всі' } }
                ];

                if (sports && Array.isArray(sports) && sports.length) {
                    sports.forEach(s => {
                        sportsList.push({
                            title: s.name,
                            category: s
                        });
                    });
                }

                Lampa.Select.show({
                    title: 'Оберіть вид спорту',
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
                    onBack: function () {
                        Lampa.Controller.toggle('menu');
                    }
                });
            }, function (err) {
                Lampa.Activity.loader(false);
                console.error('[Streamed Plugin] Помилка завантаження видів спорту:', err);
                Lampa.Noty.show('Помилка завантаження видів спорту');
            });
        } catch (e) {
            Lampa.Activity.loader(false);
            console.error('[Streamed Plugin] Перехоплено помилку виконання:', e);
            Lampa.Noty.show('Помилка виконання скрипта');
        }
    }

    function createMenuItem() {
        let svgIcon = `<svg height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`;

        let menu_item = $(`
            <div class="menu__item selector" data-action="streamed_sports">
                <div class="menu__ico">${svgIcon}</div>
                <div class="menu__text">Трансляції</div>
            </div>
        `);

        menu_item.on('hover:enter', openSportsMenu);
        return menu_item;
    }

    function injectMenu() {
        if ($('.menu .menu__item[data-action="streamed_sports"]').length > 0) return;

        let menuList = $('.menu .menu__list');
        if (menuList.length) {
            let settingsItem = menuList.find('.menu__item[data-action="settings"]');
            let item = createMenuItem();

            if (settingsItem.length) {
                settingsItem.before(item);
            } else {
                menuList.append(item);
            }
        }
    }

    function init() {
        Lampa.Component.add('streamed_matches', StreamedMatchesComponent);
        Lampa.Noty.show('Плагін Трансляції підключено (v3.0)');

        let timer = setInterval(function () {
            if ($('.menu .menu__list').length) {
                injectMenu();
            }
        }, 500);

        setTimeout(function () { clearInterval(timer); }, 10000);

        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready' || e.type === 'menu') {
                injectMenu();
            }
        });
    }

    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
