// Who else is listening? A serverless peer-to-peer room (Trystero over public Nostr relays):
// counts listeners and passes played notes between them. Joining is optional (header toggle);
// like any WebRTC app, peers in the room can see each other's IP addresses.
import { LIBS } from './lazy.js';

const APP_ID = 'datamusak-v1';
const listeners = new Set();
let room = null;
let shareNote = null;
let joining = null;
let lastShare = 0;

export const presence = {
  peers: 0,
  get connected() {
    return !!room;
  },
  // fn({type: 'count' | 'join' | 'leave' | 'note', peers, note?})
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  async join() {
    if (room || joining) return joining;
    joining = LIBS.trystero().then(({ joinRoom }) => {
      room = joinRoom({ appId: APP_ID }, 'lobby');
      const action = room.makeAction('note');
      shareNote = (data) => action.send(data);
      const count = () => (presence.peers = Object.keys(room.getPeers()).length);
      room.onPeerJoin = (peerId) => emit({ type: 'join', peers: count(), peerId });
      room.onPeerLeave = (peerId) => emit({ type: 'leave', peers: count(), peerId });
      action.onMessage = (note, meta) => {
        if (!note || !Number.isFinite(note.n)) return;
        emit({ type: 'note', peers: presence.peers, note, peerId: meta?.peerId });
      };
      emit({ type: 'count', peers: count() });
      joining = null;
    });
    return joining;
  },
  leave() {
    room?.leave();
    room = null;
    shareNote = null;
    presence.peers = 0;
    emit({ type: 'count', peers: 0 });
  },
  // (also used by tests) deliver an event to every listener
  emit: (e) => emit(e),
  // Share one of our notes (throttled to 4/s so rooms stay light).
  share(n) {
    if (!shareNote || !presence.peers) return;
    const now = performance.now();
    if (now - lastShare < 250) return;
    lastShare = now;
    shareNote({ n: n.note, v: n.velocity, d: Math.round(n.duration * 100) / 100, s: n.source }).catch(() => {});
  },
};

function emit(e) {
  for (const fn of listeners) fn(e);
}
