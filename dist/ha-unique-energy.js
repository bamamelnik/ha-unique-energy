/*
 * ha-unique-energy — animated energy flows over a layered picture of a house.
 *
 * MIT licensed. The idea is inspired by Lumina Energy Card; no code or
 * graphics were taken from it.
 *
 * Structure: a base image, one aligned PNG layer per optional component on top,
 * then an SVG with the flows (in image coordinates) and HTML labels (positioned
 * in percent so the text does not scale with the picture).
 *
 * Sign convention: every path runs from its component to the node at the house.
 * Producers and grid import flow towards the node, consumers and battery
 * charging flow away from it.
 */
(() => {
  const VERSION = "0.8.0"; // also appended to image URLs: bump it when images change

  // Layout per image set. Paths in image pixels, only M/L/Q/C (also read by
  // tools/path_preview.py — the block between the markers must stay valid JSON).
  const LAYOUTS = /*LAYOUT-START*/ {
    "lowpoly": {
      "width": 1376,
      "height": 768,
      "base": "base.jpg",
      "home_label": [630, 360],
      "components": {
        "barn":       { "layer": "barn.png",       "path": "M1087,280 L1045,319 L1045,434 L880,368 L650,460 L650,384", "label": [1185, 200] },
        "pv_roof":    { "layer": "pv-roof.png",    "path": "M587,238 L630,298 L630,340",   "label": [645, 130] },
        "pv_balcony": { "layer": "pv-balcony.png", "path": "M770,303 L660,347",   "label": [800, 225] },
        "heat_pump":  { "layer": "heat-pump.png",  "path": "M440,375 L440,337.6 L563,386.8 L605,370",   "label": [400, 478] },
        "battery":    { "layer": "battery.png",    "path": "M552,430 L552,392.4 L563,396.8 L605,380",           "label": [515, 300] },
        "car_2":      { "layer": "car-2.png",      "path": "M935,470 L862,499",  "label": [1165, 515] },
        "wallbox":    { "layer": "wallbox.png",    "path": "M855,503 L693,438 L693,346.8 L655,362",   "label": [900, 420] },
        "car_1":      { "layer": "car-1.png",      "path": "M855,555 L855,503",   "label": [800, 650] },
        "grid":       { "layer": null,             "path": "M180,462 L403,551 L598,473 L598,385",   "label": [172, 322] }
      }
    }
  } /*LAYOUT-END*/;

  // Role per component: colour and direction at positive power
  // (+1 = towards the node, -1 = away from it).
  const ROLES = {
    pv_roof:    { kind: "pv",      direction: +1 },
    pv_balcony: { kind: "pv",      direction: +1 },
    barn:       { kind: "pv",      direction: +1 },
    battery:    { kind: "battery", direction: -1 },
    grid:       { kind: "grid",    direction: +1 },
    heat_pump:  { kind: "heat",    direction: -1 },
    wallbox:    { kind: "car",     direction: -1 },
    car_1:      { kind: "car",     direction: -1 },
    car_2:      { kind: "car",     direction: -1 },
  };

  const IDLE_W = 10; // below this a flow counts as idle

  // PV arrays: up to three strings, shown as a fine line above the total
  const STRINGS = ["string_1", "string_2", "string_3"];

  const TOP_CONSUMERS = 3; // home: how many of the listed consumers are shown

  // ── Translations ────────────────────────────────────────────────────
  const I18N = {
    de: {
      locale: "de-DE",
      names: { grid: "Netz", home: "Haus", pv_roof: "PV Dach", pv_balcony: "Balkon-PV", barn: "PV Scheune", battery: "Akku",
        heat_pump: "Wärmepumpe", wallbox: "Wallbox", car_1: "Auto 1", car_2: "Auto 2" },
      import: "Bezug", export: "Einspeisung", charging: "lädt", discharging: "entlädt", idle: "Ruhe",
      today: "heute", min: "min.",
      fields: { price: "Strompreis (pro kWh, optional)", cost: "Kosten heute (optional)", soc_min: "Minimaler Ladestand (%, optional)", consumers: "Verbraucher (optional)",
        images: "Bildordner", layout: "Bildsatz", title: "Titel (optional)", language: "Sprache", show: "Anzeigen", name: "Name",
        power: "Leistung (W oder kW)", invert: "Vorzeichen umkehren", soc: "Ladestand (%)", subtract: "abzüglich Leistung",
        string: "String", optional: "optional", auto: "Automatisch (wie Home Assistant)" },
      sections: { grid: "Netz", home: "Haus", pv_roof: "PV Dach", pv_balcony: "Balkon-PV", barn: "Scheune mit PV", battery: "Hausakku",
        heat_pump: "Wärmepumpe", wallbox: "Wallbox", car_1: "Auto 1", car_2: "Auto 2" },
      help: { consumers: "Leistungssensoren einzelner Verbraucher; die drei größten werden beim Haus angezeigt", price: "z. B. Tibber: Strompreis", soc_min: "z. B. Entladegrenze des Akkus",
        images: "über HACS: /hacsfiles/ha-unique-energy/lowpoly", grid: "+ = Bezug, − = Einspeisung",
        home: "Verbrauch des Hauses ohne die übrigen Komponenten", pv: "Erzeugung; leer lassen: Summe der Strings",
        battery: "+ = lädt, − = entlädt", heat_pump: "Verbrauch", wallbox: "Ladeleistung",
        car_1: "leer lassen: übernimmt die Wallbox", car_2: "eigene Ladeleistung, falls vorhanden" },
      batteryList: "Mehrere Hausakkus sind als Liste konfiguriert — bitte im YAML-Modus bearbeiten.",
    },
    en: {
      locale: "en-US",
      names: { grid: "Grid", home: "Home", pv_roof: "Roof PV", pv_balcony: "Balcony PV", barn: "Barn PV", battery: "Battery",
        heat_pump: "Heat pump", wallbox: "Wallbox", car_1: "Car 1", car_2: "Car 2" },
      import: "Import", export: "Export", charging: "charging", discharging: "discharging", idle: "idle",
      today: "today", min: "min",
      fields: { price: "Electricity price (per kWh, optional)", cost: "Cost today (optional)", soc_min: "Minimum state of charge (%, optional)", consumers: "Consumers (optional)",
        images: "Image folder", layout: "Image set", title: "Title (optional)", language: "Language", show: "Show", name: "Name",
        power: "Power (W or kW)", invert: "Invert sign", soc: "State of charge (%)", subtract: "Subtract power",
        string: "String", optional: "optional", auto: "Automatic (like Home Assistant)" },
      sections: { grid: "Grid", home: "Home", pv_roof: "Roof PV", pv_balcony: "Balcony PV", barn: "Barn with PV", battery: "Home battery",
        heat_pump: "Heat pump", wallbox: "Wallbox", car_1: "Car 1", car_2: "Car 2" },
      help: { consumers: "Power sensors of single consumers; the three largest are shown at the house", price: "e.g. Tibber: electricity price", soc_min: "e.g. the battery's discharge limit",
        images: "via HACS: /hacsfiles/ha-unique-energy/lowpoly", grid: "+ = import, − = export",
        home: "House consumption without the other components", pv: "Production; leave empty: sum of the strings",
        battery: "+ = charging, − = discharging", heat_pump: "Consumption", wallbox: "Charging power",
        car_1: "leave empty: uses the wallbox", car_2: "own charging power, if available" },
      batteryList: "Several home batteries are configured as a list — please edit them in YAML mode.",
    },
    es: {
      locale: "es-ES",
      names: { grid: "Red", home: "Casa", pv_roof: "FV tejado", pv_balcony: "FV balcón", barn: "FV granero", battery: "Batería",
        heat_pump: "Bomba de calor", wallbox: "Wallbox", car_1: "Coche 1", car_2: "Coche 2" },
      import: "Importación", export: "Exportación", charging: "cargando", discharging: "descargando", idle: "en reposo",
      today: "hoy", min: "mín.",
      fields: { price: "Precio de la electricidad (por kWh, opcional)", cost: "Coste de hoy (opcional)", soc_min: "Estado de carga mínimo (%, opcional)", consumers: "Consumidores (opcional)",
        images: "Carpeta de imágenes", layout: "Juego de imágenes", title: "Título (opcional)", language: "Idioma", show: "Mostrar",
        name: "Nombre", power: "Potencia (W o kW)", invert: "Invertir signo", soc: "Estado de carga (%)", subtract: "Restar potencia",
        string: "String", optional: "opcional", auto: "Automático (como Home Assistant)" },
      sections: { grid: "Red", home: "Casa", pv_roof: "FV tejado", pv_balcony: "FV balcón", barn: "Granero con FV", battery: "Batería doméstica",
        heat_pump: "Bomba de calor", wallbox: "Wallbox", car_1: "Coche 1", car_2: "Coche 2" },
      help: { consumers: "Sensores de potencia de consumidores individuales; los tres mayores se muestran en la casa", price: "p. ej. Tibber: precio de la electricidad", soc_min: "p. ej. el límite de descarga de la batería",
        images: "vía HACS: /hacsfiles/ha-unique-energy/lowpoly", grid: "+ = importación, − = exportación",
        home: "Consumo de la casa sin los demás componentes", pv: "Producción; vacío: suma de los strings",
        battery: "+ = carga, − = descarga", heat_pump: "Consumo", wallbox: "Potencia de carga",
        car_1: "vacío: usa la wallbox", car_2: "potencia de carga propia, si existe" },
      batteryList: "Hay varias baterías configuradas como lista; edítalas en modo YAML.",
    },
    fr: {
      locale: "fr-FR",
      names: { grid: "Réseau", home: "Maison", pv_roof: "PV toit", pv_balcony: "PV balcon", barn: "PV grange", battery: "Batterie",
        heat_pump: "Pompe à chaleur", wallbox: "Borne", car_1: "Voiture 1", car_2: "Voiture 2" },
      import: "Soutirage", export: "Injection", charging: "en charge", discharging: "en décharge", idle: "au repos",
      today: "aujourd'hui", min: "min.",
      fields: { price: "Prix de l'électricité (par kWh, facultatif)", cost: "Coût du jour (facultatif)", soc_min: "État de charge minimal (%, facultatif)", consumers: "Consommateurs (facultatif)",
        images: "Dossier d'images", layout: "Jeu d'images", title: "Titre (facultatif)", language: "Langue", show: "Afficher",
        name: "Nom", power: "Puissance (W ou kW)", invert: "Inverser le signe", soc: "État de charge (%)", subtract: "Puissance à soustraire",
        string: "Chaîne", optional: "facultatif", auto: "Automatique (comme Home Assistant)" },
      sections: { grid: "Réseau", home: "Maison", pv_roof: "PV toit", pv_balcony: "PV balcon", barn: "Grange avec PV", battery: "Batterie domestique",
        heat_pump: "Pompe à chaleur", wallbox: "Borne de recharge", car_1: "Voiture 1", car_2: "Voiture 2" },
      help: { consumers: "Capteurs de puissance de consommateurs individuels ; les trois plus importants sont affichés à la maison", price: "p. ex. Tibber : prix de l'électricité", soc_min: "p. ex. la limite de décharge de la batterie",
        images: "via HACS : /hacsfiles/ha-unique-energy/lowpoly", grid: "+ = soutirage, − = injection",
        home: "Consommation de la maison sans les autres composants", pv: "Production ; vide : somme des chaînes",
        battery: "+ = charge, − = décharge", heat_pump: "Consommation", wallbox: "Puissance de charge",
        car_1: "vide : reprend la borne", car_2: "puissance de charge propre, si disponible" },
      batteryList: "Plusieurs batteries sont configurées en liste ; modifiez-les en mode YAML.",
    },
  };
  const LANGUAGES = Object.keys(I18N);
  const LANGUAGE_NAMES = { de: "Deutsch", en: "English", es: "Español", fr: "Français" };

  // "auto" (or nothing) follows Home Assistant; unknown languages fall back to English
  function resolveLanguage(config, hass) {
    const wanted = config && config.language && config.language !== "auto"
      ? config.language
      : (hass && ((hass.locale && hass.locale.language) || hass.language)) || "en";
    const short = String(wanted).toLowerCase().slice(0, 2);
    return LANGUAGES.includes(short) ? short : "en";
  }

  // ── Legacy configuration (up to v0.5, German keys) ────────────────────
  const LEGACY_TOP = { bilder: "images", titel: "title" };
  const LEGACY_COMPONENTS = { netz: "grid", haus: "home", pv_haus: "pv_roof", balkon_pv: "pv_balcony", scheune: "barn",
    akku: "battery", waermepumpe: "heat_pump", auto_1: "car_1", auto_2: "car_2" };
  const LEGACY_FIELDS = { leistung: "power", invertieren: "invert", abzueglich: "subtract", zeigen: "show" };
  const LEGACY_TYPE = "custom:hos-energiekarte";
  const CARD_TYPE = "custom:unique-energy-card";

  const renameKeys = (obj, map) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [map[k] || k, v]));
  const renameFields = (c) => (Array.isArray(c) ? c.map(renameFields) : c && typeof c === "object" ? renameKeys(c, LEGACY_FIELDS) : c);

  // Returns the configuration with English keys; an English configuration passes unchanged
  function normalizeConfig(config) {
    const out = {};
    for (const [k, v] of Object.entries(config)) {
      if (LEGACY_TOP[k]) out[LEGACY_TOP[k]] = v;
      else if (LEGACY_COMPONENTS[k]) out[LEGACY_COMPONENTS[k]] = renameFields(v);
      else if (k in ROLES || k === "home") out[k] = renameFields(v);
      else out[k] = v;
    }
    if (out.type === LEGACY_TYPE) out.type = CARD_TYPE;
    return out;
  }

  // Prices and costs: two decimals, "EUR" shown as "€"
  const formatMoney = (v, unit, locale) =>
    `${v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${(unit || "").replace(/EUR/g, "€")}`.trim();

  // Short consumer name: own name, else the friendly name without a trailing "power"
  const consumerName = (c, st) =>
    c.name || ((st && st.attributes && st.attributes.friendly_name) || c.entity).replace(/\s+(leistung|power|power consumption|potencia|puissance)$/i, "");

  const formatPower = (w, locale) => {
    const a = Math.abs(w);
    if (a < 1000) return `${Math.round(a)} W`;
    return `${(a / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kW`;
  };

  // Duration of one animation cycle: faster with more power, capped
  const cycleSeconds = (w) => Math.min(7, Math.max(0.9, 4.2 / Math.sqrt(Math.abs(w) / 1000)));

  class UniqueEnergyCard extends HTMLElement {
    setConfig(config) {
      config = normalizeConfig(config || {});
      if (!config.images) throw new Error("unique-energy-card: 'images' is missing (folder with the layers)");
      const layout = LAYOUTS[config.layout || "lowpoly"];
      if (!layout) throw new Error(`unique-energy-card: unknown layout '${config.layout}'`);
      this._config = config;
      this._layout = layout;
      this._built = false;
      if (this._hass) this._render();
    }

    set hass(hass) {
      this._hass = hass;
      if (this._config) this._render();
    }

    getCardSize() {
      return 6;
    }

    static getStubConfig() {
      return { images: "/hacsfiles/ha-unique-energy/lowpoly", grid: {}, home: {} };
    }

    static getConfigElement() {
      return document.createElement("unique-energy-card-editor");
    }

    // Components that are configured and not switched off
    _active() {
      const cfg = this._config;
      return Object.keys(this._layout.components).filter((n) => {
        const c = cfg[n];
        if (!c) return false;
        if (Array.isArray(c)) return c.length > 0;
        return c.show !== false;
      });
    }

    // Power of a component in W, with unit handling and optional sign flip
    _watts(cfg) {
      if (!cfg || !cfg.power) return null;
      let w = this._entityWatts(cfg.power);
      if (w === null) return null;
      // subtract: entity or list, e.g. house meter minus wallbox
      const minus = cfg.subtract ? [].concat(cfg.subtract) : [];
      for (const e of minus) {
        const x = this._entityWatts(e);
        if (x === null) return null; // better no value than a wrong one
        w -= x;
      }
      return cfg.invert ? -w : w;
    }

    _entityWatts(entity) {
      const st = this._hass && this._hass.states[entity];
      if (!st) return null;
      const v = parseFloat(st.state);
      if (Number.isNaN(v)) return null;
      const unit = (st.attributes && st.attributes.unit_of_measurement) || "W";
      return unit === "kW" ? v * 1000 : unit === "MW" ? v * 1e6 : v;
    }

    _number(entity) {
      if (!entity || !this._hass) return null;
      const st = this._hass.states[entity];
      const v = st ? parseFloat(st.state) : NaN;
      return Number.isNaN(v) ? null : v;
    }

    // Home: the largest active consumers, as [{ name, w }]
    _topConsumers() {
      const list = [].concat(this._config.home.consumers || []).map((c) => (typeof c === "string" ? { entity: c } : c));
      return list
        .map((c) => ({ name: consumerName(c, this._hass && this._hass.states[c.entity]), w: this._entityWatts(c.entity) }))
        .filter((c) => c.w !== null && c.w >= IDLE_W)
        .sort((a, b) => b.w - a.w)
        .slice(0, TOP_CONSUMERS);
    }

    // Grid: price per kWh and today's cost, both optional
    _tariff() {
      const g = this._config.grid || {};
      const read = (entity) => {
        const v = this._number(entity);
        if (v === null) return null;
        const st = this._hass.states[entity];
        return { v, unit: st.attributes && st.attributes.unit_of_measurement };
      };
      return { price: read(g.price), cost: read(g.cost) };
    }

    // Values per component: { w, soc, socMin, entity, count, name, strings }
    _values(name) {
      const c = this._config[name];
      if (Array.isArray(c)) {
        // several devices (e.g. batteries) are summed, SOC averaged
        let w = 0, socSum = 0, socN = 0, valid = false;
        for (const e of c) {
          const x = this._watts(e);
          if (x !== null) { w += x; valid = true; }
          const s = this._number(e.soc);
          if (s !== null) { socSum += s; socN++; }
        }
        return { w: valid ? w : null, soc: socN ? socSum / socN : null, socMin: null, entity: c[0].power, count: c.length, name: c[0].name, strings: [] };
      }
      let w = this._watts(c);
      // car 1 without its own sensor takes the wallbox power
      if (w === null && name === "car_1" && !c.power) w = this._watts(this._config.wallbox);
      const used = ROLES[name].kind === "pv" ? STRINGS.filter((k) => c[k]) : [];
      const strings = used.map((k) => this._entityWatts(c[k]));
      // Without a total sensor the strings add up to the power, but only if all of them report
      if (!c.power && strings.length) w = strings.includes(null) ? null : strings.reduce((a, x) => a + x, 0);
      return { w, soc: this._number(c.soc), socMin: this._number(c.soc_min), entity: c.power || c.soc || c[used[0]], count: 1, name: c.name, strings };
    }

    _build() {
      const L = this._layout;
      const active = this._active();
      const dir = (this._config.images || "").replace(/\/$/, "");
      const layers = active
        .filter((n) => L.components[n].layer)
        .map((n) => `<img class="layer" src="${dir}/${L.components[n].layer}?v=${VERSION}" alt="">`)
        .join("");
      const flows = active
        .map((n) => `<path class="track" data-k="${n}" d="${L.components[n].path}"/><path class="flow" data-k="${n}" d="${L.components[n].path}"/>`)
        .join("");
      const pct = ([x, y]) => `left:${(x / L.width) * 100}%;top:${(y / L.height) * 100}%`;
      const labels = active
        .map((n) => `<div class="label" data-k="${n}" style="${pct(L.components[n].label)}"><span class="title"></span><span class="strings"></span><span class="value"></span><span class="details"></span></div>`)
        .join("");
      const homeLabel = this._config.home
        ? `<div class="label home" data-k="home" style="${pct(L.home_label)}"><span class="title"></span><span class="value"></span><span class="details"></span></div>`
        : "";

      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>${STYLE}</style>
        <ha-card>
          ${this._config.title ? `<div class="header">${this._config.title}</div>` : ""}
          <div class="stage" style="aspect-ratio:${L.width}/${L.height}">
            <img class="layer" src="${dir}/${L.base}?v=${VERSION}" alt="">
            ${layers}
            <svg viewBox="0 0 ${L.width} ${L.height}" preserveAspectRatio="none">${flows}</svg>
            ${labels}${homeLabel}
          </div>
        </ha-card>`;

      this.shadowRoot.querySelectorAll(".label").forEach((el) => {
        el.addEventListener("click", () => {
          const k = el.dataset.k;
          const v = k === "home" ? { entity: this._config.home.power } : this._values(k);
          const c = this._config[k];
          const tap = c && !Array.isArray(c) ? c.tap_action : undefined;
          // own tap_action: Home Assistant runs it (navigate, more-info, perform-action, …)
          if (tap) {
            const config = { entity: v.entity, tap_action: tap };
            this.dispatchEvent(new CustomEvent("hass-action", { detail: { config, action: "tap" }, bubbles: true, composed: true }));
            return;
          }
          if (!v.entity) return;
          this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: v.entity }, bubbles: true, composed: true }));
        });
      });
      this._built = true;
    }

    _render() {
      if (!this._built) this._build();
      const root = this.shadowRoot;
      const t = I18N[resolveLanguage(this._config, this._hass)];
      const fmt = (w) => formatPower(w, t.locale);

      for (const el of root.querySelectorAll(".flow")) {
        const n = el.dataset.k;
        const role = ROLES[n];
        const { w } = this._values(n);
        const idle = w === null || Math.abs(w) < IDLE_W;
        let kind = role.kind;
        if (n === "grid") kind = w !== null && w < 0 ? "export" : "import";
        const direction = role.direction * (w !== null && w < 0 ? -1 : 1);
        el.setAttribute("class", `flow ${kind}${idle ? " idle" : ""}${direction < 0 ? " reverse" : ""}`);
        el.previousElementSibling.setAttribute("class", `track ${kind}${idle ? "" : " active"}`);
        if (!idle) el.style.setProperty("--cycle", `${cycleSeconds(w).toFixed(2)}s`);
      }

      for (const el of root.querySelectorAll(".label")) {
        const n = el.dataset.k;
        let title, value, details = [];
        if (n === "home") {
          title = this._config.home.name || t.names.home;
          // the difference of two meters can briefly drop below zero
          const w = this._watts(this._config.home);
          value = w === null ? "–" : fmt(Math.max(0, w));
          // name and power separately: a long name is shortened, the power always stays visible
          details = this._topConsumers().map((c) => [c.name, fmt(c.w)]);
        } else {
          const v = this._values(n);
          title = v.name || t.names[n];
          if (v.count > 1) title += ` ×${v.count}`;
          if (v.soc !== null) title += ` · ${Math.round(v.soc)} %`;
          if (v.socMin !== null) title += `\n${t.min} ${Math.round(v.socMin)} %`; // second line
          if (v.w === null) value = "–";
          else if (n === "grid") value = Math.abs(v.w) < IDLE_W ? "0 W" : `${v.w < 0 ? t.export : t.import} ${fmt(v.w)}`;
          else if (n === "battery") value = Math.abs(v.w) < IDLE_W ? t.idle : `${v.w > 0 ? t.charging : t.discharging} ${fmt(v.w)}`;
          else value = fmt(v.w);
          el.querySelector(".strings").textContent = v.strings.map((x) => (x === null ? "–" : fmt(x))).join(" · ");
          if (n === "grid") {
            const { price, cost } = this._tariff();
            const parts = [];
            if (price) parts.push(formatMoney(price.v, price.unit, t.locale));
            if (cost) parts.push(`${t.today} ${formatMoney(cost.v, cost.unit, t.locale)}`);
            details = parts; // one line each
          }
        }
        const span = (className, textContent) => Object.assign(document.createElement("span"), { className, textContent });
        el.querySelector(".details").replaceChildren(...details.map((line) => {
          if (!Array.isArray(line)) return span("line", line);
          const row = span("line", "");
          row.append(span("name", line[0]), span("power", line[1]));
          return row;
        }));
        el.querySelector(".title").textContent = title;
        el.querySelector(".value").textContent = value;
      }
    }
  }

  // ── Graphical editor ────────────────────────────────────────────────
  // Built on Home Assistant's own ha-form (like the built-in cards). Form data:
  // one object per component with the extra field "show"; fromForm() turns it
  // back into the card configuration and leaves unknown keys alone.

  // key, icon, extra fields, help text for the power field
  const EDITOR_COMPONENTS = [
    ["grid", "mdi:transmission-tower", ["price", "cost"], "grid"],
    ["home", "mdi:home-lightning-bolt-outline", ["subtract", "consumers"], "home"],
    ["pv_roof", "mdi:solar-panel", STRINGS, "pv"],
    ["pv_balcony", "mdi:solar-panel-large", STRINGS, "pv"],
    ["barn", "mdi:barn", STRINGS, "pv"],
    ["battery", "mdi:home-battery", ["soc", "soc_min"], "battery"],
    ["heat_pump", "mdi:heat-pump", [], "heat_pump"],
    ["wallbox", "mdi:ev-station", [], "wallbox"],
    ["car_1", "mdi:car-electric", ["soc"], "car_1"],
    ["car_2", "mdi:car-electric", ["soc"], "car_2"],
  ];
  const FIELDS = ["name", "power", "invert", "soc", "soc_min", "subtract", "price", "cost", "consumers", ...STRINGS];
  const sensor = { entity: { filter: { domain: "sensor" } } };
  // Selectors that differ from a single sensor
  const SELECTORS = {
    soc_min: { entity: { filter: { domain: ["sensor", "number", "input_number"] } } },
    consumers: { entity: { multiple: true, filter: { domain: "sensor" } } },
  };

  const batteryList = (cfg) => Array.isArray(cfg.battery);

  function fieldLabel(name, t) {
    const i = STRINGS.indexOf(name);
    if (i >= 0) return `${t.fields.string} ${i + 1} (${t.fields.optional})`;
    return t.fields[name] ?? name;
  }

  function schemaFor(cfg, t) {
    const components = EDITOR_COMPONENTS.filter(([k]) => !(k === "battery" && batteryList(cfg))).map(([k, icon, extra, help]) => ({
      type: "expandable", name: k, title: t.sections[k], icon,
      schema: [
        { type: "grid", name: "", schema: [{ name: "show", selector: { boolean: {} } }, { name: "name", selector: { text: {} } }] },
        { name: "power", selector: sensor, help: t.help[help] },
        ...extra.map((f) => ({ name: f, selector: SELECTORS[f] || sensor, ...(t.help[f] ? { help: t.help[f] } : {}) })),
        { name: "invert", selector: { boolean: {} } },
      ],
    }));
    const languages = [{ value: "auto", label: t.fields.auto }, ...LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))];
    return [
      { name: "images", required: true, selector: { text: {} }, help: t.help.images },
      { type: "grid", name: "", schema: [
        { name: "layout", selector: { select: { mode: "dropdown", options: Object.keys(LAYOUTS) } } },
        { name: "language", selector: { select: { mode: "dropdown", options: languages } } },
      ] },
      { name: "title", selector: { text: {} } },
      ...components,
    ];
  }

  function toForm(cfg) {
    const d = { images: cfg.images || "", layout: cfg.layout || "lowpoly", language: cfg.language || "auto", title: cfg.title || "" };
    for (const [k] of EDITOR_COMPONENTS) {
      if (k === "battery" && batteryList(cfg)) continue;
      const c = cfg[k];
      d[k] = { ...(c || {}), show: !!c && c.show !== false };
      // consumers may carry own names in YAML; the form only edits the entities
      if (c && c.consumers) d[k].consumers = [].concat(c.consumers).map((x) => (typeof x === "string" ? x : x.entity));
    }
    return d;
  }

  function fromForm(d, old) {
    const next = { ...old, images: d.images || "" };
    if (d.layout && d.layout !== "lowpoly") next.layout = d.layout; else delete next.layout;
    if (d.language && d.language !== "auto") next.language = d.language; else delete next.language;
    if (d.title) next.title = d.title; else delete next.title;
    for (const [k] of EDITOR_COMPONENTS) {
      if (k === "battery" && batteryList(old)) continue; // a list stays as it is
      const f = d[k] || {};
      const obj = { ...(old[k] || {}) };
      delete obj.show;
      for (const field of FIELDS) {
        let v = f[field];
        if (field === "consumers" && Array.isArray(v)) {
          // keep the YAML names of consumers that are still in the list
          const named = Object.fromEntries([].concat(obj.consumers || []).filter((x) => typeof x === "object").map((x) => [x.entity, x]));
          v = v.length ? v.map((e) => named[e] || e) : null;
        }
        if (v === undefined || v === "" || v === false || v === null) delete obj[field]; else obj[field] = v;
      }
      if (f.show) next[k] = obj;
      else if (Object.keys(obj).length) next[k] = { ...obj, show: false }; // keep the settings, only hide
      else delete next[k];
    }
    return next;
  }

  class UniqueEnergyCardEditor extends HTMLElement {
    setConfig(config) {
      this._config = normalizeConfig(config || {});
      this._draw();
    }

    set hass(hass) {
      this._hass = hass;
      if (this._form) this._form.hass = hass;
    }

    async connectedCallback() {
      // HA loads ha-form on demand; the card helpers pull it in.
      if (!customElements.get("ha-form") && window.loadCardHelpers) {
        const helpers = await window.loadCardHelpers();
        const card = await helpers.createCardElement({ type: "entities", entities: [] });
        await card.constructor.getConfigElement?.();
      }
      await customElements.whenDefined("ha-form");
      this._draw();
    }

    _draw() {
      if (!this._config || !customElements.get("ha-form")) return;
      const t = () => I18N[resolveLanguage(this._config, this._hass)];
      if (!this._form) {
        this._notice = document.createElement("ha-alert");
        this._notice.alertType = "info";
        this._form = document.createElement("ha-form");
        this._form.computeLabel = (s) => fieldLabel(s.name, t());
        this._form.computeHelper = (s) => s.help; // own key in the schema, ha-form passes it through
        this._form.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          const next = fromForm(ev.detail.value, this._config);
          if (JSON.stringify(next) === JSON.stringify(this._config)) return;
          const relabel = next.language !== this._config.language;
          this._config = next;
          if (relabel) this._draw(); // labels and help texts follow the chosen language
          this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: next }, bubbles: true, composed: true }));
        });
        this.append(this._notice, this._form);
      }
      this._notice.textContent = t().batteryList;
      this._notice.style.display = batteryList(this._config) ? "" : "none";
      this._form.hass = this._hass;
      this._form.schema = schemaFor(this._config, t());
      this._form.data = toForm(this._config);
    }
  }

  const STYLE = `
    :host { display: block; }
    ha-card { overflow: hidden; display: block; background: var(--ha-card-background, var(--card-background-color, #fff)); border-radius: var(--ha-card-border-radius, 12px); }
    .header { padding: 12px 16px 0; font-size: 1.1em; font-weight: 500; color: var(--primary-text-color, #222); }
    .stage { position: relative; width: 100%; container-type: inline-size; }
    .layer { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; user-select: none; }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    .track { fill: none; stroke: rgba(40, 46, 58, 0.16); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
    /* line (including its glow) half as opaque as the dots, so both stand apart */
    .track.active { stroke: currentColor; stroke-opacity: 0.75; stroke-width: 2.5; opacity: 0.5;
                    filter: drop-shadow(0 0 2px currentColor) drop-shadow(0 0 5px currentColor); }
    .flow { fill: none; stroke: currentColor; stroke-width: 5.6; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 0.1 18;
            animation: run var(--cycle, 4s) linear infinite; filter: drop-shadow(0 0 2px currentColor); }
    .flow.reverse { animation-direction: reverse; }
    .flow.idle { stroke-opacity: 0; animation: none; }
    .pv { color: #f5b400; }
    .battery { color: #2f8cff; }
    .import { color: #e5484d; }
    .export { color: #2fa36b; }
    .heat { color: #f76b15; }
    .car { color: #8e4ec6; }
    @keyframes run { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -180; } }
    .label { position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center;
             padding: 3px 8px; border-radius: 8px; background: rgba(24, 28, 36, 0.78); color: #fff; cursor: pointer;
             font: 500 clamp(9px, 1.6cqi, 14px)/1.25 var(--ha-font-family-body, system-ui, sans-serif); white-space: nowrap;
             backdrop-filter: blur(2px); }
    .label .title { opacity: 0.75; font-size: 0.85em; white-space: pre-line; text-align: center; }
    .label .value { font-weight: 600; }
    .label .strings { font-weight: 400; font-size: 0.78em; opacity: 0.85; letter-spacing: 0.01em; }
    .label .strings:empty, .label .details:empty { display: none; }
    .label .details { display: flex; flex-direction: column; align-items: center; font-weight: 400; font-size: 0.74em; opacity: 0.8; margin-top: 1px; }
    .label.home .details .line { display: flex; gap: 0.35em; max-width: 20ch; }
    .label.home .details .name { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .label.home .details .power { flex: none; }
    /* anchored at its top: the consumer lines grow downwards, away from the labels above */
    .label.home { background: rgba(24, 28, 36, 0.88); transform: translate(-50%, calc(-1.3em - 3px)); }
    @container (max-width: 520px) { .label .title, .label .strings, .label .details { display: none; } .label { padding: 2px 5px; } }
    @media (prefers-reduced-motion: reduce) { .flow { animation: none; stroke-dasharray: none; stroke-width: 4; } }
  `;

  if (!customElements.get("unique-energy-card")) {
    customElements.define("unique-energy-card", UniqueEnergyCard);
    customElements.define("unique-energy-card-editor", UniqueEnergyCardEditor);
    // Old element name (up to v0.5): keeps existing dashboards working, not offered in the card picker
    if (!customElements.get("hos-energiekarte")) customElements.define("hos-energiekarte", class extends UniqueEnergyCard {});
    window.customCards = window.customCards || [];
    window.customCards.push({ type: "unique-energy-card", name: "Unique Energy Card", description: "Animated energy flows over a layered house picture", preview: true });
    console.info(`%c unique-energy-card ${VERSION} `, "background:#2f8cff;color:#fff;border-radius:3px");
  }
})();
