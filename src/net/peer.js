/**
 * Thin WebRTC wrapper: one reliable channel for control messages and one
 * unreliable channel for the 20 Hz car state stream.
 */

export const DEFAULT_STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * @param {{
 *   initiator: boolean,
 *   iceServers?: RTCIceServer[],
 *   onControl?: (message: any) => void,
 *   onState?: (message: any) => void,
 *   onOpen?: () => void,
 *   onClose?: () => void,
 *   onStatus?: (status: string) => void,
 * }} options
 */
export function createPeer(options) {
  const RTC = /** @type {any} */ (globalThis).RTCPeerConnection;
  if (!RTC) {
    throw new Error('WebRTC is not available in this browser');
  }
  const pc = new RTCPeerConnection({
    iceServers: options.iceServers ?? DEFAULT_STUN,
    iceCandidatePoolSize: 2,
  });

  /** @type {RTCDataChannel | null} */
  let control = null;
  /** @type {RTCDataChannel | null} */
  let state = null;
  let open = false;

  /**
   * @param {RTCDataChannel} channel
   */
  function register(channel) {
    channel.binaryType = 'arraybuffer';
    if (channel.label === 'state') {
      state = channel;
      channel.onmessage = (event) => {
        try {
          options.onState?.(JSON.parse(event.data));
        } catch {
          /* ignore malformed packets */
        }
      };
    } else {
      control = channel;
      channel.onmessage = (event) => {
        try {
          options.onControl?.(JSON.parse(event.data));
        } catch {
          /* ignore malformed packets */
        }
      };
    }
    channel.onopen = () => {
      if (control?.readyState === 'open' && state?.readyState === 'open' && !open) {
        open = true;
        options.onOpen?.();
      }
    };
    channel.onclose = () => {
      if (open) {
        open = false;
        options.onClose?.();
      }
    };
  }

  if (options.initiator) {
    register(pc.createDataChannel('ctrl', { ordered: true }));
    register(pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
  } else {
    pc.ondatachannel = (event) => register(event.channel);
  }

  pc.onconnectionstatechange = () => {
    options.onStatus?.(pc.connectionState);
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      open = false;
      options.onClose?.();
    }
  };

  return {
    pc,
    /** @returns {boolean} */
    get isOpen() {
      return open;
    },
    /**
     * @param {any} message
     */
    sendControl(message) {
      if (control?.readyState === 'open') {
        control.send(JSON.stringify(message));
        return true;
      }
      return false;
    },
    /**
     * @param {any} message
     */
    sendState(message) {
      if (state?.readyState === 'open') {
        state.send(JSON.stringify(message));
        return true;
      }
      return false;
    },
    /**
     * Create an offer and wait until ICE gathering is complete so the code
     * contains every candidate.
     * @returns {Promise<string>}
     */
    async createOffer() {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIce(pc);
      return pc.localDescription?.sdp ?? '';
    },
    /**
     * @param {string} sdp
     */
    async acceptOffer(sdp) {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIce(pc);
      return pc.localDescription?.sdp ?? '';
    },
    /**
     * @param {string} sdp
     */
    async acceptAnswer(sdp) {
      if (pc.signalingState === 'stable') return;
      await pc.setRemoteDescription({ type: 'answer', sdp });
    },
    close() {
      try {
        control?.close();
        state?.close();
        pc.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/**
 * Resolve once ICE gathering finished (or the timeout expired).
 * @param {RTCPeerConnection} pc
 * @param {number} [timeout]
 * @returns {Promise<void>}
 */
export function waitForIce(pc, timeout = 3500) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', done);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeout);
    pc.addEventListener('icegatheringstatechange', done);
    done();
  });
}
