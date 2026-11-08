/* Previously On – before an episode starts after a long break, shows what happened in the
 * previous episodes, using the episode descriptions already in the library.
 *
 * How it hooks in: before playing anything, the web client asks the server for
 * Items/{id}/PlaybackInfo. This script holds that one request back while the recap is shown,
 * so the player does not even load until the user continues. Everything else passes through. */
(function () {
    'use strict';

    var cfg = window.PreviouslyOnConfig || {};
    if (window.PreviouslyOn || cfg.enabled === false || typeof window.fetch !== 'function') return;

    var de = /^de\b/i.test(document.documentElement.lang || navigator.language || '');
    var T = de ? {
        title: 'Was bisher geschah', play: 'Weiter zur Episode', noText: 'Keine Beschreibung vorhanden.',
        season: function (n) { return 'Staffel ' + n; }, ep: function (s, e) { return 'S' + s + ' · E' + e; },
        ago: function (d) {
            if (d < 14) return 'Zuletzt gesehen vor ' + d + ' Tagen';
            if (d < 60) return 'Zuletzt gesehen vor ' + Math.round(d / 7) + ' Wochen';
            if (d < 730) return 'Zuletzt gesehen vor ' + Math.round(d / 30.4) + ' Monaten';
            return 'Zuletzt gesehen vor ' + Math.round(d / 365) + ' Jahren';
        },
        hint: 'Enter: weiter'
    } : {
        title: 'Previously on', play: 'Continue to episode', noText: 'No description available.',
        season: function (n) { return 'Season ' + n; }, ep: function (s, e) { return 'S' + s + ' · E' + e; },
        ago: function (d) {
            if (d < 14) return 'Last watched ' + d + ' days ago';
            if (d < 60) return 'Last watched ' + Math.round(d / 7) + ' weeks ago';
            if (d < 730) return 'Last watched ' + Math.round(d / 30.4) + ' months ago';
            return 'Last watched ' + Math.round(d / 365) + ' years ago';
        },
        hint: 'Enter: continue'
    };

    var PLAYBACK_INFO = /\/Items\/([0-9a-f]{32}|[0-9a-f-]{36})\/PlaybackInfo(?:\?|$)/i;
    var REPEAT_MS = 6 * 3600 * 1000;   // do not show the same recap twice within a few hours
    var LOOKUP_MS = 4000;              // never hold playback longer than this for the lookup
    var shown = {};                    // itemId -> time it was shown
    var open = null;                   // Promise of the overlay currently on screen

    function api() { return window.ApiClient; }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function urlOf(input) {
        if (typeof input === 'string') return input;
        if (input && typeof input.url === 'string') return input.url;
        return String(input || '');
    }

    function methodOf(input, init) {
        return String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    }

    // Something is already playing (e.g. the client re-asks for PlaybackInfo when the audio track changes).
    function playing() {
        var v = document.querySelectorAll('video, audio');
        for (var i = 0; i < v.length; i++) {
            if (!v[i].paused && !v[i].ended && v[i].currentTime > 0) return true;
        }
        return false;
    }

    function lookup(id) {
        var a = api();
        if (!a || !a.getJSON || !a.getCurrentUserId || !a.getCurrentUserId()) return Promise.resolve(null);
        var timer;
        var timeout = new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, LOOKUP_MS); });
        var req = a.getJSON(a.getUrl('PreviouslyOn/Recap/' + id)).catch(function () { return null; });
        return Promise.race([req, timeout]).then(function (r) { clearTimeout(timer); return r; });
    }

    function image(id, type, width) {
        return api().getUrl('Items/' + id + '/Images/' + type, { maxWidth: width, quality: 90 });
    }

    function render(r) {
        var html = '';
        if (r.seasonOverview) {
            html += '<section class="po-item po-season"><div class="po-text">'
                + '<h3 class="po-name">' + esc(r.seasonName || '') + '</h3>'
                + '<p>' + esc(r.seasonOverview) + '</p></div></section>';
        }
        (r.episodes || []).forEach(function (e) {
            html += '<section class="po-item">'
                + (e.hasImage ? '<img class="po-thumb" loading="lazy" alt="" src="' + esc(image(e.id, 'Primary', 400)) + '" onerror="this.remove()">' : '')
                + '<div class="po-text"><h3 class="po-name"><span class="po-num">' + esc(T.ep(e.season, e.episode)) + '</span>' + esc(e.name) + '</h3>'
                + (e.overview ? '<p>' + esc(e.overview) + '</p>' : '<p class="po-missing">' + esc(T.noText) + '</p>')
                + '</div></section>';
        });
        return html;
    }

    function show(r) {
        return new Promise(function (resolve) {
            var root = document.createElement('div');
            root.className = 'po-overlay';
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-modal', 'true');
            root.setAttribute('aria-labelledby', 'po-title');
            root.innerHTML = '<div class="po-backdrop" style="background-image:url(&quot;' + esc(image(r.seriesId, 'Backdrop', 1600)) + '&quot;)"></div>'
                + '<div class="po-panel">'
                + '<header class="po-head"><div class="po-series">' + esc(r.seriesName || '') + '</div>'
                + '<h2 id="po-title" class="po-title">' + esc(T.title) + '</h2>'
                + (r.gapDays != null ? '<div class="po-ago">' + esc(T.ago(r.gapDays)) + '</div>' : '') + '</header>'
                + '<div class="po-list">' + render(r) + '</div>'
                + '<footer class="po-actions"><button type="button" is="emby-button" class="raised button-submit emby-button po-play">'
                + '<span class="material-icons play_arrow" aria-hidden="true"></span><span>' + esc(T.play) + '</span></button></footer>'
                + '</div>';

            var done = false;
            var before = document.activeElement;
            function close() {
                if (done) return;
                done = true;
                document.removeEventListener('keydown', onKey, true);
                document.documentElement.classList.remove('po-open');
                root.classList.add('po-closing');
                setTimeout(function () { root.remove(); }, 180);
                try { if (before && before.focus) before.focus(); } catch (e) { /* ignore */ }
                resolve();
            }
            function onKey(ev) {
                var k = ev.key;
                if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack') {
                    ev.preventDefault(); ev.stopPropagation(); close();
                } else if (k === 'Enter' || k === 'MediaPlay' || k === 'MediaPlayPause') {
                    ev.preventDefault(); ev.stopPropagation(); close();
                } else if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'PageDown' || k === 'PageUp') {
                    var list = root.querySelector('.po-list');
                    var step = (k === 'PageDown' || k === 'PageUp') ? list.clientHeight * 0.9 : 80;
                    list.scrollBy({ top: (k === 'ArrowDown' || k === 'PageDown') ? step : -step, behavior: 'smooth' });
                    ev.preventDefault(); ev.stopPropagation();
                }
            }

            root.querySelector('.po-play').addEventListener('click', close);
            root.querySelector('.po-backdrop').addEventListener('click', close);
            document.addEventListener('keydown', onKey, true);
            document.documentElement.classList.add('po-open');
            document.body.appendChild(root);
            setTimeout(function () { var b = root.querySelector('.po-play'); if (b) b.focus(); }, 30);
        });
    }

    function maybeRecap(id) {
        if (open) return open;
        var now = Date.now();
        if (shown[id] && now - shown[id] < REPEAT_MS) return Promise.resolve();
        if (playing()) return Promise.resolve();
        shown[id] = now;
        open = lookup(id).then(function (r) {
            if (r && r.show && ((r.episodes && r.episodes.length) || r.seasonOverview)) return show(r);
        }).catch(function () { /* never block playback */ }).then(function () { open = null; });
        return open;
    }

    function playbackItem(method, url) {
        if (cfg.enabled === false || String(method).toUpperCase() !== 'POST') return null;
        var m = PLAYBACK_INFO.exec(String(url || ''));
        return m ? m[1].replace(/-/g, '').toLowerCase() : null;
    }

    // jellyfin-apiclient (older code paths) uses fetch ...
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
        var self = this;
        var args = arguments;
        try {
            var id = playbackItem(methodOf(input, init), urlOf(input));
            if (id) return maybeRecap(id).then(function () { return originalFetch.apply(self, args); });
        } catch (e) { /* fall through */ }
        return originalFetch.apply(self, args);
    };

    // ... the playback manager on Jellyfin 12 goes through @jellyfin/sdk (axios), i.e. XMLHttpRequest.
    // The request is only sent once the recap is closed; its timeout starts with the real send.
    var xhrOpen = XMLHttpRequest.prototype.open;
    var xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        try { this.__poItem = playbackItem(method, url); } catch (e) { this.__poItem = null; }
        return xhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        var args = arguments;
        var id = xhr.__poItem;
        if (!id) return xhrSend.apply(xhr, args);
        xhr.__poItem = null;
        maybeRecap(id).then(function () { xhrSend.apply(xhr, args); });
    };

    window.PreviouslyOn = {
        version: cfg.version,
        /** Shows the recap for an episode right away (for testing), ignoring the repeat guard. */
        preview: function (id) { delete shown[id]; return maybeRecap(id); }
    };
})();
