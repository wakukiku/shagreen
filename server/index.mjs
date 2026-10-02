import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const seed = JSON.parse(
  fs.readFileSync(path.join(project, "public/catalog.json"), "utf8"),
);
export function createStore({
  dbPath = process.env.DB_PATH || path.join(project, "data/store.sqlite"),
} = {}) {
  if (dbPath !== ":memory:")
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS inventory(id TEXT PRIMARY KEY,stock INTEGER NOT NULL CHECK(stock>=0));
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,session TEXT NOT NULL,idempotency TEXT NOT NULL,request TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(session,idempotency));`);
  for (const p of seed.products)
    db.prepare("INSERT OR IGNORE INTO inventory VALUES (?,?)").run(
      p.id,
      p.stock,
    );
  const limits = new Map();
  const json = (res, status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    let url;
    try {
      url = new URL("http://localhost" + req.url);
    } catch {
      return json(res, 400, { error: "Некорректный адрес запроса." });
    }
    let session = /\bstore_session=([a-f0-9]{48})\b/.exec(
      req.headers.cookie || "",
    )?.[1];
    if (!session) {
      session = randomBytes(24).toString("hex");
      res.setHeader(
        "Set-Cookie",
        `store_session=${session}; HttpOnly; SameSite=Strict; Path=/`,
      );
    }
    try {
      if (url.pathname === "/api/health")
        return json(res, 200, { ok: true, store: seed.id });
      if (url.pathname === "/api/catalog" && req.method === "GET")
        return json(res, 200, {
          ...seed,
          mode: "server",
          products: seed.products.map((p) => ({
            ...p,
            stock: db
              .prepare("SELECT stock FROM inventory WHERE id=?")
              .get(p.id).stock,
          })),
        });
      if (url.pathname === "/api/orders" && req.method === "POST") {
        if (
          req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host
        )
          return json(res, 403, { error: "Запрос с другого сайта отклонён." });
        if (!String(req.headers["content-type"]).startsWith("application/json"))
          return json(res, 415, { error: "Ожидается JSON." });
        const ip = req.socket.remoteAddress,
          now = Date.now();
        if (limits.size > 1000)
          for (const [key, v] of limits) if (v.until < now) limits.delete(key);
        const limit = limits.get(ip) || { count: 0, until: now + 60000 };
        if (limit.until < now) {
          limit.count = 0;
          limit.until = now + 60000;
        }
        limit.count++;
        limits.set(ip, limit);
        if (limit.count > 30)
          return json(res, 429, {
            error: "Слишком много заказов. Попробуйте через минуту.",
          });
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 32768) {
            json(res, 413, { error: "Слишком большой запрос." });
            return;
          }
        }
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(res, 400, { error: "Некорректный JSON." });
        }
        const key = req.headers["idempotency-key"];
        if (typeof key !== "string" || !/^[\w-]{10,80}$/.test(key))
          return json(res, 400, { error: "Не указан идентификатор заказа." });
        const previous = db
          .prepare(
            "SELECT payload,request FROM orders WHERE session=? AND idempotency=?",
          )
          .get(session, key);
        if (previous) {
          if (previous.request !== raw)
            return json(res, 409, {
              error: "Этот идентификатор уже использован для другого заказа.",
            });
          return json(res, 200, JSON.parse(previous.payload));
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          return json(res, 400, { error: "Ожидается объект заказа." });
        const { customer, items } = body;
        if (
          !customer ||
          typeof customer.name !== "string" ||
          customer.name.trim().length < 2 ||
          customer.name.length > 80 ||
          typeof customer.email !== "string" ||
          !/^\S+@\S+\.\S+$/.test(customer.email) ||
          customer.email.length > 120 ||
          typeof customer.address !== "string" ||
          customer.address.trim().length < 5 ||
          customer.address.length > 250
        )
          return json(res, 400, {
            error: "Проверьте имя, email и адрес доставки.",
          });
        if (!Array.isArray(items) || !items.length || items.length > 30)
          return json(res, 400, {
            error: "Корзина должна содержать от 1 до 30 позиций.",
          });
        const totals = new Map(),
          lines = [];
        for (const item of items) {
          if (!item || typeof item !== "object")
            return json(res, 400, { error: "Некорректная позиция корзины." });
          const p = seed.products.find((p) => p.id === item.id);
          if (
            !p ||
            !Number.isInteger(item.qty) ||
            item.qty < 1 ||
            item.qty > 20
          )
            return json(res, 400, {
              error: "Некорректный товар или количество.",
            });
          let options = {};
          if (seed.id === "shagren" && item.options?.monogram) {
            if (
              typeof item.options.monogram !== "string" ||
              !/^[А-ЯЁA-Z]{1,3}$/.test(item.options.monogram) ||
              !["gold", "blind", "silver"].includes(item.options.foil)
            )
              return json(res, 400, {
                error: "Монограмма: от 1 до 3 букв, без символов.",
              });
            options = {
              monogram: item.options.monogram,
              foil: item.options.foil,
            };
          }
          totals.set(p.id, (totals.get(p.id) || 0) + item.qty);
          lines.push({
            id: p.id,
            name: p.name,
            price: p.price,
            qty: item.qty,
            options,
          });
        }
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const [id, qty] of totals) {
            const stock = db
              .prepare("SELECT stock FROM inventory WHERE id=?")
              .get(id).stock;
            if (qty > stock) {
              db.exec("ROLLBACK");
              return json(res, 409, {
                error: `Недостаточно товара: ${seed.products.find((p) => p.id === id).name}. Осталось ${stock}.`,
              });
            }
          }
          const subtotal = lines.reduce((s, p) => s + p.price * p.qty, 0),
            shipping = subtotal >= 8000 ? 0 : 390;
          const order = {
            id: randomUUID(),
            number: `${seed.id.toUpperCase().slice(0, 3)}-${randomBytes(3).toString("hex").toUpperCase()}`,
            items: lines,
            subtotal,
            shipping,
            total: subtotal + shipping,
            status: "demo",
            createdAt: new Date().toISOString(),
          };
          db.prepare("INSERT INTO orders VALUES(?,?,?,?,?,?)").run(
            order.id,
            session,
            key,
            raw,
            JSON.stringify(order),
            order.createdAt,
          );
          for (const [id, qty] of totals)
            db.prepare("UPDATE inventory SET stock=stock-? WHERE id=?").run(
              qty,
              id,
            );
          db.exec("COMMIT");
          return json(res, 201, order);
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      }
      if (url.pathname.startsWith("/api/orders/") && req.method === "GET") {
        const found = db
          .prepare("SELECT payload FROM orders WHERE id=? AND session=?")
          .get(url.pathname.split("/").pop(), session);
        return json(
          res,
          found ? 200 : 404,
          found ? JSON.parse(found.payload) : { error: "Заказ не найден." },
        );
      }
      if (url.pathname.startsWith("/api/"))
        return json(res, 404, { error: "Маршрут не найден." });
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405);
        res.end();
        return;
      }
      let decoded;
      try {
        decoded = decodeURIComponent(url.pathname);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      const base = path.join(project, "dist");
      const file = path.resolve(
        base,
        "." + (decoded.endsWith("/") ? decoded + "index.html" : decoded),
      );
      if (
        !file.startsWith(base + path.sep) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
      };
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "Cache-Control":
          path.extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      if (req.method === "HEAD") res.end();
      else fs.createReadStream(file).pipe(res);
    } catch (error) {
      console.error(error.message);
      if (!res.headersSent)
        json(res, 500, {
          error: "Не удалось выполнить запрос. Попробуйте ещё раз.",
        });
      else res.end();
    }
  });
  return {
    server,
    db,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          db.close();
          resolve();
        }),
      ),
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server } = createStore();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`Store ready: http://localhost:${port}`),
  );
}
