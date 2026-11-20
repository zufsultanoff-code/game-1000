/* Thousand (1000) card game engine. Works in browser and Node. */
(function (root) {
  'use strict';

  var SUITS = ['S', 'C', 'D', 'H'];
  var SUIT_SYM = { S: '\u2660', C: '\u2663', D: '\u2666', H: '\u2665' };
  var RANKS = ['9', 'J', 'Q', 'K', '10', 'A'];
  var VAL = { '9': 0, 'J': 2, 'Q': 3, 'K': 4, '10': 10, 'A': 11 };
  var STR = { '9': 0, 'J': 1, 'Q': 2, 'K': 3, '10': 4, 'A': 5 };
  var PAIR = { S: 40, C: 60, D: 80, H: 100 };

  var DEFAULTS = {
    barrel: true,        // 880 barrel rule
    bolts: true,         // 3 zero-deals = -120
    dump555: true,       // exactly 555 -> 0
    aceBonus: false,     // four aces = 200
    pairOver120: true,   // bid above 120 requires K+Q pair
    pairNeedTrick: true, // can announce pair only after taking a trick
    concedeGive: 60,     // points to each opponent when declarer gives up
    aiSpeed: 650,
    hints: true          // show card badges, winning card highlights, deal score/hand eval
  };

  function makeCard(s, r) { return { s: s, r: r, id: r + s }; }
  function newDeck() {
    var d = [];
    SUITS.forEach(function (s) { RANKS.forEach(function (r) { d.push(makeCard(s, r)); }); });
    return d;
  }
  function shuffle(a, rng) {
    rng = rng || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function round5(x) { return Math.round(x / 5) * 5; }
  function points(cards) { return cards.reduce(function (t, c) { return t + VAL[c.r]; }, 0); }
  function sortHand(h, trump) {
    var order = { S: 0, D: 1, C: 2, H: 3 };
    return h.sort(function (a, b) {
      if (a.s !== b.s) {
        if (trump) { if (a.s === trump) return 1; if (b.s === trump) return -1; }
        return order[a.s] - order[b.s];
      }
      return STR[b.r] - STR[a.r];
    });
  }
  function has(hand, s, r) { return hand.some(function (c) { return c.s === s && c.r === r; }); }
  function pairsIn(hand) { return SUITS.filter(function (s) { return has(hand, s, 'K') && has(hand, s, 'Q'); }); }
  function pairsValue(hand) { return pairsIn(hand).reduce(function (t, s) { return t + PAIR[s]; }, 0); }
  function allAces(hand) { return SUITS.every(function (s) { return has(hand, s, 'A'); }); }
  function nx(p) { return (p + 1) % 3; }

  /* ---------- setup ---------- */
  function newGame(names, settings) {
    var st = {
      settings: Object.assign({}, DEFAULTS, settings || {}),
      players: names.map(function (n, i) {
        return { name: n, human: i === 0, score: 0, bolts: 0, barrelTries: 0, onBarrel: false };
      }),
      dealer: Math.floor(Math.random() * 3),
      dealNo: 0,
      history: [],
      phase: 'idle',
      winner: -1
    };
    return st;
  }

  function startDeal(st) {
    st.dealNo++;
    st.dealer = st.dealNo === 1 ? st.dealer : nx(st.dealer);
    var deck = shuffle(newDeck());
    st.hands = [deck.slice(0, 7), deck.slice(7, 14), deck.slice(14, 21)];
    st.prikup = deck.slice(21, 24);
    st.hands.forEach(function (h) { sortHand(h); });
    st.bidder = nx(st.dealer);
    st.bid = 100;
    st.passed = [false, false, false];
    st.turn = nx(st.bidder);
    st.declarer = -1;
    st.trump = null;
    st.trick = [];
    st.lastTrick = null;
    st.leader = -1;
    st.taken = [[], [], []];
    st.tricks = [0, 0, 0];
    st.bonus = [0, 0, 0];
    st.announce = null;
    st.given = 0;
    st.phase = 'bid';
    st.log = [];
    return st;
  }

  /* ---------- bidding ---------- */
  function maxBid(st, p) {
    var h = st.hands[p];
    if (st.phase !== 'bid' && st.phase !== 'raise') return 120;
    if (!st.settings.pairOver120) return 300;
    var pv = pairsValue(h);
    return pv ? Math.min(300, 120 + pv) : 120;
  }
  function minBid(st) { return st.bid + 5; }
  function canRaise(st, p) { return maxBid(st, p) >= minBid(st); }

  function advanceBid(st) {
    var active = [0, 1, 2].filter(function (i) { return !st.passed[i]; });
    if (active.length === 1) {
      st.declarer = active[0];
      st.bidder = active[0];
      st.phase = 'prikup';
      return;
    }
    var p = nx(st.turn);
    while (st.passed[p]) p = nx(p);
    st.turn = p;
  }
  function placeBid(st, p, amount) {
    if (st.phase !== 'bid' || st.turn !== p) return false;
    if (amount < minBid(st) || amount > maxBid(st, p) || amount % 5) return false;
    st.bid = amount; st.bidder = p;
    st.log.push({ p: p, bid: amount });
    advanceBid(st);
    return true;
  }
  function pass(st, p) {
    if (st.phase !== 'bid' || st.turn !== p) return false;
    st.passed[p] = true;
    st.log.push({ p: p, bid: 0 });
    // the forced 100 holder keeps it when the other two pass
    var active = [0, 1, 2].filter(function (i) { return !st.passed[i]; });
    if (active.length === 1) { advanceBid(st); return true; }
    advanceBid(st);
    return true;
  }

  /* ---------- talon and giving ---------- */
  function takeTalon(st) {
    if (st.phase !== 'prikup') return false;
    var d = st.declarer;
    st.hands[d] = st.hands[d].concat(st.prikup);
    sortHand(st.hands[d]);
    st.phase = 'give';
    st.given = 0;
    st.givenTo = [false, false, false];
    return true;
  }
  function giveCard(st, cardId, to) {
    var d = st.declarer;
    if (st.phase !== 'give' || to === d || st.givenTo[to]) return false;
    var h = st.hands[d];
    var i = h.findIndex(function (c) { return c.id === cardId; });
    if (i < 0) return false;
    var c = h.splice(i, 1)[0];
    st.hands[to].push(c);
    sortHand(st.hands[to]);
    st.givenTo[to] = true;
    st.given++;
    if (st.given === 2) st.phase = 'raise';
    return true;
  }
  function confirmBid(st, amount) {
    if (st.phase !== 'raise') return false;
    amount = amount || st.bid;
    if (amount < st.bid || amount % 5) return false;
    st.bid = amount;
    st.phase = 'play';
    st.leader = st.declarer;
    st.turn = st.declarer;
    st.trick = [];
    return true;
  }

  /* ---------- play ---------- */
  function legalCards(st, p) {
    var h = st.hands[p];
    if (st.phase !== 'play' || st.turn !== p) return [];
    if (!st.trick.length) return h.slice();
    var ls = st.trick[0].card.s;
    var follow = h.filter(function (c) { return c.s === ls; });
    if (follow.length) return follow;
    if (st.trump) {
      var tr = h.filter(function (c) { return c.s === st.trump; });
      if (tr.length) return tr;
    }
    return h.slice();
  }
  function canAnnounce(st, p, card) {
    if (st.trick.length || st.phase !== 'play') return false;
    if (card.r !== 'K' && card.r !== 'Q') return false;
    if (st.settings.pairNeedTrick && st.tricks[p] === 0) return false;
    var h = st.hands[p];
    return has(h, card.s, 'K') && has(h, card.s, 'Q');
  }
  function canAceBonus(st, p, card) {
    if (!st.settings.aceBonus || st.trick.length || card.r !== 'A') return false;
    if (st.settings.pairNeedTrick && st.tricks[p] === 0) return false;
    return allAces(st.hands[p]) && !st.aceUsed;
  }
  function beats(a, b, lead, trump) {
    // does card a beat card b
    if (a.s === b.s) return STR[a.r] > STR[b.r];
    if (trump && a.s === trump) return true;
    return false;
  }
  function trickWinner(trick, trump) {
    var best = trick[0];
    for (var i = 1; i < trick.length; i++) {
      if (beats(trick[i].card, best.card, trick[0].card.s, trump)) best = trick[i];
    }
    return best.p;
  }
  function playCard(st, p, cardId) {
    var legal = legalCards(st, p);
    var c = legal.find(function (x) { return x.id === cardId; });
    if (!c) return null;
    var ev = { p: p, card: c, announce: null };
    if (canAnnounce(st, p, c)) {
      st.trump = c.s;
      st.bonus[p] += PAIR[c.s];
      ev.announce = { type: 'pair', suit: c.s, value: PAIR[c.s] };
      st.announce = ev.announce;
    } else if (canAceBonus(st, p, c)) {
      st.bonus[p] += 200;
      st.aceUsed = true;
      ev.announce = { type: 'aces', value: 200 };
      st.announce = ev.announce;
    }
    var h = st.hands[p];
    h.splice(h.indexOf(c), 1);
    st.trick.push({ p: p, card: c });
    if (st.trick.length < 3) {
      st.turn = nx(p);
    } else {
      st.phase = 'trickDone';
      st.trickWin = trickWinner(st.trick, st.trump);
    }
    return ev;
  }
  function collectTrick(st) {
    if (st.phase !== 'trickDone') return false;
    var w = st.trickWin;
    st.trick.forEach(function (t) { st.taken[w].push(t.card); });
    st.tricks[w]++;
    st.lastTrick = { cards: st.trick, winner: w };
    st.trick = [];
    st.leader = w;
    st.turn = w;
    if (st.hands[0].length === 0 && st.hands[1].length === 0 && st.hands[2].length === 0) {
      scoreDeal(st, false);
    } else {
      st.phase = 'play';
    }
    return true;
  }

  /* ---------- scoring ---------- */
  function resign(st) {
    if (st.phase !== 'raise') return false;
    scoreDeal(st, true);
    return true;
  }

  function scoreDeal(st, resigned) {
    var s = st.settings, d = st.declarer, i;
    var raw = [0, 1, 2].map(function (k) { return points(st.taken[k]) + st.bonus[k]; });
    var delta = [0, 0, 0], notes = [[], [], []];
    var made = !resigned && raw[d] >= st.bid;
    for (i = 0; i < 3; i++) {
      var pl = st.players[i];
      if (i === d) {
        delta[i] = made ? st.bid : -st.bid;
        if (resigned) notes[i].push('сдача');
      } else if (resigned) {
        delta[i] = s.concedeGive;
      } else {
        delta[i] = round5(raw[i]);
        if (s.bolts && st.tricks[i] === 0) {
          pl.bolts++;
          notes[i].push('болт');
          if (pl.bolts >= 3) { pl.bolts = 0; delta[i] = -120; notes[i].push('3 болта −120'); }
        }
      }
      // on the barrel only own bid counts
      if (s.barrel && i !== d && pl.onBarrel && delta[i] > 0) delta[i] = 0;
    }
    applyDelta(st, delta, notes, raw, resigned, made);
  }

  function applyDelta(st, delta, notes, raw, resigned, made) {
    var s = st.settings, d = st.declarer, i, P = st.players;
    for (i = 0; i < 3; i++) {
      var ns = P[i].score + delta[i];
      if (s.barrel && i !== d && ns > 880) ns = Math.max(P[i].score, 880);
      delta[i] = ns - P[i].score;
      P[i].score = ns;
    }
    if (s.barrel) updateBarrel(st, delta, notes);
    if (s.dump555) {
      for (i = 0; i < 3; i++) if (P[i].score === 555) { delta[i] -= 555; P[i].score = 0; notes[i].push('555 → 0'); }
    }
    st.history.push({
      deal: st.dealNo, declarer: d, bid: st.bid, raw: raw, delta: delta.slice(),
      scores: P.map(function (p) { return p.score; }), notes: notes, resigned: resigned, made: made
    });
    var top = -1, best = -1e9;
    for (i = 0; i < 3; i++) if (P[i].score >= 1000 && P[i].score > best) { best = P[i].score; top = i; }
    st.winner = top;
    st.phase = top >= 0 ? 'over' : 'end';
  }

  // 880..999 = barrel zone. Three deals to finish, otherwise -120.
  // Only one player can stay there; a newcomer pushes the previous one down by 120.
  function updateBarrel(st, delta, notes) {
    var P = st.players, i, newcomers = [];
    for (i = 0; i < 3; i++) {
      var p = P[i];
      var inZone = p.score >= 880 && p.score < 1000;
      if (p.onBarrel) {
        if (!inZone) { p.onBarrel = false; p.barrelTries = 0; }
        else {
          p.barrelTries++;
          if (p.barrelTries >= 3) {
            p.score -= 120; delta[i] -= 120; p.onBarrel = false; p.barrelTries = 0;
            notes[i].push('бочка −120');
          }
        }
      } else if (inZone) {
        newcomers.push(i);
      }
    }
    newcomers.forEach(function (k) {
      for (var j = 0; j < 3; j++) {
        if (j !== k && P[j].onBarrel) {
          P[j].score -= 120; delta[j] -= 120; P[j].onBarrel = false; P[j].barrelTries = 0;
          notes[j].push('сбит с бочки −120');
        }
      }
      P[k].onBarrel = true; P[k].barrelTries = 0;
      notes[k].push('на бочке');
    });
  }

  /* ---------- AI: hand estimate ---------- */
  function estimate(hand, withTalon) {
    var e = 0;
    SUITS.forEach(function (s) {
      var cs = hand.filter(function (c) { return c.s === s; });
      var hasA = has(cs, s, 'A'), has10 = has(cs, s, '10');
      if (hasA) e += 11 + 6;
      if (has10 && hasA) e += 10 + 4;
      else if (has10 && cs.length >= 3) e += 6;
      if (has(cs, s, 'K') && has(cs, s, 'Q')) e += PAIR[s];
      if (cs.length >= 4) e += 8;
    });
    e += withTalon ? 15 : 25;
    return e;
  }

  function aiBid(st, p) {
    var h = st.hands[p];
    var lim = Math.floor(estimate(h, false) / 5) * 5;
    lim = Math.min(lim, maxBid(st, p));
    var pl = st.players[p];
    if (pl.onBarrel) {
      var need = Math.ceil((1000 - pl.score) / 5) * 5;
      if (lim + 10 >= need) lim = Math.max(lim, Math.min(need, maxBid(st, p)));
    }
    var mb = minBid(st);
    return lim >= mb ? mb : 0;
  }

  function aiGive(st) {
    var d = st.declarer, h = st.hands[d].slice();
    var keep = pairsIn(h);
    function cost(c) {
      var v = VAL[c.r] * 2 + STR[c.r];
      if (keep.indexOf(c.s) >= 0 && (c.r === 'K' || c.r === 'Q')) v += 100;
      if (c.r === 'A') v += 40;
      var n = h.filter(function (x) { return x.s === c.s; }).length;
      v += n * 3; // keep long suits, dump singletons
      return v;
    }
    h.sort(function (a, b) { return cost(a) - cost(b); });
    var opp = [nx(d), nx(nx(d))];
    return [{ cardId: h[0].id, to: opp[0] }, { cardId: h[1].id, to: opp[1] }];
  }

  function aiRaise(st) {
    var d = st.declarer, h = st.hands[d];
    var e = estimate(h, true);
    if (e + 30 < st.bid && st.bid > 120) return -1;
    var lim = Math.floor(e / 5) * 5;
    var pl = st.players[d];
    if (pl.onBarrel) return st.bid;
    if (lim - 25 > st.bid) return Math.min(lim - 25, 120 + pairsValue(h));
    return st.bid;
  }

  /* ---------- AI: card play ---------- */
  function seenIds(st) {
    var s = {};
    st.taken.forEach(function (t) { t.forEach(function (c) { s[c.id] = 1; }); });
    st.trick.forEach(function (t) { s[t.card.id] = 1; });
    return s;
  }
  function isMaster(st, p, c, seen) {
    for (var i = STR[c.r] + 1; i < RANKS.length; i++) {
      var id = RANKS[i] + c.s;
      if (!seen[id] && !st.hands[p].some(function (x) { return x.id === id; })) return false;
    }
    return true;
  }
  function team(st, p) { return p === st.declarer ? 0 : 1; }
  function dumpCost(st, p, c) {
    var h = st.hands[p], v = VAL[c.r] * 3 + STR[c.r];
    if ((c.r === 'K' || c.r === 'Q') && has(h, c.s, 'K') && has(h, c.s, 'Q')) v += 200;
    if (c.s === st.trump) v += 30;
    if (c.r === 'A') v += 40;
    return v;
  }
  function pickMin(arr, f) { var b = arr[0]; arr.forEach(function (x) { if (f(x) < f(b)) b = x; }); return b; }
  function pickMax(arr, f) { var b = arr[0]; arr.forEach(function (x) { if (f(x) > f(b)) b = x; }); return b; }

  function aiPlay(st, p) {
    var legal = legalCards(st, p), seen = seenIds(st), h = st.hands[p];
    if (legal.length === 1) return legal[0].id;
    var T = st.trump;

    if (!st.trick.length) {
      // 1) announce the most valuable pair
      var ann = legal.filter(function (c) { return canAnnounce(st, p, c); });
      if (ann.length) {
        var best = pickMax(ann, function (c) { return PAIR[c.s] * 10 - VAL[c.r]; });
        var q = ann.find(function (c) { return c.s === best.s && c.r === 'Q'; });
        return (q || best).id;
      }
      // 2) declarer pulls trumps with a master trump
      if (T && p === st.declarer) {
        var mt = legal.filter(function (c) { return c.s === T && isMaster(st, p, c, seen); });
        if (mt.length) return pickMax(mt, function (c) { return STR[c.r]; }).id;
      }
      // 3) cash masters in side suits
      var masters = legal.filter(function (c) {
        return c.s !== T && isMaster(st, p, c, seen) && STR[c.r] >= 4;
      });
      if (masters.length) return pickMax(masters, function (c) { return VAL[c.r]; }).id;
      // 4) lowest card, not breaking pairs, not leading bare tens
      var safe = legal.filter(function (c) { return !(c.r === '10' && !has(h, c.s, 'A')); });
      return pickMin(safe.length ? safe : legal, function (c) { return dumpCost(st, p, c); }).id;
    }

    var w = trickWinner(st.trick, T);
    var wCard = st.trick.find(function (t) { return t.p === w; }).card;
    var leadS = st.trick[0].card.s;
    var friendWins = team(st, w) === team(st, p);
    var winners = legal.filter(function (c) { return beats(c, wCard, leadS, T); });
    var last = st.trick.length === 2;

    if (friendWins) {
      var safeFriend = last || isMaster(st, w, wCard, seen) && (wCard.s === T || !T);
      if (safeFriend) {
        // give points to the friend
        var give = legal.filter(function (c) { return !(c.r === 'A' && c.s === T); });
        return pickMax(give.length ? give : legal, function (c) {
          return VAL[c.r] * 3 - (dumpCost(st, p, c) - VAL[c.r] * 3);
        }).id;
      }
    }
    if (winners.length) {
      if (last) {
        var side = winners.filter(function (c) { return c.s !== T || leadS === T; });
        if (side.length) return pickMax(side, function (c) { return VAL[c.r] - (c.r === 'A' ? 1 : 0); }).id;
        return pickMin(winners, function (c) { return STR[c.r]; }).id;
      }
      var sure = winners.filter(function (c) { return isMaster(st, p, c, seen); });
      if (sure.length) return pickMin(sure, function (c) { return STR[c.r]; }).id;
      if (!friendWins) return pickMin(winners, function (c) { return dumpCost(st, p, c); }).id;
    }
    return pickMin(legal, function (c) { return dumpCost(st, p, c); }).id;
  }

  /* ---------- hints ---------- */
  function dealPoints(st, p) {
    return points((st.taken && st.taken[p]) || []) + ((st.bonus && st.bonus[p]) || 0);
  }

  function winningCards(st, p) {
    if (st.phase !== 'play' || st.turn !== p || !st.trick || !st.trick.length) return [];
    var w = trickWinner(st.trick, st.trump);
    var wCard = st.trick.find(function (t) { return t.p === w; }).card;
    var leadS = st.trick[0].card.s;
    return legalCards(st, p).filter(function (c) { return beats(c, wCard, leadS, st.trump); });
  }

  function handEval(st, p) {
    var h = (st.hands && st.hands[p]) || [];
    var pairs = pairsIn(h);
    var pairPts = pairsValue(h);
    var aces = st.settings.aceBonus && !st.aceUsed && allAces(h) ? 200 : 0;
    var mb = st.settings.pairOver120
      ? ((pairPts + aces) ? Math.min(300, 120 + pairPts + aces) : 120)
      : 300;
    var withTalon = st.phase === 'give' || st.phase === 'raise' || st.phase === 'play';
    var est = Math.min(mb, Math.max(100, Math.floor((estimate(h, withTalon) + aces) / 5) * 5));
    return {
      cardPoints: points(h),
      pairs: pairs,
      pairPoints: pairPts,
      acePoints: aces,
      maxBid: mb,
      estimate: est
    };
  }

  var API = {
    SUITS: SUITS, SUIT_SYM: SUIT_SYM, RANKS: RANKS, VAL: VAL, PAIR: PAIR, DEFAULTS: DEFAULTS,
    newGame: newGame, startDeal: startDeal, placeBid: placeBid, pass: pass,
    minBid: minBid, maxBid: maxBid, canRaise: canRaise,
    takeTalon: takeTalon, giveCard: giveCard, confirmBid: confirmBid, resign: resign,
    legalCards: legalCards, canAnnounce: canAnnounce, canAceBonus: canAceBonus, playCard: playCard, collectTrick: collectTrick,
    points: points, pairsIn: pairsIn, pairsValue: pairsValue, sortHand: sortHand,
    dealPoints: dealPoints, winningCards: winningCards, handEval: handEval,
    aiBid: aiBid, aiGive: aiGive, aiRaise: aiRaise, aiPlay: aiPlay, estimate: estimate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Engine = API;
})(this);
