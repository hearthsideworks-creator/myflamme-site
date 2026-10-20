// Share-link viewer for myflamme.app/r (also served as 404.html for /r/CODE).
// Everything from the link is untrusted: text only via textContent, no
// images, no clickable links except the fixed open-in-Flamme intent.
// The recipe lives ENTIRELY in this page's URL fragment (after the '#'):
// compressed with deflate, written as base64url. Fragments are never sent to
// the server, so the recipe stays between the sender and whoever they sent
// it to. This mirrors src/utils/shareLink.js in the app.
(function () {
  'use strict';

  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var LOOKUP = {};
  for (var i = 0; i < ALPHA.length; i++) LOOKUP[ALPHA[i]] = i;

  function base64urlToBytes(text) {
    var clean = (text || '').replace(/=+$/, '');
    var len = clean.length;
    if (len === 0) return null;
    var out = new Uint8Array(Math.floor(len * 3 / 4));
    var o = 0;
    for (var i = 0; i < len; i += 4) {
      var c0 = LOOKUP[clean[i]], c1 = LOOKUP[clean[i + 1]];
      var c2 = i + 2 < len ? LOOKUP[clean[i + 2]] : undefined;
      var c3 = i + 3 < len ? LOOKUP[clean[i + 3]] : undefined;
      if (c0 === undefined || c1 === undefined) return null;
      out[o++] = (c0 << 2) | (c1 >> 4);
      if (c2 !== undefined) out[o++] = ((c1 & 15) << 4) | (c2 >> 2);
      else if (i + 2 < len) return null;
      if (c3 !== undefined) out[o++] = ((c2 & 3) << 6) | c3;
      else if (i + 3 < len) return null;
    }
    return out;
  }

  function inflate(bytes) {
    // Browsers ship the zip algorithm natively these days.
    var stream = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }

  function isWebUrl(v) { return typeof v === 'string' && /^https?:\/\//i.test(v.trim()); }

  function lines(text) {
    return (typeof text === 'string' ? text : '').split('\n')
      .map(function (l) { return l.replace(/^\s*\d+[.)]\s*/, '').trim(); })
      .filter(function (l) { return l !== ''; });
  }

  function show(id) { document.getElementById(id).classList.remove('hidden'); }
  function setText(id, text) { document.getElementById(id).textContent = text; }

  function fail(message) {
    setText('error', message);
    show('error');
  }

  function render(r) {
    // Everything is inserted with textContent — the link's content is
    // untrusted, so it must never become HTML.
    setText('name', r.name);
    document.title = r.name + ' — Flamme';

    var meta = [];
    if (typeof r.genre === 'string' && r.genre.trim()) meta.push(r.genre.trim());
    if (typeof r.protein === 'string' && r.protein.trim() &&
        !/^(none|n\/?a|-+)$/i.test(r.protein.trim())) meta.push(r.protein.trim());
    if (typeof r.totalMinutes === 'number' && r.totalMinutes > 0) meta.push(r.totalMinutes + ' min');
    setText('meta', meta.join(' · '));

    // No pictures from links: anyone can write a long link, and an image is
    // the easiest way to fake an "official Flamme" message (security audit
    // 2026-10-20). Photos are shown inside the app, not on this page.

    var ing = lines(r.ingredients);
    if (ing.length) {
      var ul = document.getElementById('ingredients');
      ing.forEach(function (l) {
        var li = document.createElement('li');
        li.textContent = l;
        ul.appendChild(li);
      });
      show('ingredients-wrap');
    }

    var steps = lines(r.instructions);
    if (steps.length) {
      var ol = document.getElementById('directions');
      steps.forEach(function (l) {
        var li = document.createElement('li');
        li.textContent = l;
        ol.appendChild(li);
      });
      show('directions-wrap');
    }

    var nut = lines(r.nutrition);
    if (nut.length) {
      var box = document.getElementById('nutrition');
      nut.forEach(function (l) {
        var p = document.createElement('p');
        p.textContent = l;
        box.appendChild(p);
      });
      show('nutrition-wrap');
    }

    // Source as plain text (the real hostname, punycode for look-alikes),
    // never a clickable link on our domain.
    if (isWebUrl(r.sourceUrl)) {
      var host = '';
      try { host = new URL(r.sourceUrl.trim()).hostname; } catch (e) { host = ''; }
      if (host) {
        setText('source', 'Original recipe from: ' + host);
        show('source');
      }
    }

    // In-app browsers (Discord, Instagram…) show this page instead of
    // deep-linking into Flamme. This button is the escape hatch, in Android's
    // intent:// format (plain flamme:// gets ignored by in-app browsers).
    // Hard-won details, learned on Ruben's phone:
    //   • scheme=https, NOT a custom scheme — Android's package-visibility
    //     rules hide custom-scheme handlers from other apps (Discord "sees"
    //     no Flamme → bounced to a dead Play Store page), but every browser
    //     app is allowed to see https handlers. The explicit package= makes
    //     Android open Flamme itself, even when link verification is off.
    //   • the payload rides as ?d= (intent:// reserves the #fragment) — the
    //     app accepts both spellings.
    //   • browser_fallback_url returns no-Flamme users to this page instead
    //     of the Play Store (Flamme isn't published there yet).
    document.getElementById('open-app-link').href =
      'intent://myflamme.app/r?' + appQuery +
      '#Intent;scheme=https;package=com.hearthsideworks.flamme' +
      ';S.browser_fallback_url=' + encodeURIComponent(location.href) + ';end';
    show('open-app');

    show('recipe');
  }

  // This file also runs as 404.html (GitHub Pages' page for unknown paths),
  // which is how myflamme.app/r/CODE works. Anything that isn't /r... is a
  // genuine "not found".
  if (!/^\/r(\.html)?(\/|$)/.test(location.pathname)) {
    fail('Page not found. Looking for Flamme? Visit myflamme.app.');
    return;
  }

  // ---- short links: myflamme.app/r/CODE (served via 404.html) or /r?c=CODE.
  // The recipe is looked up with Flamme's PUBLIC key; the database only ever
  // returns that one recipe, and nothing if the link was turned off.
  var SUPABASE_URL = 'https://xljnustfjvvnillqnkpa.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_caykshDVKpXeV4z-ArSpmQ_AcvKGp4v';
  var shortMatch = location.pathname.match(/^\/r\/([A-Za-z0-9_-]{12})\/?$/) ||
                   location.search.match(/[?&]c=([A-Za-z0-9_-]{12})(?:&|$)/);
  var appQuery = '';
  if (shortMatch) {
    var code = shortMatch[1];
    appQuery = 'c=' + code;
    fetch(SUPABASE_URL + '/rest/v1/rpc/get_shared_recipe', {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: code }),
      referrerPolicy: 'no-referrer',
    }).then(function (res) { return res.ok ? res.json() : null; })
      .then(function (r) {
        if (!r || typeof r.name !== 'string' || r.name.trim() === '') {
          fail('This link was turned off by the person who shared it, or it never existed.');
          return;
        }
        render(r);
      })
      .catch(function () { fail("Couldn't load this recipe. Check your connection and try again."); });
    return;
  }

  var fragment = location.hash ? location.hash.slice(1) : '';
  appQuery = 'd=' + fragment;
  if (!fragment) {
    fail('This link has no recipe in it. Ask your friend to share it again from Flamme.');
    return;
  }
  if (typeof DecompressionStream === 'undefined') {
    fail('Your browser is too old to unpack this recipe — try opening the link in an up-to-date browser.');
    return;
  }
  var bytes = base64urlToBytes(fragment);
  if (!bytes) {
    fail('This link looks damaged (part of it may not have been copied).');
    return;
  }
  inflate(bytes).then(function (json) {
    var envelope = JSON.parse(json);
    if (!envelope || envelope.v !== 1 || !envelope.r ||
        typeof envelope.r.name !== 'string' || envelope.r.name.trim() === '') {
      throw new Error('bad envelope');
    }
    render(envelope.r);
  }).catch(function () {
    fail('This link looks damaged or incomplete — ask your friend to share it again.');
  });
})();
