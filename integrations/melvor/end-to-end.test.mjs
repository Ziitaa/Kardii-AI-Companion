import test from "node:test";
import assert from "node:assert/strict";
import { createMelvorReceiver } from "./local-receiver.mjs";
import { sendSnapshot } from "./steam-mod/setup.mjs";

const mockGame = () => ({
  gp: { amount: 750 },
  bank: { items: [1, 2, 3], maximumSlots: 20 },
  skills: { getObjectByID: id => ({ level: id.endsWith("Fishing") ? 12 : 5 }) }
});

test("Steam sender -> loopback receiver -> validated agent observation", async () => {
  const received = [];
  const receiver = createMelvorReceiver({
    allowedOrigins: ["https://melvoridle.com"],
    onSnapshot: observation => received.push(observation)
  });
  const port = await receiver.start();
  try {
    const url = `http://127.0.0.1:${port}/v1/snapshot`;
    const fetchImpl = (url, options) => fetch(url, {
      ...options, headers: { ...options.headers, Origin: "https://melvoridle.com" }
    });
    const response = await sendSnapshot({
      game: mockGame(), url, token: receiver.token, fetchImpl
    });
    assert.equal(response.accepted, true);
    assert.equal(response.mayExecute, false);
    assert.equal(received.length, 1);
    assert.equal(received[0].snapshot.gp, 750);
    assert.equal(received[0].snapshot.skills.Fishing, 12);
    assert.equal(received[0].assessment.mayExecute, false);
    assert.equal(receiver.latest().snapshot.bank.used, 3);
  } finally { await receiver.stop(); }
});

test("Steam sender cannot publish with wrong token", async () => {
  const receiver = createMelvorReceiver();
  const port = await receiver.start();
  try {
    await assert.rejects(
      sendSnapshot({
        game: mockGame(),
        url: `http://127.0.0.1:${port}/v1/snapshot`,
        token: "b".repeat(64)
      }),
      /401/
    );
    assert.equal(receiver.latest(), null);
  } finally { await receiver.stop(); }
});
