(function () {
  "use strict";

  /* The page never computes indicators. data/<SYM>.js holds finished results produced
     offline by scripts/build.js; this file only draws and explains them. */
  const LW = window.LightweightCharts;
  const DATA = (window.LADDER_DATA || {}).NVDA;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasGSAP = typeof window.gsap !== "undefined";
  const motion = hasGSAP && !reduceMotion;

  const COLORS = {
    ink: "#eceef1", ink2: "#b9bfc7", mut: "#8b939c", down: "#5b6470",
    blue: "#3d8bff", yellow: "#f2c230", buy: "#ff5a5f", sell: "#2fc6b8",
    grid: "rgba(255,255,255,0.045)", line: "rgba(255,255,255,0.08)"
  };
  const BAND = {
    blue: { fillColor: "rgba(61,139,255,0.26)", lineColor: "rgba(61,139,255,0.75)" },
    yellow: { fillColor: "rgba(242,194,48,0.20)", lineColor: "rgba(242,194,48,0.65)" }
  };

  /* ============================================================
     i18n
     ============================================================ */
  let lang = window.__LANG === "zh" ? "zh" : "en";
  const t = (k, vars) => {
    let s = (window.I18N[lang] && window.I18N[lang][k]) ?? window.I18N.en[k] ?? k;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, v) => (vars[v] ?? m));
    return s;
  };
  const pct = (v, sign = true) => (v == null ? "—" : (sign && v > 0 ? "+" : "") + (v * 100).toFixed(1) + "%");
  const px = (v) => (v >= 1 ? v.toFixed(2) : v.toFixed(4));
  const fmtDate = (d) => {
    const [y, m, day] = d.split("-").map(Number);
    if (lang === "zh") return `${y}年${m}月${day}日`;
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  };
  const tfName = (tf) => t({ D: "tfD", W: "tfW", M: "tfM" }[tf]);

  function applyStaticText() {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = t("pageTitle");
    $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-html]").forEach((el) => {
      // trusted strings from i18n.js; each <br> chunk becomes a line for the reveal animation
      el.innerHTML = t(el.dataset.i18nHtml).split(/<br\s*\/?>/i).map((c) => `<span class="ln"><span>${c}</span></span>`).join("");
    });
    $$("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    $("#searchInput").setAttribute("placeholder", t("searchPlaceholder"));
    $$("#langToggle [data-lang]").forEach((s) => s.classList.toggle("is-active", s.dataset.lang === lang));
    $("#footData").textContent = t("footData", { date: fmtDate(DATA.updated) });
  }

  /* ============================================================
     STATE — unpack the precomputed period payloads
     ============================================================ */
  const cache = {};
  const state = { tf: "D", sel: null, hz: 10, showAllSignals: false, recTable: false, replay: null };
  const comp = () => cache[state.tf] || (cache[state.tf] = unpack(state.tf));
  const ZONES = ["above", "inside", "below"];

  function unpack(tf) {
    const P = DATA.periods[tf];
    const n = P.t.length, time = P.t;
    const bars = time.map((d, i) => [d, P.o[i], P.h[i], P.l[i], P.c[i]]);
    const signals = P.sig.map((s) => ({
      i: s[0], kind: s[1] > 0 ? "buy" : "sell", date: time[s[0]], close: P.c[s[0]], zone: ZONES[s[2]],
      fwd: { 5: s[3], 10: s[4], 20: s[5] }, confirm: s[6],
      why: s[7] != null ? { price: [s[7], s[8]], mom: [s[9], s[10]] } : null,
      over: s[11]
    }));
    const band = (up, lo) => time.map((tm, i) => ({ time: tm, upper: up[i], lower: lo[i] }));
    const series = {
      candles: bars.map((b) => ({ time: b[0], open: b[1], high: b[2], low: b[3], close: b[4] })),
      blueBand: band(P.bu, P.bl),
      yellowBand: band(P.yu, P.yl),
      hist: time.map((tm, i) => ({ time: tm, value: P.mh[i], color: P.mh[i] >= 0 ? "rgba(236,238,241,0.32)" : "rgba(91,100,112,0.6)" })),
      fast: time.map((tm, i) => ({ time: tm, value: P.mf[i] })),
      slow: time.map((tm, i) => ({ time: tm, value: P.ms[i] }))
    };
    return { n, time, bars, C: P.c, H: P.h, L: P.l, P, signals, series };
  }

  /* ============================================================
     BAND SERIES — a filled ribbon between two price lines
     ============================================================ */
  class BandRenderer {
    update(data, opts) { this.d = data; this.o = opts; }
    draw(target, toY) {
      target.useBitmapCoordinateSpace((scope) => {
        const d = this.d;
        if (!d || !d.bars.length || !d.visibleRange) return;
        const ctx = scope.context, hr = scope.horizontalPixelRatio, vr = scope.verticalPixelRatio;
        const from = Math.max(0, d.visibleRange.from - 1), to = Math.min(d.bars.length, d.visibleRange.to + 1);
        const pts = [];
        for (let i = from; i < to; i++) {
          const b = d.bars[i], od = b.originalData;
          if (od.upper == null) continue;
          const yu = toY(od.upper), yl = toY(od.lower);
          if (yu == null || yl == null) continue;
          pts.push([b.x * hr, yu * vr, yl * vr]);
        }
        if (pts.length < 2) return;
        ctx.beginPath();
        pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        for (let k = pts.length - 1; k >= 0; k--) ctx.lineTo(pts[k][0], pts[k][2]);
        ctx.closePath();
        ctx.fillStyle = this.o.fillColor;
        ctx.fill();
        ctx.lineWidth = Math.max(1, Math.round(vr));
        ctx.strokeStyle = this.o.lineColor;
        for (const j of [1, 2]) {
          ctx.beginPath();
          pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[j]) : ctx.moveTo(p[0], p[j])));
          ctx.stroke();
        }
      });
    }
  }
  class BandSeries {
    constructor() { this.r = new BandRenderer(); }
    priceValueBuilder(row) { return [row.lower, row.upper, (row.upper + row.lower) / 2]; }
    isWhitespace(row) { return row.upper == null; }
    renderer() { return this.r; }
    update(data, opts) { this.r.update(data, opts); }
    defaultOptions() { return { ...LW.customSeriesDefaultOptions, fillColor: "rgba(255,255,255,0.1)", lineColor: "#fff" }; }
  }

  /* ============================================================
     CHART
     ============================================================ */
  let chart, S = {}, markersApi;

  function initChart() {
    const el = $("#chart");
    chart = LW.createChart(el, {
      autoSize: true,
      layout: {
        background: { type: "solid", color: "transparent" },
        textColor: COLORS.mut, fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: COLORS.line, separatorHoverColor: COLORS.line, enableResize: false }
      },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      crosshair: {
        mode: 0,
        vertLine: { color: "rgba(236,238,241,0.25)", labelBackgroundColor: "#15181d", style: 3 },
        horzLine: { color: "rgba(236,238,241,0.25)", labelBackgroundColor: "#15181d", style: 3 }
      },
      rightPriceScale: { borderColor: COLORS.line, scaleMargins: { top: 0.12, bottom: 0.06 } },
      timeScale: { borderColor: COLORS.line, shiftVisibleRangeOnNewBar: false, rightOffset: 6, barSpacing: 7, minBarSpacing: 0.4 },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: { time: true, price: true } },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }
    });

    const quiet = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    S.yellowBand = chart.addCustomSeries(new BandSeries(), { ...quiet, ...BAND.yellow });
    S.blueBand = chart.addCustomSeries(new BandSeries(), { ...quiet, ...BAND.blue });
    S.candles = chart.addSeries(LW.CandlestickSeries, {
      upColor: COLORS.ink, downColor: COLORS.down, borderVisible: false,
      wickUpColor: "rgba(236,238,241,0.7)", wickDownColor: "rgba(91,100,112,0.9)",
      priceLineColor: "rgba(236,238,241,0.35)", priceLineStyle: 2
    });
    S.priceDiv = chart.addSeries(LW.LineSeries, { ...quiet, color: COLORS.buy, lineWidth: 2, lineStyle: 2, pointMarkersVisible: true, pointMarkersRadius: 4 });

    // Momentum pane: no price scale numbers, the shape is what matters
    const momScale = { priceScaleId: "right" };
    S.hist = chart.addSeries(LW.HistogramSeries, { ...quiet, ...momScale }, 1);
    S.slow = chart.addSeries(LW.LineSeries, { ...quiet, ...momScale, color: "rgba(139,147,156,0.9)", lineWidth: 1, lineStyle: 2 }, 1);
    S.fast = chart.addSeries(LW.LineSeries, { ...quiet, ...momScale, color: COLORS.ink2, lineWidth: 2 }, 1);
    S.momDiv = chart.addSeries(LW.LineSeries, { ...quiet, ...momScale, color: COLORS.yellow, lineWidth: 2, lineStyle: 2, pointMarkersVisible: true, pointMarkersRadius: 4 }, 1);

    const panes = chart.panes();
    panes[0].setStretchFactor(3);
    panes[1].setStretchFactor(1);
    try { S.fast.priceScale().applyOptions({ visible: false }); } catch (e) {}
    markersApi = LW.createSeriesMarkers(S.candles, []);

    chart.subscribeCrosshairMove((p) => {
      if (state.replay) return;
      const k = p && p.logical != null ? Math.round(p.logical) : null;
      renderReadout(k != null && k >= 0 && k < comp().n ? k : null);
    });
    chart.subscribeClick((p) => {
      if (state.replay || !p || p.logical == null) return;
      const k = Math.round(p.logical);
      let best = null;
      for (const s of comp().signals) if (Math.abs(s.i - k) <= 2 && (!best || Math.abs(s.i - k) < Math.abs(best.i - k))) best = s;
      if (best) selectSignal(best, { zoom: false });
    });

    new ResizeObserver(positionPaneLabel).observe(el);
  }

  function positionPaneLabel() {
    try { $("#macdLabel").style.top = chart.panes()[0].getHeight() + 6 + "px"; } catch (e) {}
  }

  const SERIES_KEYS = ["candles", "blueBand", "yellowBand", "hist", "fast", "slow"];
  function setSeriesData(upto) {
    const s = comp().series;
    for (const k of SERIES_KEYS) S[k].setData(upto == null ? s[k] : s[k].slice(0, upto + 1));
  }
  function pushBar(k) {
    const s = comp().series;
    for (const key of SERIES_KEYS) S[key].update(s[key][k]);
  }

  function markerList(upto) {
    const sel = state.sel;
    return comp().signals
      .filter((s) => upto == null || s.i <= upto)
      .map((s) => ({
        time: s.date,
        position: s.kind === "buy" ? "belowBar" : "aboveBar",
        shape: s.kind === "buy" ? "arrowUp" : "arrowDown",
        color: s.kind === "buy" ? COLORS.buy : COLORS.sell,
        text: t(s.kind),
        size: sel && sel.i === s.i && sel.kind === s.kind ? 2 : 1
      }));
  }
  const refreshMarkers = (upto) => markersApi.setMarkers(markerList(upto));

  function clearDivergence() { S.priceDiv.setData([]); S.momDiv.setData([]); }
  function drawDivergence(sig) {
    const c = comp();
    if (!sig || !sig.why) return clearDivergence();
    S.priceDiv.applyOptions({ color: sig.kind === "buy" ? COLORS.buy : COLORS.sell });
    S.priceDiv.setData(sig.why.price.map((k) => ({ time: c.time[k], value: c.C[k] })));
    S.momDiv.setData(sig.why.mom.map((k) => ({ time: c.time[k], value: c.P.mf[k] })));
  }

  function visibleDefault() {
    const n = comp().n;
    const span = { D: 260, W: 260, M: 220 }[state.tf];
    return { from: Math.max(0, n - span), to: n + 4 };
  }

  function setLadderVisibility() {
    S.blueBand.applyOptions({ visible: $("#tBlue").checked });
    S.yellowBand.applyOptions({ visible: $("#tYellow").checked });
  }

  /* ============================================================
     PERIOD + SELECTION
     ============================================================ */
  function setPeriod(tf, { intro = false } = {}) {
    stopReplay(true);
    state.tf = tf;
    state.sel = null;
    state.showAllSignals = false;
    $$("[data-tf]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tf === tf)));
    clearDivergence();
    const range = visibleDefault();
    if (intro && motion) introDraw(range);
    else {
      setSeriesData();
      refreshMarkers();
      chart.timeScale().setVisibleLogicalRange(range);
    }
    renderHeader();
    renderReadout(null);
    renderSignalList();
    renderInspector();
    renderRecord();
    requestAnimationFrame(positionPaneLabel);
  }

  const sigStart = (sig) => (sig.why ? Math.min(sig.why.price[0], sig.why.mom[0]) : sig.i - 40);

  function selectSignal(sig, { zoom = true } = {}) {
    state.sel = sig;
    refreshMarkers();
    drawDivergence(sig);
    if (zoom && sig) {
      const n = comp().n;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, sigStart(sig) - 18), to: Math.min(n + 4, sig.i + 45) });
    }
    renderInspector();
    renderSignalList();
  }

  /* ============================================================
     REPLAY — bars appear one by one, the stage pill narrates
     ============================================================ */
  function stageAt(k) {
    for (const s of comp().signals) {
      if (s.i === k) return [s.kind, t(s.kind === "buy" ? "stageBuy" : "stageSell")];
      if (s.why && s.i > k && sigStart(s) <= k) return ["div", t("stageBottomDiv")];
    }
    return ["none", t("stageNone")];
  }
  function showStage(k, override) {
    const st = $("#stage");
    const [s, text] = override || stageAt(k);
    st.hidden = false;
    st.dataset.s = s;
    $("#stageText").textContent = text;
    $("#stageDate").textContent = k != null ? fmtDate(comp().time[k]) : "";
  }

  function setPlayButton(playing) {
    const b = $("#replayBtn");
    b.classList.toggle("is-playing", playing);
    b.querySelector(".ico").textContent = playing ? "❚❚" : "▶";
    b.querySelector("[data-i18n]").textContent = t(playing ? "pause" : "replay");
  }

  function startReplay(sig) {
    stopReplay(true);
    const n = comp().n;
    let from, to;
    if (sig) {
      state.sel = sig;
      from = Math.max(30, sigStart(sig) - 12);
      to = Math.min(n - 1, sig.i + 30);
    } else {
      const r = chart.timeScale().getVisibleLogicalRange() || visibleDefault();
      from = Math.max(30, Math.floor(r.from));
      to = Math.min(n - 1, Math.max(from + 40, Math.ceil(r.to) - 4));
    }
    clearDivergence();
    setSeriesData(from);
    refreshMarkers(from);
    chart.timeScale().setVisibleLogicalRange({ from: from - 4, to: to + 6 });
    state.replay = { k: from, to, sig, paused: false, timer: null };
    setPlayButton(true);
    showStage(from);
    renderInspector();
    tickReplay();
  }

  function tickReplay() {
    const r = state.replay;
    if (!r || r.paused) return;
    const speed = { D: 70, W: 110, M: 160 }[state.tf];
    r.timer = setTimeout(() => {
      if (!state.replay || r.paused) return;
      r.k++;
      pushBar(r.k);
      refreshMarkers(r.k);
      showStage(r.k);
      renderReadout(r.k);
      const hit = r.sig && r.k === r.sig.i;
      if (hit) drawDivergence(r.sig);
      if (r.k >= r.to) return finishReplay();
      if (hit) { r.timer = setTimeout(tickReplay, 1100); return; }
      tickReplay();
    }, speed);
  }

  function finishReplay() {
    const r = state.replay;
    showStage(r.k, ["none", t("replayDone")]);
    setTimeout(() => { if (state.replay === r) stopReplay(false); }, 1400);
  }

  function stopReplay(silent) {
    const r = state.replay;
    if (!r) return;
    clearTimeout(r.timer);
    state.replay = null;
    setPlayButton(false);
    $("#stage").hidden = true;
    if (silent) return;
    const range = chart.timeScale().getVisibleLogicalRange();
    setSeriesData();
    refreshMarkers();
    drawDivergence(state.sel);
    if (range) chart.timeScale().setVisibleLogicalRange(range);
    renderReadout(null);
    renderInspector();
  }

  function toggleReplay() {
    const r = state.replay;
    if (!r) return startReplay(state.sel);
    r.paused = !r.paused;
    setPlayButton(!r.paused);
    if (!r.paused) tickReplay(); else clearTimeout(r.timer);
  }

  // First paint: bars sweep in from left to right
  function introDraw(range) {
    const n = comp().n;
    const start = Math.max(30, Math.floor(range.from));
    setSeriesData(start);
    refreshMarkers(start);
    chart.timeScale().setVisibleLogicalRange(range);
    let k = start;
    const step = Math.max(1, Math.round((n - start) / 70));
    (function frame() {
      if (state.replay) return;
      const end = Math.min(n - 1, k + step);
      for (let i = k + 1; i <= end; i++) pushBar(i);
      k = end;
      refreshMarkers(k);
      if (k < n - 1) requestAnimationFrame(frame);
      else { chart.timeScale().setVisibleLogicalRange(range); renderReadout(null); }
    })();
  }

  /* ============================================================
     RENDER — header, readout, inspector, list, record, hero
     ============================================================ */
  function renderHeader() {
    const c = comp(), n = c.n;
    const last = c.C[n - 1], prev = c.C[n - 2];
    $("#symName").textContent = DATA.symbol;
    $("#symPx").textContent = "$" + px(last);
    const chg = last / prev - 1;
    const el = $("#symChg");
    el.textContent = `${pct(chg)} · ${tfName(state.tf)}`;
    el.className = "term-chg mono " + (chg >= 0 ? "up" : "down");
  }

  function renderReadout(k) {
    const c = comp();
    const i = k == null ? (state.replay ? state.replay.k : c.n - 1) : k;
    const b = c.bars[i];
    if (!b) return;
    const chg = i > 0 ? b[4] / c.C[i - 1] - 1 : 0;
    $("#readout").innerHTML =
      `<span><b>${fmtDate(b[0])}</b></span>` +
      `<span>O <b>${px(b[1])}</b></span><span>H <b>${px(b[2])}</b></span><span>L <b>${px(b[3])}</b></span><span>C <b>${px(b[4])}</b> ${pct(chg)}</span>`;
  }

  function quality(sig) {
    if (sig.kind === "buy") return sig.zone === "below" ? ["caution", t("qCaution")] : ["good", t("qGood")];
    return sig.over > 0.08 ? ["good", t("qStretched")] : ["caution", t("qStrong")];
  }

  function renderInspector() {
    const box = $("#inspCard");
    const sig = state.sel;
    if (!sig) { box.innerHTML = `<p class="insp-empty">${t("inspectorEmpty")}</p>`; return; }
    const c = comp();
    const isBuy = sig.kind === "buy";
    const [qk, qText] = quality(sig);
    const why = sig.why
      ? t(isBuy ? "whyBuy" : "whySell", { p0: `<b>${px(c.C[sig.why.price[0]])}</b>`, p1: `<b>${px(c.C[sig.why.price[1]])}</b>`, date: fmtDate(sig.date) })
      : "";
    let zone;
    if (isBuy) zone = t({ above: "zoneAboveBuy", inside: "zoneInsideBuy", below: "zoneBelowBuy" }[sig.zone]);
    else zone = (sig.over > 0 ? t("zoneSell", { pct: pct(sig.over, false) }) : t("zoneSellInside")) + " " + t(sig.over > 0.08 ? "sellStretchedNote" : "sellStrongNote");
    let confirm;
    if (sig.confirm != null) confirm = t(isBuy ? "confirmBuy" : "confirmSell", { date: fmtDate(c.time[sig.confirm]), n: sig.confirm - sig.i });
    else confirm = sig.i + 20 >= c.n ? t("confirmPending") : t("confirmNone");
    const fwd = [5, 10, 20].map((n) => {
      const v = sig.fwd[n];
      const cls = v == null ? "" : (isBuy ? v > 0 : v < 0) ? "good" : "bad";
      return `<div class="${cls}"><span>+${n} ${t("bars")}</span><b>${pct(v)}</b></div>`;
    }).join("");
    box.innerHTML = `
      <div class="ic-top">
        <span class="tag ${isBuy ? "tag-buy" : "tag-sell"}">${isBuy ? "▲" : "▼"} ${t(sig.kind)}</span>
        <span class="tag tag-q ${qk}">${qText}</span>
      </div>
      <p class="ic-date">${fmtDate(sig.date)}</p>
      <p class="ic-type mono">${tfName(state.tf)} · $${px(sig.close)}</p>
      ${why ? `<p class="ic-why">${why}</p>` : ""}
      <p class="ic-zone">${zone}</p>
      <p class="ic-confirm">${confirm}</p>
      <div class="ic-after"><span class="ic-after-k mono">${t("after")}</span><div class="ic-fwd">${fwd}</div></div>
      <button class="ic-replay" type="button" id="icReplay">▶ ${t("replayThis")}</button>`;
    $("#icReplay").addEventListener("click", () => startReplay(sig));
  }

  function renderSignalList() {
    const all = comp().signals;
    const sigs = all.slice().reverse();
    const shown = state.showAllSignals ? sigs : sigs.slice(0, 12);
    $("#sigCount").textContent = sigs.length;
    $("#sigList").innerHTML = shown.map((s) => {
      const cur = state.sel && state.sel.i === s.i && state.sel.kind === s.kind;
      return `<li><button type="button" data-idx="${all.indexOf(s)}" aria-current="${cur}">
        <span class="sig-ico ${s.kind}" aria-hidden="true">${s.kind === "buy" ? "▲" : "▼"}</span>
        <span>${t(s.kind)} · ${fmtDate(s.date)}</span>
        <span class="sig-px">$${px(s.close)}</span></button></li>`;
    }).join("");
    const more = $("#sigMore");
    more.hidden = sigs.length <= 12;
    more.textContent = state.showAllSignals ? t("showLess") : `${t("showAll")} (${sigs.length})`;
  }

  function renderRecord() {
    const c = comp(), hz = state.hz;
    $$("#hzSeg [data-hz]").forEach((b) => b.setAttribute("aria-selected", String(+b.dataset.hz === hz)));
    $("#recSub").textContent = t("recSub", { n: hz });
    const zoneLabel = { above: t("zoneAbove"), inside: t("zoneInside"), below: t("zoneBelow") };
    const stat = (kind, zone) => {
      const list = c.signals.filter((s) => s.kind === kind && (!zone || zone.includes(s.zone)) && s.fwd[hz] != null);
      if (!list.length) return null;
      const win = list.filter((s) => (kind === "buy" ? s.fwd[hz] > 0 : s.fwd[hz] < 0)).length / list.length;
      const avg = list.reduce((a, s) => a + s.fwd[hz], 0) / list.length;
      return { n: list.length, win, avg };
    };
    const good = stat("buy", ["above", "inside"]), bad = stat("buy", ["below"]);
    $("#recInsight").innerHTML = good && bad
      ? t("recInsight", { tf: tfName(state.tf).toLowerCase(), a: `<b>${Math.round(good.win * 100)}%</b>`, b: `<b>${Math.round(bad.win * 100)}%</b>`, n: hz })
      : t("recInsightNone");

    const col = (kind) => {
      const title = `<h3><span class="tag ${kind === "buy" ? "tag-buy" : "tag-sell"}">${kind === "buy" ? "▲" : "▼"} ${t(kind)}</span>${t(kind === "buy" ? "recBuyCol" : "recSellCol")}</h3>`;
      if (state.recTable) {
        const rows = ZONES.map((z) => {
          const s = stat(kind, [z]);
          return `<tr><td>${zoneLabel[z]}</td><td>${s ? s.n : 0}</td><td>${s ? Math.round(s.win * 100) + "%" : "—"}</td><td>${s ? pct(s.avg) : "—"}</td></tr>`;
        }).join("");
        return `<div class="rec-col">${title}<table class="rec-table"><thead><tr><th>${t("recThZone")}</th><th>${t("recThN")}</th><th>${t("recThWin")}</th><th>${t("recThAvg")}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }
      const rows = ZONES.map((z) => {
        const s = stat(kind, [z]);
        return `<div class="rec-row z-${z}">
          <div class="rec-row-top"><span class="rec-zone">${zoneLabel[z]}</span><span class="rec-pct">${s ? Math.round(s.win * 100) + "%" : "—"}</span></div>
          <div class="rec-bar"><i style="transform:scaleX(${s ? s.win : 0})"></i></div>
          <p class="rec-meta mono">${s ? t("recRow", { win: Math.round(s.win * 100) + "%", avg: pct(s.avg), n: s.n }) : t("recEmpty")}</p>
        </div>`;
      }).join("");
      return `<div class="rec-col">${title}${rows}</div>`;
    };
    $("#recGrid").innerHTML = col("buy") + col("sell");
    $("#recToggle").textContent = state.recTable ? t("recChart") : t("recTable");
  }

  function renderHeroStatus() {
    const c = cache.D || comp();
    const n = c.n - 1, P = c.P;
    const last = c.signals[c.signals.length - 1];
    const zone = c.C[n] > P.yu[n] ? "zoneAbove" : c.C[n] < P.yl[n] ? "zoneBelow" : "zoneInside";
    const rising = P.bu[n] > P.bu[n - 5];
    $("#heroStatus").innerHTML = `
      <li><span class="hs-k mono">${t("latestSignal")} · ${t("tfD")}</span><span class="hs-v"><span class="tag ${last.kind === "buy" ? "tag-buy" : "tag-sell"}">${last.kind === "buy" ? "▲" : "▼"} ${t(last.kind)}</span>${fmtDate(last.date)}</span></li>
      <li><span class="hs-k mono">${t("trendState")}</span><span class="hs-v">${t(zone)}</span></li>
      <li><span class="hs-k mono">${t("blueState")}</span><span class="hs-v">${rising ? "↗" : "↘"} ${t(rising ? "ladderUp" : "ladderDown")}</span></li>`;
  }

  // Hero art: the latest NVDA bands as a faint backdrop
  function renderHeroArt() {
    const c = cache.D || comp();
    const P = c.P, n = c.n, from = n - 180;
    const xs = (i) => ((i - from) / (n - 1 - from)) * 1000;
    let lo = Infinity, hi = -Infinity;
    for (let i = from; i < n; i++) { lo = Math.min(lo, c.L[i], P.yl[i], P.bl[i]); hi = Math.max(hi, c.H[i], P.yu[i], P.bu[i]); }
    const ys = (v) => 560 - ((v - lo) / (hi - lo)) * 520;
    const pts = (arr) => Array.from({ length: n - from }, (_, k) => `${xs(from + k).toFixed(1)},${ys(arr[from + k]).toFixed(1)}`);
    const band = (up, dn) => `M${pts(up).join(" L")} L${pts(dn).reverse().join(" L")} Z`;
    $("#rungField").innerHTML = `<svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
      <path class="art-band" d="${band(P.yu, P.yl)}" fill="rgba(242,194,48,0.22)" stroke="rgba(242,194,48,0.6)" stroke-width="1"/>
      <path class="art-band" d="${band(P.bu, P.bl)}" fill="rgba(61,139,255,0.26)" stroke="rgba(61,139,255,0.7)" stroke-width="1"/>
      <polyline class="art-line" points="${pts(c.C).join(" ")}" fill="none" stroke="${COLORS.ink}" stroke-width="2" opacity="0.9"/>
    </svg>`;
  }

  /* ============================================================
     UI WIRING
     ============================================================ */
  let lenis = null;
  const scrollToEl = (el) => (lenis ? lenis.scrollTo(el, { duration: 1.3, offset: -70 }) : el.scrollIntoView({ behavior: "smooth" }));

  function wire() {
    $$("[data-tf]").forEach((b) => b.addEventListener("click", () => setPeriod(b.dataset.tf)));
    $$("#hzSeg [data-hz]").forEach((b) => b.addEventListener("click", () => { state.hz = +b.dataset.hz; renderRecord(); }));
    $("#recToggle").addEventListener("click", () => { state.recTable = !state.recTable; renderRecord(); });
    $("#tBlue").addEventListener("change", setLadderVisibility);
    $("#tYellow").addEventListener("change", setLadderVisibility);
    $("#replayBtn").addEventListener("click", toggleReplay);
    const zoom = (f) => {
      const r = chart.timeScale().getVisibleLogicalRange();
      if (!r) return;
      const mid = (r.from + r.to) / 2, half = ((r.to - r.from) / 2) * f;
      chart.timeScale().setVisibleLogicalRange({ from: mid - half, to: mid + half });
    };
    $("#zoomIn").addEventListener("click", () => zoom(0.7));
    $("#zoomOut").addEventListener("click", () => zoom(1.4));
    $("#resetView").addEventListener("click", () => { stopReplay(false); chart.timeScale().setVisibleLogicalRange(visibleDefault()); });
    $("#sigList").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-idx]");
      if (b) { stopReplay(false); selectSignal(comp().signals[+b.dataset.idx]); }
    });
    $("#sigMore").addEventListener("click", () => { state.showAllSignals = !state.showAllSignals; renderSignalList(); });

    $("#searchForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $("#searchInput").value.trim().toUpperCase();
      if (v && v !== DATA.symbol) {
        $("#searchMsg").textContent = t("searchLocked");
        $("#searchInput").value = DATA.symbol;
      } else $("#searchMsg").textContent = "";
      scrollToEl($("#lab"));
    });

    $("#howCta").addEventListener("click", () => {
      if (state.tf !== "D") setPeriod("D");
      const sig = comp().signals.find((s) => s.date === "2023-11-01" && s.kind === "buy");
      scrollToEl($("#lab"));
      if (sig) setTimeout(() => { selectSignal(sig, { zoom: false }); startReplay(sig); }, 900);
    });

    $("#langToggle").addEventListener("click", () => {
      lang = lang === "en" ? "zh" : "en";
      try { localStorage.setItem("site-lang", lang); } catch (e) {}
      applyStaticText();
      setPlayButton(!!(state.replay && !state.replay.paused));
      refreshMarkers(state.replay ? state.replay.k : null);
      renderHeader(); renderReadout(null); renderInspector(); renderSignalList(); renderRecord(); renderHeroStatus();
      if (state.replay) showStage(state.replay.k);
    });

    // Nav: solid after scroll, hides on the way down
    const nav = $("#nav");
    let lastY = scrollY;
    window.addEventListener("scroll", () => {
      const y = scrollY;
      nav.classList.toggle("is-scrolled", y > 20);
      if (y > lastY + 4 && y > 300) nav.classList.add("is-hidden");
      else if (y < lastY - 4) nav.classList.remove("is-hidden");
      lastY = y;
    }, { passive: true });
  }

  /* ============================================================
     MOTION
     ============================================================ */
  function initMotion() {
    if (!motion) return;
    gsap.registerPlugin(ScrollTrigger);
    if (window.Lenis) {
      lenis = new Lenis({ lerp: 0.1 });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add((tm) => lenis.raf(tm * 1000));
      gsap.ticker.lagSmoothing(0);
      document.addEventListener("click", (e) => {
        const a = e.target.closest('a[href^="#"]');
        if (!a) return;
        const target = $(a.getAttribute("href"));
        if (target) { e.preventDefault(); scrollToEl(target); }
      });
    }
    const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
    tl.from(".hero-title .ln > span", { yPercent: 110, duration: 1.3, stagger: 0.12 })
      .from(".hero .eyebrow, .hero-sub, .search, .hero-status li", { opacity: 0, y: 24, duration: 1, stagger: 0.08 }, 0.3)
      .from(".nav", { yPercent: -100, duration: 1, clearProps: "transform" }, 0.2);
    $$(".art-line").forEach((p) => {
      const len = p.getTotalLength ? p.getTotalLength() : 2000;
      gsap.fromTo(p, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 2.4, ease: "power2.inOut", delay: 0.2 });
    });
    gsap.from(".art-band", { opacity: 0, duration: 1.6, stagger: 0.2, ease: "power2.out", delay: 0.4 });
    gsap.to(".rung-field svg", { yPercent: 12, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
    gsap.from(".terminal", { y: 60, opacity: 0, duration: 1.2, ease: "expo.out", scrollTrigger: { trigger: ".lab", start: "top 85%" } });
    $$(".sec-title").forEach((el) => gsap.from(el.querySelectorAll(".ln > span"), { yPercent: 110, duration: 1.1, stagger: 0.08, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 85%" } }));
    ScrollTrigger.batch(".reveal", { start: "top 88%", once: true, onEnter: (els) => gsap.from(els, { opacity: 0, y: 40, duration: 0.9, stagger: 0.08, ease: "power3.out" }) });
    ScrollTrigger.create({ trigger: "#record", start: "top 70%", once: true, onEnter: () => gsap.from(".rec-bar i", { scaleX: 0, duration: 1.2, stagger: 0.08, ease: "expo.out" }) });
  }

  /* ============================================================
     BOOT
     ============================================================ */
  if (!DATA || !LW) { document.body.insertAdjacentHTML("afterbegin", "<p style='padding:20px'>Data failed to load.</p>"); return; }
  applyStaticText();
  initChart();
  wire();
  setPeriod("D", { intro: true });
  renderHeroStatus();
  renderHeroArt();
  initMotion();
})();
