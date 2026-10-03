/* OHAB IPTV PS4 v3 - ES5-oriented, persistent playlists, large player */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var channels = [];
  var favorites = readJSON('ohab_favs', []);
  var lastPlayed = null;
  var retryTimer = null;
  var retryCount = 0;
  var STORAGE_STATE = 'ohab_state_v3';
  var STORAGE_XTREAM = 'ohab_xtream_v3';

  function readJSON(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  function removeKey(key) { try { localStorage.removeItem(key); } catch (e) {} }
  function cleanUrl(s) { return String(s || '').replace(/^\s+|\s+$/g, ''); }
  function normalizeHost(s) { return cleanUrl(s).replace(/\/+$/, ''); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
    });
  }

  /* ---------------- Navigation ---------------- */
  var nav = document.querySelectorAll('.tabBtn');
  for (var n = 0; n < nav.length; n++) {
    nav[n].onclick = function () {
      var buttons = document.querySelectorAll('.tabBtn');
      var pages = document.querySelectorAll('.page');
      var i, j;
      for (i = 0; i < buttons.length; i++) buttons[i].className = 'tabBtn';
      for (j = 0; j < pages.length; j++) pages[j].className = 'page';
      this.className = 'tabBtn active';
      var page = $(this.getAttribute('data-tab'));
      if (page) page.className = 'page active';
    };
  }

  function updateClock() {
    var d = new Date();
    var h = ('0' + d.getHours()).slice(-2);
    var m = ('0' + d.getMinutes()).slice(-2);
    var s = ('0' + d.getSeconds()).slice(-2);
    $('clock').textContent = h + ':' + m + ':' + s;
  }
  setInterval(updateClock, 1000);
  updateClock();

  function updateNet() {
    var online = navigator.onLine !== false;
    $('netText').textContent = online ? 'متصل بالإنترنت' : 'غير متصل';
    $('netStatus').className = 'netStatus ' + (online ? 'online' : 'offline');
  }
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);
  updateNet();

  function setMessage(id, text, type) {
    $(id).className = 'message ' + (type || '');
    $(id).textContent = text || '';
  }

  /* ---------------- Playlist parsing ---------------- */
  function normalizeChannel(c, i) {
    return {
      id: String(c.id || ('ch_' + i)),
      name: String(c.name || 'قناة بدون اسم'),
      group: String(c.group || 'عام'),
      url: cleanUrl(c.url),
      logo: cleanUrl(c.logo)
    };
  }

  function parseM3U(text) {
    var out = [];
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var meta = null;
    var i, line, comma, name, gm, logo, tid;

    for (i = 0; i < lines.length; i++) {
      line = lines[i].replace(/^\s+|\s+$/g, '');
      if (!line) continue;

      if (line.indexOf('#EXTINF') === 0) {
        comma = line.indexOf(',');
        name = comma >= 0 ? line.substring(comma + 1).replace(/^\s+|\s+$/g, '') : 'Channel';
        gm = line.match(/group-title\s*=\s*["']([^"']*)["']/i);
        logo = line.match(/tvg-logo\s*=\s*["']([^"']*)["']/i);
        tid = line.match(/tvg-id\s*=\s*["']([^"']*)["']/i);
        meta = {
          name: name || 'Channel',
          group: gm ? gm[1] : 'عام',
          logo: logo ? logo[1] : '',
          id: tid ? tid[1] : ''
        };
      } else if (line.charAt(0) !== '#' && meta) {
        meta.url = line;
        out.push(normalizeChannel(meta, out.length));
        meta = null;
      }
    }
    return out;
  }

  /* ---------------- Persistence ---------------- */
  function saveLibrary(sourceType, sourceUrl, sourceLabel) {
    var state = {
      version: 3,
      sourceType: sourceType || 'cached',
      sourceUrl: sourceUrl || '',
      sourceLabel: sourceLabel || 'قائمة محفوظة',
      channels: channels,
      savedAt: new Date().getTime()
    };
    if (!saveJSON(STORAGE_STATE, state)) {
      setMessage('msgM', 'تم تحميل القنوات، لكن المتصفح لم يسمح بحفظ القائمة محليًا.', 'bad');
    }
  }

  function loadCachedLibrary() {
    var state = readJSON(STORAGE_STATE, null);
    if (!state || !state.channels || !state.channels.length) return state;
    channels = state.channels;
    showLibrary(state.sourceLabel || 'قائمة محفوظة');
    render();
    return state;
  }

  function buildCategories() {
    var cats = {}, i, k, arr = [];
    for (i = 0; i < channels.length; i++) cats[channels[i].group] = true;
    for (k in cats) if (cats.hasOwnProperty(k)) arr.push(k);
    arr.sort(function (a, b) { return a.localeCompare(b); });
    var current = $('category').value || 'all';
    var html = '<option value="all">كل التصنيفات</option>';
    for (i = 0; i < arr.length; i++) html += '<option value="' + esc(arr[i]) + '">' + esc(arr[i]) + '</option>';
    $('category').innerHTML = html;
    $('category').value = (current !== 'all' && cats[current]) ? current : 'all';
    $('catCount').textContent = arr.length;
  }

  function isFav(id) { return favorites.indexOf(String(id)) >= 0; }
  function toggleFav(id) {
    id = String(id);
    var p = favorites.indexOf(id);
    if (p >= 0) favorites.splice(p, 1); else favorites.push(id);
    saveJSON('ohab_favs', favorites);
    render();
  }
  window.ohabToggleFav = toggleFav;

  function card(c) {
    var star = isFav(c.id) ? '★' : '☆';
    var logo = c.logo ? '<img src="' + esc(c.logo) + '" onerror="this.style.display=\'none\'">' : '<span class="logoFallback">TV</span>';
    return '<div class="channel" data-id="' + esc(c.id) + '">' +
      '<button class="fav" onclick="event.stopPropagation();ohabToggleFav(\'' + esc(c.id).replace(/'/g, "\\'") + '\')">' + star + '</button>' +
      '<div class="logo">' + logo + '</div>' +
      '<div class="chText"><b title="' + esc(c.name) + '">' + esc(c.name) + '</b><small title="' + esc(c.group) + '">' + esc(c.group) + '</small></div>' +
      '</div>';
  }

  function render() {
    var q = ($('search').value || '').toLowerCase();
    var cat = $('category').value || 'all';
    var sort = $('sort').value;
    var list = [], favHtml = '', i, c, html = '';

    for (i = 0; i < channels.length; i++) {
      c = channels[i];
      if ((cat === 'all' || c.group === cat) && (!q || c.name.toLowerCase().indexOf(q) >= 0 || c.group.toLowerCase().indexOf(q) >= 0)) list.push(c);
    }

    list.sort(function (a, b) {
      if (sort === 'group') return a.group.localeCompare(b.group) || a.name.localeCompare(b.name);
      if (sort === 'favorites') return (isFav(a.id) ? 0 : 1) - (isFav(b.id) ? 0 : 1) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });

    for (i = 0; i < list.length; i++) html += card(list[i]);
    $('channels').innerHTML = html || '<div class="empty">لا توجد قنوات مطابقة.</div>';

    for (i = 0; i < channels.length; i++) if (isFav(channels[i].id)) favHtml += card(channels[i]);
    $('favList').innerHTML = favHtml || '<div class="empty">لا توجد قنوات مفضلة.</div>';

    $('count').textContent = channels.length;
    $('favCount').textContent = favorites.length;
    buildCategories();
  }

  function showLibrary(source) {
    $('librarySource').textContent = source || 'قائمة محملة';
  }

  function setChannels(arr, source, sourceType, sourceUrl, doScroll) {
    channels = arr || [];
    showLibrary(source);
    render();
    saveLibrary(sourceType, sourceUrl, source);

    /* Old version used scrollIntoView(false), which intentionally aligned the
       library to the bottom. That caused the page to open near the last row. */
    if (doScroll !== false && channels.length) {
      setTimeout(function () {
        var lib = document.querySelector('.library');
        if (lib && lib.scrollIntoView) lib.scrollIntoView(true);
        else window.scrollTo(0, 0);
      }, 60);
    }
  }

  function fetchText(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 30000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) callback(null, xhr.responseText);
      else callback(new Error('HTTP ' + xhr.status));
    };
    xhr.ontimeout = function () { callback(new Error('انتهت مهلة الاتصال')); };
    xhr.onerror = function () { callback(new Error('تعذر الاتصال أو أن السيرفر يمنع CORS')); };
    try { xhr.send(null); } catch (e) { callback(e); }
  }

  /* ---------------- M3U ---------------- */
  function loadM3UUrl(url, silent) {
    url = cleanUrl(url);
    if (!url) {
      if (!silent) setMessage('msgM', 'أدخل رابط M3U/M3U8 أولاً', 'bad');
      return;
    }
    if (!silent) setMessage('msgM', 'جاري تحميل القائمة...');
    fetchText(url, function (err, text) {
      if (err) {
        if (!silent) setMessage('msgM', 'تعذر تحميل القائمة: ' + err.message, 'bad');
        return;
      }
      var arr = parseM3U(text);
      if (!arr.length) {
        if (!silent) setMessage('msgM', 'لم يتم العثور على قنوات داخل ملف M3U.', 'bad');
        return;
      }
      $('murl').value = url;
      setChannels(arr, 'M3U: ' + url, 'm3u-url', url, !silent);
      if (!silent) setMessage('msgM', 'تم تحميل ' + arr.length + ' قناة وحفظها محليًا.', 'ok');
    });
  }

  $('loadM').onclick = function () { loadM3UUrl($('murl').value, false); };

  $('mfile').onchange = function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var arr = parseM3U(reader.result);
      if (!arr.length) { setMessage('msgM', 'الملف لا يحتوي على قنوات قابلة للقراءة.', 'bad'); return; }
      setChannels(arr, 'ملف M3U محلي: ' + file.name, 'm3u-file', '', true);
      setMessage('msgM', 'تم تحميل ' + arr.length + ' قناة وحفظها محليًا.', 'ok');
    };
    reader.onerror = function () { setMessage('msgM', 'تعذر قراءة الملف', 'bad'); };
    reader.readAsText(file);
  };

  /* ---------------- Xtream ---------------- */
  function loadXtream(silent) {
    var host = normalizeHost($('xhost').value);
    var user = cleanUrl($('xuser').value);
    var pass = cleanUrl($('xpass').value);
    if (!host || !user || !pass) {
      if (!silent) setMessage('msgX', 'أدخل السيرفر واسم المستخدم وكلمة المرور', 'bad');
      return;
    }

    if ($('rememberX').checked) saveJSON(STORAGE_XTREAM, {host:host, user:user, pass:pass});
    else removeKey(STORAGE_XTREAM);

    if (!silent) setMessage('msgX', 'جاري الاتصال بـ XTREAM...');
    var api = host + '/player_api.php?username=' + encodeURIComponent(user) + '&password=' + encodeURIComponent(pass) + '&action=get_live_streams';
    fetchText(api, function (err, text) {
      if (err) {
        if (!silent) setMessage('msgX', 'فشل الاتصال: ' + err.message, 'bad');
        return;
      }
      var data;
      try { data = JSON.parse(text); } catch (e) {
        if (!silent) setMessage('msgX', 'استجابة السيرفر ليست JSON صالحًا', 'bad');
        return;
      }
      if (!Array.isArray(data)) {
        if (!silent) setMessage('msgX', 'السيرفر لم يُرجع قائمة قنوات مباشرة', 'bad');
        return;
      }

      var arr = [], i, x;
      for (i = 0; i < data.length; i++) {
        x = data[i] || {};
        arr.push(normalizeChannel({
          id: 'x' + x.stream_id,
          name: x.name,
          group: x.category_name || 'عام',
          logo: x.stream_icon,
          url: host + '/live/' + encodeURIComponent(user) + '/' + encodeURIComponent(pass) + '/' + x.stream_id + '.ts'
        }, i));
      }
      setChannels(arr, 'XTREAM: ' + host, 'xtream', '', !silent);
      if (!silent) setMessage('msgX', 'تم تحميل ' + arr.length + ' قناة وحفظها محليًا.', 'ok');
    });
  }
  $('loadX').onclick = function () { loadXtream(false); };

  var savedX = readJSON(STORAGE_XTREAM, null);
  if (savedX) {
    $('xhost').value = savedX.host || '';
    $('xuser').value = savedX.user || '';
    $('xpass').value = savedX.pass || '';
    $('rememberX').checked = true;
  }

  /* ---------------- Player ---------------- */
  function setPlayerMessage(text) { $('playerMsg').textContent = text || ''; }

  function play(c) {
    lastPlayed = c;
    retryCount = 0;
    $('nowName').textContent = c.name;
    $('nowGroup').textContent = c.group;
    setPlayerMessage('');
    $('playerModal').className = 'modal';
    var v = $('video');

    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
    v.src = c.url;
    try { v.load(); } catch (e2) {}

    setTimeout(function () {
      try {
        var p = v.play();
        if (p && p.catch) p.catch(function () {
          setPlayerMessage('اضغط تشغيل. إذا لم يعمل، فقد تكون صيغة البث غير مدعومة في المتصفح.');
        });
      } catch (e3) {
        setPlayerMessage('اضغط تشغيل لبدء البث.');
      }
    }, 120);
  }

  function retry() {
    if (!lastPlayed) return;
    retryCount++;
    setPlayerMessage('إعادة المحاولة ' + retryCount + '...');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () { play(lastPlayed); }, 250);
  }
  $('retry').onclick = retry;

  function closePlayer() {
    clearTimeout(retryTimer);
    var v = $('video');
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
    $('playerModal').className = 'modal hidden';
  }
  $('close').onclick = closePlayer;

  function toggleFullscreen() {
    var box = $('playerFrame');
    var v = $('video');
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        return;
      }
      if (box.requestFullscreen) box.requestFullscreen();
      else if (box.webkitRequestFullscreen) box.webkitRequestFullscreen();
      else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
      else if (v.requestFullscreen) v.requestFullscreen();
      else setPlayerMessage('ملء الشاشة غير متاح في هذا المتصفح.');
    } catch (e) { setPlayerMessage('تعذر فتح ملء الشاشة في هذا المتصفح.'); }
  }
  $('fullscreenBtn').onclick = toggleFullscreen;

  $('video').addEventListener('error', function () {
    if (lastPlayed) setPlayerMessage('تعذر تشغيل البث. جرّب إعادة المحاولة أو قناة أخرى.');
  });

  function channelClick(e) {
    var x = e.target;
    while (x && x !== this && !x.getAttribute('data-id')) x = x.parentNode;
    if (x && x.getAttribute('data-id')) {
      var id = x.getAttribute('data-id');
      for (var i = 0; i < channels.length; i++) {
        if (channels[i].id === id) { play(channels[i]); break; }
      }
    }
  }
  $('channels').onclick = channelClick;
  $('favList').onclick = channelClick;

  $('clearFav').onclick = function () { favorites = []; saveJSON('ohab_favs', favorites); render(); };
  $('search').oninput = render;
  $('category').onchange = render;
  $('sort').onchange = render;

  document.onkeydown = function (e) {
    var code = e.keyCode || e.which;
    if (code === 27 && $('playerModal').className.indexOf('hidden') < 0) closePlayer();
  };

  /* ---------------- Startup ---------------- */
  var cached = loadCachedLibrary();
  if (!cached) render();

  /* If the last source was a URL, refresh it automatically in the background.
     Cached channels remain visible even if the server is temporarily offline. */
  if (cached && cached.sourceType === 'm3u-url' && cached.sourceUrl) {
    $('murl').value = cached.sourceUrl;
    setMessage('msgM', 'تمت استعادة القنوات المحفوظة. يتم تحديث القائمة...', 'ok');
    loadM3UUrl(cached.sourceUrl, true);
  } else if (cached && cached.sourceType === 'xtream' && savedX) {
    setMessage('msgX', 'تمت استعادة القنوات المحفوظة. يتم تحديث القائمة...', 'ok');
    loadXtream(true);
  }
}());
