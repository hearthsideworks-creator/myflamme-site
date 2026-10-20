// Self-service account deletion for Flamme (Ruben, 2026-10-20: no emails to
// manage - people sign in with Google here and delete it themselves).
//
// Same steps as the app's "Delete account": remove your photos from storage,
// then call delete_my_account(), which deletes the account and cascades to
// everything else (profile, shared recipes, follows, reactions, links...).
// Uses only the PUBLIC publishable key; the database's own rules make sure
// you can only ever delete yourself. Everything shown is set with
// textContent (never HTML) so nothing from the server can inject markup.
(function () {
  'use strict';
  var SUPABASE_URL = 'https://xljnustfjvvnillqnkpa.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_caykshDVKpXeV4z-ArSpmQ_AcvKGp4v';
  var REDIRECT = 'https://myflamme.app/delete-account.html';

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: false },
  });

  var $ = function (id) { return document.getElementById(id); };
  function show(id) {
    ['step-signin', 'step-confirm', 'step-done', 'step-none', 'step-busy'].forEach(function (s) {
      $(s).hidden = s !== id;
    });
  }
  function error(msg) {
    $('error').textContent = msg || '';
    $('error').hidden = !msg;
  }

  async function start() {
    error('');
    show('step-busy');
    // clear ?code=... from the address bar once supabase-js has read it
    var res = await sb.auth.getSession();
    if (location.search) history.replaceState(null, '', REDIRECT);
    var session = res.data && res.data.session;
    if (!session) return show('step-signin');

    var uid = session.user.id;
    var prof = await sb.from('profiles').select('handle, display_name').eq('id', uid).maybeSingle();
    if (prof.error) {
      show('step-signin');
      return error("Couldn't check your account. Please try again.");
    }
    if (!prof.data) {
      // Signing in just created an empty login for a Google account that never
      // used Flamme - remove it so nothing is left behind.
      await sb.rpc('delete_my_account');
      await sb.auth.signOut();
      return show('step-none');
    }
    $('who-name').textContent = prof.data.display_name;
    $('who-handle').textContent = '@' + prof.data.handle;
    show('step-confirm');
  }

  $('signin').addEventListener('click', async function () {
    error('');
    var r = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: REDIRECT, queryParams: { prompt: 'select_account' } },
    });
    if (r.error) error("Couldn't start Google sign-in. Please try again.");
  });

  $('confirm-text').addEventListener('input', function () {
    $('delete').disabled = this.value.trim() !== 'DELETE';
  });

  $('cancel').addEventListener('click', async function () {
    await sb.auth.signOut();
    $('confirm-text').value = '';
    show('step-signin');
  });

  $('delete').addEventListener('click', async function () {
    if ($('confirm-text').value.trim() !== 'DELETE') return;
    error('');
    show('step-busy');
    var s = await sb.auth.getSession();
    var uid = s.data && s.data.session && s.data.session.user.id;
    if (!uid) return show('step-signin');
    // 1. photos (Storage doesn't let the database delete files)
    for (var round = 0; round < 50; round++) {
      var list = await sb.storage.from('photos').list(uid, { limit: 100 });
      if (list.error) { show('step-confirm'); return error("Couldn't remove your photos. Please try again."); }
      if (!list.data || !list.data.length) break;
      var rm = await sb.storage.from('photos').remove(list.data.map(function (f) { return uid + '/' + f.name; }));
      if (rm.error) { show('step-confirm'); return error("Couldn't remove your photos. Please try again."); }
    }
    // 2. the account (cascades everything else)
    var del = await sb.rpc('delete_my_account');
    if (del.error) { show('step-confirm'); return error("Couldn't delete your account. Please try again."); }
    await sb.auth.signOut();
    show('step-done');
  });

  start();
})();
