import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/index.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const customer = {
  name: "Тестовый покупатель",
  email: "demo@example.com",
  address: "Тестовый город, дом 1",
};
test("orders are priced on server, idempotent, session-isolated, transactional and durable", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "store-test-"));
  const dbPath = path.join(dir, "db.sqlite");
  let app = createStore({ dbPath });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const cat = await fetch(base + "/api/catalog");
    const cookie = cat.headers.get("set-cookie").split(";")[0];
    const data = await cat.json(),
      p = data.products[0];
    const headers = {
      "Content-Type": "application/json",
      Cookie: cookie,
      "Idempotency-Key": "test-order-key-0001",
    };
    const body = {
      customer,
      items: [{ id: p.id, qty: 1, price: 1, options: {} }],
    };
    const r = await fetch(base + "/api/orders", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 201);
    const order = await r.json();
    assert.equal(order.subtotal, p.price);
    assert.equal(order.total, p.price + (p.price >= 8000 ? 0 : 390));
    const again = await fetch(base + "/api/orders", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).id, order.id);
    const changed = await fetch(base + "/api/orders", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, items: [{ id: p.id, qty: 2 }] }),
    });
    assert.equal(changed.status, 409);
    assert.equal((await fetch(base + "/api/orders/" + order.id)).status, 404);
    assert.equal(
      (
        await fetch(base + "/api/orders/" + order.id, {
          headers: { Cookie: cookie },
        })
      ).status,
      200,
    );
    const inventory = await (await fetch(base + "/api/catalog")).json();
    assert.equal(inventory.products[0].stock, p.stock - 1);
    const badHeaders = { ...headers, "Idempotency-Key": "test-order-key-0002" };
    const oversold = await fetch(base + "/api/orders", {
      method: "POST",
      headers: badHeaders,
      body: JSON.stringify({
        ...body,
        items: [
          { id: p.id, qty: 20 },
          { id: p.id, qty: 20 },
        ],
      }),
    });
    assert.equal(oversold.status, 409);
    assert.equal(
      (await (await fetch(base + "/api/catalog")).json()).products[0].stock,
      p.stock - 1,
    );
    const invalid = await fetch(base + "/api/orders", {
      method: "POST",
      headers: badHeaders,
      body: JSON.stringify({ ...body, items: [{ id: p.id, qty: -1 }] }),
    });
    assert.equal(invalid.status, 400);
    const invalidCustomer = await fetch(base + "/api/orders", {
      method: "POST",
      headers: badHeaders,
      body: JSON.stringify({ ...body, customer: { name: "x" } }),
    });
    assert.equal(invalidCustomer.status, 400);
    const forged = await fetch(base + "/api/orders", {
      method: "POST",
      headers: { ...badHeaders, Origin: "https://other.example" },
      body: JSON.stringify(body),
    });
    assert.equal(forged.status, 403);
    if (data.id === "shagren") {
      const invalidOptions = await fetch(base + "/api/orders", {
        method: "POST",
        headers: badHeaders,
        body: JSON.stringify({
          ...body,
          items: [
            { id: p.id, qty: 1, options: { monogram: "<X>", foil: "gold" } },
          ],
        }),
      });
      assert.equal(invalidOptions.status, 400);
    }
    await app.close();
    app = createStore({ dbPath });
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${app.server.address().port}`;
    assert.equal(
      (
        await fetch(base + "/api/orders/" + order.id, {
          headers: { Cookie: cookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await fetch(base + "/api/catalog")).json()).products[0].stock,
      p.stock - 1,
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
