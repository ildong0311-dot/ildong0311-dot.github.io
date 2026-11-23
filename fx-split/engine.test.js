// 실행: node fx-split/engine.test.js
const E = require('./engine.js');
const assert = require('assert');
let pass = 0;
function t(name, fn) { fn(); pass++; console.log('ok -', name); }
function setMid(st, cur, m) { st.rates[cur].mid = m; }

t('예약환전: 목표가 위에서는 안 사고, 도달하면 1차수 매수', () => {
  const st = E.defaultState();
  setMid(st, 'USD', 1360);
  const s = E.createStrategy(st, { cur: 'USD', firstRate: 1355, maxLots: 5, amount: 50000, buyInt: 5, sellInt: 2 });
  E.step(st, 1); assert.strictEqual(s.lots.length, 0);
  setMid(st, 'USD', 1354); // ask 1355
  E.step(st, 2); assert.strictEqual(s.lots.length, 1);
  assert.strictEqual(s.lots[0].price, 1355);
  assert.strictEqual(s.lots[0].qty, 36.9);                // 50000/1355 = 36.90
  assert.strictEqual(s.lots[0].cost, Math.round(36.9 * 1355));
  assert.strictEqual(st.cash, 10000000 - s.lots[0].cost);
});

t('한 틱에 한 차수씩, 간격 아래로 내려가야 다음 차수', () => {
  const st = E.defaultState();
  setMid(st, 'USD', 1299);
  const s = E.createStrategy(st, { cur: 'USD', firstRate: 1300, maxLots: 3, amount: 50000, buyInt: 5, sellInt: 2 });
  E.step(st); E.step(st); E.step(st); E.step(st);
  assert.strictEqual(s.lots.length, 1, '1300에서 산 뒤 1295 이하가 아니면 2차수 안 삼');
  setMid(st, 'USD', 1250);
  E.step(st); assert.strictEqual(s.lots.length, 2);
  E.step(st); assert.strictEqual(s.lots.length, 2, '산 직후 같은 가격에서 또 사지 않음');
  setMid(st, 'USD', 1240); E.step(st); assert.strictEqual(s.lots.length, 3);
  setMid(st, 'USD', 1200); E.step(st); assert.strictEqual(s.lots.length, 3, '최대 차수 초과 금지');
});

t('매도: 차수별 매수가 + 매도간격, 확정손익은 실제 원가 기준', () => {
  const st = E.defaultState();
  setMid(st, 'USD', 1299);
  const s = E.createStrategy(st, { cur: 'USD', firstRate: 1300, maxLots: 3, amount: 50000, buyInt: 5, sellInt: 2, rebuy: false });
  E.step(st);
  setMid(st, 'USD', 1290); E.step(st); // lot2 @1291
  assert.strictEqual(s.lots.length, 2);
  setMid(st, 'USD', 1294); // bid 1293 → lot2(1291+2) 매도, lot1(1300) 유지
  E.step(st);
  assert.strictEqual(s.lots.length, 1);
  const sell = st.trades.find(x => x.side === 'sell');
  assert.strictEqual(sell.n, 2);
  assert.strictEqual(sell.pnl, sell.krw - Math.round(sell.qty * 1291));
  assert.strictEqual(s.stats.realized, sell.pnl);
});

t('재매수 꺼짐: 판 차수 다시 안 사고, 다 팔리면 완료', () => {
  const st = E.defaultState();
  setMid(st, 'USD', 1299);
  const s = E.createStrategy(st, { cur: 'USD', firstRate: 1300, maxLots: 3, amount: 50000, buyInt: 5, sellInt: 2, rebuy: false });
  E.step(st); setMid(st, 'USD', 1290); E.step(st);
  setMid(st, 'USD', 1294); E.step(st);       // lot2 매도
  setMid(st, 'USD', 1280); E.step(st);
  assert.strictEqual(s.lots.length, 1, '재매수 꺼짐 → 2차수 다시 안 삼');
  setMid(st, 'USD', 1310); E.step(st);
  assert.strictEqual(s.status, 'done');
});

t('재매수 켜짐: 판 차수 다시 매수, 전역 재매수 스위치 끄면 대기', () => {
  const st = E.defaultState();
  setMid(st, 'USD', 1299);
  const s = E.createStrategy(st, { cur: 'USD', firstRate: 1300, maxLots: 3, amount: 50000, buyInt: 5, sellInt: 2, rebuy: true });
  E.step(st); setMid(st, 'USD', 1290); E.step(st);
  setMid(st, 'USD', 1294); E.step(st);
  st.switches.rebuy = false;
  setMid(st, 'USD', 1280); E.step(st);
  assert.strictEqual(s.lots.length, 1);
  st.switches.rebuy = true; E.step(st);
  assert.strictEqual(s.lots.length, 2);
  assert.strictEqual(s.status, 'running');
});

