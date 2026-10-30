// Networking: host/client over WebRTC (PeerJS, free public signalling + TURN),
// plus a BroadcastChannel transport (?net=local) for testing several tabs on one machine.
import Peer, { DataConnection } from 'peerjs';
import { IS_TEST } from './config';

export const PROTOCOL = 5;
const PREFIX = IS_TEST ? 'kistenkrieg-v1-test-' : 'kistenkrieg-v1-';
const LOCAL = IS_TEST ? 'kk-test-' : 'kk-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const makeCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = { t: string; [k: string]: any };

export interface Link {
  readonly id: string;
  send(m: Msg): void;
  close(): void;
}

export interface HostTransport {
  code: string;
  onJoin: (l: Link) => void;
  onMessage: (l: Link, m: Msg) => void;
  onLeave: (l: Link) => void;
  close(): void;
}

export interface ClientTransport {
  send(m: Msg): void;
  onMessage: (m: Msg) => void;
  onClose: (reason: string) => void;
  close(): void;
}

// Transports are classes (not object literals with no-op defaults): the minifier would
// otherwise treat calls to the empty default handlers as dead code and drop them.
class HostT implements HostTransport {
  onJoin: (l: Link) => void = () => {};
  onMessage: (l: Link, m: Msg) => void = () => {};
  onLeave: (l: Link) => void = () => {};
  constructor(readonly code: string, private closeFn: () => void) {}
  close() {
    this.closeFn();
  }
}

class ClientT implements ClientTransport {
  send: (m: Msg) => void = () => {};
  onMessage: (m: Msg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  constructor(private closeFn: () => void) {}
  close() {
    this.closeFn();
  }
}

/**
 * ICE servers for WebRTC. STUN finds the public address; TURN relays the traffic when a network
 * (mobile carrier NAT, school/company Wi-Fi, VPN) blocks direct connections. PeerJS' free TURN
 * service was shut down, so a relay only works once TURN_SERVERS is filled in.
 */
const TURN_SERVERS: RTCIceServer[] = [];
const PEER_CONFIG = {
  debug: 0,
  config: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
      ...TURN_SERVERS,
    ],
  },
};
const BLOCKED_MSG =
  'Keine Verbindung möglich: Dein Netzwerk blockiert die direkte Verbindung zum Host. ' +
  'Tipp: WLAN statt mobiler Daten (oder umgekehrt) probieren, VPN oder Werbeblocker-Apps ausschalten.';

const TIMEOUT_MSG =
  'Zeitüberschreitung: Der Raum wurde gefunden, aber es kam keine Verbindung zustande. Meist blockiert das Netzwerk ' +
  'die direkte Verbindung. Tipp: WLAN statt mobiler Daten (oder umgekehrt) probieren, VPN oder Werbeblocker-Apps ausschalten.';

const useLocal = () => new URLSearchParams(location.search).get('net') === 'local';

// ---------------------------------------------------------------- PeerJS

class PeerLink implements Link {
  lastSeen = performance.now();
  constructor(readonly id: string, readonly conn: DataConnection) {}
  send(m: Msg) {
    try {
      if (this.conn.open) this.conn.send(m);
    } catch {
      /* ignore */
    }
  }
  close() {
    try { this.conn.close(); } catch { /* ignore */ }
  }
}

function peerError(e: unknown): string {
  const type = (e as { type?: string })?.type ?? '';
  if (type === 'peer-unavailable') return 'Raum nicht gefunden. Stimmt der Code?';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') return 'Keine Verbindung zum Vermittlungsserver. Internet prüfen und erneut versuchen.';
  if (type === 'browser-incompatible') return 'Dieser Browser unterstützt kein WebRTC.';
  if (type === 'unavailable-id') return 'Raumcode bereits vergeben.';
  return 'Verbindungsfehler' + (type ? ` (${type})` : '');
}

function hostPeer(): Promise<HostTransport> {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      const code = makeCode();
      const peer = new Peer(PREFIX + code, PEER_CONFIG);
      let opened = false;
      const links = new Map<string, PeerLink>();
      let seq = 0;
      const t = new HostT(code, () => {
        clearInterval(watchdog);
        for (const l of links.values()) l.close();
        peer.destroy();
      });
      const drop = (l: PeerLink) => {
        if (!links.delete(l.id)) return;
        l.close();
        t.onLeave(l);
      };
      const watchdog = window.setInterval(() => {
        const now = performance.now();
        for (const l of links.values()) if (now - l.lastSeen > 10000) drop(l);
      }, 2000);
      peer.on('open', () => {
        opened = true;
        resolve(t);
      });
      peer.on('connection', (conn) => {
        const link = new PeerLink('c' + ++seq, conn);
        conn.on('open', () => {
          links.set(link.id, link);
          t.onJoin(link);
        });
        conn.on('data', (d) => {
          link.lastSeen = performance.now();
          if (d && typeof d === 'object') t.onMessage(link, d as Msg);
        });
        conn.on('close', () => drop(link));
        conn.on('error', () => drop(link));
      });
      peer.on('disconnected', () => {
        // lost the signalling server – existing game connections keep working; try to come back
        if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
      });
      peer.on('error', (e) => {
        if (!opened) {
          clearInterval(watchdog);
          peer.destroy();
          if ((e as { type?: string }).type === 'unavailable-id' && tries++ < 4) attempt();
          else reject(new Error(peerError(e)));
        }
      });
    };
    attempt();
  });
}

