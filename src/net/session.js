/**
 * Multiplayer session.
 *
 * Topology is a star: every guest connects to the host, and the host relays
 * the car states so every client can draw every other car as a ghost. No
 * server is involved at any point - only the host's browser.
 */

import { MSG, packState, unpackState } from './protocol.js';
import { createPeer, DEFAULT_STUN } from './peer.js';
import { createLocalSignal, packSignal, unpackSignal, createPeerId } from './signal.js';

/**
 * @typedef {object} SessionOptions
 * @property {string} name
 * @property {string} color
 * @property {string} accent
 * @property {boolean} [useStun]
 * @property {(ghosts: import('./protocol.js').GhostState[]) => void} [onGhosts]
 * @property {(peers: import('./protocol.js').PeerInfo[]) => void} [onPeers]
 * @property {(status: string) => void} [onStatus]
 * @property {(config: { trackId: string, seed: number, laps: number }) => void} [onStart]
 * @property {(scores: { id: string, name: string, score: number }[]) => void} [onScores]
 * @property {(message: string) => void} [onNotice]
 * @property {(options: any) => any} [createPeer] injectable peer factory (tests)
 */

/**
 * @param {SessionOptions} options
 */
export function createSession(options) {
  const id = createPeerId();
  /** @type {'host' | 'guest' | null} */
  let role = null;
  /** @type {ReturnType<typeof createPeer> | null} */
  let peer = null;
  let localSignal = null;
  let closed = false;

  /** @type {Map<string, import('./protocol.js').PeerInfo>} */
  const peers = new Map();
  /** @type {Map<string, import('./protocol.js').GhostState>} */
  const ghostStates = new Map();
  /** @type {Map<string, number>} */
  const scores = new Map();

  let lastStateSent = 0;
  let lastGhostBroadcast = 0;
  let localOfferTimer = 0;

  const iceServers = options.useStun === false ? [] : DEFAULT_STUN;

  /**
   * @param {import('./protocol.js').PeerInfo[]} list
   */
  function publishPeers() {
    options.onPeers?.(Array.from(peers.values()));
  }

  /**
   * @param {string} peerId
   * @param {import('./protocol.js').GhostState} state
   */
  function setGhost(peerId, state) {
    ghostStates.set(peerId, state);
  }

  function broadcastGhosts() {
    const list = Array.from(ghostStates.entries()).map(([peerId, state]) => ({ id: peerId, ...state }));
    options.onGhosts?.(list);
  }

  /**
   * @param {any} message
   */
  function handleControl(message) {
    switch (message.t) {
      case MSG.HELLO: {
        peers.set(message.id, {
          id: message.id,
          name: message.name || 'Driver',
          color: message.color || '#31d6ff',
          accent: message.accent || '#e9fbff',
          ready: true,
          lastSeen: Date.now(),
        });
        publishPeers();
        // The host owns the roster and the race configuration.
        if (role === 'host') {
          peer?.sendControl({
            t: MSG.WELCOME,
            id,
            peers: Array.from(peers.values()),
          });
        }
        break;
      }
      case MSG.WELCOME: {
        for (const info of message.peers || []) peers.set(info.id, info);
        publishPeers();
        break;
      }
      case MSG.START: {
        options.onStart?.({ trackId: message.trackId, seed: message.seed, laps: message.laps });
        break;
      }
      case MSG.SCORE: {
        scores.set(message.id, message.score);
        options.onScores?.(
          Array.from(scores.entries()).map(([peerId, score]) => ({
            id: peerId,
            name: peers.get(peerId)?.name || 'Driver',
            score,
          })),
        );
        break;
      }
      case MSG.BYE: {
        peers.delete(message.id);
        ghostStates.delete(message.id);
        publishPeers();
        broadcastGhosts();
        break;
      }
      default:
        break;
    }
  }

  /**
   * @param {any} message
   */
  function handleState(message) {
    if (message.t === MSG.GHOSTS) {
      // The host relays the full roster of car states.
      ghostStates.clear();
      for (const ghost of message.g || []) {
        ghostStates.set(ghost.id, {
          x: ghost.x,
          y: ghost.y,
          z: ghost.z,
          qx: ghost.qx,
          qy: ghost.qy,
          qz: ghost.qz,
          qw: ghost.qw,
          speed: ghost.speed,
          slip: ghost.slip,
        });
      }
      broadcastGhosts();
      return;
    }
    if (message.t !== MSG.STATE) return;
    const state = unpackState(message.p || []);
    const sender = message.id || 'peer';
    setGhost(sender, state);
    broadcastGhosts();
  }

  function createConnection(initiator) {
    const factory = options.createPeer ?? createPeer;
    peer = factory({
      initiator,
      iceServers,
      onControl: handleControl,
      onState: handleState,
      onOpen: () => {
        options.onStatus?.('connected');
        peer?.sendControl({
          t: MSG.HELLO,
          id,
          name: options.name,
          color: options.color,
          accent: options.accent,
        });
        // The host shares its own state so guests can see it.
        if (role === 'host') {
          // nothing to do yet, the first state packet will follow
        }
      },
      onClose: () => {
        options.onStatus?.('disconnected');
      },
      onStatus: (status) => {
        options.onStatus?.(status);
      },
    });
    return peer;
  }

  return {
    id,
    get role() {
      return role;
    },
    get isHost() {
      return role === 'host';
    },
    get peers() {
      return Array.from(peers.values());
    },
    get peerCount() {
      return peers.size;
    },

    /**
     * Start hosting and return an invite code for the guest.
     * @returns {Promise<string>}
     */
    async host() {
      role = 'host';
      createConnection(true);
      peers.set(id, {
        id,
        name: options.name,
        color: options.color,
        accent: options.accent,
        ready: true,
        lastSeen: Date.now(),
      });
      publishPeers();
      const sdp = await peer.createOffer();
      return packSignal({ k: 'offer', id, sdp, name: options.name });
    },

    /**
     * Finish the handshake with the answer code from the guest.
     * @param {string} code
     */
    async acceptAnswer(code) {
      const data = await unpackSignal(code);
      if (data.k !== 'answer') throw new Error('That is not an answer code');
      await peer?.acceptAnswer(data.sdp);
      options.onStatus?.('connecting');
    },

    /**
     * Join a room with the invite code.
     * @param {string} code
     */
    async join(code) {
      const data = await unpackSignal(code);
      if (data.k !== 'offer') throw new Error('That is not an invite code');
      role = 'guest';
      createConnection(false);
      const sdp = await peer.acceptOffer(data.sdp);
      return packSignal({ k: 'answer', id, sdp });
    },

    /**
     * Same-device room: two tabs on one phone or PC find each other.
     * The host keeps republishing its offer until somebody answers.
     */
    async joinLocal() {
      role = 'guest';
      createConnection(false);
      localSignal = createLocalSignal({
        id,
        onOffer: async (offer) => {
          try {
            const sdp = await peer?.acceptOffer(offer.sdp);
            if (sdp) localSignal?.publishAnswer(offer.from, sdp);
          } catch (err) {
            options.onNotice?.(String(err));
          }
        },
        onAnswer: async (answer) => {
          try {
            await peer?.acceptAnswer(answer.sdp);
          } catch (err) {
            options.onNotice?.(String(err));
          }
        },
      });
      options.onStatus?.('waiting-for-host');
    },

    /**
     * Host side of the same-device room.
     * @returns {Promise<void>}
     */
    async hostLocal() {
      role = 'host';
      createConnection(true);
      peers.set(id, {
        id,
        name: options.name,
        color: options.color,
        accent: options.accent,
        ready: true,
        lastSeen: Date.now(),
      });
      publishPeers();
      localSignal = createLocalSignal({
        id,
        onOffer: () => {},
        onAnswer: async (answer) => {
          try {
            await peer?.acceptAnswer(answer.sdp);
          } catch (err) {
            options.onNotice?.(String(err));
          }
        },
      });
      const publish = async () => {
        if (closed || !localSignal) return;
        const sdp = await peer?.createOffer();
        if (sdp) localSignal.publishOffer(sdp);
      };
      await publish();
      localOfferTimer = setInterval(publish, 2500);
    },

    /**
     * Broadcast the local car state (throttled to ~20 Hz).
     * @param {import('../game/vehicle.js').VehicleState} vehicle
     * @param {number} now
     */
    sendState(vehicle, now = Date.now()) {
      if (!peer || closed) return;
      const packed = packState(vehicle);
      if (role === 'host') {
        setGhost(id, {
          x: packed[0],
          y: packed[1],
          z: packed[2],
          qx: packed[3],
          qy: packed[4],
          qz: packed[5],
          qw: packed[6],
          speed: packed[7],
          slip: packed[8],
        });
        if (now - lastGhostBroadcast > 70) {
          lastGhostBroadcast = now;
          broadcastGhosts();
          // Relay every known car state to the guests.
          const list = Array.from(ghostStates.entries()).map(([peerId, state]) => ({
            id: peerId,
            x: state.x,
            y: state.y,
            z: state.z,
            qx: state.qx,
            qy: state.qy,
            qz: state.qz,
            qw: state.qw,
            speed: state.speed,
            slip: state.slip,
          }));
          peer.sendState({ t: MSG.GHOSTS, g: list });
        }
        return;
      }
      if (now - lastStateSent < 50) return;
      lastStateSent = now;
      peer.sendState({ t: MSG.STATE, id, p: packed });
    },

    /**
     * @param {number} score
     */
    sendScore(score) {
      peer?.sendControl({ t: MSG.SCORE, id, score });
    },

    /**
     * Host only: start the race for everyone.
     * @param {{ trackId: string, seed: number, laps: number }} config
     */
    startRace(config) {
      peer?.sendControl({ t: MSG.START, ...config });
      options.onStart?.(config);
    },

    /**
     * Host only: relay a guest state to the other guests.
     * @param {import('./protocol.js').GhostState[]} list
     */
    relayGhosts(list) {
      if (role !== 'host') return;
      for (const ghost of list) {
        peer?.sendState({ t: MSG.STATE, id: ghost.id, p: [ghost.x, ghost.z, ghost.heading, ghost.drift, ghost.boost ? 1 : 0] });
      }
    },

    leave() {
      if (closed) return;
      closed = true;
      peer?.sendControl({ t: MSG.BYE, id });
      if (localOfferTimer) clearInterval(localOfferTimer);
      localSignal?.close();
      peer?.close();
      peer = null;
      role = null;
      peers.clear();
      ghostStates.clear();
    },
  };
}
