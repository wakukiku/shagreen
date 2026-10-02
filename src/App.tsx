import { useState } from "react";
import {
  useShop,
  useCatalog,
  Loading,
  CartButton,
  ShopOverlays,
  Footer,
  Filters,
  EmptyResults,
  Image,
  money,
  Product,
  Shop,
} from "./core";
import { normalizeMonogram } from "./domain.mjs";
function Monogram({
  shop,
  product,
  initialId = "s1",
}: {
  shop: Shop;
  product?: Product;
  initialId?: string;
}) {
  const [selected, setSelected] = useState(initialId),
    [text, setText] = useState("АМ"),
    [foil, setFoil] = useState("gold");
  const p = product || shop.catalog!.products.find((p) => p.id === selected)!;
  return (
    <div className="monogram-studio">
      <div className="monogram-preview">
        <img src={p.image} alt={`${p.name}: пример размещения монограммы`} />
        <span className={"initials " + foil}>{text || "АБ"}</span>
        <small>Предпросмотр тиснения</small>
      </div>
      <div className="monogram-controls">
        <span className="eyebrow">Личная деталь</span>
        <h2>
          Только ваши
          <br />
          инициалы.
        </h2>
        {!product && (
          <label>
            На каком изделии
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {shop.catalog!.products.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Монограмма <span>до 3 букв</span>
          <input
            aria-label="Монограмма"
            value={text}
            maxLength={3}
            onChange={(e) => setText(normalizeMonogram(e.target.value))}
          />
        </label>
        <fieldset>
          <legend>Тиснение</legend>
          {[
            ["gold", "Золото"],
            ["silver", "Серебро"],
            ["blind", "Без фольги"],
          ].map(([id, label]) => (
            <button
              className={foil === id ? "selected" : ""}
              key={id}
              aria-pressed={foil === id}
              onClick={() => setFoil(id)}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <div className="custom-total">
          <span>Тиснение включено</span>
          <strong>{money(p.price)}</strong>
        </div>
        <button
          className="primary"
          disabled={!text || !p.stock}
          onClick={() => shop.add(p, { monogram: text, foil })}
        >
          Добавить своё изделие <span>↗</span>
        </button>
      </div>
    </div>
  );
}
export default function App() {
  const shop = useShop("shagren");
  const [customProduct, setCustomProduct] = useState("s1");
  const catalog = useCatalog(shop.catalog?.products || []);
  if (!shop.catalog) return <Loading shop={shop} />;
  return (
    <div id="top">
      <a href="#catalog" className="skip">
        Перейти к коллекции
      </a>

      <header>
        <nav>
          <a href="#catalog">Коллекция</a>
          <a href="#atelier">Тиснение</a>
        </nav>
        <a className="wordmark" href="#top">
          ШАГРЕНЬ<span>КОЖА / ФОРМА / ХАРАКТЕР</span>
        </a>
        <CartButton shop={shop} />
      </header>
      <main>
        <section className="editorial">
          <div className="cover-photo">
            <img
              src="assets/hero.jpg"
              alt="Кожаная сумка тёплого коньячного оттенка"
            />
            <span>КОЛЛЕКЦИЯ 01 / 2026</span>
          </div>
          <div className="editorial-copy">
            <span className="eyebrow">Повседневное. Личное.</span>
            <h1>
              Вещи с вашим
              <br />
              <em>характером.</em>
            </h1>
            <p>
              Кожа, которая живёт вместе с вами.
              <br />
              Детали, в которых узнаёте себя.
            </p>
            <a className="primary" href="#catalog">
              Смотреть коллекцию <span>↗</span>
            </a>
            <div className="edition">
              <span>01</span>
              <p>
                Тактильные формы.
                <br />
                Ничего лишнего.
              </p>
            </div>
          </div>
        </section>
        <section className="collection" id="catalog">
          <div className="section-title">
            <h2>На каждый день.</h2>
            <span>Четыре точных формы</span>
          </div>
          <Filters state={catalog} />
          <div className="products">
            {catalog.filtered.map((p, i) => (
              <article key={p.id}>
                <button
                  className="product-photo"
                  onClick={() => shop.setDetail(p)}
                  aria-label={`Подробнее: ${p.name}`}
                >
                  <Image p={p} />
                  <span>0{i + 1}</span>
                </button>
                <div className="product-meta">
                  <div>
                    <button
                      className="product-name"
                      onClick={() => shop.setDetail(p)}
                    >
                      {p.name}
                    </button>
                    <p>{p.subtitle}</p>
                  </div>
                  <span>{money(p.price)}</span>
                </div>
                <button className="add-link" onClick={() => shop.add(p)}>
                  В корзину <span>+</span>
                </button>
              </article>
            ))}
            {!catalog.filtered.length && <EmptyResults />}
          </div>
        </section>
        <section id="atelier">
          <Monogram key={customProduct} shop={shop} initialId={customProduct} />
        </section>
        <div className="craft-line">
          <span>Натуральная кожа</span>
          <span>Ручная обработка краёв</span>
          <span>Индивидуальное тиснение</span>
        </div>
      </main>
      <Footer shop={shop} />
      <ShopOverlays
        shop={shop}
        renderDetail={(p) => (
          <button
            className="primary"
            onClick={() => {
              setCustomProduct(p.id);
              shop.setDetail(null);
              document
                .getElementById("atelier")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Выбрать тиснение
          </button>
        )}
      />
    </div>
  );
}