function joinPeer(code: string): Promise<ClientTransport> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PEER_CONFIG);
    let done = false;
    let opened = false;
    let lastSeen = performance.now();
    let watchdog = 0;
    const t = new ClientT(() => {
      clearInterval(watchdog);
      peer.destroy();
    });
    const fail = (msg: string) => {
      if (done) return;
      done = true;
      peer.destroy();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail(TIMEOUT_MSG), 20000);
    peer.on('error', (e) => {
      if (!done) fail(peerError(e));
      else t.onClose(peerError(e));
    });
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      // the room exists, but the direct connection (and every relay) failed
      conn.on('iceStateChanged', (state) => {
        if (state === 'failed' && !opened) { clearTimeout(timer); fail(BLOCKED_MSG); }
      });
      conn.on('error', () => {
        if (!opened) { clearTimeout(timer); fail(BLOCKED_MSG); }
      });
      conn.on('open', () => {
        clearTimeout(timer);
        done = true;
        opened = true;
        t.send = (m) => {
          try { if (conn.open) conn.send(m); } catch { /* ignore */ }
        };
        watchdog = window.setInterval(() => {
          if (performance.now() - lastSeen > 10000) {
            clearInterval(watchdog);
            t.onClose('Verbindung zum Host verloren.');
            peer.destroy();
          }
        }, 2000);
        resolve(t);
      });
      conn.on('data', (d) => {
        lastSeen = performance.now();
        if (d && typeof d === 'object') t.onMessage(d as Msg);
      });
      conn.on('close', () => {
        clearInterval(watchdog);
        if (opened) t.onClose('Der Host hat das Spiel beendet.');
      });
    });
  });
}

// ---------------------------------------------------------------- BroadcastChannel (local testing)

function hostLocal(): Promise<HostTransport> {
  const code = makeCode();
  const ch = new BroadcastChannel(LOCAL + code);
  const links = new Map<string, Link>();
  const t = new HostT(code, () => {
    ch.postMessage({ to: '*', m: { t: 'bye' } });
    ch.close();
  });
  ch.onmessage = (e) => {
    const { from, m, to } = e.data ?? {};
    if (to !== 'host' || typeof from !== 'string') return;
    if (m?.t === '__hello') {
      const link: Link = { id: from, send: (msg) => ch.postMessage({ to: from, m: msg }), close: () => ch.postMessage({ to: from, m: { t: 'bye' } }) };
      links.set(from, link);
      link.send({ t: '__ok' });
      t.onJoin(link);
      return;
    }
    const link = links.get(from);
    if (!link) return;
    if (m?.t === '__bye') { links.delete(from); t.onLeave(link); return; }
    t.onMessage(link, m);
  };
  return Promise.resolve(t);
}

function joinLocal(code: string): Promise<ClientTransport> {
  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel(LOCAL + code);
    const me = 'l' + Math.random().toString(36).slice(2, 8);
    const t = new ClientT(() => {
      ch.postMessage({ from: me, to: 'host', m: { t: '__bye' } });
      ch.close();
    });
    t.send = (m) => ch.postMessage({ from: me, to: 'host', m });
    const timer = setTimeout(() => { ch.close(); reject(new Error('Raum nicht gefunden (lokal).')); }, 3000);
    ch.onmessage = (e) => {
      const { to, m } = e.data ?? {};
      if (to !== me && to !== '*') return;
      if (m?.t === '__ok') { clearTimeout(timer); resolve(t); return; }
      if (m?.t === 'bye') { t.onClose('Der Host hat das Spiel beendet.'); return; }
      t.onMessage(m);
    };
    ch.postMessage({ from: me, to: 'host', m: { t: '__hello' } });
  });
}

export const createHost = (): Promise<HostTransport> => (useLocal() ? hostLocal() : hostPeer());
export const joinHost = (code: string): Promise<ClientTransport> => (useLocal() ? joinLocal(code) : joinPeer(code));