t('즉시환전: 바로 1차수, 이후 기준가는 첫 매수가', () => {
  const st = E.defaultState();
  setMid(st, 'USD', 1400);
  const s = E.createStrategy(st, { cur: 'USD', mode: 'now', maxLots: 3, amount: 50000, buyInt: 10, sellInt: 2 });
  E.step(st);
  assert.strictEqual(s.lots[0].price, 1401);
  assert.strictEqual(s.anchor, 1401);
});

t('예수금 부족이면 안 사고 메시지', () => {
  const st = E.defaultState(); st.cash = 36959;
  setMid(st, 'USD', 1300);
  const s = E.createStrategy(st, { cur: 'USD', firstRate: 1400, maxLots: 3, amount: 50000, buyInt: 1, sellInt: 2 });
  E.step(st);
  assert.strictEqual(s.lots.length, 0);
  assert.ok(s.msg.includes('예수금 부족'));
});

t('% 간격, 엔화(100엔 단위) 금액 계산', () => {
  const st = E.defaultState();
  setMid(st, 'JPY', 846);
  const s = E.createStrategy(st, { cur: 'JPY', firstRate: 850, maxLots: 2, amount: 100000, buyIntType: 'pct', buyInt: 1, sellIntType: 'pct', sellInt: 0.5 });
  E.step(st);
  const lot = s.lots[0];
  assert.strictEqual(lot.qty, Math.floor(100000 / lot.price * 100 * 100) / 100);
  assert.strictEqual(lot.cost, Math.round(lot.qty * lot.price / 100));
  assert.strictEqual(E.sellTarget(s, lot), E.r2(lot.price * 1.005));
});

t('사다리 미리보기: 0.01원 간격 50차수는 0.49원 폭', () => {
  const p = { firstRate: 1364.48, maxLots: 50, buyIntType: 'won', buyInt: 0.01, sellIntType: 'won', sellInt: 2 };
  assert.strictEqual(E.ladderBottom(p), 1363.99);
});

t('바로환전 매수/매도 + 집계', () => {
  const st = E.defaultState();
  setMid(st, 'USD', 1300);
  const b = E.manualBuy(st, 'USD', 1000000); assert.ok(b.ok);
  setMid(st, 'USD', 1320);
  const s = E.manualSell(st, 'USD', b.qty / 2); assert.ok(s.ok);
  const sum = E.summary(st);
  assert.strictEqual(sum.cur.USD.realized, s.pnl);
  assert.ok(sum.cur.USD.realized > 0);
  assert.strictEqual(sum.total.equity, st.cash + sum.total.value);
});

t('매도 직후 같은 틱 재매수 없음, 재매수는 예전 매수가 이하에서만', () => {
  const st = E.defaultState();
  setMid(st, 'USD', 1299);
  const s = E.createStrategy(st, { cur: 'USD', firstRate: 1300, maxLots: 3, amount: 50000, buyInt: 5, sellInt: 2 });
  E.step(st); setMid(st, 'USD', 1290); E.step(st);   // lot2 @1291
  setMid(st, 'USD', 1294); E.step(st);               // lot2 매도
  assert.strictEqual(s.lots.length, 1);
  E.step(st);                                        // ask 1295 > 예전 매수가 1291
  assert.strictEqual(s.lots.length, 1);
  setMid(st, 'USD', 1290); E.step(st);               // ask 1291
  assert.strictEqual(s.lots.length, 2);
});

t('장기 랜덤 시뮬레이션: 돈이 새거나 생기지 않음', () => {
  const st = E.defaultState();
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  st.settings.volatility = 0.002;
  E.createStrategy(st, { cur: 'USD', firstRate: 1350, maxLots: 30, amount: 50000, buyInt: 3, sellInt: 3 });
  E.createStrategy(st, { cur: 'EUR', firstRate: 1480, maxLots: 20, amount: 100000, buyIntType: 'pct', buyInt: 0.3, sellIntType: 'pct', sellInt: 0.3 });
  for (let i = 0; i < 20000; i++) { E.randomWalk(st, rnd); E.step(st, i); }
  const sum = E.summary(st);
  // 현금 = 초기 - 총매수 + 총매도
  const bought = st.trades.filter(x => x.side === 'buy').reduce((a, x) => a + x.krw, 0);
  const sold = st.trades.filter(x => x.side === 'sell').reduce((a, x) => a + x.krw, 0);
  assert.strictEqual(st.cash, 10000000 - bought + sold);
  // 확정손익 = 매도금액 - 판 차수 원가
  assert.strictEqual(sum.total.realized, sum.total.soldProceeds - sum.total.soldCost);
  // 총매수 = 판 원가 + 보유 원가
  assert.strictEqual(bought, sum.total.soldCost + sum.total.heldCost);
  assert.ok(st.trades.length > 50);
});

console.log(`\n${pass} passed`);
