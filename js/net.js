// Gulp! online rooms. The match itself runs browser to browser over WebRTC data channels, with the host's browser as
// the hub: every guest talks only to the host. The Arcade's shared Supabase project is used just to find each other:
// presence on the room's channel says who's there (and who hosts), and one broadcast each way carries the WebRTC
// handshake. (Supabase's free plan allows 100 Realtime messages a second for the whole project, far too few to stream
// a match through.) With ?net=local, a BroadcastChannel stands in for both, so the headless tests can run several
// players as pages in one browser with no network.
//
// openRoom() returns a room: { code, me, isHost, hostId, send(msg), sendFast(msg), sendTo(id, msg), leave(), on(type, fn) }
// Guests' send goes to the host; the host's send goes to every guest. sendFast is unreliable and unordered (positions).
// Events: 'join' (id), 'leave' (id), 'msg' (from, msg), 'closed' (reason).

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0 or 1: easy to read out and type
export const newCode = (rand = Math.random) => Array.from({ length: 5 }, () => CODE_LETTERS[Math.floor(rand() * CODE_LETTERS.length)]).join('');
export const cleanCode = text => String(text).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
export const newId = () => Math.random().toString(36).slice(2, 10);
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
const MAX_PLAYERS = 8;
export const localNet = new URLSearchParams(location.search).get('net') === 'local';

function emitter() {
  const fns = {};
  return { on(type, fn) { (fns[type] ??= []).push(fn); }, emit(type, ...a) { for (const fn of fns[type] ?? []) { try { fn(...a); } catch (e) { console.error(e); } } } };
}

// host: true to create the room (code), false to join it. Resolves when connected (a guest: to the host), or rejects
// with a message for the player ("Room not found", "Room full", "Couldn't connect ...").
export function openRoom(code, host, me = newId()) {
  return (localNet ? localRoom : rtcRoom)(code, host, me);
}

// ---------- The test stand-in: a BroadcastChannel shared by pages in one browser ----------
function localRoom(code, host, me) {
  const ev = emitter(), bc = new BroadcastChannel(`gulp-local-${code}`), peers = new Map(); // id -> last heard (ms)
  let hostId = host ? me : null, closed = false;
  const post = (to, m) => bc.postMessage({ from: me, to, m });
  const room = {
    code, me, isHost: host, get hostId() { return hostId; }, peers: () => [...peers.keys()],
    send(m) { if (host) for (const id of peers.keys()) post(id, m); else post(hostId, m); },
    sendFast(m) { room.send(m); },
    sendTo(id, m) { post(id, m); }, // (fast or not: a BroadCastChannel is always reliable)
    leave() { if (closed) return; closed = true; post(null, { $: 'bye' }); clearInterval(beat); bc.close(); },
    on: ev.on,
  };
  const beat = setInterval(() => {
    if (closed) return;
    post(null, { $: 'hb', host });
    const now = Date.now();
    for (const [id, t] of peers) { // gone quiet for 15 s (generous: a busy test page can go quiet for a few seconds)
      if (now - t <= 15000) continue;
      peers.delete(id);
      if (id === hostId && !host) { ev.emit('closed', 'The host left the room.'); room.leave(); } else ev.emit('leave', id);
    }
  }, 1000);
  return new Promise((resolve, reject) => {
    bc.onmessage = ({ data: { from, to, m } }) => {
      if (closed || from === me || (to && to !== me)) return;
      if (m.$ === 'bye') {
        if (from === hostId && !host) { ev.emit('closed', 'The host left the room.'); room.leave(); return; }
        if (peers.delete(from)) ev.emit('leave', from);
        return;
      }
      if (host) {
        if (m.$ === 'knock') { // someone wants in
          if (peers.size + 1 >= MAX_PLAYERS && !peers.has(from)) return post(from, { $: 'full' });
          if (room.locked) return post(from, { $: 'busy' });
          const fresh = !peers.has(from);
          peers.set(from, Date.now());
          post(from, { $: 'welcome' });
          if (fresh) ev.emit('join', from);
          return;
        }
        if (!peers.has(from)) return;
        peers.set(from, Date.now());
      } else {
        if (m.$ === 'welcome' && !hostId) { hostId = from; peers.set(from, Date.now()); resolve(room); return; }
        if (m.$ === 'full') return reject(new Error('That room is full (8 players).'));
        if (m.$ === 'busy') return reject(new Error('That room is in the middle of a match. Try again when it ends.'));
        if (from !== hostId) return;
        peers.set(from, Date.now());
      }
      if (m.$ !== 'hb') ev.emit('msg', from, m);
    };
    if (host) resolve(room);
    else {
      post(null, { $: 'knock' });
      setTimeout(() => { if (!hostId) { room.leave(); reject(new Error('Room not found. Check the code.')); } }, 2500);
    }
  });
}

// ---------- The real thing: Supabase presence + a one-message WebRTC handshake ----------
let sb = null;
function supa() {
  if (!sb) sb = window.supabase.createClient(ARCADE_URL, ARCADE_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'gulp-rooms' } });
  return sb;
}
// Waits until the connection has gathered all its candidates, so the offer/answer is one message, not a trickle.
const gathered = (pc, ms = 3000) => new Promise(res => {
  if (pc.iceGatheringState === 'complete') return res();
  const t = setTimeout(res, ms);
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
});

