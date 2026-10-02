import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
export type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  subtitle: string;
  image: string;
  stock: number;
  material: string;
  size: string;
  format?: string;
  type?: string;
  hex?: string;
  light?: string;
  care?: string;
  pet?: boolean;
  weight?: number;
  role?: string;
};
export type Options = { monogram?: string; foil?: string };
export type Line = { id: string; qty: number; options: Options };
export type Catalog = {
  id: string;
  name: string;
  description: string;
  products: Product[];
};
export const money = (n: number) =>
  new Intl.NumberFormat("ru-RU").format(n) + " ₽";
export const keyOf = (p: Line) => p.id + JSON.stringify(p.options);
export function useShop(id: string) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [mode, setMode] = useState("loading"),
    [error, setError] = useState("");
  const [cart, setCart] = useState<Line[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(id + "-cart") || "[]");
      return Array.isArray(v)
        ? v.filter(
            (x) =>
              typeof x.id === "string" &&
              Number.isInteger(x.qty) &&
              x.qty > 0 &&
              x.qty <= 20 &&
              x.options &&
              typeof x.options === "object",
          )
        : [];
    } catch {
      return [];
    }
  });
  const [cartOpen, setCartOpen] = useState(false),
    [detail, setDetail] = useState<Product | null>(null),
    [toast, setToast] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const r = await fetch("./api/catalog");
        if (!r.ok) throw Error();
        const d = await r.json();
        if (!d.products) throw Error();
        if (active) {
          setCatalog(d);
          setMode("server");
        }
      } catch {
        try {
          const r = await fetch("./catalog.json");
          if (!r.ok) throw Error();
          const d = await r.json();
          if (active) {
            setCatalog(d);
            setMode("static");
          }
        } catch {
          if (active)
            setError(
              "Каталог не загрузился. Проверьте соединение и обновите страницу.",
            );
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(id + "-cart", JSON.stringify(cart));
    } catch {}
  }, [cart, id]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  const add = (p: Product, options: Options = {}, qty = 1) => {
    const total = cart
      .filter((l) => l.id === p.id)
      .reduce((s, l) => s + l.qty, 0);
    if (total + qty > Math.min(p.stock, 20)) {
      setToast("Достигнут доступный остаток");
      return false;
    }
    setCart((old) => {
      const line = { id: p.id, qty, options };
      const existing = old.find((l) => keyOf(l) === keyOf(line));
      return existing
        ? old.map((l) =>
            keyOf(l) === keyOf(line) ? { ...l, qty: l.qty + qty } : l,
          )
        : [...old, line];
    });
    setToast(`${p.name} — в корзине`);
    return true;
  };
  const addSet = (products: Product[]) => {
    setCart((old) => {
      let next = [...old];
      for (const p of products) {
        const q = next
          .filter((l) => l.id === p.id)
          .reduce((s, l) => s + l.qty, 0);
        if (q >= Math.min(20, p.stock)) continue;
        const existing = next.find(
          (l) => l.id === p.id && !Object.keys(l.options).length,
        );
        next = existing
          ? next.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l))
          : [...next, { id: p.id, qty: 1, options: {} }];
      }
      return next;
    });
    setToast("Набор добавлен в корзину");
  };
  const latest = useRef({ catalog, cart, add });
  latest.current = { catalog, cart, add };
  useEffect(() => {
    const ctx = (
      document as unknown as {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!ctx?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = [
      {
        name: "list_products",
        description: "Read this store catalog and current local cart.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: () => ({
          products: latest.current.catalog?.products || [],
          cart: latest.current.cart,
        }),
      },
      {
        name: "stage_cart_item",
        description:
          "Add a catalog item to the visible cart. Does not place an order.",
        inputSchema: {
          type: "object",
          properties: {
            productId: { type: "string" },
            quantity: { type: "integer", minimum: 1, maximum: 20 },
          },
          required: ["productId", "quantity"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: (input: unknown) => {
          const v = input as { productId: string; quantity: number };
          if (
            !v ||
            typeof v.productId !== "string" ||
            !Number.isInteger(v.quantity) ||
            v.quantity < 1 ||
            v.quantity > 20
          )
            throw Error("Invalid product or quantity");
          const p = latest.current.catalog?.products.find(
            (p) => p.id === v.productId,
          );
          if (!p) throw Error("Unknown product");
          let ok = false;
          flushSync(() => {
            ok = latest.current.add(p, {}, v.quantity);
          });
          if (!ok) throw Error("Insufficient stock");
          return { staged: true, productId: p.id, quantity: v.quantity };
        },
      },
    ];
    for (const tool of tools) {
      try {
        Promise.resolve(
          ctx.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    }
    return () => lifecycle.abort();
  }, []);
  return {
    catalog,
    mode,
    error,
    cart,
    setCart,
    cartOpen,
    setCartOpen,
    detail,
    setDetail,
    toast,
    setToast,
    add,
    addSet,
    count: cart.reduce((s, l) => s + l.qty, 0),
  };
}
export type Shop = ReturnType<typeof useShop>;
export function Loading({ shop }: { shop: Shop }) {
  return (
    <div className="loading" role="status">
      {shop.error || "Загружаем коллекцию…"}
      {shop.error && (
        <button onClick={() => location.reload()}>Повторить</button>
      )}
    </div>
  );
}
export function Image({
  p,
  className = "",
}: {
  p: Product;
  className?: string;
}) {
  return p.hex ? (
    <div
      role="img"
      aria-label={`Образец цвета: ${p.name}`}
      className={"color-sample " + className}
      style={{ background: p.hex }}
    >
      <span>{p.name}</span>
    </div>
  ) : (
    <img
      className={className}
      src={p.image}
      alt={p.name}
      loading="lazy"
      width="800"
      height="900"
    />
  );
}
export function CartButton({
  shop,
  children,
}: {
  shop: Shop;
  children?: React.ReactNode;
}) {
  return (
    <button
      className="cart-button"
      onClick={() => shop.setCartOpen(true)}
      aria-label={`Корзина, товаров: ${shop.count}`}
    >
      {children || "Корзина"}{" "}
      <span>{shop.count.toString().padStart(2, "0")}</span>
    </button>
  );
}
export function Dialog({
  open,
  onClose,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (open && !el?.open) el?.showModal();
    else if (!open && el?.open) el.close();
    return () => {};
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={className}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
      aria-label={title}
    >
      <div className="dialog-content">
        <div className="dialog-heading">
          <h2>{title}</h2>
          <button className="close" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function ShopOverlays({
  shop,
  renderDetail,
}: {
  shop: Shop;
  renderDetail?: (p: Product) => React.ReactNode;
}) {
  const [checkout, setCheckout] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [order, setOrder] = useState<{
      number: string;
      total: number;
      id?: string;
    } | null>(null);
  const idempotency = useRef(crypto.randomUUID());
  const lastBody = useRef("");
  const products = shop.catalog?.products || [];
  const lines = shop.cart
    .map((l) => ({ ...l, p: products.find((p) => p.id === l.id) }))
    .filter((l) => l.p) as (Line & { p: Product })[];
  const subtotal = lines.reduce((s, l) => s + l.p.price * l.qty, 0),
    shipping = subtotal >= 8000 ? 0 : 390;
  const change = (l: Line, delta: number) => {
    setError("");
    shop.setCart((old) =>
      old
        .map((x) => (keyOf(l) === keyOf(x) ? { ...x, qty: x.qty + delta } : x))
        .filter((x) => x.qty > 0),
    );
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const customer = Object.fromEntries(f);
    const body = JSON.stringify({ customer, items: shop.cart });
    if (lastBody.current !== body) {
      idempotency.current = crypto.randomUUID();
      lastBody.current = body;
    }
    try {
      let result;
      if (shop.mode === "server") {
        const r = await fetch("./api/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency.current,
          },
          body,
        });
        result = await r.json();
        if (!r.ok)
          throw Error(
            result.error || "Заказ не отправлен. Попробуйте ещё раз.",
          );
      } else {
        result = {
          number: "DEMO-" + crypto.randomUUID().slice(0, 6).toUpperCase(),
          total: subtotal + shipping,
        };
      }
      setOrder(result);
      shop.setCart([]);
      setCheckout(false);
      idempotency.current = crypto.randomUUID();
      lastBody.current = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось оформить заказ.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className={"toast" + (shop.toast ? " visible" : "")} role="status">
        {shop.toast}
      </div>
      <Dialog
        open={!!shop.detail}
        onClose={() => shop.setDetail(null)}
        title={shop.detail?.name || "Товар"}
        className="product-dialog"
      >
        {shop.detail && (
          <>
            <div className="detail-grid">
              <Image p={shop.detail} />
              <div>
                <p className="detail-category">{shop.detail.category}</p>
                <p>{shop.detail.subtitle}</p>
                <dl>
                  <dt>Материал</dt>
                  <dd>{shop.detail.material}</dd>
                  <dt>Размер / объём</dt>
                  <dd>{shop.detail.size}</dd>
                  <dt>В наличии</dt>
                  <dd>{shop.detail.stock} шт.</dd>
                </dl>
                <strong className="detail-price">
                  {money(shop.detail.price)}
                </strong>
                {renderDetail ? (
                  renderDetail(shop.detail)
                ) : (
                  <button
                    className="primary"
                    disabled={!shop.detail.stock}
                    onClick={() => shop.add(shop.detail!)}
                  >
                    Добавить в корзину
                  </button>
                )}
              </div>
            </div>
            <p className="delivery-note">
              Доставка — 390 ₽. Бесплатно от 8 000 ₽.
            </p>
          </>
        )}
      </Dialog>
      <Dialog
        open={shop.cartOpen}
        onClose={() => shop.setCartOpen(false)}
        title={
          order ? "Заказ оформлен" : checkout ? "Доставка" : "Ваша корзина"
        }
        className="cart-dialog"
      >
        {order ? (
          <div className="order-success">
            <span className="success-mark">✓</span>
            <h3>{order.number}</h3>
            <p>{money(order.total)}</p>
            <p>
              {shop.mode === "server"
                ? "Тестовый заказ сохранён на сервере."
                : "Демонстрация завершена. Заказ не отправлен на сервер."}{" "}
              Оплата и реальная доставка не выполняются.
            </p>
            <button
              className="primary"
              onClick={() => {
                setOrder(null);
                shop.setCartOpen(false);
              }}
            >
              Продолжить покупки
            </button>
          </div>
        ) : !lines.length ? (
          <div className="empty">
            <h3>Здесь пока пусто</h3>
            <p>Выберите что-нибудь в каталоге.</p>
            <button className="primary" onClick={() => shop.setCartOpen(false)}>
              К покупкам
            </button>
          </div>
        ) : (
          <>
            {!checkout ? (
              <>
                <div className="cart-lines">
                  {lines.map((l) => (
                    <div className="cart-line" key={keyOf(l)}>
                      <Image p={l.p} />
                      <div>
                        <h3>{l.p.name}</h3>
                        {l.options.monogram && (
                          <p>
                            Тиснение: {l.options.monogram} ·{" "}
                            {l.options.foil === "gold"
                              ? "золото"
                              : l.options.foil === "silver"
                                ? "серебро"
                                : "без фольги"}
                          </p>
                        )}
                        <strong>{money(l.p.price * l.qty)}</strong>
                        <div className="quantity">
                          <button
                            aria-label={`Уменьшить ${l.p.name}`}
                            onClick={() => change(l, -1)}
                          >
                            −
                          </button>
                          <output>{l.qty}</output>
                          <button
                            aria-label={`Увеличить ${l.p.name}`}
                            disabled={
                              shop.cart
                                .filter((x) => x.id === l.id)
                                .reduce((s, x) => s + x.qty, 0) >=
                              Math.min(20, l.p.stock)
                            }
                            onClick={() => change(l, 1)}
                          >
                            +
                          </button>
                          <button
                            className="remove"
                            onClick={() =>
                              shop.setCart((old) =>
                                old.filter((x) => keyOf(x) !== keyOf(l)),
                              )
                            }
                          >
                            Убрать
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="totals">
                  <p>
                    <span>Товары</span>
                    <b>{money(subtotal)}</b>
                  </p>
                  <p>
                    <span>Доставка</span>
                    <b>{shipping ? money(shipping) : "Бесплатно"}</b>
                  </p>
                  <p className="grand">
                    <span>Итого</span>
                    <b>{money(subtotal + shipping)}</b>
                  </p>
                </div>
                <button
                  className="primary checkout"
                  onClick={() => setCheckout(true)}
                >
                  Оформить заказ
                </button>
                <p className="demo-note">
                  Портфолио-магазин. Без списания денег.
                </p>
              </>
            ) : (
              <form onSubmit={submit} className="checkout-form">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setCheckout(false)}
                >
                  ← Вернуться в корзину
                </button>
                <label>
                  Имя
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={80}
                    autoComplete="given-name"
                    placeholder="Ваше имя"
                  />
                </label>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    required
                    maxLength={120}
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                </label>
                <label>
                  Адрес доставки
                  <input
                    name="address"
                    required
                    minLength={5}
                    maxLength={250}
                    autoComplete="street-address"
                    placeholder="Город, улица, дом"
                  />
                </label>
                <p className="demo-note">
                  Тестовый заказ. Можно использовать вымышленные данные.{" "}
                  {shop.mode === "static"
                    ? "В онлайн-витрине данные не отправляются."
                    : "Данные сохраняются в локальной базе."}
                </p>
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
                <button className="primary" disabled={busy}>
                  {busy
                    ? "Сохраняем…"
                    : `Подтвердить · ${money(subtotal + shipping)}`}
                </button>
              </form>
            )}
          </>
        )}
      </Dialog>
    </>
  );
}
export function Footer({ shop }: { shop: Shop }) {
  return (
    <footer>
      <span>{shop.catalog?.name} © 2026</span>
      <span>
        Концепт магазина ·{" "}
        {shop.mode === "server"
          ? "тестовые заказы"
          : "демонстрационная витрина"}
      </span>
      <a href="#top">Наверх ↑</a>
    </footer>
  );
}
export function useCatalog(products: Product[]) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("Все"),
    [sort, setSort] = useState("default");
  const filtered = products
    .filter(
      (p) =>
        (category === "Все" || p.category === category) &&
        `${p.name} ${p.subtitle}`
          .toLowerCase()
          .includes(query.toLowerCase().trim()),
    )
    .sort((a, b) =>
      sort === "asc"
        ? a.price - b.price
        : sort === "desc"
          ? b.price - a.price
          : 0,
    );
  return {
    query,
    setQuery,
    category,
    setCategory,
    sort,
    setSort,
    filtered,
    categories: ["Все", ...new Set(products.map((p) => p.category))],
  };
}
export function Filters({ state }: { state: ReturnType<typeof useCatalog> }) {
  return (
    <div className="filters">
      <div className="categories">
        {state.categories.map((c) => (
          <button
            key={c}
            aria-pressed={state.category === c}
            className={state.category === c ? "active" : ""}
            onClick={() => state.setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="search-sort">
        <label className="search">
          <span className="sr-only">Поиск товаров</span>
          <input
            type="search"
            placeholder="Найти в каталоге"
            value={state.query}
            onChange={(e) => state.setQuery(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Сортировка</span>
          <select
            value={state.sort}
            onChange={(e) => state.setSort(e.target.value)}
          >
            <option value="default">По умолчанию</option>
            <option value="asc">Сначала дешевле</option>
            <option value="desc">Сначала дороже</option>
          </select>
        </label>
      </div>
    </div>
  );
}
export function EmptyResults() {
  return (
    <div className="empty-results">
      Ничего не нашлось. Попробуйте другую категорию или запрос.
    </div>
  );
}
