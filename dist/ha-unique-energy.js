/*
 * hos-energiekarte — animierte Energieflüsse über einer Ebenen-Grafik.
 *
 * Eigenentwicklung für home-os, veröffentlicht als ha-unique-energy (MIT).
 * Idee angelehnt an Lumina Energy Card, aber ohne deren Code oder Grafiken.
 *
 * Aufbau: ein Grundbild, darüber je Komponente eine deckungsgleiche PNG-Ebene,
 * darüber ein SVG mit den Flüssen (Bildkoordinaten) und HTML-Beschriftungen
 * (in Prozent positioniert, damit die Schrift nicht mitskaliert).
 *
 * Vorzeichen: Jeder Pfad führt von der Komponente zum Knoten am Haus.
 * Erzeuger und Netzbezug fließen zum Knoten, Verbraucher und Akku-Laden davon weg.
 */
(() => {
  const VERSION = "0.5.0"; // hängt auch an den Bild-URLs: neue Bilder → Version hochzählen

  // Layout je Bildsatz. Pfade in Bildpixeln, nur M/L/Q/C (wird auch von
  // pfade-vorschau.py gelesen — der Block zwischen den Markern bleibt JSON).
  const LAYOUTS = /*LAYOUT-START*/ {
    "lowpoly": {
      "breite": 1376,
      "hoehe": 768,
      "grundbild": "basis.jpg",
      "haus_label": [630, 360],
      "komponenten": {
        "scheune":     { "ebene": "scheune.png",     "pfad": "M1087,280 L1045,319 L1045,434 L880,368 L650,460 L650,384", "label": [1185, 200] },
        "pv_haus":     { "ebene": "pv-haus.png",     "pfad": "M587,238 L630,298 L630,340",   "label": [645, 130] },
        "balkon_pv":   { "ebene": "balkon-pv.png",   "pfad": "M770,303 L660,347",   "label": [800, 225] },
        "waermepumpe": { "ebene": "waermepumpe.png", "pfad": "M440,375 L440,337.6 L563,386.8 L605,370",   "label": [400, 478] },
        "akku":        { "ebene": "akku.png",        "pfad": "M552,430 L552,392.4 L563,396.8 L605,380",           "label": [515, 300] },
        "auto_2":      { "ebene": "auto-2.png",      "pfad": "M935,470 L862,499",  "label": [1165, 515] },
        "wallbox":     { "ebene": "wallbox.png",     "pfad": "M855,503 L693,438 L693,346.8 L655,362",   "label": [900, 420] },
        "auto_1":      { "ebene": "auto-1.png",      "pfad": "M855,555 L855,503",   "label": [800, 650] },
        "netz":        { "ebene": null,              "pfad": "M180,462 L403,551 L598,473 L598,385",   "label": [172, 322] }
      }
    }
  } /*LAYOUT-END*/;

  // Rolle je Komponente: Farbe und Richtung bei positiver Leistung
  // (+1 = zum Knoten, -1 = vom Knoten weg).
  const ROLLEN = {
    pv_haus:     { name: "PV Dach",      typ: "pv",      richtung: +1 },
    balkon_pv:   { name: "Balkon-PV",    typ: "pv",      richtung: +1 },
    scheune:     { name: "PV Scheune",   typ: "pv",      richtung: +1 },
    akku:        { name: "Akku",         typ: "akku",    richtung: -1 },
    netz:        { name: "Netz",         typ: "netz",    richtung: +1 },
    waermepumpe: { name: "Wärmepumpe",   typ: "wp",      richtung: -1 },
    wallbox:     { name: "Wallbox",      typ: "auto",    richtung: -1 },
    auto_1:      { name: "Auto 1",       typ: "auto",    richtung: -1 },
    auto_2:      { name: "Auto 2",       typ: "auto",    richtung: -1 },
  };

  const SCHWELLE_W = 10; // darunter gilt ein Fluss als still

  // PV-Anlagen: bis zu drei Strings, als feine Zeile über der Summe
  const STRINGS = ["string_1", "string_2", "string_3"];

  const fmtLeistung = (w) => {
    const a = Math.abs(w);
    if (a < 1000) return `${Math.round(a)} W`;
    return `${(a / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kW`;
  };

  // Dauer eines Animationszyklus: schneller bei mehr Leistung, gedeckelt
  const dauer = (w) => Math.min(7, Math.max(0.9, 4.2 / Math.sqrt(Math.abs(w) / 1000)));

  class HosEnergiekarte extends HTMLElement {
    setConfig(config) {
      if (!config || !config.bilder) throw new Error("hos-energiekarte: 'bilder' fehlt (Ordner mit den Ebenen)");
      const layout = LAYOUTS[config.layout || "lowpoly"];
      if (!layout) throw new Error(`hos-energiekarte: unbekanntes Layout '${config.layout}'`);
      this._config = config;
      this._layout = layout;
      this._gebaut = false;
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
      return { bilder: "/hacsfiles/ha-unique-energy/lowpoly", netz: {}, haus: {} };
    }

    static getConfigElement() {
      return document.createElement("hos-energiekarte-editor");
    }

    // Welche Komponenten sind konfiguriert und nicht abgeschaltet?
    _aktive() {
      const k = this._config;
      return Object.keys(this._layout.komponenten).filter((n) => {
        const c = k[n];
        if (!c) return false;
        if (Array.isArray(c)) return c.length > 0;
        return c.zeigen !== false;
      });
    }

    // Leistung einer Entität in W, mit Einheit und optionaler Umkehr
    _watt(cfg) {
      if (!cfg || !cfg.leistung) return null;
      let w = this._entitaetWatt(cfg.leistung);
      if (w === null) return null;
      // abzueglich: Entität oder Liste, z. B. Hauszähler minus Wallbox
      const abzug = cfg.abzueglich ? [].concat(cfg.abzueglich) : [];
      for (const e of abzug) {
        const x = this._entitaetWatt(e);
        if (x === null) return null; // lieber kein Wert als ein falscher
        w -= x;
      }
      return cfg.invertieren ? -w : w;
    }

    _entitaetWatt(entity) {
      const st = this._hass && this._hass.states[entity];
      if (!st) return null;
      const v = parseFloat(st.state);
      if (Number.isNaN(v)) return null;
      const unit = (st.attributes && st.attributes.unit_of_measurement) || "W";
      return unit === "kW" ? v * 1000 : unit === "MW" ? v * 1e6 : v;
    }

    _zahl(entity) {
      if (!entity || !this._hass) return null;
      const st = this._hass.states[entity];
      const v = st ? parseFloat(st.state) : NaN;
      return Number.isNaN(v) ? null : v;
    }

    // Werte je Komponente: { w, soc, entity, anzahl }
    _werte(name) {
      const c = this._config[name];
      if (Array.isArray(c)) {
        // mehrere Geräte (z. B. Akkus) werden summiert, SOC gemittelt
        let w = 0, socSum = 0, socN = 0, gueltig = false;
        for (const e of c) {
          const x = this._watt(e);
          if (x !== null) { w += x; gueltig = true; }
          const s = this._zahl(e.soc);
          if (s !== null) { socSum += s; socN++; }
        }
        return { w: gueltig ? w : null, soc: socN ? socSum / socN : null, entity: c[0].leistung, anzahl: c.length, name: c[0].name, strings: [] };
      }
      let w = this._watt(c);
      // Auto 1 ohne eigenen Sensor bekommt die Wallbox-Leistung
      if (w === null && name === "auto_1" && !c.leistung) w = this._watt(this._config.wallbox);
      const belegt = ROLLEN[name].typ === "pv" ? STRINGS.filter((k) => c[k]) : [];
      const strings = belegt.map((k) => this._entitaetWatt(c[k]));
      // Ohne Summensensor ist die Summe der Strings die Leistung, aber nur wenn alle melden
      if (!c.leistung && strings.length) w = strings.includes(null) ? null : strings.reduce((a, x) => a + x, 0);
      return { w, soc: this._zahl(c.soc), entity: c.leistung || c.soc || c[belegt[0]], anzahl: 1, name: c.name, strings };
    }

    _bauen() {
      const L = this._layout;
      const aktiv = this._aktive();
      const pfad = (this._config.bilder || "").replace(/\/$/, "");
      const ebenen = aktiv
        .filter((n) => L.komponenten[n].ebene)
        .map((n) => `<img class="ebene" src="${pfad}/${L.komponenten[n].ebene}?v=${VERSION}" alt="">`)
        .join("");
      const fluesse = aktiv
        .map((n) => `<path class="spur" data-k="${n}" d="${L.komponenten[n].pfad}"/><path class="fluss" data-k="${n}" d="${L.komponenten[n].pfad}"/>`)
        .join("");
      const pct = ([x, y]) => `left:${(x / L.breite) * 100}%;top:${(y / L.hoehe) * 100}%`;
      const labels = aktiv
        .map((n) => `<div class="label" data-k="${n}" style="${pct(L.komponenten[n].label)}"><span class="titel"></span><span class="strings"></span><span class="wert"></span></div>`)
        .join("");
      const hausLabel = this._config.haus
        ? `<div class="label haus" data-k="haus" style="${pct(L.haus_label)}"><span class="titel"></span><span class="wert"></span></div>`
        : "";

      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>${STIL}</style>
        <ha-card>
          ${this._config.titel ? `<div class="kopf">${this._config.titel}</div>` : ""}
          <div class="buehne" style="aspect-ratio:${L.breite}/${L.hoehe}">
            <img class="ebene" src="${pfad}/${L.grundbild}?v=${VERSION}" alt="">
            ${ebenen}
            <svg viewBox="0 0 ${L.breite} ${L.hoehe}" preserveAspectRatio="none">${fluesse}</svg>
            ${labels}${hausLabel}
          </div>
        </ha-card>`;

      this.shadowRoot.querySelectorAll(".label").forEach((el) => {
        el.addEventListener("click", () => {
          const w = el.dataset.k === "haus" ? { entity: this._config.haus.leistung } : this._werte(el.dataset.k);
          if (!w.entity) return;
          this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: w.entity }, bubbles: true, composed: true }));
        });
      });
      this._gebaut = true;
    }

    _render() {
      if (!this._gebaut) this._bauen();
      const root = this.shadowRoot;

      for (const el of root.querySelectorAll(".fluss")) {
        const n = el.dataset.k;
        const rolle = ROLLEN[n];
        const { w } = this._werte(n);
        const still = w === null || Math.abs(w) < SCHWELLE_W;
        let typ = rolle.typ;
        if (n === "netz") typ = w !== null && w < 0 ? "einspeisung" : "bezug";
        const richtung = rolle.richtung * (w !== null && w < 0 ? -1 : 1);
        el.setAttribute("class", `fluss ${typ}${still ? " still" : ""}${richtung < 0 ? " rueck" : ""}`);
        el.previousElementSibling.setAttribute("class", `spur ${typ}${still ? "" : " aktiv"}`);
        if (!still) el.style.setProperty("--dauer", `${dauer(w).toFixed(2)}s`);
      }

      for (const el of root.querySelectorAll(".label")) {
        const n = el.dataset.k;
        let titel, wert;
        if (n === "haus") {
          titel = this._config.haus.name || "Haus";
          // Differenzen zweier Zähler können kurz unter null fallen
          const w = this._watt(this._config.haus);
          wert = w === null ? "–" : fmtLeistung(Math.max(0, w));
        } else {
          const v = this._werte(n);
          titel = v.name || ROLLEN[n].name;
          if (v.anzahl > 1) titel += ` ×${v.anzahl}`;
          if (v.soc !== null) titel += ` · ${Math.round(v.soc)} %`;
          if (v.w === null) wert = "–";
          else if (n === "netz") wert = Math.abs(v.w) < SCHWELLE_W ? "0 W" : `${v.w < 0 ? "Einspeisung" : "Bezug"} ${fmtLeistung(v.w)}`;
          else if (n === "akku") wert = Math.abs(v.w) < SCHWELLE_W ? "Ruhe" : `${v.w > 0 ? "lädt" : "entlädt"} ${fmtLeistung(v.w)}`;
          else wert = fmtLeistung(v.w);
        }
        el.querySelector(".titel").textContent = titel;
        el.querySelector(".wert").textContent = wert;
        const st = el.querySelector(".strings");
        if (st) st.textContent = this._werte(n).strings.map((x) => (x === null ? "–" : fmtLeistung(x))).join(" · ");
      }
    }
  }

  // ── Grafischer Editor ────────────────────────────────────────────────
  // Baut auf HAs eigenem ha-form auf (wie die eingebauten Karten). Formulardaten:
  // je Komponente ein Objekt mit dem Zusatzfeld „zeigen“; ausForm() macht daraus
  // wieder die Kartenkonfiguration und lässt unbekannte Schlüssel stehen.

  // Schlüssel, Titel, Icon, Zusatzfelder, Hilfe zur Leistung
  const EDITOR_KOMPONENTEN = [
    ["netz", "Netz", "mdi:transmission-tower", [], "+ = Bezug, − = Einspeisung"],
    ["haus", "Haus", "mdi:home-lightning-bolt-outline", ["abzueglich"], "Verbrauch des Hauses ohne die übrigen Komponenten"],
    ["pv_haus", "PV Dach", "mdi:solar-panel", STRINGS, "Erzeugung; leer lassen: Summe der Strings"],
    ["balkon_pv", "Balkon-PV", "mdi:solar-panel-large", STRINGS, "Erzeugung; leer lassen: Summe der Strings"],
    ["scheune", "Scheune mit PV", "mdi:barn", STRINGS, "Erzeugung; leer lassen: Summe der Strings"],
    ["akku", "Hausakku", "mdi:home-battery", ["soc"], "+ = lädt, − = entlädt"],
    ["waermepumpe", "Wärmepumpe", "mdi:heat-pump", [], "Verbrauch"],
    ["wallbox", "Wallbox", "mdi:ev-station", [], "Ladeleistung"],
    ["auto_1", "Auto 1", "mdi:car-electric", ["soc"], "leer lassen: übernimmt die Wallbox"],
    ["auto_2", "Auto 2", "mdi:car-electric", ["soc"], "eigene Ladeleistung, falls vorhanden"],
  ];
  const FELDER = ["name", "leistung", "invertieren", "soc", "abzueglich", ...STRINGS];
  const LABELS = {
    bilder: "Bildordner", layout: "Bildsatz", titel: "Titel (optional)", zeigen: "Anzeigen", name: "Name",
    leistung: "Leistung (W oder kW)", invertieren: "Vorzeichen umkehren", soc: "Ladestand (%)", abzueglich: "abzüglich Leistung",
    string_1: "String 1 (optional)", string_2: "String 2 (optional)", string_3: "String 3 (optional)",
  };
  const sensor = { entity: { filter: { domain: "sensor" } } };

  const listenAkku = (cfg) => Array.isArray(cfg.akku);

  function schemaFuer(cfg) {
    const komponenten = EDITOR_KOMPONENTEN.filter(([k]) => !(k === "akku" && listenAkku(cfg))).map(([k, titel, icon, extra, hilfe]) => ({
      type: "expandable", name: k, title: titel, icon,
      schema: [
        { type: "grid", name: "", schema: [{ name: "zeigen", selector: { boolean: {} } }, { name: "name", selector: { text: {} } }] },
        { name: "leistung", selector: sensor, hilfe },
        ...extra.map((f) => ({ name: f, selector: sensor })),
        { name: "invertieren", selector: { boolean: {} } },
      ],
    }));
    return [
      { name: "bilder", required: true, selector: { text: {} }, hilfe: "über HACS: /hacsfiles/ha-unique-energy/lowpoly" },
      { type: "grid", name: "", schema: [
        { name: "layout", selector: { select: { mode: "dropdown", options: Object.keys(LAYOUTS) } } },
        { name: "titel", selector: { text: {} } },
      ] },
      ...komponenten,
    ];
  }

  function zuForm(cfg) {
    const d = { bilder: cfg.bilder || "", layout: cfg.layout || "lowpoly", titel: cfg.titel || "" };
    for (const [k] of EDITOR_KOMPONENTEN) {
      if (k === "akku" && listenAkku(cfg)) continue;
      const c = cfg[k];
      d[k] = { ...(c || {}), zeigen: !!c && c.zeigen !== false };
    }
    return d;
  }

  function ausForm(d, alt) {
    const neu = { ...alt, bilder: d.bilder || "" };
    if (d.layout && d.layout !== "lowpoly") neu.layout = d.layout; else delete neu.layout;
    if (d.titel) neu.titel = d.titel; else delete neu.titel;
    for (const [k] of EDITOR_KOMPONENTEN) {
      if (k === "akku" && listenAkku(alt)) continue; // Liste bleibt, wie sie ist
      const f = d[k] || {};
      const obj = { ...(alt[k] || {}) };
      delete obj.zeigen;
      for (const feld of FELDER) {
        const v = f[feld];
        if (v === undefined || v === "" || v === false || v === null) delete obj[feld]; else obj[feld] = v;
      }
      if (f.zeigen) neu[k] = obj;
      else if (Object.keys(obj).length) neu[k] = { ...obj, zeigen: false }; // Einstellungen behalten, nur ausblenden
      else delete neu[k];
    }
    return neu;
  }

  class HosEnergiekarteEditor extends HTMLElement {
    setConfig(config) {
      this._config = config;
      this._zeichnen();
    }

    set hass(hass) {
      this._hass = hass;
      if (this._form) this._form.hass = hass;
    }

    async connectedCallback() {
      // ha-form lädt HA erst bei Bedarf; die Hilfsfunktionen der Karten ziehen es nach.
      if (!customElements.get("ha-form") && window.loadCardHelpers) {
        const helfer = await window.loadCardHelpers();
        const karte = await helfer.createCardElement({ type: "entities", entities: [] });
        await karte.constructor.getConfigElement?.();
      }
      await customElements.whenDefined("ha-form");
      this._zeichnen();
    }

    _zeichnen() {
      if (!this._config || !customElements.get("ha-form")) return;
      if (!this._form) {
        this._hinweis = document.createElement("ha-alert");
        this._hinweis.alertType = "info";
        this._hinweis.textContent = "Mehrere Hausakkus sind als Liste konfiguriert — bitte im YAML-Modus bearbeiten.";
        this._form = document.createElement("ha-form");
        this._form.computeLabel = (s) => LABELS[s.name] ?? s.name;
        this._form.computeHelper = (s) => s.hilfe; // eigener Schlüssel im Schema, ha-form reicht ihn durch
        this._form.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          const neu = ausForm(ev.detail.value, this._config);
          if (JSON.stringify(neu) === JSON.stringify(this._config)) return;
          this._config = neu;
          this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: neu }, bubbles: true, composed: true }));
        });
        this.append(this._hinweis, this._form);
      }
      this._hinweis.style.display = listenAkku(this._config) ? "" : "none";
      this._form.hass = this._hass;
      this._form.schema = schemaFuer(this._config);
      this._form.data = zuForm(this._config);
    }
  }

  const STIL = `
    :host { display: block; }
    ha-card { overflow: hidden; display: block; background: var(--ha-card-background, var(--card-background-color, #fff)); border-radius: var(--ha-card-border-radius, 12px); }
    .kopf { padding: 12px 16px 0; font-size: 1.1em; font-weight: 500; color: var(--primary-text-color, #222); }
    .buehne { position: relative; width: 100%; container-type: inline-size; }
    .ebene { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; user-select: none; }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    .spur { fill: none; stroke: rgba(40, 46, 58, 0.16); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
    /* Linie halb so deckend wie die Punkte (inkl. Glühen), damit sich beide abheben */
    .spur.aktiv { stroke: currentColor; stroke-opacity: 0.75; stroke-width: 2.5; opacity: 0.5;
                  filter: drop-shadow(0 0 2px currentColor) drop-shadow(0 0 5px currentColor); }
    .fluss { fill: none; stroke: currentColor; stroke-width: 5.6; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 0.1 18;
             animation: lauf var(--dauer, 4s) linear infinite; filter: drop-shadow(0 0 2px currentColor); }
    .fluss.rueck { animation-direction: reverse; }
    .fluss.still { stroke-opacity: 0; animation: none; }
    .pv { color: #f5b400; }
    .akku { color: #2f8cff; }
    .bezug { color: #e5484d; }
    .einspeisung { color: #2fa36b; }
    .wp { color: #f76b15; }
    .auto { color: #8e4ec6; }
    @keyframes lauf { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -180; } }
    .label { position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center;
             padding: 3px 8px; border-radius: 8px; background: rgba(24, 28, 36, 0.78); color: #fff; cursor: pointer;
             font: 500 clamp(9px, 1.6cqi, 14px)/1.25 var(--ha-font-family-body, system-ui, sans-serif); white-space: nowrap;
             backdrop-filter: blur(2px); }
    .label .titel { opacity: 0.75; font-size: 0.85em; }
    .label .wert { font-weight: 600; }
    .label .strings { font-weight: 400; font-size: 0.78em; opacity: 0.85; letter-spacing: 0.01em; }
    .label .strings:empty { display: none; }
    .label.haus { background: rgba(24, 28, 36, 0.88); }
    @container (max-width: 520px) { .label .titel, .label .strings { display: none; } .label { padding: 2px 5px; } }
    @media (prefers-reduced-motion: reduce) { .fluss { animation: none; stroke-dasharray: none; stroke-width: 4; } }
  `;

  if (!customElements.get("hos-energiekarte")) {
    customElements.define("hos-energiekarte", HosEnergiekarte);
    customElements.define("hos-energiekarte-editor", HosEnergiekarteEditor);
    window.customCards = window.customCards || [];
    window.customCards.push({ type: "hos-energiekarte", name: "HOS Energiekarte", description: "Energieflüsse über einer Ebenen-Grafik", preview: true });
    console.info(`%c hos-energiekarte ${VERSION} `, "background:#2f8cff;color:#fff;border-radius:3px");
  }
})();