function rtcRoom(code, host, me) {
  const ev = emitter(), peers = new Map(); // id -> { pc, r (reliable), u (fast) }
  let hostId = host ? me : null, closed = false;
  const channel = supa().channel(`gulp-room-${code}`, { config: { presence: { key: me }, broadcast: { self: false } } });
  const wire = (id, r, u) => {
    const p = peers.get(id) ?? {};
    Object.assign(p, r ? { r } : {}, u ? { u } : {});
    peers.set(id, p);
    for (const ch of [r, u].filter(Boolean)) ch.onmessage = e => { try { ev.emit('msg', id, JSON.parse(e.data)); } catch {} };
  };
  const out = (p, m, fast) => { const ch = fast && p?.u?.readyState === 'open' ? p.u : p?.r; if (ch?.readyState === 'open') ch.send(JSON.stringify(m)); };
  const drop = id => {
    const p = peers.get(id);
    if (!p) return;
    peers.delete(id);
    try { p.pc?.close(); } catch {}
    if (!host && id === hostId) { ev.emit('closed', 'Lost the host. The match has ended.'); room.leave(); } else ev.emit('leave', id);
  };
  const room = {
    code, me, isHost: host, get hostId() { return hostId; }, peers: () => [...peers.keys()],
    send(m) { if (host) for (const p of peers.values()) out(p, m); else out(peers.get(hostId), m); },
    sendFast(m) { if (host) for (const p of peers.values()) out(p, m, true); else out(peers.get(hostId), m, true); },
    sendTo(id, m, fast = false) { out(peers.get(id), m, fast); },
    set locked(v) { channel.track({ id: me, host, locked: !!v }).catch(() => {}); },
    leave() {
      if (closed) return;
      closed = true;
      for (const p of peers.values()) { try { p.pc?.close(); } catch {} }
      peers.clear();
      supa().removeChannel(channel).catch(() => {});
    },
    on: ev.on,
  };
  const watch = (id, pc) => pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed'].includes(pc.connectionState)) drop(id); });

  return new Promise((resolve, reject) => {
    const fail = msg => { room.leave(); reject(new Error(msg)); };
    // The host answers each guest's offer; a guest takes the host's answer.
    channel.on('broadcast', { event: 'sig' }, async ({ payload: s }) => {
      if (closed || s.to !== me) return;
      if (host && s.offer) {
        if (peers.size + 1 >= MAX_PLAYERS) return;
        const pc = new RTCPeerConnection({ iceServers: ICE });
        peers.set(s.from, { pc });
        pc.ondatachannel = e => {
          if (e.channel.label === 'u') wire(s.from, null, e.channel); else wire(s.from, e.channel, null);
          e.channel.onopen = () => { const p = peers.get(s.from); if (p?.r?.readyState === 'open' && !p.joined) { p.joined = true; ev.emit('join', s.from); } };
        };
        watch(s.from, pc);
        await pc.setRemoteDescription(s.offer);
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        channel.send({ type: 'broadcast', event: 'sig', payload: { to: s.from, from: me, answer: pc.localDescription.toJSON() } });
      } else if (!host && s.answer && peers.get(hostId)?.pc) {
        await peers.get(hostId).pc.setRemoteDescription(s.answer).catch(() => {});
      }
    });
    // Updating your presence (the host marking the room busy) shows up as a leave and a join: only someone with nothing
    // left in the room has really gone.
    channel.on('presence', { event: 'leave' }, ({ key }) => { if (key !== me && !channel.presenceState()[key]?.length) setTimeout(() => { if (!channel.presenceState()[key]?.length) drop(key); }, 1500); });
    channel.subscribe(async status => {
      if (closed) return;
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') return fail("Can't reach the room server. Check your connection.");
      if (status !== 'SUBSCRIBED') return;
      await channel.track({ id: me, host, locked: false });
      if (host) return resolve(room);
      // A guest: find the host in the room, then connect to it directly.
      let state = {}, people = [], h = null;
      for (let i = 0; i < 20 && !h && !closed; i++) { // wait (up to 5 s) for the room's presence to arrive
        await new Promise(r => setTimeout(r, 250));
        state = channel.presenceState();
        people = Object.values(state).flat();
        h = people.find(p => p.host);
      }
      if (!h) return fail('Room not found. Check the code.');
      if (h.locked) return fail('That room is in the middle of a match. Try again when it ends.');
      if (Object.keys(state).length > MAX_PLAYERS) return fail('That room is full (8 players).');
      hostId = h.id;
      const pc = new RTCPeerConnection({ iceServers: ICE });
      const r = pc.createDataChannel('r'), u = pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 });
      peers.set(hostId, { pc });
      wire(hostId, r, u);
      watch(hostId, pc);
      const timer = setTimeout(() => fail("Couldn't connect to the host. Your network may block direct connections; try another network (Wi-Fi or mobile data)."), 15000);
      r.onopen = () => { clearTimeout(timer); resolve(room); };
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      channel.send({ type: 'broadcast', event: 'sig', payload: { to: hostId, from: me, offer: pc.localDescription.toJSON() } });
    });
  });
}
