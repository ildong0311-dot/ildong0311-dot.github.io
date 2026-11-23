/* 화면 로직. 매매 판단은 전부 engine.js(SplitEngine)에 있습니다. */
(function () {
  'use strict';
  var E = window.SplitEngine, C = E.CURRENCIES, CURS = Object.keys(C);
  var KEY = 'fxsplit.v1';
  var state = load();
  var ui = { view: 'home', sel: null, curFilter: 'all', stFilter: 'run', tMode: 'order', tPeriod: 'all', tFrom: '', tTo: '', tSid: 'all', form: null };
  var timer = null, lastTick = Date.now();

  /* ---------- 저장 ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw), d = E.defaultState();
        s.settings = Object.assign(d.settings, s.settings || {});
        s.settings.spread = Object.assign(d.settings.spread, (s.settings || {}).spread || {});
        s.switches = Object.assign(d.switches, s.switches || {});
        s.rates = Object.assign(d.rates, s.rates || {});
        s.manual = s.manual || {}; s.trades = s.trades || []; s.strategies = s.strategies || [];
        return s;
      }
    } catch (e) { /* 저장소 사용 불가 → 새로 시작 */ }
    return E.defaultState();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { } }

  /* ---------- 유틸 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function won(n) { return Math.round(n).toLocaleString('ko-KR'); }
  function rate(n) { return (+n).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fx(n) { return (+n).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function signed(n, f) { f = f || won; return '<span class="' + (n > 0 ? 'up' : n < 0 ? 'down' : '') + '">' + (n > 0 ? '+' : '') + f(n) + '</span>'; }
  function pct(n) { return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function dt(ts) { var d = new Date(ts); function p(x) { return (x < 10 ? '0' : '') + x; } return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }
  function day(ts) { return dt(ts).slice(0, 10); }
  function curLabel(c) { return '<span class="flag">' + C[c].flag + '</span>' + c + (C[c].unit !== 1 ? ' <span class="meta">(' + C[c].unit + '엔당)</span>' : ''); }
  var toastT;
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2200); }

  /* ---------- 내비게이션 ---------- */
  var ICON = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    quick: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    add: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>',
    status: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    trades: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'
  };
  var VIEWS = [
    ['home', '홈', '홈'], ['quick', '바로환전하기', '바로환전'], ['add', '자동분할투자하기', '전략추가'],
    ['status', '분할현황', '분할현황'], ['trades', '세부거래내역', '거래내역'], ['settings', '계좌·시세 설정', '설정']
  ];
  function svg(k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[k] + '</svg>'; }
  function renderNav() {
    $('#nav').innerHTML = VIEWS.map(function (v) { return '<a data-go="' + v[0] + '" class="' + (ui.view === v[0] ? 'on' : '') + '">' + svg(v[0]) + v[1] + '</a>'; }).join('');
    $('#tabs').innerHTML = VIEWS.map(function (v) { return '<a data-go="' + v[0] + '" class="' + (ui.view === v[0] ? 'on' : '') + '">' + svg(v[0]) + v[2] + '</a>'; }).join('');
  }
  function go(v) {
    ui.view = v;
    try { sessionStorage.setItem('fxsplit.view', v); } catch (e) { }
    renderNav();
    $('#title').textContent = VIEWS.filter(function (x) { return x[0] === v; })[0][1];
    render(true);
    window.scrollTo(0, 0);
  }

  /* ---------- 공통 카드 ---------- */
  function rateCard(c) {
    var q = E.quote(state, c);
    return '<div class="card"><h3>' + curLabel(c) + '</h3><div class="rate"><div><div class="meta">기준</div><div class="mid num">' + rate(q.mid) + '</div></div>' +
      '<div class="sb num"><div>살때<b>' + rate(q.ask) + '</b></div><div>팔때<b>' + rate(q.bid) + '</b></div></div></div>' +
      '<div class="meta" style="margin-top:8px">' + (state.settings.simulate ? '시뮬레이션 시세' : '시세 고정') + ' · ' + dt(lastTick) + '</div></div>';
  }

  /* ---------- 홈 ---------- */
  function vHome() {
    var S = E.summary(state), T = S.total;
    var h = '<div class="sec">환율</div><div class="grid">' + CURS.map(rateCard).join('') + '</div>';
    h += '<div class="sec">누적 확정손익</div><div class="grid">';
    h += '<div class="card"><h3>전체</h3><div class="kv">' +
      '<div><label>판 차수 매입원가(원)</label><b class="num">' + won(T.soldCost) + '</b></div>' +
      '<div><label>매도금액(원)</label><b class="num">' + won(T.soldProceeds) + '</b></div>' +
      '<div><label>총 매수금액(원)</label><b class="num">' + won(T.boughtKrw) + '</b></div>' +
      '<div><label>확정손익(원)</label><b class="num">' + signed(T.realized) + '</b></div></div></div>';
    CURS.forEach(function (c) {
      var o = S.cur[c];
      h += '<div class="card"><h3>' + curLabel(c) + '</h3><div class="kv">' +
        '<div><label>판 차수 매입원가(원)</label><b class="num">' + won(o.soldCost) + '</b></div>' +
        '<div><label>매도금액(원)</label><b class="num">' + won(o.soldProceeds) + '</b></div>' +
        '<div><label>총 매수금액(원)</label><b class="num">' + won(o.boughtKrw) + '</b></div>' +
        '<div><label>확정손익(원)</label><b class="num">' + signed(o.realized) + '</b></div></div></div>';
    });
    h += '</div><p class="note">확정손익 = 매도금액 − 그 차수를 샀던 원가. 아직 안 판 보유분은 아래 투자현황(평가손익)에만 들어갑니다.</p>';
    h += '<div class="sec">투자현황</div><div class="grid">';
    h += '<div class="card"><h3>예수금 · 총자산</h3><div class="kv"><div><label>예수금 KRW(원)</label><b class="num">' + won(state.cash) + '</b></div>' +
      '<div><label>총 평가손익(원)</label><b class="num">' + signed(T.unrealized) + '</b></div></div>' +
      '<div class="big num">' + won(T.equity) + '<span class="meta"> 원</span></div><div class="meta" style="text-align:right">예수금 + 보유 외화 평가금액</div></div>';
    CURS.forEach(function (c) {
      var o = S.cur[c], avg = o.heldQty ? o.heldCost / o.heldQty * C[c].unit : 0;
      h += '<div class="card"><h3>' + curLabel(c) + '</h3><div class="kv">' +
        '<div><label>매입금액(원)</label><b class="num">' + won(o.heldCost) + '</b></div>' +
        '<div><label>평가금액(원)</label><b class="num">' + won(o.value) + '</b></div>' +
        '<div><label>보유(' + c + ') · 평균 ' + (avg ? rate(avg) : '-') + '</label><b class="num">' + fx(o.heldQty) + '</b></div>' +
        '<div><label>평가손익(원)</label><b class="num">' + signed(o.unrealized) + (o.heldCost ? ' <span class="meta">' + pct(o.unrealized / o.heldCost * 100) + '</span>' : '') + '</b></div></div></div>';
    });
    return h + '</div>';
  }

  /* ---------- 바로환전 ---------- */
  function vQuick() {
    var h = '<div class="grid">';
    CURS.forEach(function (c) {
      var q = E.quote(state, c), m = state.manual[c] || { qty: 0, cost: 0 };
      h += '<div class="card"><h3>' + curLabel(c) + '<span class="meta" style="margin-left:auto">우대 반영 스프레드 ±' + state.settings.spread[c] + '원</span></h3>' +
        '<div class="qbtns"><div class="qbtn" style="background:var(--buy)"><small>살때</small><b class="num" data-live="ask-' + c + '">' + rate(q.ask) + '</b></div>' +
        '<div class="qbtn" style="background:var(--sell)"><small>팔때</small><b class="num" data-live="bid-' + c + '">' + rate(q.bid) + '</b></div></div>' +
        '<div class="field"><span>매수 금액</span><input class="num" inputmode="numeric" data-qb="' + c + '" placeholder="0"><em>원</em></div>' +
        '<div class="row" style="margin-bottom:10px"><button class="btn sm" data-qadd="' + c + ':100000">+10만</button><button class="btn sm" data-qadd="' + c + ':1000000">+100만</button><button class="btn sm" data-qadd="' + c + ':0">초기화</button><button class="btn buy" style="margin-left:auto" data-qbuy="' + c + '">매수하기</button></div>' +
        '<div class="field"><span>매도 수량</span><input class="num" inputmode="decimal" data-qs="' + c + '" placeholder="0.00"><em>' + c + '</em></div>' +
        '<div class="row"><span class="note">직접환전 보유 <b class="num" data-live="mq-' + c + '">' + fx(m.qty) + '</b> ' + c + '</span><button class="btn sm" data-qall="' + c + '">전량</button><button class="btn sell" style="margin-left:auto" data-qsell="' + c + '">매도하기</button></div>' +
        '</div>';
    });
    return h + '</div><p class="note">바로환전으로 산 외화는 분할 전략과 따로 "직접환전"으로 관리되며 자동매도되지 않습니다. 예수금 ' + '<b class="num" data-live="cash">' + won(state.cash) + '</b>원</p>';
  }

  /* ---------- 전략 추가 ---------- */
  function newForm(c) {
    c = c || 'USD';
    var q = E.quote(state, c);
    return { cur: c, mode: 'reserve', maxLots: 50, firstRate: q.ask, amtType: 'krw', amount: 50000, buyIntType: 'won', buyInt: c === 'JPY' ? 1 : 2, sellIntType: 'won', sellInt: 2, rebuy: true, name: '' };
  }
  function vAdd() {
    var f = ui.form || (ui.form = newForm());
    var h = '<div class="two"><div class="card">';
    h += '<div class="curpick">' + CURS.map(function (c) {
      var q = E.quote(state, c);
      return '<button data-fcur="' + c + '" class="' + (f.cur === c ? 'on' : '') + '"><b>' + C[c].flag + ' ' + c + '</b><small>살때 <span class="num" data-live="ask-' + c + '">' + rate(q.ask) + '</span></small><small>팔때 <span class="num" data-live="bid-' + c + '">' + rate(q.bid) + '</span></small></button>';
    }).join('') + '</div>';
    h += '<div class="field"><span>전략이름</span><input data-f="name" placeholder="' + esc(E.strategyName(f)) + '" value="' + esc(f.name) + '" style="text-align:left;font-size:13px"></div>';
    h += '<div class="field"><span>환전 방식</span><select data-f="mode"><option value="reserve"' + (f.mode === 'reserve' ? ' selected' : '') + '>예약환전 (목표가 도달 시 1차수)</option><option value="now"' + (f.mode === 'now' ? ' selected' : '') + '>즉시환전 (지금 1차수)</option></select></div>';
    h += '<div class="field"><span>최대차수</span><input class="num" data-f="maxLots" inputmode="numeric" value="' + f.maxLots + '"><em>차</em></div>';
    if (f.mode === 'reserve') h += '<div class="field"><span>1차수 환율예약</span><input class="num" data-f="firstRate" inputmode="decimal" value="' + f.firstRate + '"><em>원</em><button class="btn sm" data-fnow>현재가</button></div>';
    h += '<div class="field"><span>차수별 금액</span><input class="num" data-f="amount" inputmode="decimal" value="' + f.amount + '"><div class="seg" data-fseg="amtType"><button data-v="krw" class="' + (f.amtType === 'krw' ? 'on' : '') + '">원</button><button data-v="fx" class="' + (f.amtType === 'fx' ? 'on' : '') + '">' + f.cur + '</button></div></div>';
    if (f.amtType === 'krw') h += '<div class="row" style="margin:-2px 0 10px"><button class="btn sm" data-famt="-100000">-10만원</button><button class="btn sm" data-famt="-50000">-5만원</button><button class="btn sm" data-famt="50000">+5만원</button><button class="btn sm" data-famt="100000">+10만원</button></div>';
    h += '<div class="field"><span>매수간격</span><input class="num" data-f="buyInt" inputmode="decimal" value="' + f.buyInt + '"><div class="seg" data-fseg="buyIntType"><button data-v="won" class="' + (f.buyIntType === 'won' ? 'on' : '') + '">원</button><button data-v="pct" class="' + (f.buyIntType === 'pct' ? 'on' : '') + '">%</button></div></div>';
    h += '<div class="field"><span>매도간격</span><input class="num" data-f="sellInt" inputmode="decimal" value="' + f.sellInt + '"><div class="seg" data-fseg="sellIntType"><button data-v="won" class="' + (f.sellIntType === 'won' ? 'on' : '') + '">원</button><button data-v="pct" class="' + (f.sellIntType === 'pct' ? 'on' : '') + '">%</button></div></div>';
    h += '<div class="field"><span>재매수</span><em style="flex:1;text-align:right">매도된 차수를 다시 살까요?</em><div class="seg" data-fseg="rebuy"><button data-v="1" class="' + (f.rebuy ? 'on' : '') + '">켬</button><button data-v="0" class="' + (!f.rebuy ? 'on' : '') + '">끔</button></div></div>';
    h += '<div class="row" style="margin-top:12px"><button class="btn pri" data-fsave style="flex:1">전략 저장 · 시작</button><button class="btn" data-freset>초기화</button></div>';
    h += '</div><div class="card" id="preview">' + previewHtml(f) + '</div></div>';
    return h;
  }
  function previewHtml(f) {
    var q = E.quote(state, f.cur);
    var p = Object.assign({}, f, { firstRate: f.mode === 'now' ? q.ask : +f.firstRate, maxLots: Math.max(1, f.maxLots | 0) });
    var perLot = f.amtType === 'krw' ? +f.amount : E.fxValue(+f.amount, p.firstRate, f.cur);
    var total = perLot * p.maxLots;
    var bottom = E.ladderBottom(p), width = p.firstRate - bottom, widthPct = p.firstRate ? width / p.firstRate * 100 : 0;
    var h = '<h3>미리보기</h3><div class="kv" style="margin-bottom:10px">' +
      '<div><label>예수금(원)</label><b class="num" data-live="cash">' + won(state.cash) + '</b></div>' +
      '<div><label>전 차수 매수 시 필요금액(원)</label><b class="num">' + won(total) + '</b></div>' +
      '<div><label>매수 구간</label><b class="num">' + rate(p.firstRate) + ' → ' + rate(bottom) + '</b></div>' +
      '<div><label>구간 폭</label><b class="num">' + rate(width) + '원 (' + widthPct.toFixed(2) + '%)</b></div></div>';
    if (p.maxLots > 1 && widthPct < 1) h += '<div class="warn">' + p.maxLots + '개 차수가 ' + rate(width) + '원 안에 몰려 있어요. 환율이 조금만 내려도 한꺼번에 사지기 때문에 나눠 사는 효과가 거의 없습니다. 매수간격을 넓혀 보세요.</div>';
    if (total > state.cash) h += '<div class="warn">전 차수를 다 사려면 예수금이 ' + won(total - state.cash) + '원 모자랍니다. 모자라면 그 차수부터는 매수되지 않습니다.</div>';
    if (f.mode === 'reserve' && p.firstRate < q.ask) h += '<div class="note" style="margin-bottom:8px">지금 살때 환율(' + rate(q.ask) + ')이 1차수 예약가보다 높아서, 내려올 때까지 기다립니다.</div>';
    var L = E.ladder(p, p.maxLots), show = L.length > 12 ? L.slice(0, 8).concat([null]).concat(L.slice(-3)) : L;
    h += '<div class="tw"><table class="tbl"><thead><tr><th>차수</th><th>매수 목표가</th><th>매도 목표가</th><th>금액(원)</th></tr></thead><tbody>' + show.map(function (r) {
      if (!r) return '<tr><td colspan="4" class="l meta">…</td></tr>';
      var amt = f.amtType === 'krw' ? +f.amount : E.fxValue(+f.amount, r.buy, f.cur);
      return '<tr><td>' + r.n + '차</td><td class="num">' + rate(r.buy) + '</td><td class="num">' + rate(r.sell) + '</td><td class="num">' + won(amt) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    return h;
  }

  /* ---------- 분할현황 ---------- */
  function vStatus() {
    var list = state.strategies.filter(function (s) {
      return (ui.curFilter === 'all' || s.cur === ui.curFilter) && (ui.stFilter === 'all' || (ui.stFilter === 'run' ? s.status !== 'done' : s.status === 'done'));
    });
    var agg = { cost: 0, value: 0, qty: 0 };
    list.forEach(function (s) { var x = E.strategySummary(state, s); agg.cost += x.cost; agg.value += x.value; });
    if (!ui.sel || !state.strategies.some(function (s) { return s.id === ui.sel; })) ui.sel = list[0] ? list[0].id : null;
    var h = '<div class="two"><div class="card"><div class="row" style="margin-bottom:10px"><b style="flex:1">진행내역</b>' +
      '<select class="inp" data-sf="cur"><option value="all">전체 통화</option>' + CURS.map(function (c) { return '<option value="' + c + '"' + (ui.curFilter === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' +
      '<select class="inp" data-sf="st"><option value="run"' + (ui.stFilter === 'run' ? ' selected' : '') + '>진행</option><option value="done"' + (ui.stFilter === 'done' ? ' selected' : '') + '>완료</option><option value="all"' + (ui.stFilter === 'all' ? ' selected' : '') + '>전체</option></select></div>';
    h += '<div class="kv" style="margin-bottom:12px;padding:12px;background:var(--panel2);border-radius:12px"><div><label>매입금액(원)</label><b class="num">' + won(agg.cost) + '</b></div><div><label>평가금액(원)</label><b class="num">' + won(agg.value) + '</b></div>' +
      '<div><label>전략 수</label><b>' + list.length + '</b></div><div><label>평가손익</label><b class="num">' + signed(agg.value - agg.cost) + (agg.cost ? ' <span class="meta">' + pct((agg.value - agg.cost) / agg.cost * 100) + '</span>' : '') + '</b></div></div>';
    h += '<div class="slist">' + (list.length ? list.map(function (s) {
      var x = E.strategySummary(state, s);
      return '<div class="sitem' + (s.id === ui.sel ? ' on' : '') + '" data-sel="' + s.id + '"><div class="h"><span>' + day(s.createdAt) + ' <span class="tag ' + (s.status === 'running' ? 'run' : s.status === 'done' ? 'done' : '') + '">' + ({ running: '진행', paused: '일시정지', done: '완료' })[s.status] + '</span></span>' +
        '<span class="badges" title="보유 / 매도 횟수 / 남은 차수 / 최대"><span class="bd r">' + s.lots.length + '</span><span class="bd o">' + s.stats.sells + '</span><span class="bd g">' + (s.maxLots - s.lots.length) + '</span><span class="bd gr">' + s.maxLots + '</span></span></div>' +
        '<div class="m"><span>' + C[s.cur].flag + ' ' + s.cur + '</span><span class="num">' + won(x.value) + '</span></div>' +
        '<div class="n"><span>' + esc(s.name) + '</span><span class="num">' + signed(x.unrealized) + (x.cost ? '(' + pct(x.pct) + ')' : '') + '</span></div>' +
        (s.msg ? '<div class="note" style="color:var(--warn);margin-top:4px">' + esc(s.msg) + '</div>' : '') + '</div>';
    }).join('') : '<div class="empty">전략이 없습니다</div>') + '</div>';
    h += '<button class="btn pri" style="width:100%;margin-top:12px" data-go="add">전략 추가하기</button></div>';
    h += '<div class="card">' + detailHtml(state.strategies.filter(function (s) { return s.id === ui.sel; })[0]) + '</div></div>';
    h += '<p class="note">배지: <span class="bd r" style="display:inline-block">보유</span> <span class="bd o" style="display:inline-block">매도 횟수</span> <span class="bd g" style="display:inline-block">남은 차수</span> <span class="bd gr" style="display:inline-block">최대</span></p>';
    return h;
  }
  function detailHtml(s) {
    if (!s) return '<div class="empty">왼쪽에서 전략을 선택하세요</div>';
    var q = E.quote(state, s.cur), x = E.strategySummary(state, s), nt = E.nextBuyTarget(s);
    var unitB = s.buyIntType === 'pct' ? '%' : '원', unitS = s.sellIntType === 'pct' ? '%' : '원';
    var h = '<h3>' + C[s.cur].flag + ' ' + esc(s.name) + '</h3>';
    h += '<div class="kv" style="margin-bottom:12px">' +
      '<div><label>매입금액(원)</label><b class="num">' + won(x.cost) + '</b></div><div><label>평가금액(원)</label><b class="num">' + won(x.value) + '</b></div>' +
      '<div><label>보유(' + s.cur + ')</label><b class="num">' + fx(x.qty) + '</b></div><div><label>평가손익</label><b class="num">' + signed(x.unrealized) + '</b></div>' +
      '<div><label>확정손익(원)</label><b class="num">' + signed(s.stats.realized) + '</b></div><div><label>매수/매도 체결</label><b>' + s.stats.buys + ' / ' + s.stats.sells + '회</b></div>' +
      '<div><label>다음 매수 (' + (s.lots.length + 1) + '차)</label><b class="num">' + (s.lots.length >= s.maxLots ? '최대 차수 도달' : nt == null ? '즉시' : rate(nt) + ' 이하') + '</b></div>' +
      '<div><label>현재 살때 / 팔때</label><b class="num">' + rate(q.ask) + ' / ' + rate(q.bid) + '</b></div></div>';
    h += '<div class="note" style="margin-bottom:10px">' + (s.mode === 'now' ? '즉시환전' : '예약환전 ' + rate(s.firstRate)) + ' · 최대 ' + s.maxLots + '차 · ' + (s.amtType === 'krw' ? won(s.amount) + '원' : s.amount + ' ' + s.cur) + '/차 · 매수간격 ' + s.buyInt + unitB + ' · 매도간격 ' + s.sellInt + unitS + ' · 재매수 ' + (s.rebuy ? '켬' : '끔') + '</div>';
    if (s.msg) h += '<div class="warn">' + esc(s.msg) + '</div>';
    h += '<div class="row" style="margin-bottom:12px">';
    if (s.status === 'running') h += '<button class="btn sm" data-sact="pause:' + s.id + '">일시정지</button>';
    if (s.status === 'paused') h += '<button class="btn sm ok" data-sact="resume:' + s.id + '">재개</button>';
    if (s.status !== 'done') h += '<button class="btn sm" data-sact="liq:' + s.id + '">' + (s.lots.length ? '전량매도 후 종료' : '종료') + '</button>';
    if (s.status === 'done') h += '<button class="btn sm" data-sact="del:' + s.id + '">목록에서 삭제</button>';
    h += '</div>';
    h += '<div class="tw"><table class="tbl"><thead><tr><th>차수</th><th>매수가</th><th>수량</th><th>원가(원)</th><th>매도목표</th><th>평가손익</th></tr></thead><tbody>';
    if (!s.lots.length) h += '<tr><td colspan="6" class="empty">보유 차수 없음</td></tr>';
    s.lots.slice().reverse().forEach(function (l) {
      var v = E.fxValue(l.qty, q.bid, s.cur) - l.cost;
      h += '<tr><td>' + l.n + '차</td><td class="num">' + rate(l.price) + '</td><td class="num">' + fx(l.qty) + '</td><td class="num">' + won(l.cost) + '</td><td class="num">' + rate(E.sellTarget(s, l)) + '</td><td class="num">' + signed(v) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ---------- 세부거래내역 ---------- */
  function filteredTrades() {
    var from = ui.tFrom ? new Date(ui.tFrom + 'T00:00:00').getTime() : 0;
    var to = ui.tTo ? new Date(ui.tTo + 'T23:59:59').getTime() : Infinity;
    var now = Date.now(), span = { day: 864e5, week: 7 * 864e5, month: 31 * 864e5 }[ui.tPeriod];
    if (span) from = Math.max(from, now - span);
    return state.trades.filter(function (t) {
      if (t.ts < from || t.ts > to) return false;
      if (ui.tSid !== 'all' && t.sid !== ui.tSid) return false;
      if (ui.tMode === 'pnl' && t.side !== 'sell') return false;
      return true;
    });
  }
  function vTrades() {
    var S = E.summary(state);
    var h = '<div class="grid" style="margin-bottom:14px"><div class="card"><h3>투자수익 (전체)</h3><div class="kv"><div><label>판 차수 매입원가</label><b class="num">' + won(S.total.soldCost) + '</b></div><div><label>매도금액</label><b class="num">' + won(S.total.soldProceeds) + '</b></div><div><label>보유 매입금액</label><b class="num">' + won(S.total.heldCost) + '</b></div><div><label>확정손익</label><b class="num">' + signed(S.total.realized) + '</b></div></div></div>';
    CURS.forEach(function (c) { var o = S.cur[c]; h += '<div class="card"><h3>' + curLabel(c) + '</h3><div class="kv"><div><label>판 차수 매입원가</label><b class="num">' + won(o.soldCost) + '</b></div><div><label>매도금액</label><b class="num">' + won(o.soldProceeds) + '</b></div><div><label>보유(' + c + ')</label><b class="num">' + fx(o.heldQty) + '</b></div><div><label>확정손익</label><b class="num">' + signed(o.realized) + '</b></div></div></div>'; });
    h += '</div><div class="card"><div class="row" style="margin-bottom:10px">' +
      '<div class="seg" data-tseg="tMode"><button data-v="order" class="' + (ui.tMode === 'order' ? 'on' : '') + '">주문내역</button><button data-v="pnl" class="' + (ui.tMode === 'pnl' ? 'on' : '') + '">손익내역</button></div>' +
      '<div class="seg" data-tseg="tPeriod">' + [['day', '일'], ['week', '주'], ['month', '월'], ['all', '전체']].map(function (p) { return '<button data-v="' + p[0] + '" class="' + (ui.tPeriod === p[0] ? 'on' : '') + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<input type="date" class="inp" data-tf="tFrom" value="' + ui.tFrom + '"><input type="date" class="inp" data-tf="tTo" value="' + ui.tTo + '">' +
      '<select class="inp" data-tf="tSid"><option value="all">전체 전략</option><option value="manual"' + (ui.tSid === 'manual' ? ' selected' : '') + '>직접환전</option>' + state.strategies.map(function (s) { return '<option value="' + s.id + '"' + (ui.tSid === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>' +
      '<button class="btn sm" data-csv style="margin-left:auto">CSV 내려받기</button></div><div id="tbody">' + tradesTable() + '</div></div>';
    return h;
  }
  function tradesTable() {
    var list = filteredTrades(), shown = list.slice(0, 300);
    var sum = list.reduce(function (a, t) { return a + (t.pnl || 0); }, 0);
    var h = '<div class="note" style="margin-bottom:6px">' + list.length + '건' + (ui.tMode === 'pnl' ? ' · 확정손익 합계 ' + signed(sum) + '원' : '') + (list.length > 300 ? ' · 최근 300건 표시' : '') + '</div>';
    h += '<div class="tw"><table class="tbl"><thead><tr><th>주문일자</th><th class="l">전략</th><th>통화</th><th>차수</th><th>구분</th><th>체결가격</th><th>체결수량</th><th>금액(원)</th><th>' + (ui.tMode === 'pnl' ? '매수가' : '유형') + '</th><th>손익(원)</th></tr></thead><tbody>';
    if (!shown.length) h += '<tr><td colspan="10" class="empty">거래가 없습니다</td></tr>';
    shown.forEach(function (t) {
      h += '<tr><td class="num">' + dt(t.ts) + '</td><td class="l nm" title="' + esc(t.sname) + '">' + esc(t.sname) + '</td><td>' + t.cur + '</td><td>' + (t.n ? t.n + '회' : '-') + '</td><td class="' + (t.side === 'buy' ? 'up' : 'down') + '">' + (t.side === 'buy' ? '매수' : '매도') + '</td>' +
        '<td class="num">' + rate(t.price) + '</td><td class="num">' + fx(t.qty) + '</td><td class="num">' + won(t.krw) + '</td><td class="num">' + (ui.tMode === 'pnl' ? (t.buyPrice ? rate(t.buyPrice) : '평균') : (t.kind === 'manual' ? '직접' : '자동')) + '</td><td class="num">' + (t.pnl == null ? '-' : signed(t.pnl)) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }
  function downloadCsv() {
    var rows = [['주문일자', '전략', '통화', '차수', '구분', '체결가격', '체결수량', '금액(원)', '손익(원)']];
    filteredTrades().forEach(function (t) { rows.push([dt(t.ts), t.sname, t.cur, t.n || '', t.side === 'buy' ? '매수' : '매도', t.price, t.qty, t.krw, t.pnl == null ? '' : t.pnl]); });
    var csv = '﻿' + rows.map(function (r) { return r.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = '거래내역_' + day(Date.now()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- 설정 ---------- */
  function vSettings() {
    var st = state.settings;
    var h = '<div class="two"><div class="card"><h3>계좌 (가상)</h3>' +
      '<div class="field"><span>예수금</span><b class="num" style="margin-left:auto" data-live="cash">' + won(state.cash) + '</b><em>원</em></div>' +
      '<div class="field"><span>입금/출금</span><input class="num" id="depAmt" inputmode="numeric" placeholder="금액"><em>원</em></div>' +
      '<div class="row"><button class="btn pri" data-dep="1">입금</button><button class="btn" data-dep="-1">출금</button></div>' +
      '<h3 style="margin-top:20px">데이터</h3><div class="row"><button class="btn" data-export>백업 내려받기</button><label class="btn" style="cursor:pointer">백업 불러오기<input type="file" accept=".json" id="importFile" hidden></label><button class="btn" data-reset style="color:var(--up)">전체 초기화</button></div>' +
      '<p class="note">모든 데이터는 이 기기 브라우저에만 저장됩니다. 다른 기기로 옮기려면 백업 파일을 쓰세요.</p></div>';
    h += '<div class="card"><h3>시세</h3>' +
      '<div class="field"><span>자동 시세 변동</span><div class="seg" data-sset="simulate" style="margin-left:auto"><button data-v="1" class="' + (st.simulate ? 'on' : '') + '">켬</button><button data-v="0" class="' + (!st.simulate ? 'on' : '') + '">끔</button></div></div>' +
      '<div class="field"><span>변동성(1틱)</span><input class="num" data-snum="volatility" inputmode="decimal" value="' + (st.volatility * 100) + '"><em>%</em></div>' +
      '<div class="field"><span>틱 간격</span><input class="num" data-snum="tickMs" inputmode="numeric" value="' + st.tickMs / 1000 + '"><em>초</em></div>' +
      '<div class="field"><span>배속</span><select data-snum="speed">' + [1, 5, 20, 100].map(function (x) { return '<option value="' + x + '"' + (st.speed === x ? ' selected' : '') + '>' + x + '배 (틱당 ' + x + '회)</option>'; }).join('') + '</select></div>' +
      '<button class="btn" data-fetch style="width:100%;margin-bottom:12px">실제 기준환율로 맞추기 (인터넷 조회)</button>' +
      CURS.map(function (c) {
        return '<div class="field"><span>' + C[c].flag + ' ' + c + ' 기준</span><input class="num" data-mid="' + c + '" inputmode="decimal" value="' + E.r2(state.rates[c].mid) + '"><button class="btn sm" data-nudge="' + c + ':-1">▼1</button><button class="btn sm" data-nudge="' + c + ':1">▲1</button></div>' +
          '<div class="field"><span>' + c + ' 스프레드</span><input class="num" data-spread="' + c + '" inputmode="decimal" value="' + st.spread[c] + '"><em>원(±)</em></div>';
      }).join('') +
      '<p class="note">살때 = 기준 + 스프레드, 팔때 = 기준 − 스프레드. ▼▲ 버튼으로 시세를 직접 움직여 전략이 어떻게 반응하는지 확인할 수 있습니다.</p></div></div>';
    return h;
  }

  /* ---------- 렌더 ---------- */
  var formViews = { add: 1, quick: 1, settings: 1 };
  function render(full) {
    var v = ui.view;
    if (full || !formViews[v]) {
      if (v === 'trades' && !full) { $('#tbody').innerHTML = tradesTable(); }
      else if (v === 'status' && !full && document.activeElement && document.activeElement.tagName === 'SELECT') { /* 선택 중엔 유지 */ }
      else $('#view').innerHTML = ({ home: vHome, quick: vQuick, add: vAdd, status: vStatus, trades: vTrades, settings: vSettings })[v]();
    } else {
      // 입력 화면: 실시간 값만 갱신
      CURS.forEach(function (c) {
        var q = E.quote(state, c), m = state.manual[c] || { qty: 0 };
        $$('[data-live="ask-' + c + '"]').forEach(function (e) { e.textContent = rate(q.ask); });
        $$('[data-live="bid-' + c + '"]').forEach(function (e) { e.textContent = rate(q.bid); });
        $$('[data-live="mq-' + c + '"]').forEach(function (e) { e.textContent = fx(m.qty); });
        var mi = $('[data-mid="' + c + '"]');
        if (mi && document.activeElement !== mi) mi.value = E.r2(state.rates[c].mid);
      });
      $$('[data-live="cash"]').forEach(function (e) { e.textContent = won(state.cash); });
      if (v === 'add' && ui.form && ui.form.mode === 'now') $('#preview').innerHTML = previewHtml(ui.form);
    }
    var sw = state.switches, anyOn = sw.buy || sw.sell;
    $('#swDot').className = 'dot' + (anyOn ? ' on' : '');
    $('#simDot').className = 'dot' + (state.settings.simulate ? ' on' : '');
    $('#simTxt').textContent = state.settings.simulate ? '시세 변동 중' : '시세 고정';
  }

  /* ---------- 틱 ---------- */
  function tick() {
    var n = state.settings.speed || 1, before = state.trades.length;
    for (var i = 0; i < n; i++) {
      if (state.settings.simulate) E.randomWalk(state);
      E.step(state, Date.now());
    }
    lastTick = Date.now();
    var newT = state.trades.length - before;
    if (newT > 0 && n === 1) { var t = state.trades[0]; toast(t.cur + ' ' + (t.n ? t.n + '차 ' : '') + (t.side === 'buy' ? '매수' : '매도') + ' ' + rate(t.price) + (t.pnl != null ? ' (' + (t.pnl > 0 ? '+' : '') + won(t.pnl) + '원)' : '')); }
    save(); render(false);
  }
  function restart() { clearInterval(timer); timer = setInterval(tick, Math.max(300, state.settings.tickMs)); }

  /* ---------- 자동매매 스위치 모달 ---------- */
  function renderSw() {
    var rows = [['buy', '매수주문'], ['sell', '매도주문'], ['rebuy', '재매수옵션']];
    $('#swBody').innerHTML = rows.map(function (r) {
      var on = state.switches[r[0]];
      return '<div class="swrow"><span class="dot' + (on ? ' on' : '') + '"></span><p>' + r[1] + ' ' + (on ? '실행중 입니다.' : '중지되어 있습니다.') + '</p>' +
        '<button class="btn sm ' + (on ? 'ok' : '') + '" data-sw="' + r[0] + ':1">시작</button><button class="btn sm ' + (!on ? 'ok' : '') + '" data-sw="' + r[0] + ':0">중지</button></div>';
    }).join('');
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-go],[data-sel],[data-sact],[data-fcur],[data-fseg] button,[data-famt],[data-fnow],[data-fsave],[data-freset],[data-tseg] button,[data-csv],[data-qbuy],[data-qsell],[data-qadd],[data-qall],[data-dep],[data-reset],[data-export],[data-fetch],[data-nudge],[data-sset] button,[data-sw],[data-close],#swPill,#simPill');
    if (!t) { if (e.target.id === 'swModal') $('#swModal').classList.remove('on'); return; }
    var d = t.dataset;
    if (d.go) return go(d.go);
    if (t.id === 'swPill') { renderSw(); $('#swModal').classList.add('on'); return; }
    if (t.id === 'simPill') { state.settings.simulate = !state.settings.simulate; save(); render(ui.view === 'settings'); toast(state.settings.simulate ? '시세 변동 켬' : '시세 고정'); return; }
    if (d.close != null) { $('#swModal').classList.remove('on'); return; }
    if (d.sw) { var p = d.sw.split(':'); state.switches[p[0]] = p[1] === '1'; save(); renderSw(); render(false); return; }
    if (d.sel) { ui.sel = d.sel; return render(true); }
    if (d.sact) {
      var a = d.sact.split(':'), s = state.strategies.filter(function (x) { return x.id === a[1]; })[0];
      if (!s) return;
      if (a[0] === 'pause') s.status = 'paused';
      if (a[0] === 'resume') { s.status = 'running'; s.msg = ''; }
      if (a[0] === 'liq') { if (!confirm(s.lots.length ? '보유 ' + s.lots.length + '개 차수를 현재 팔때 환율로 모두 매도하고 종료할까요?' : '이 전략을 종료할까요?')) return; E.liquidate(state, s); }
      if (a[0] === 'del') { state.strategies = state.strategies.filter(function (x) { return x !== s; }); ui.sel = null; }
      save(); return render(true);
    }
    // 전략 추가 폼
    var f = ui.form;
    if (d.fcur) { var keep = f; ui.form = newForm(d.fcur); ['mode', 'maxLots', 'amtType', 'amount', 'buyIntType', 'sellIntType', 'sellInt', 'rebuy'].forEach(function (k) { ui.form[k] = keep[k]; }); return render(true); }
    if (t.parentNode.dataset && t.parentNode.dataset.fseg) { var k = t.parentNode.dataset.fseg; f[k] = k === 'rebuy' ? t.dataset.v === '1' : t.dataset.v; return render(true); }
    if (d.famt) { f.amount = Math.max(10000, (+f.amount || 0) + (+d.famt)); return render(true); }
    if (d.fnow != null) { f.firstRate = E.quote(state, f.cur).ask; return render(true); }
    if (d.freset != null) { ui.form = newForm(f.cur); return render(true); }
    if (d.fsave != null) {
      if (!(+f.amount > 0) || !(+f.buyInt > 0) || !(+f.sellInt > 0) || !(f.maxLots >= 1) || (f.mode === 'reserve' && !(+f.firstRate > 0))) return toast('입력값을 확인하세요');
      var ns = E.createStrategy(state, { name: f.name.trim(), cur: f.cur, mode: f.mode, maxLots: +f.maxLots, firstRate: +f.firstRate, amtType: f.amtType, amount: +f.amount, buyIntType: f.buyIntType, buyInt: +f.buyInt, sellIntType: f.sellIntType, sellInt: +f.sellInt, rebuy: f.rebuy }, Date.now());
      E.stepStrategy(state, ns, Date.now());
      save(); ui.form = null; ui.sel = ns.id; ui.stFilter = 'run'; toast('전략을 저장하고 시작했습니다'); return go('status');
    }
    // 거래내역
    if (t.parentNode.dataset && t.parentNode.dataset.tseg) { ui[t.parentNode.dataset.tseg] = t.dataset.v; return render(true); }
    if (d.csv != null) return downloadCsv();
    // 바로환전
    if (d.qadd) { var qa = d.qadd.split(':'), inp = $('[data-qb="' + qa[0] + '"]'); inp.value = qa[1] === '0' ? '' : ((+inp.value.replace(/,/g, '') || 0) + (+qa[1])); return; }
    if (d.qall) { var m = state.manual[d.qall]; $('[data-qs="' + d.qall + '"]').value = m ? m.qty : 0; return; }
    if (d.qbuy) {
      var amt = +$('[data-qb="' + d.qbuy + '"]').value.replace(/,/g, '');
      var qq = E.quote(state, d.qbuy);
      if (!(amt > 0)) return toast('매수 금액을 입력하세요');
      if (!confirm(d.qbuy + ' 를 살때 ' + rate(qq.ask) + '원에 ' + won(amt) + '원어치 매수할까요?')) return;
      var r = E.manualBuy(state, d.qbuy, amt); save();
      toast(r.ok ? fx(r.qty) + ' ' + d.qbuy + ' 매수 (' + won(r.krw) + '원)' : r.msg); return render(true);
    }
    if (d.qsell) {
      var qty = +$('[data-qs="' + d.qsell + '"]').value;
      if (!(qty > 0)) return toast('매도 수량을 입력하세요');
      if (!confirm(fx(qty) + ' ' + d.qsell + ' 를 팔때 ' + rate(E.quote(state, d.qsell).bid) + '원에 매도할까요?')) return;
      var r2 = E.manualSell(state, d.qsell, qty); save();
      toast(r2.ok ? won(r2.krw) + '원 입금 (손익 ' + (r2.pnl > 0 ? '+' : '') + won(r2.pnl) + '원)' : r2.msg); return render(true);
    }
    // 설정
    if (d.dep) { var v = +$('#depAmt').value.replace(/,/g, ''); if (!(v > 0)) return toast('금액을 입력하세요'); if (d.dep === '-1' && v > state.cash) return toast('예수금보다 많이 출금할 수 없습니다'); state.cash += v * (+d.dep); save(); toast(d.dep === '1' ? '입금 완료' : '출금 완료'); return render(true); }
    if (d.reset != null) { if (!confirm('전략·거래내역·예수금을 모두 지우고 처음부터 시작할까요?')) return; state = E.defaultState(); save(); ui.form = null; ui.sel = null; toast('초기화했습니다'); return render(true); }
    if (d.export != null) { var a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' })); a2.download = 'fx-split-backup-' + day(Date.now()) + '.json'; document.body.appendChild(a2); a2.click(); a2.remove(); return; }
    if (d.nudge) { var nu = d.nudge.split(':'); state.rates[nu[0]].mid = E.r2(state.rates[nu[0]].mid + (+nu[1])); E.step(state, Date.now()); save(); return render(false); }
    if (t.parentNode.dataset && t.parentNode.dataset.sset) { state.settings.simulate = t.dataset.v === '1'; save(); return render(true); }
    if (d.fetch != null) {
      t.disabled = true; t.textContent = '조회 중…';
      fetch('https://open.er-api.com/v6/latest/USD').then(function (r) { return r.json(); }).then(function (j) {
        var k = j.rates.KRW; if (!k) throw 0;
        state.rates.USD.mid = E.r2(k); state.rates.JPY.mid = E.r2(k / j.rates.JPY * 100); state.rates.EUR.mid = E.r2(k / j.rates.EUR);
        save(); toast('기준환율 반영 (' + (j.time_last_update_utc || '').slice(0, 16) + ')'); render(true);
      }).catch(function () { toast('환율 조회 실패'); t.disabled = false; t.textContent = '실제 기준환율로 맞추기 (인터넷 조회)'; });
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target, d = t.dataset;
    if (d.f && ui.form) { ui.form[d.f] = t.tagName === 'SELECT' || d.f === 'name' ? t.value : t.value.replace(/,/g, ''); if (d.f === 'mode') return render(true); $('#preview').innerHTML = previewHtml(ui.form); return; }
  });
  document.addEventListener('change', function (e) {
    var t = e.target, d = t.dataset;
    if (d.sf) { if (d.sf === 'cur') ui.curFilter = t.value; else ui.stFilter = t.value; ui.sel = null; return render(true); }
    if (d.tf) { ui[d.tf] = t.value; if (d.tf !== 'tSid') ui.tPeriod = 'all'; return render(true); }
    if (d.snum) { var v = +t.value; if (!(v > 0)) return; if (d.snum === 'volatility') state.settings.volatility = v / 100; else if (d.snum === 'tickMs') { state.settings.tickMs = v * 1000; restart(); } else state.settings.speed = v; save(); return; }
    if (d.mid) { var m = +t.value; if (m > 0) { state.rates[d.mid].mid = m; E.step(state, Date.now()); save(); render(false); } return; }
    if (d.spread) { var s = +t.value; if (s >= 0) { state.settings.spread[d.spread] = s; save(); } return; }
    if (t.id === 'importFile' && t.files[0]) {
      var rd = new FileReader();
      rd.onload = function () { try { var s2 = JSON.parse(rd.result); if (!s2.strategies || !s2.rates) throw 0; localStorage.setItem(KEY, JSON.stringify(s2)); state = load(); toast('백업을 불러왔습니다'); render(true); } catch (err) { toast('올바른 백업 파일이 아닙니다'); } };
      rd.readAsText(t.files[0]);
    }
  });

  /* ---------- 시작 ---------- */
  try { var sv = sessionStorage.getItem('fxsplit.view'); if (sv && VIEWS.some(function (v) { return v[0] === sv; })) ui.view = sv; } catch (e) { }
  go(ui.view);
  restart();
})();
