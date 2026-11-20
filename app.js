/* Thousand — UI controller */
(function () {
  'use strict';
  var E = window.Engine;
  var SAVE_KEY = 'thousand.save.v1';
  var CFG_KEY = 'thousand.cfg.v1';
  var $ = function (s) { return document.querySelector(s); };
  var RL = { '9': '9', 'J': 'В', 'Q': 'Д', 'K': 'К', '10': '10', 'A': 'Т' };
  var FACE = { 'J': 'В', 'Q': 'Д', 'K': 'К' };
  var SUIT_NAME = { S: 'пики', C: 'трефы', D: 'бубны', H: 'черви' };

  var cfg = loadCfg();
  var st = null;
  var busy = false;      // animation lock
  var sel = null;        // selected card id (give phase)
  var bidVal = 0;        // human bid stepper value
  var timer = null;

  function loadCfg() {
    var d = { names: ['Вы', 'Миша', 'Оля'], settings: Object.assign({}, E.DEFAULTS) };
    try {
      var c = JSON.parse(localStorage.getItem(CFG_KEY));
      if (c) { d.names = c.names || d.names; d.settings = Object.assign(d.settings, c.settings || {}); }
    } catch (e) {}
    return d;
  }
  function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(st)); } catch (e) {} }
  function loadGame() {
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.players) {
        s.settings = Object.assign({}, E.DEFAULTS, s.settings || {});
        return s;
      }
    } catch (e) {}
    return null;
  }
  function hintsOn() { return !st || !st.settings || st.settings.hints !== false; }
  function isRed(s) { return s === 'H' || s === 'D'; }
  function sym(s) { return E.SUIT_SYM[s]; }
  function delay() { return st.settings.aiSpeed || 650; }
  function V(p, he, you) { return p === 0 ? you : he; }

  /* ---------- card elements ---------- */
  function cardEl(c) {
    var el = document.createElement('div');
    el.className = 'card' + (isRed(c.s) ? ' red' : '');
    el.dataset.id = c.id;
    el.style.backgroundImage = 'url("cards/' + c.id + '.jpg")';
    el.setAttribute('aria-label', RL[c.r] + ' ' + sym(c.s));
    return el;
  }
  function backEl() { var el = document.createElement('div'); el.className = 'card back'; return el; }

  /* ---------- render ---------- */
  function plate(sel, i) {
    var pl = st.players[i], box = $(sel);
    box.querySelector('.name').textContent = pl.name;
    box.querySelector('.score').textContent = pl.score;
    var tags = [];
    var inPlay = st.phase === 'play' || st.phase === 'trickDone';
    var hints = hintsOn();
    if (pl.onBarrel) tags.push('🛢' + (3 - pl.barrelTries));
    if (pl.bolts) tags.push('⚡' + pl.bolts);
    if (st.declarer === i && st.phase !== 'bid') {
      tags.push(inPlay && hints ? '★ ' + E.dealPoints(st, i) + '/' + st.bid : 'заказ ' + st.bid);
    }
    if (inPlay) {
      if (hints) {
        if (st.declarer !== i) tags.push(E.dealPoints(st, i) + ' очк.');
        tags.push('вз. ' + st.tricks[i]);
      } else {
        tags.push('взяток ' + st.tricks[i]);
      }
    }
    box.querySelector('.tag').textContent = tags.join(' · ');
    var active = (st.phase === 'bid' || st.phase === 'play') && st.turn === i;
    box.classList.toggle('active', active);
  }

  function renderOpp(i) {
    var root = $('#opp' + i), oh = root.querySelector('.ohand');
    oh.innerHTML = '';
    var n = st.hands ? st.hands[i].length : 0;
    var w = oh.clientWidth, cw = oh.clientHeight / 1.42;
    var step = n > 1 ? Math.min(cw * 0.45, (w - cw) / (n - 1)) : 0;
    var start = (w - (cw + step * (n - 1))) / 2;
    for (var k = 0; k < n; k++) {
      var b = backEl(); b.style.left = (start + k * step) + 'px'; oh.appendChild(b);
    }
    plate('#opp' + i + ' .plate', i);
  }

  function addBadge(el, cls, text) {
    var b = document.createElement('span');
    b.className = 'card-badge ' + cls;
    b.textContent = text;
    el.appendChild(b);
    return b;
  }

  function renderHand() {
    var hd = $('#hand');
    hd.innerHTML = '';
    if (!st.hands) return;
    var h = st.hands[0];
    var legal = {};
    var playing = st.phase === 'play' && st.turn === 0 && !busy;
    if (playing) E.legalCards(st, 0).forEach(function (c) { legal[c.id] = 1; });
    var hints = hintsOn();
    var pairs = hints ? E.pairsIn(h) : [];
    var fourAces = hints && st.settings.aceBonus && !st.aceUsed && E.SUITS.every(function (s) {
      return h.some(function (c) { return c.s === s && c.r === 'A'; });
    });
    var winners = {};
    if (hints && playing && st.trick.length > 0) {
      E.winningCards(st, 0).forEach(function (c) { winners[c.id] = 1; });
    }
    var n = h.length, w = hd.clientWidth;
    var cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cw')) || 0;
    var probe = backEl(); hd.appendChild(probe); cw = probe.offsetWidth; hd.removeChild(probe);
    var step = n > 1 ? Math.min(cw * 0.92, (w - cw - 16) / (n - 1)) : 0;
    var start = (w - (cw + step * (n - 1))) / 2;
    h.forEach(function (c, k) {
      var el = cardEl(c);
      el.style.left = (start + k * step) + 'px';
      el.style.zIndex = k;
      if (playing) el.classList.add(legal[c.id] ? 'legal' : 'dim');
      if (st.phase === 'give' && st.declarer === 0) el.classList.add('legal');
      if (hints) {
        if ((c.r === 'K' || c.r === 'Q') && pairs.indexOf(c.s) >= 0) {
          var ready = playing && st.trick.length === 0 && E.canAnnounce(st, 0, c);
          addBadge(el, 'pair-badge' + (ready ? ' ready' : ''), '👑+' + E.PAIR[c.s]);
          if (ready) el.classList.add('can-marry');
        } else if (fourAces && c.r === 'A') {
          var readyA = playing && st.trick.length === 0 && E.canAceBonus(st, 0, c);
          addBadge(el, 'pair-badge' + (readyA ? ' ready' : ''), '👑+200');
          if (readyA) el.classList.add('can-marry');
        }
        if (playing && winners[c.id]) {
          el.classList.add('beats');
          addBadge(el, 'beat-badge', '▲ Бьёт');
        }
      }
      if (sel === c.id) el.classList.add('sel');
      el.addEventListener('click', function () { onCard(c.id); });
      hd.appendChild(el);
    });
    plate('.me-plate', 0);
  }

  function renderCenter() {
    var tl = $('#talon'), tr = $('#trick');
    tl.innerHTML = '';
    if (st.phase === 'bid') {
      for (var i = 0; i < 3; i++) tl.appendChild(backEl());
    } else if (st.phase === 'prikup') {
      st.prikup.forEach(function (c) { tl.appendChild(cardEl(c)); });
    }
    tr.innerHTML = '';
    tr.className = '';
    (st.trick || []).forEach(function (t) {
      var el = cardEl(t.card); el.classList.add('t' + t.p); tr.appendChild(el);
    });
  }

  function renderInfo() {
    var b = $('#infoBid'), t = $('#infoTrump');
    var inPlay = (st.phase === 'play' || st.phase === 'trickDone') && st.declarer >= 0;
    if (st.phase === 'bid') {
      b.textContent = 'Торг: ' + st.bid;
      b.className = '';
    } else if (inPlay && hintsOn()) {
      var dPts = E.dealPoints(st, st.declarer);
      b.textContent = st.players[st.declarer].name + ': ' + dPts + ' / ' + st.bid;
      b.className = dPts >= st.bid ? 'made' : '';
    } else {
      b.textContent = st.declarer >= 0 ? st.players[st.declarer].name + ': ' + st.bid : '';
      b.className = '';
    }
    t.textContent = st.trump ? 'Козырь ' + sym(st.trump) : '';
    t.className = st.trump && isRed(st.trump) ? 'red' : '';
  }

  function render() {
    if (!st) return;
    renderOpp(1); renderOpp(2);
    renderCenter(); renderHand(); renderInfo(); renderPanel();
  }

  /* ---------- action panel ---------- */
  function btn(label, cls, fn, disabled) {
    var b = document.createElement('button');
    b.className = 'btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.disabled = !!disabled;
    b.addEventListener('click', function () { if (!busy) fn(); });
    return b;
  }
  function hint(text) { var d = document.createElement('div'); d.className = 'hint'; d.textContent = text; return d; }
  function statHint(html, warn) {
    var d = document.createElement('div');
    d.className = 'hint hint-stat' + (warn ? ' warn' : '');
    d.innerHTML = html;
    return d;
  }
  function pairSummary(ev) {
    var list = ev.pairs.map(function (s) { return sym(s) + '+' + E.PAIR[s]; });
    if (ev.acePoints) list.push('4Т+' + ev.acePoints);
    return list.length ? list.join(', ') : 'без марьяжа';
  }
  function stepper(min, max, onOk, okLabel) {
    var p = $('#panel');
    if (bidVal < min) bidVal = min;
    if (bidVal > max) bidVal = max;
    var v = document.createElement('div'); v.className = 'bidval'; v.textContent = bidVal;
    p.appendChild(btn('−', 'alt', function () { bidVal = Math.max(min, bidVal - 5); v.textContent = bidVal; }));
    p.appendChild(v);
    p.appendChild(btn('+', 'alt', function () { bidVal = Math.min(max, bidVal + 5); v.textContent = bidVal; }));
    p.appendChild(btn(okLabel, '', function () { onOk(bidVal); }));
  }

  function renderPanel() {
    var p = $('#panel');
    p.innerHTML = '';
    var ph = st.phase;
    var hints = hintsOn();
    if (busy && ph !== 'trickDone') return;
    if (ph === 'bid') {
      if (hints) {
        var evB = E.handEval(st, 0);
        p.appendChild(statHint('Сила руки: ~<b>' + evB.estimate + '</b> · Карт: <b>' + evB.cardPoints + '</b> очк. · ' + esc(pairSummary(evB)) + ' · Макс: <b>' + evB.maxBid + '</b>'));
      }
      if (st.turn === 0) {
        if (E.canRaise(st, 0)) {
          stepper(E.minBid(st), E.maxBid(st, 0), function (v) { humanBid(v); }, 'Заказ');
        } else {
          p.appendChild(hint('Выше ' + E.maxBid(st, 0) + ' нельзя без марьяжа'));
        }
        p.appendChild(btn('Пас', 'alt', function () { humanBid(0); }));
      }
    } else if (ph === 'prikup' && st.declarer === 0) {
      if (hints) {
        var evP = E.handEval(st, 0);
        p.appendChild(statHint('На руке: карт на <b>' + evP.cardPoints + '</b> очк. · ' + esc(pairSummary(evP)) + ' · Оценка: ~<b>' + evP.estimate + '</b>'));
      }
      p.appendChild(btn('Взять прикуп', '', function () { E.takeTalon(st); after(); }));
    } else if (ph === 'give' && st.declarer === 0) {
      if (hints) {
        var evG = E.handEval(st, 0);
        p.appendChild(statHint('На руке: карт на <b>' + evG.cardPoints + '</b> очк. · ' + esc(pairSummary(evG)) + ' · Оценка: ~<b>' + evG.estimate + '</b>'));
        if (sel) {
          var sc = st.hands[0].find(function (c) { return c.id === sel; });
          if (sc && (sc.r === 'K' || sc.r === 'Q') && evG.pairs.indexOf(sc.s) >= 0) {
            p.appendChild(statHint('⚠️ Эта карта разрушит марьяж (' + sym(sc.s) + ' +' + E.PAIR[sc.s] + ')!', true));
          }
        }
      }
      p.appendChild(hint(sel ? 'Кому отдать карту?' : 'Выберите карту, чтобы отдать сопернику (' + (2 - st.given) + ')'));
      [1, 2].forEach(function (i) {
        p.appendChild(btn((i === 1 ? '← ' : '') + st.players[i].name + (i === 2 ? ' →' : ''), 'alt', function () {
          if (sel && E.giveCard(st, sel, i)) { sel = null; after(); }
        }, !sel || st.givenTo[i]));
      });
    } else if (ph === 'raise' && st.declarer === 0) {
      if (hints) {
        var evR = E.handEval(st, 0);
        var msgR = 'Оценка руки: ~<b>' + evR.estimate + '</b> (карт: ' + evR.cardPoints + ' очк., ' + esc(pairSummary(evR)) + ')';
        if (st.bid > evR.estimate + 10) msgR += ' · <span class="hint-warn">⚠️ Заказ выше оценки руки</span>';
        p.appendChild(statHint(msgR));
      }
      var mx = st.settings.pairOver120 ? Math.max(st.bid, 120 + E.pairsValue(st.hands[0])) : 300;
      bidVal = st.bid;
      stepper(st.bid, mx, function (v) { E.confirmBid(st, v); after(); }, 'Играть');
      p.appendChild(btn('Сдаться', 'danger', function () {
        confirmBox('Сдаться? Вы получите −' + st.bid + ', соперники по +' + st.settings.concedeGive + '.', function () {
          E.resign(st); after();
        });
      }));
    } else if (ph === 'play' || ph === 'trickDone') {
      if (hints) {
        if (st.declarer === 0) {
          var myPts = E.dealPoints(st, 0), rem = Math.max(0, st.bid - myPts);
          if (rem > 0) p.appendChild(statHint('Набрано в раздаче: <b>' + myPts + ' из ' + st.bid + '</b> (осталось <b>' + rem + '</b>)'));
          else p.appendChild(statHint('Набрано в раздаче: <b>' + myPts + ' из ' + st.bid + '</b> (заказ выполнен ✓)'));
        } else if (st.declarer > 0) {
          var d = st.declarer, dPts = E.dealPoints(st, d), myOppPts = E.dealPoints(st, 0);
          p.appendChild(statHint('Ваши очки: <b>' + myOppPts + '</b> · Заказчик (' + esc(st.players[d].name) + '): <b>' + dPts + ' из ' + st.bid + '</b>'));
        }
      }
      if (ph === 'play' && st.turn === 0 && !busy) {
        if (hints) {
          if (st.trick.length === 0) {
            var hasReady = st.hands[0].some(function (c) { return E.canAnnounce(st, 0, c) || E.canAceBonus(st, 0, c); });
            p.appendChild(hint(hasReady ? 'Ваш ход — заходите (можно объявить марьяж 👑)' : 'Ваш ход — заходите'));
          } else {
            var trickPts = E.points(st.trick.map(function (t) { return t.card; }));
            var winCount = E.winningCards(st, 0).length;
            p.appendChild(hint('Ваш ход · Взятка: ' + trickPts + ' очк. · ' + (winCount ? 'Есть чем побить (▲)' : 'Побить нельзя')));
          }
        } else {
          p.appendChild(hint(st.trick.length ? 'Ваш ход' : 'Ваш ход — заходите'));
        }
      }
    }
  }

  /* ---------- feedback ---------- */
  var bubbleT = [0, 0, 0], toastT = 0;
  function bubble(p, text) {
    var b = $('#bubble' + p);
    b.textContent = text; b.classList.add('show');
    clearTimeout(bubbleT[p]);
    bubbleT[p] = setTimeout(function () { b.classList.remove('show'); }, 1400);
  }
  function toast(text, ms) {
    var t = $('#toast');
    t.textContent = text; t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove('show'); }, ms || 1800);
  }
  function vibrate() { if (navigator.vibrate) navigator.vibrate(15); }

  /* ---------- actions ---------- */
  function humanBid(v) {
    if (v) { if (!E.placeBid(st, 0, v)) return; bubble(0, String(v)); }
    else { E.pass(st, 0); bubble(0, 'Пас'); }
    after();
  }
  function onCard(id) {
    if (busy) return;
    if (st.phase === 'give' && st.declarer === 0) {
      sel = sel === id ? null : id;
      render();
      return;
    }
    if (st.phase === 'play' && st.turn === 0) {
      if (!E.legalCards(st, 0).some(function (c) { return c.id === id; })) {
        toast(st.trick.length ? 'Нужно ходить в масть' + (st.trump ? ' или козырем' : '') : 'Так ходить нельзя');
        return;
      }
      doPlay(0, id);
    }
  }
  function doPlay(p, id) {
    var ev = E.playCard(st, p, id);
    if (!ev) return;
    vibrate();
    if (ev.announce) {
      if (ev.announce.type === 'pair') {
        toast(st.players[p].name + ': марьяж ' + sym(ev.announce.suit) + ' +' + ev.announce.value + ', козырь — ' + SUIT_NAME[ev.announce.suit], 2200);
      } else toast(st.players[p].name + ': четыре туза +200', 2200);
    }
    after();
  }
  function onBidEnd() {
    var d = st.declarer;
    toast(st.players[d].name + V(d, ' играет ', ' играете ') + st.bid);
  }

  /* ---------- game flow ---------- */
  var lastPhase = null;
  function after() {
    if (lastPhase === 'bid' && st.phase !== 'bid') onBidEnd();
    lastPhase = st.phase;
    save();
    render();
    schedule();
  }
  function later(fn, ms) { clearTimeout(timer); timer = setTimeout(fn, ms); }

  function schedule() {
    var ph = st.phase, d = st.declarer;
    if (ph === 'bid' && st.turn !== 0) {
      later(function () {
        var p = st.turn, v = E.aiBid(st, p);
        if (v) { E.placeBid(st, p, v); bubble(p, String(v)); }
        else { E.pass(st, p); bubble(p, 'Пас'); }
        after();
      }, delay());
    } else if (ph === 'prikup' && d !== 0) {
      later(function () { E.takeTalon(st); after(); }, 1800);
    } else if (ph === 'give' && d !== 0) {
      later(function () {
        E.aiGive(st).forEach(function (x) { E.giveCard(st, x.cardId, x.to); });
        after();
      }, delay());
    } else if (ph === 'raise' && d !== 0) {
      later(function () {
        var r = E.aiRaise(st);
        if (r < 0) { toast(st.players[d].name + ' сдаётся'); E.resign(st); }
        else {
          if (r > st.bid) toast(st.players[d].name + ' повышает до ' + r);
          E.confirmBid(st, r);
        }
        after();
      }, delay());
    } else if (ph === 'play' && st.turn !== 0) {
      later(function () { doPlay(st.turn, E.aiPlay(st, st.turn)); }, delay());
    } else if (ph === 'trickDone') {
      busy = true;
      render();
      later(function () {
        $('#trick').classList.add('collect-' + st.trickWin);
        setTimeout(function () {
          busy = false;
          E.collectTrick(st);
          after();
        }, 380);
      }, Math.max(700, delay() + 200));
    } else if (ph === 'end') {
      later(showDealResult, 500);
    } else if (ph === 'over') {
      later(showGameOver, 500);
    }
  }

  function newDeal() {
    sel = null;
    E.startDeal(st);
    lastPhase = 'bid';
    bidVal = 0;
    after();
  }
  function newGame() {
    clearTimeout(timer);
    busy = false;
    st = E.newGame(cfg.names, cfg.settings);
    newDeal();
  }

  /* ---------- modals ---------- */
  function openModal(html, wire, dismissable) {
    $('#modalBody').innerHTML = html;
    $('#modal').classList.remove('hidden');
    $('#modal').dataset.dismiss = dismissable ? '1' : '';
    if (wire) wire($('#modalBody'));
  }
  function closeModal() { $('#modal').classList.add('hidden'); }
  function on(root, sel, fn) { var el = root.querySelector(sel); if (el) el.addEventListener('click', fn); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function confirmBox(text, yes) {
    openModal('<p>' + esc(text) + '</p><div class="row"><button class="btn alt" id="mNo">Отмена</button><button class="btn danger" id="mYes">Да</button></div>',
      function (r) { on(r, '#mNo', closeModal); on(r, '#mYes', function () { closeModal(); yes(); }); }, true);
  }

  function scoreTable() {
    var P = st.players;
    var h = '<table class="score"><tr><th>#</th>' + P.map(function (p) { return '<th>' + esc(p.name) + '</th>'; }).join('') + '</tr>';
    st.history.forEach(function (r) {
      h += '<tr><td>' + r.deal + '</td>';
      for (var i = 0; i < 3; i++) {
        var d = r.delta[i], mark = i === r.declarer ? '★' + r.bid + ' ' : '';
        var note = r.notes[i].length ? '<small>' + esc(r.notes[i].join(', ')) + '</small>' : '';
        h += '<td class="' + (d < 0 ? 'neg' : '') + '">' + r.scores[i] + '<small>' + mark + (d > 0 ? '+' : '') + d + '</small>' + note + '</td>';
      }
      h += '</tr>';
    });
    h += '<tr class="total"><td>Σ</td>' + P.map(function (p) { return '<td>' + p.score + '</td>'; }).join('') + '</tr></table>';
    return h;
  }

  function showDealResult() {
    var r = st.history[st.history.length - 1], d = r.declarer, P = st.players;
    var head = r.resigned ? P[d].name + V(d, ' сдался (', ' сдались (') + r.bid + ')'
      : P[d].name + (r.made ? V(d, ' сыграл ', ' сыграли ') : V(d, ' не сыграл ', ' не сыграли ')) + r.bid +
        V(d, ' (набрал ', ' (набрали ') + r.raw[d] + ')';
    var lines = P.map(function (p, i) {
      return '<li><b>' + esc(p.name) + '</b>: ' + (r.resigned ? '' : 'очки ' + r.raw[i] + ', ') +
        (r.delta[i] > 0 ? '+' : '') + r.delta[i] + ' → <b>' + r.scores[i] + '</b>' +
        (r.notes[i].length ? ' <i>(' + esc(r.notes[i].join(', ')) + ')</i>' : '') + '</li>';
    }).join('');
    openModal('<h2>' + esc(head) + '</h2><ul>' + lines + '</ul>' +
      '<details><summary>Таблица счёта</summary>' + scoreTable() + '</details>' +
      '<div class="row"><button class="btn" id="mNext">Следующая раздача</button></div>',
      function (root) { on(root, '#mNext', function () { closeModal(); newDeal(); }); });
  }

  function showGameOver() {
    var w = st.players[st.winner];
    openModal('<div class="big-title">🏆</div><h2 style="text-align:center">' +
      (st.winner === 0 ? 'Вы победили!' : esc(w.name) + ' победил') + '</h2>' + scoreTable() +
      '<div class="row"><button class="btn" id="mNew">Новая игра</button></div>',
      function (root) { on(root, '#mNew', function () { closeModal(); newGame(); }); });
  }

  function showMenu() {
    openModal('<div class="big-title">1000</div><p style="text-align:center;margin-top:0">Тысяча — карточная игра</p>' +
      '<div class="menu-list">' +
      '<button class="btn" id="mResume">Продолжить</button>' +
      '<button class="btn alt" id="mNew">Новая игра</button>' +
      '<button class="btn alt" id="mLast">Последняя взятка</button>' +
      '<button class="btn alt" id="mSet">Настройки</button>' +
      '<button class="btn alt" id="mRules">Правила</button></div>',
      function (r) {
        on(r, '#mResume', closeModal);
        on(r, '#mNew', function () { confirmBox('Начать новую игру? Текущая будет потеряна.', function () { newGame(); }); });
        on(r, '#mLast', showLastTrick);
        on(r, '#mSet', showSettings);
        on(r, '#mRules', showRules);
      }, true);
  }

  function showLastTrick() {
    var lt = st.lastTrick;
    if (!lt) { openModal('<p>Взяток ещё не было.</p><div class="row"><button class="btn" id="mOk">OK</button></div>', function (r) { on(r, '#mOk', closeModal); }, true); return; }
    openModal('<h2>Последняя взятка</h2><div id="ltCards" style="display:flex;gap:8px;justify-content:center"></div>' +
      '<p style="text-align:center">Забрал: <b>' + esc(st.players[lt.winner].name) + '</b></p>' +
      '<div class="row"><button class="btn" id="mOk">OK</button></div>',
      function (r) {
        lt.cards.forEach(function (t) {
          var w = document.createElement('div'); w.style.textAlign = 'center';
          w.appendChild(cardEl(t.card));
          var n = document.createElement('div'); n.textContent = st.players[t.p].name; n.style.fontSize = '13px';
          w.appendChild(n); r.querySelector('#ltCards').appendChild(w);
        });
        on(r, '#mOk', closeModal);
      }, true);
  }

  var OPTS = [
    ['hints', 'Подсказки (марьяжи, битьё, счётчик очков)'],
    ['barrel', 'Бочка на 880'],
    ['bolts', 'Болты (3 болта = −120)'],
    ['dump555', 'Самосвал на 555'],
    ['aceBonus', 'Тузовый марьяж (4 туза = 200)'],
    ['pairOver120', 'Заказ выше 120 — только с марьяжем'],
    ['pairNeedTrick', 'Марьяж — только после первой взятки']
  ];
  function showSettings() {
    var s = cfg.settings;
    var h = '<h2>Настройки</h2>';
    h += '<label class="opt">Ваше имя <input type="text" id="nm0" maxlength="10" value="' + esc(cfg.names[0]) + '"></label>';
    h += '<label class="opt">Соперник слева <input type="text" id="nm1" maxlength="10" value="' + esc(cfg.names[1]) + '"></label>';
    h += '<label class="opt">Соперник справа <input type="text" id="nm2" maxlength="10" value="' + esc(cfg.names[2]) + '"></label>';
    h += '<label class="opt">Скорость соперников <select id="spd">' +
      [[350, 'Быстро'], [650, 'Обычно'], [1000, 'Медленно']].map(function (o) {
        return '<option value="' + o[0] + '"' + (s.aiSpeed == o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>';
    OPTS.forEach(function (o) {
      h += '<label class="opt">' + o[1] + ' <input type="checkbox" id="o_' + o[0] + '"' + (s[o[0]] ? ' checked' : '') + '></label>';
    });
    h += '<p style="font-size:13px;color:#666">Правила (кроме имён, скорости и подсказок) применяются со следующей новой игры.</p>';
    h += '<div class="row"><button class="btn alt" id="mCancel">Отмена</button><button class="btn" id="mSave">Сохранить</button></div>';
    openModal(h, function (r) {
      on(r, '#mCancel', closeModal);
      on(r, '#mSave', function () {
        for (var i = 0; i < 3; i++) cfg.names[i] = (r.querySelector('#nm' + i).value.trim() || cfg.names[i]).slice(0, 10);
        s.aiSpeed = +r.querySelector('#spd').value;
        OPTS.forEach(function (o) { s[o[0]] = r.querySelector('#o_' + o[0]).checked; });
        saveCfg();
        if (st) {
          st.players.forEach(function (p, i) { p.name = cfg.names[i]; });
          st.settings.aiSpeed = s.aiSpeed;
          st.settings.hints = s.hints;
          save(); render();
        }
        closeModal();
      });
    }, true);
  }

  function showRules() {
    openModal('<h2>Правила игры «Тысяча»</h2>' +
      '<p>Играют трое, колода 24 карты (от девятки до туза). Цель — первым набрать 1000 очков.</p>' +
      '<h3>Очки карт</h3><p>Туз — 11, десятка — 10, король — 4, дама — 3, валет — 2, девятка — 0. Всего в колоде 120 очков. Старшинство: Т, 10, К, Д, В, 9.</p>' +
      '<h3>Раздача и торговля</h3><p>Каждому по 7 карт, 3 карты — в прикуп. Игрок после сдающего обязан начать со 100. Дальше по кругу можно повысить (шаг 5) или спасовать. Спасовавший в торге больше не участвует. Без марьяжа на руке выше 120 заказать нельзя.</p>' +
      '<h3>Прикуп</h3><p>Выигравший торг открывает и забирает прикуп, затем отдаёт по одной карте каждому сопернику. После этого он может повысить заказ или сдаться (сам получает минус заказ, соперники — по 60).</p>' +
      '<h3>Розыгрыш</h3><p>Первым ходит заказчик. Ходить нужно в масть; если масти нет — козырем; если нет и козырей — любой картой. Взятку берёт старший козырь или старшая карта масти хода.</p>' +
      '<h3>Марьяж</h3><p>Король и дама одной масти. Объявляется ходом короля или дамы, когда вы заходите и уже взяли хотя бы одну взятку. Масть марьяжа становится козырем. Пики — 40, трефы — 60, бубны — 80, черви — 100.</p>' +
      '<h3>Подсчёт</h3><p>Заказчик, набравший не меньше заказа, получает заказ, иначе заказ вычитается. Остальные записывают свои очки, округлённые до 5.</p>' +
      '<h3>Бочка</h3><p>Набрав 880, игрок «садится на бочку»: дальше он получает очки, только если сам сыграет заказ. На выход — 3 раздачи, иначе −120. Если на бочку садится другой, прежний падает на 120. Без своего заказа выше 880 подняться нельзя.</p>' +
      '<h3>Болты и самосвал</h3><p>Раздача без единой взятки — болт. Три болта — −120. Ровно 555 очков — самосвал, счёт сбрасывается на 0.</p>' +
      '<div class="row"><button class="btn" id="mOk">Понятно</button></div>',
      function (r) { on(r, '#mOk', closeModal); }, true);
  }

  /* ---------- boot ---------- */
  $('#btnMenu').addEventListener('click', showMenu);
  $('#btnScore').addEventListener('click', function () {
    if (!st) return;
    openModal('<h2>Счёт</h2>' + (st.history.length ? scoreTable() : '<p>Пока нет сыгранных раздач.</p>') +
      '<div class="row"><button class="btn" id="mOk">Закрыть</button></div>', function (r) { on(r, '#mOk', closeModal); }, true);
  });
  $('#modal').addEventListener('click', function (e) {
    if (e.target.id === 'modal' && this.dataset.dismiss) closeModal();
  });
  $('#center').addEventListener('click', function () { if (st && st.lastTrick && st.phase === 'play') showLastTrick(); });
  window.addEventListener('resize', function () { if (st) render(); });

  st = loadGame();
  if (st && st.phase !== 'idle') {
    if (st.phase === 'trickDone') busy = false;
    lastPhase = st.phase;
    render();
    schedule();
  } else {
    newGame();
    showRulesOnce();
  }
  function showRulesOnce() {
    if (!localStorage.getItem('thousand.seenRules')) { localStorage.setItem('thousand.seenRules', '1'); showRules(); }
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
