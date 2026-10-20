/**
 * Serverless signalling.
 *
 * Two ways to connect, neither of which needs a server:
 *   1. Manual codes - the host generates an invite code, the guest pastes it
 *      and sends back an answer code. Works over any chat app.
 *   2. Same-device - a BroadcastChannel lets two tabs on one phone/PC find
 *      each other automatically. Handy for testing and for playing on one
 *      device with two windows.
 *
 * Codes are deflated and base64url encoded so they stay short enough to send
 * over SMS.
 */

const CODE_PREFIX_DEFLATE = 'D';
const CODE_PREFIX_RAW = 'R';
export const LOCAL_CHANNEL = 'driftline-signal-v1';

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64Url(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, /** @type {number[]} */ (Array.from(bytes.subarray(i, i + chunk))));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
function base64UrlToBytes(text) {
  const normalised = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
async function deflate(bytes) {
  const CS = /** @type {any} */ (globalThis).CompressionStream;
  if (!CS) return bytes;
  const stream = new CS('deflate-raw');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
async function inflate(bytes) {
  const DS = /** @type {any} */ (globalThis).DecompressionStream;
  if (!DS) return bytes;
  const stream = new DS('deflate-raw');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Pack a signalling payload into a shareable code.
 * @param {any} data
 * @returns {Promise<string>}
 */
export async function packSignal(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const compressed = await deflate(bytes);
  const prefix = compressed.length < bytes.length ? CODE_PREFIX_DEFLATE : CODE_PREFIX_RAW;
  const payload = prefix === CODE_PREFIX_DEFLATE ? compressed : bytes;
  return prefix + bytesToBase64Url(payload);
}

/**
 * Unpack a signalling code.
 * @param {string} code
 * @returns {Promise<any>}
 */
export async function unpackSignal(code) {
  const trimmed = (code || '').trim().replace(/\s+/g, '');
  if (!trimmed) throw new Error('Empty code');
  const prefix = trimmed[0];
  const body = base64UrlToBytes(trimmed.slice(1));
  const bytes = prefix === CODE_PREFIX_DEFLATE ? await inflate(body) : body;
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * BroadcastChannel signalling for two tabs on the same device.
 *
 * @param {{ id: string, onOffer: (offer: { from: string, sdp: string }) => void, onAnswer: (answer: { from: string, sdp: string }) => void }} options
 */
export function createLocalSignal(options) {
  const BC = /** @type {any} */ (globalThis).BroadcastChannel;
  if (!BC) {
    return {
      available: false,
      publishOffer() {},
      publishAnswer() {},
      close() {},
    };
  }
  const channel = new BC(LOCAL_CHANNEL);
  // Node keeps the process alive for open channels; browsers ignore this.
  channel.unref?.();
  channel.onmessage = (/** @type {MessageEvent} */ event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.kind === 'offer' && (!data.to || data.to === options.id)) {
      options.onOffer({ from: data.from, sdp: data.sdp });
    } else if (data.kind === 'answer' && data.to === options.id) {
      options.onAnswer({ from: data.from, sdp: data.sdp });
    }
  };
  return {
    available: true,
    /**
     * @param {string} sdp
     */
    publishOffer(sdp) {
      channel.postMessage({ kind: 'offer', from: options.id, sdp });
    },
    /**
     * @param {string} to
     * @param {string} sdp
     */
    publishAnswer(to, sdp) {
      channel.postMessage({ kind: 'answer', from: options.id, to, sdp });
    },
    close() {
      channel.close();
    },
  };
}

/**
 * Random short identifier for peers.
 * @returns {string}
 */
export function createPeerId() {
  const bytes = new Uint8Array(4);
  const crypto = /** @type {any} */ (globalThis).crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
