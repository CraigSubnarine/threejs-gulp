// Arcade accounts: optional Google sign-in, leaderboards and cloud saves through the Arcade's shared Supabase project
// (setup in GameDev/CLAUDE.md). The same file goes in every game; each game passes its own folder name.
// Plain script; needs supabase-js (its UMD build) loaded first. Nothing here ever blocks play: signed out, offline or
// with the CDN unreachable, calls just return null, and scores wait in a local queue until they can be posted.
const ARCADE_URL = 'https://xatgyulmwulwyizghcuc.supabase.co';
const ARCADE_KEY = 'sb_publishable_xp9EL9y0Zais0aUlKvirpw_frE_AJCf'; // public by design: Row Level Security guards the data
const NAME_RULE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,18}[A-Za-z0-9]$/; // the database checks this too, plus a bad-word list

// Field by field: the larger number, either true flag. Keeps unlocks and records from any device.
function mergeMax(a = {}, b = {}) {
  const out = { ...b, ...a };
  for (const k of Object.keys(out)) {
    if (typeof a[k] === 'number' && typeof b[k] === 'number') out[k] = Math.max(a[k], b[k]);
    else if (typeof a[k] === 'boolean' || typeof b[k] === 'boolean') out[k] = !!(a[k] || b[k]);
  }
  return out;
}

// game: this game's folder name, e.g. 'threejs-gulp'. onChange(account) runs whenever sign-in or the name changes.
function createArcade(game, onChange = () => {}) {
  const local = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let sb = null;
  try { sb = window.supabase.createClient(ARCADE_URL, ARCADE_KEY, { auth: { flowType: 'pkce' } }); } catch {} // CDN didn't load
  const account = {
    online: !!sb,
    user: null, // the signed-in Supabase user, or null
    name: null, // their public player name
    // Leaves the page for Google, then comes back to this same page signed in.
    async signIn() {
      if (!sb) return false;
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
      return !error;
    },
    async signOut() {
      if (sb) await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      setUser(null);
    },
    // Returns null when saved, or a message to show.
    async rename(name) {
      name = name.trim().replace(/\s+/g, ' ');
      if (!NAME_RULE.test(name)) return 'Use 3-20 letters, numbers, spaces, - _ or . (starting and ending with a letter or number).';
      if (!account.user) return 'Sign in first.';
      const { error } = await sb.from('profiles').update({ display_name: name, updated_at: new Date().toISOString() }).eq('id', account.user.id);
      if (error) return error.code === '23514' ? "That name isn't allowed. Try another." : "Couldn't save. Check your connection.";
      account.name = name;
      onChange(account);
      return null;
    },
    // Posts a score (queued first, so a dropped connection doesn't lose it). Resolves true once it's on the board.
    async post(score, mode = '', seed = null) {
      if (!account.user) return false;
      local.set('arcade-pending', [...local.get('arcade-pending', []), { game, score: Math.floor(score), mode, seed: seed == null ? null : String(seed).slice(0, 40), user: account.user.id }]);
      return flush();
    },
    // The top n players (their best scores) on a board: [{ name, score, me }], or null if it can't load.
    async top(mode = '', n = 10) {
      if (!sb) return null;
      const { data, error } = await sb.from('leaderboard').select('display_name, score, user_id').eq('game', game).eq('mode', mode).order('score', { ascending: false }).limit(n);
      return error ? null : data.map(r => ({ name: r.display_name, score: r.score, me: r.user_id === account.user?.id }));
    },
    // Where the signed-in player stands on a board: { rank, of, score } (their best), or null.
    async standing(mode = '') {
      if (!sb || !account.user) return null;
      const board = () => sb.from('leaderboard').select('user_id', { count: 'exact', head: true }).eq('game', game).eq('mode', mode);
      const { data: mine } = await sb.from('leaderboard').select('score').eq('game', game).eq('mode', mode).eq('user_id', account.user.id).maybeSingle();
      if (!mine) return null;
      const [above, all] = await Promise.all([board().gt('score', mine.score), board()]);
      if (above.error || all.error) return null;
      return { rank: above.count + 1, of: all.count, score: mine.score };
    },
    // Cloud save: merges this device's data with the saved copy, saves the result and returns it (or `data` as it
    // was, when signed out or offline). merge(local, cloud) decides what wins.
    async sync(data, merge = mergeMax) {
      if (!account.user) return data;
      try {
        const { data: row, error } = await sb.from('saves').select('data').eq('game', game).eq('user_id', account.user.id).maybeSingle();
        if (error) return data;
        const merged = merge(data, row?.data ?? {});
        await sb.from('saves').upsert({ game, user_id: account.user.id, data: merged, updated_at: new Date().toISOString() });
        return merged;
      } catch { return data; }
    },
  };

  // Sends queued scores for whoever is signed in now; the rest stay queued (another player's, or no connection).
  // One flush at a time, so a score is never sent twice. Resolves true if a score for this game went up.
  let flushing = Promise.resolve(false);
  const flush = () => (flushing = flushing.then(async () => {
    if (!account.user) return false;
    const queue = local.get('arcade-pending', []), left = [];
    let posted = false, offline = false;
    for (const s of queue) {
      if (offline || s.user !== account.user.id) { left.push(s); continue; }
      const { error } = await sb.from('scores').insert({ game: s.game, score: s.score, mode: s.mode, seed: s.seed });
      if (!error) posted ||= s.game === game;
      else if (!error.code) { offline = true; left.push(s); } // no connection: keep it for next time
      // an error with a database code means the row itself was refused (it never will be accepted): drop it
    }
    local.set('arcade-pending', [...left, ...local.get('arcade-pending', []).slice(queue.length)]); // keep any posted meanwhile
    return posted;
  }).catch(() => false));

  async function setUser(user) {
    account.user = user;
    account.name = null;
    if (user) {
      const { data } = await sb.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
      account.name = data?.display_name ?? 'Player';
      flush();
    }
    onChange(account);
  }

  if (sb) {
    // Supabase warns against awaiting its own calls inside this callback, so the work runs just after it.
    sb.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null;
      if (user?.id !== account.user?.id) setTimeout(() => setUser(user));
    });
    // Coming back from Google: once the sign-in code has been swapped for a session, tidy it out of the address bar.
    sb.auth.getSession().finally(() => {
      const q = new URLSearchParams(location.search);
      if (q.has('code') || q.has('error')) history.replaceState(null, '', location.pathname);
    });
  }
  return account;
}
