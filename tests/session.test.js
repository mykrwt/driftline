import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/net/session.js';

/**
 * A loopback peer factory: two sessions in this process talk to each other
 * exactly like they would over a WebRTC data channel.
 */
function createLoopbackFactory() {
  const waiting = [];
  /**
   * @param {any} options
   */
  return function factory(options) {
    /** @type {any} */
    const peer = {
      options,
      partner: null,
      isOpen: true,
      sendControl(message) {
        peer.partner?.options.onControl?.(message);
        return true;
      },
      sendState(message) {
        peer.partner?.options.onState?.(message);
        return true;
      },
      async createOffer() {
        return 'offer-sdp';
      },
      async acceptOffer() {
        return 'answer-sdp';
      },
      async acceptAnswer() {},
      close() {
        peer.isOpen = false;
      },
    };
    if (waiting.length) {
      const other = waiting.shift();
      peer.partner = other;
      other.partner = peer;
      queueMicrotask(() => {
        options.onOpen?.();
        other.options.onOpen?.();
      });
    } else {
      waiting.push(peer);
    }
    return peer;
  };
}

const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} [overrides]
 */
function makePair(overrides = {}) {
  const factory = createLoopbackFactory();
  const hostGhosts = [];
  const guestGhosts = [];
  const hostPeers = [];
  const guestPeers = [];
  const host = createSession({
    name: 'Host',
    color: '#ff0000',
    accent: '#ffffff',
    createPeer: factory,
    onGhosts: (ghosts) => hostGhosts.push(ghosts),
    onPeers: (peers) => hostPeers.push(peers),
    ...overrides,
  });
  const guest = createSession({
    name: 'Guest',
    color: '#00ff00',
    accent: '#ffffff',
    createPeer: factory,
    onGhosts: (ghosts) => guestGhosts.push(ghosts),
    onPeers: (peers) => guestPeers.push(peers),
    ...overrides,
  });
  return { host, guest, hostGhosts, guestGhosts, hostPeers, guestPeers };
}

test('a guest joins a host and both learn about each other', async () => {
  const { host, guest, hostPeers, guestPeers } = makePair();

  const invite = await host.host();
  assert.ok(invite.length > 10);

  const reply = await guest.join(invite);
  assert.ok(reply.length > 10);
  await wait(30);

  assert.equal(host.isHost, true);
  assert.equal(guest.isHost, false);
  assert.ok(host.peerCount >= 2, `host peers: ${host.peerCount}`);
  assert.ok(guest.peerCount >= 2, `guest peers: ${guest.peerCount}`);
  assert.ok(hostPeers.length > 0);
  assert.ok(guestPeers.length > 0);

  host.leave();
  guest.leave();
});

test('guest car state reaches the host as a ghost', async () => {
  const { host, guest, hostGhosts, guestGhosts } = makePair();

  const invite = await host.host();
  await guest.join(invite);
  await wait(30);

  guest.sendState(
    {
      position: { x: 5, y: 0.5, z: 7 },
      quaternion: { x: 0, y: 0.382, z: 0, w: 0.924 },
      speed: 22,
      slipAngle: 0.2,
    },
    1000,
  );
  await wait(20);

  const ghosts = hostGhosts[hostGhosts.length - 1] || [];
  const withGuest = ghosts.find((g) => g.id === guest.id);
  assert.ok(withGuest, 'the host should see the guest car');
  assert.equal(withGuest.x, 5);
  assert.equal(withGuest.y, 0.5);
  assert.equal(withGuest.z, 7);
  assert.equal(withGuest.qy, 0.382);
  assert.equal(withGuest.speed, 22);

  // The host relays every known car state back to the guests.
  host.sendState(
    {
      position: { x: 1, y: 0.5, z: 2 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      speed: 10,
      slipAngle: 0,
    },
    2000,
  );
  await wait(20);
  const relayed = guestGhosts[guestGhosts.length - 1] || [];
  assert.ok(relayed.length >= 1, 'the guest should receive relayed ghosts');
  assert.ok(relayed.some((g) => g.id === host.id), 'the host car should be relayed');

  host.leave();
  guest.leave();
});

test('the host starts the race for everybody', async () => {
  let started = null;
  const { host, guest } = makePair({
    onStart: (config) => {
      started = { ...config, by: started ? 'both' : 'host' };
    },
  });

  const invite = await host.host();
  await guest.join(invite);
  await wait(30);

  host.startRace({ trackId: 'coast', seed: 1234, laps: 3 });
  await wait(20);
  assert.ok(started, 'a start event should fire');
  assert.equal(started.trackId, 'coast');
  assert.equal(started.seed, 1234);
  assert.equal(started.laps, 3);

  host.leave();
  guest.leave();
});

test('scores are shared with the host', async () => {
  const scores = [];
  const { host, guest } = makePair({
    onScores: (list) => scores.push(list),
  });

  const invite = await host.host();
  await guest.join(invite);
  await wait(30);

  guest.sendScore(4321);
  await wait(20);
  const latest = scores[scores.length - 1] || [];
  assert.ok(latest.some((entry) => entry.score === 4321), 'the score should arrive');

  host.leave();
  guest.leave();
});

test('leaving clears the session', async () => {
  const factory = createLoopbackFactory();
  const session = createSession({
    name: 'Solo',
    color: '#fff',
    accent: '#fff',
    createPeer: factory,
  });
  await session.host();
  assert.equal(session.isHost, true);
  session.leave();
  assert.equal(session.isHost, false);
  assert.equal(session.peerCount, 0);
});
