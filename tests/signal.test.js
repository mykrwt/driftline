import test from 'node:test';
import assert from 'node:assert/strict';
import { packSignal, unpackSignal, createPeerId, createLocalSignal } from '../src/net/signal.js';

test('a signal payload round trips', async () => {
  const payload = { k: 'offer', id: 'abcd', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n', name: 'Swift' };
  const code = await packSignal(payload);
  assert.ok(code.length > 0);
  assert.ok(code.length < 4000, `code was ${code.length} chars`);
  const decoded = await unpackSignal(code);
  assert.equal(decoded.k, 'offer');
  assert.equal(decoded.id, 'abcd');
  assert.equal(decoded.sdp, payload.sdp);
});

test('codes are URL safe and whitespace tolerant', async () => {
  const code = await packSignal({ k: 'answer', sdp: 'x'.repeat(400) });
  assert.ok(!/[+/=]/.test(code.replace(/^./, '')), `code contains unsafe characters: ${code}`);
  const spaced = `  ${code.slice(0, 10)}\n${code.slice(10)}  `;
  const decoded = await unpackSignal(spaced);
  assert.equal(decoded.k, 'answer');
});

test('an invalid code throws a readable error', async () => {
  await assert.rejects(() => unpackSignal(''), /Empty code/);
  await assert.rejects(() => unpackSignal('!!!not base64!!!'), /[A-Za-z]/);
});

test('peer ids are unique-ish', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i++) ids.add(createPeerId());
  assert.ok(ids.size > 195, `only ${ids.size} unique ids`);
});

test('the same-device signal relays offers and answers', async () => {
  const offers = [];
  const answers = [];
  const host = createLocalSignal({
    id: 'host1',
    onOffer: (offer) => offers.push(offer),
    onAnswer: (answer) => answers.push(answer),
  });
  const guest = createLocalSignal({
    id: 'guest1',
    onOffer: (offer) => offers.push(offer),
    onAnswer: (answer) => answers.push(answer),
  });
  assert.equal(host.available, true);

  guest.publishOffer('offer-sdp');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(offers.length, 1);
  assert.equal(offers[0].sdp, 'offer-sdp');
  assert.equal(offers[0].from, 'guest1');

  host.publishAnswer('guest1', 'answer-sdp');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(answers.length, 1);
  assert.equal(answers[0].sdp, 'answer-sdp');

  host.close();
  guest.close();
});
