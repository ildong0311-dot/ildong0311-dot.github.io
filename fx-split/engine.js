/*
 * 환율 분할매매 엔진 (화면과 분리된 순수 로직)
 *
 * - 화면(app.js)과 브라우저에 의존하지 않아서 Node로 테스트할 수 있습니다.
 * - 체결은 지금은 "가상 체결"입니다. 실제 증권사 연동 시 placeOrder 부분만 교체하면 됩니다.
 *
 * 전략 규칙
 *   1차수   : 예약환전이면 살때 환율 <= 1차수 예약환율일 때 매수, 즉시환전이면 시작하자마자 매수
 *   n차수   : 살때 환율 <= (직전 차수 매수가 - 매수간격) 일 때 매수 (한 틱에 한 차수씩)
 *   매도    : 보유 차수마다 팔때 환율 >= (그 차수 매수가 + 매도간격) 이면 매도
 *   재매수  : 한 번 매도된 차수를 다시 사는 것. 꺼져 있으면 그 차수는 다시 사지 않고,
 *             보유 차수가 모두 팔리면 전략이 완료됩니다.
 *   손익    : 매도 시 그 차수의 실제 매입원가와 비교해 확정손익을 계산합니다.
 */
(function (root) {
  'use strict';

  var CURRENCIES = {
    USD: { code: 'USD', name: '미국 달러', unit: 1, flag: '🇺🇸' },
    JPY: { code: 'JPY', name: '일본 엔', unit: 100, flag: '🇯🇵' },   // 100엔당 원
    EUR: { code: 'EUR', name: '유로', unit: 1, flag: '🇪🇺' }
  };

  function r2(x) { return Math.round(x * 100) / 100; }
  function floor2(x) { return Math.floor(x * 100 + 1e-9) / 100; }

  function defaultState() {
    return {
      version: 1,
      cash: 10000000,
      switches: { buy: true, sell: true, rebuy: true },
      settings: {
        spread: { USD: 1.0, JPY: 1.45, EUR: 1.9 },   // 기준환율에서 살때/팔때가 벌어지는 폭(원)
        volatility: 0.00025,                         // 시뮬레이션 1틱당 변동성
        tickMs: 2000,
        speed: 1,
        simulate: true
      },
      rates: {
        USD: { mid: 1346.85 },
        JPY: { mid: 847.66 },
        EUR: { mid: 1479.52 }
      },
      strategies: [],
      manual: {},          // 직접환전 보유분 { USD: {qty, cost} }
      trades: [],
      seq: 1
    };
  }

  /* ---------- 환율 ---------- */
  function quote(state, cur) {
    var r = state.rates[cur];
    var s = state.settings.spread[cur] || 0;
    return { mid: r2(r.mid), ask: r2(r.mid + s), bid: r2(r.mid - s) };
  }

  function randomWalk(state, rnd) {
    rnd = rnd || Math.random;
    Object.keys(state.rates).forEach(function (cur) {
      // Box-Muller 정규분포
      var u = Math.max(rnd(), 1e-12), v = rnd();
      var z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      state.rates[cur].mid = r2(state.rates[cur].mid * (1 + z * state.settings.volatility));
    });
  }

  /* ---------- 수량/금액 ---------- */
  function fxValue(qty, rate, cur) { return Math.round(qty * rate / CURRENCIES[cur].unit); }
  function qtyFor(krw, rate, cur) { return floor2(krw / rate * CURRENCIES[cur].unit); }

  /* ---------- 전략 ---------- */
  function intervalDown(price, type, v) { return r2(type === 'pct' ? price * (1 - v / 100) : price - v); }
  function intervalUp(price, type, v) { return r2(type === 'pct' ? price * (1 + v / 100) : price + v); }

  function strategyName(p) {
    var unitB = p.buyIntType === 'pct' ? '%' : '원';
    var unitS = p.sellIntType === 'pct' ? '%' : '원';
    var amt = p.amtType === 'fx' ? (p.amount + p.cur) : (p.amount / 10000 + '만원');
    var d = new Date(p.createdAt || Date.now());
    return '매수' + p.buyInt + unitB + ',매도' + p.sellInt + unitS + '(' + amt + ')' +
      d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
  }

  function createStrategy(state, p, now) {
    now = now || Date.now();
    var s = {
      id: 's' + (state.seq++),
      name: p.name || strategyName(Object.assign({ createdAt: now }, p)),
      cur: p.cur || 'USD',
      mode: p.mode || 'reserve',          // reserve | now
      maxLots: Math.max(1, Math.min(200, p.maxLots | 0 || 50)),
      firstRate: r2(+p.firstRate || 0),
      amtType: p.amtType || 'krw',         // krw | fx
      amount: +p.amount || 50000,
      buyIntType: p.buyIntType || 'won',
      buyInt: +p.buyInt || 1,
      sellIntType: p.sellIntType || 'won',
      sellInt: +p.sellInt || 2,
      rebuy: p.rebuy !== false,
      status: 'running',                   // running | paused | done
      createdAt: now,
      anchor: p.mode === 'now' ? null : r2(+p.firstRate),
      lots: [],
      soldIdx: [],
      soldAt: {},          // 차수 → 마지막 매수가 (재매수 기준)
      stats: { buys: 0, sells: 0, soldCost: 0, soldProceeds: 0, realized: 0, boughtKrw: 0 },
      msg: ''
    };
    state.strategies.unshift(s);
    return s;
  }

  // 다음 차수의 매수 목표가 (없으면 null)
  function nextBuyTarget(s) {
    var n = s.lots.length + 1;
    if (n > s.maxLots) return null;
    var t;
    if (s.lots.length === 0) {
      if (s.anchor == null) return null;                    // 즉시환전 최초 진입 → 즉시 매수
      t = s.anchor;
    } else {
      t = intervalDown(s.lots[s.lots.length - 1].price, s.buyIntType, s.buyInt);
    }
    // 재매수 차수는 예전에 샀던 가격 이하에서만 다시 산다 (매도 직후 비싸게 되사는 손해 방지)
    var prev = s.soldAt && s.soldAt[n];
    return prev != null ? Math.min(t, prev) : t;
  }

  function sellTarget(s, lot) { return intervalUp(lot.price, s.sellIntType, s.sellInt); }

  // 엔진이 계산한 차수별 사다리(미리보기용)
  function ladder(p, count) {
    var out = [], price = +p.firstRate;
    for (var i = 1; i <= Math.min(count, p.maxLots); i++) {
      out.push({ n: i, buy: r2(price), sell: intervalUp(price, p.sellIntType, p.sellInt) });
      price = intervalDown(price, p.buyIntType, p.buyInt);
    }
    return out;
  }
  function ladderBottom(p) {
    var price = +p.firstRate;
    for (var i = 1; i < p.maxLots; i++) price = intervalDown(price, p.buyIntType, p.buyInt);
    return r2(price);
  }

  function addTrade(state, t) {
    t.id = 't' + (state.seq++);
    state.trades.unshift(t);
    if (state.trades.length > 5000) state.trades.length = 5000;
    return t;
  }

  /* 가상 체결. 실거래 연동 시 이 함수를 증권사 주문으로 교체합니다. */
  function fillBuy(state, s, q, now) {
    var price = q.ask;
    var qty = s.amtType === 'fx' ? floor2(s.amount) : qtyFor(s.amount, price, s.cur);
    if (qty <= 0) { s.msg = '주문 수량이 0입니다'; return false; }
    var cost = fxValue(qty, price, s.cur);
    if (cost > state.cash) { s.msg = '예수금 부족 (필요 ' + cost.toLocaleString() + '원)'; return false; }
    var n = s.lots.length + 1;
    state.cash -= cost;
    s.lots.push({ n: n, price: price, qty: qty, cost: cost, ts: now });
    if (s.anchor == null) s.anchor = price;
    s.stats.buys++; s.stats.boughtKrw += cost;
    s.soldIdx = s.soldIdx.filter(function (x) { return x !== n; });
    s.msg = '';
    addTrade(state, { ts: now, sid: s.id, sname: s.name, cur: s.cur, n: n, side: 'buy', price: price, qty: qty, krw: cost, pnl: null, kind: 'auto' });
    return true;
  }

  function fillSell(state, s, idx, q, now) {
    var lot = s.lots[idx];
    var price = q.bid;
    var proceeds = fxValue(lot.qty, price, s.cur);
    var pnl = proceeds - lot.cost;
    state.cash += proceeds;
    s.lots.splice(idx, 1);
    if (s.soldIdx.indexOf(lot.n) < 0) s.soldIdx.push(lot.n);
    if (!s.soldAt) s.soldAt = {};
    s.soldAt[lot.n] = lot.price;
    s.stats.sells++; s.stats.soldCost += lot.cost; s.stats.soldProceeds += proceeds; s.stats.realized += pnl;
    addTrade(state, { ts: now, sid: s.id, sname: s.name, cur: s.cur, n: lot.n, side: 'sell', price: price, qty: lot.qty, krw: proceeds, pnl: pnl, buyPrice: lot.price, kind: 'auto' });
  }

  function stepStrategy(state, s, now) {
    if (s.status !== 'running') return;
    var q = quote(state, s.cur);

    // 1) 매도: 조건 맞는 보유 차수 모두
    var sold = false;
    if (state.switches.sell) {
      for (var i = s.lots.length - 1; i >= 0; i--) {
        if (q.bid >= sellTarget(s, s.lots[i])) { fillSell(state, s, i, q, now); sold = true; }
      }
    }

    // 2) 다 팔렸고 재매수 안 하는 전략이면 완료
    if (s.lots.length === 0 && s.stats.buys > 0 && !s.rebuy) { s.status = 'done'; s.msg = '전 차수 매도 완료'; return; }

    // 3) 매수: 한 틱에 한 차수, 매도가 일어난 틱에는 사지 않음
    if (!state.switches.buy || sold) return;
    var n = s.lots.length + 1;
    if (n > s.maxLots) return;
    var isRebuy = s.soldIdx.indexOf(n) >= 0;
    if (isRebuy && !(s.rebuy && state.switches.rebuy)) return;
    var target = nextBuyTarget(s);
    if (target == null ? (s.mode === 'now') : (q.ask <= target)) fillBuy(state, s, q, now);
  }

  function step(state, now) {
    now = now || Date.now();
    for (var i = 0; i < state.strategies.length; i++) stepStrategy(state, state.strategies[i], now);
  }

  /* 전략 강제 종료: 보유 차수 전량 매도 후 완료 처리 */
  function liquidate(state, s, now) {
    now = now || Date.now();
    var q = quote(state, s.cur);
    while (s.lots.length) fillSell(state, s, s.lots.length - 1, q, now);
    s.status = 'done'; s.msg = '수동 종료';
  }

  /* ---------- 바로환전(수동) ---------- */
  function manualBuy(state, cur, krw, now) {
    now = now || Date.now();
    var q = quote(state, cur);
    var qty = qtyFor(krw, q.ask, cur);
    var cost = fxValue(qty, q.ask, cur);
    if (qty <= 0) return { ok: false, msg: '금액이 너무 작습니다' };
    if (cost > state.cash) return { ok: false, msg: '예수금이 부족합니다' };
    state.cash -= cost;
    var m = state.manual[cur] || (state.manual[cur] = { qty: 0, cost: 0, realized: 0, soldCost: 0, soldProceeds: 0, boughtKrw: 0 });
    m.qty = r2(m.qty + qty); m.cost += cost; m.boughtKrw += cost;
    addTrade(state, { ts: now, sid: 'manual', sname: '직접환전', cur: cur, n: null, side: 'buy', price: q.ask, qty: qty, krw: cost, pnl: null, kind: 'manual' });
    return { ok: true, qty: qty, krw: cost };
  }

  function manualSell(state, cur, qty, now) {
    now = now || Date.now();
    var m = state.manual[cur];
    qty = floor2(qty);
    if (!m || qty <= 0 || qty > m.qty + 1e-9) return { ok: false, msg: '보유 수량을 넘었습니다' };
    var q = quote(state, cur);
    var proceeds = fxValue(qty, q.bid, cur);
    var costPart = Math.round(m.cost * qty / m.qty);
    var pnl = proceeds - costPart;
    m.qty = r2(m.qty - qty); m.cost -= costPart;
    if (m.qty <= 0) { m.qty = 0; m.cost = 0; }
    m.realized += pnl; m.soldCost += costPart; m.soldProceeds += proceeds;
    state.cash += proceeds;
    addTrade(state, { ts: now, sid: 'manual', sname: '직접환전', cur: cur, n: null, side: 'sell', price: q.bid, qty: qty, krw: proceeds, pnl: pnl, kind: 'manual' });
    return { ok: true, krw: proceeds, pnl: pnl };
  }

  /* ---------- 집계 ---------- */
  function summary(state) {
    var out = { cash: state.cash, cur: {}, total: null };
    Object.keys(CURRENCIES).forEach(function (c) {
      out.cur[c] = { soldCost: 0, soldProceeds: 0, realized: 0, heldQty: 0, heldCost: 0, value: 0, unrealized: 0, boughtKrw: 0 };
    });
    state.strategies.forEach(function (s) {
      var o = out.cur[s.cur], q = quote(state, s.cur);
      o.soldCost += s.stats.soldCost; o.soldProceeds += s.stats.soldProceeds; o.realized += s.stats.realized; o.boughtKrw += s.stats.boughtKrw;
      s.lots.forEach(function (l) { o.heldQty += l.qty; o.heldCost += l.cost; o.value += fxValue(l.qty, q.bid, s.cur); });
    });
    Object.keys(state.manual).forEach(function (c) {
      var m = state.manual[c], o = out.cur[c], q = quote(state, c);
      o.soldCost += m.soldCost; o.soldProceeds += m.soldProceeds; o.realized += m.realized; o.boughtKrw += m.boughtKrw;
      o.heldQty += m.qty; o.heldCost += m.cost; o.value += fxValue(m.qty, q.bid, c);
    });
    var t = { soldCost: 0, soldProceeds: 0, realized: 0, heldCost: 0, value: 0, unrealized: 0, boughtKrw: 0 };
    Object.keys(out.cur).forEach(function (c) {
      var o = out.cur[c];
      o.heldQty = r2(o.heldQty);
      o.unrealized = o.value - o.heldCost;
      Object.keys(t).forEach(function (k) { t[k] += o[k]; });
    });
    t.unrealized = t.value - t.heldCost;
    t.equity = state.cash + t.value;
    out.total = t;
    return out;
  }

  function strategySummary(state, s) {
    var q = quote(state, s.cur), cost = 0, qty = 0, value = 0;
    s.lots.forEach(function (l) { cost += l.cost; qty += l.qty; value += fxValue(l.qty, q.bid, s.cur); });
    return { cost: cost, qty: r2(qty), value: value, unrealized: value - cost, pct: cost ? (value - cost) / cost * 100 : 0 };
  }

  var api = {
    CURRENCIES: CURRENCIES, defaultState: defaultState, quote: quote, randomWalk: randomWalk,
    createStrategy: createStrategy, strategyName: strategyName, step: step, stepStrategy: stepStrategy,
    nextBuyTarget: nextBuyTarget, sellTarget: sellTarget, ladder: ladder, ladderBottom: ladderBottom,
    liquidate: liquidate, manualBuy: manualBuy, manualSell: manualSell,
    summary: summary, strategySummary: strategySummary, fxValue: fxValue, qtyFor: qtyFor, r2: r2
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SplitEngine = api;
})(this);
