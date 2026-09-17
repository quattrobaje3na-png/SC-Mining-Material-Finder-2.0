/* ===========================================================================
   NODE CONTENTS — an addition to the SC Mining Material Finder 2.0
   ---------------------------------------------------------------------------
   The finder tells you WHERE a material is and HOW OFTEN. This adds the third
   thing: the rock it comes out of, and what else is inside it.

   A node is not one ore. Every mineable rock carries several parts, each with
   its own authored share of the rock's mass, and the same rock type always
   carries the same elements in the same ranges. On Hurston you cannot mine
   aluminium without also taking corundum at 5–10%, every single time.

   WHY THE PERCENTAGES CAN BE TRUSTED
   ----------------------------------
   They are read from the game's own composition records, and confirmed against
   a real in-game SCAN RESULTS capture of an iron rock:

       11.25%  IRON (ORE)          the record authors a part at  9.7 – 15.7 %
       37.70%  IRON (ORE)          and a second part at         34.3 – 84.3 %
       51.03%  INERT MATERIALS     100 − 11.25 − 37.70 = 51.05

   Two parts can name the SAME ore — which is why the game prints IRON twice
   rather than once at 48.95%. They are deliberately not merged here either.

   HOW THIS ATTACHES
   -----------------
   It does NOT edit the finder's own code. The page is minified and its
   rendering is its own business, so this:
     * watches the results list and decorates rows after they are drawn, and
     * replaces the one global function it needs to, `updateRSScanner`.
   If the finder changes its markup this stops decorating rather than breaking
   anything, and it does nothing at all if its data file is missing.

   THE SCANNER REPLACEMENT, and why it is not just a composition add-on
   --------------------------------------------------------------------
   The existing Signature Checker accepts any reading within 0.5% of rs × n for
   n = 1..12. Signature values sit on an exact 15-unit grid and 0.5% of a
   reading is ±16 to ±21 — wider than the spacing — so every window spans two or
   three neighbouring materials. **Zero of the 26 ship materials are uniquely
   identified**, and because the list is sorted by proximity and only the
   winner shown, the "confidence %" is distance to the nearest multiple, not a
   probability of being right.

   Matching exactly, against only the readings a cluster can actually produce,
   takes 312 hypotheses (307 of them ambiguous) down to 76, every one unique.
   =========================================================================== */
(function () {
  'use strict';

  var DATA_URL = 'node_contents.json';
  var NC = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;',
              '"': '&quot;', "'": '&#39;'}[c];
    });
  }

  function pct(n) {
    return (Math.round(n * 10) / 10).toString();
  }

  /* Every node that yields this material by this method. A material can come
     from several rocks — iron is its own rock AND a passenger in others. */
  function nodesFor(material, method) {
    if (!NC) return [];
    var keys = NC.byMaterial[material] || [];
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      var nd = NC.nodes[keys[i]];
      if (!nd) continue;
      if (method && nd.method !== method) continue;
      out.push(nd);
    }
    return out;
  }

  /* THE PRIMARY IS THE FIRST PART. Every composition authors the rock's own
     headline ore first -- `Aslarite (Raw)` opens with two Aslarite parts, then
     its passengers -- so parts[0] identifies which rock this is, and everything
     after it is a SUB-MATERIAL of that rock.

     THIS USED TO BE ONE FLAT LIST AND THAT WAS WRONG TWICE OVER. It read as
     "more materials at this location" rather than "contents of the rock", and
     it merged the companions of every rock that yields the material under a
     tooltip claiming "every time". **30 of the 40 material+method combinations
     are served by more than one rock type.** Aslarite comes out of three: its
     own rock, where it is 42-90% of the mass, and the Agricium and Titanium
     rocks, where it is a 2-5% passenger. Flattening those says you always get
     all of it, which is the opposite of the truth. */
  function sig(nd) {
    return nd.name + '|' + nd.parts.map(function (p) {
      return p.ore + p.min + p.max;
    }).join(',');
  }

  function nodeGroups(material, method) {
    var primary = [], passenger = [], seen = {};
    nodesFor(material, method).forEach(function (nd) {
      var s = sig(nd);
      if (seen[s]) return;            /* surface and asteroid variants of one rock */
      seen[s] = 1;
      /* Where you get it BY THE BUCKET vs where it rides along. */
      (nd.parts[0] && nd.parts[0].ore === material ? primary : passenger).push(nd);
    });
    return {primary: primary, passenger: passenger};
  }

  /* The sub-materials of one rock: everything that is not the rock's own ore. */
  function subParts(nd, material) {
    return nd.parts.filter(function (p) { return p.ore !== material; });
  }

  /* What share of this rock is the ore you searched for. */
  function ownParts(nd, material) {
    return nd.parts.filter(function (p) { return p.ore === material; });
  }

  function bandText(p) {
    return pct(p.min) + '\u2013' + pct(p.max) + '%';
  }

  function partLine(p, cls) {
    return '<li class="nc-li ' + (cls || '') + '"><span class="nc-ore">'
         + esc(p.ore) + '</span><span class="nc-band">' + bandText(p) + '</span>'
         + (p.p != null && p.p < 1
             ? '<span class="nc-chance">' + Math.round(p.p * 100) + '% of rocks</span>'
             : '') + '</li>';
  }

  function chip(txt, cls) {
    return '<span class="nc-chip ' + (cls || '') + '">' + esc(txt) + '</span>';
  }

  /* The full part list for one rock, built only when a card is opened. */
  function partsListHtml(nd, material) {
    var own = ownParts(nd, material).map(function (p) {
      return partLine(p, 'nc-own');
    }).join('');
    var subs = subParts(nd, material).map(function (p) {
      return partLine(p, 'nc-subpart');
    }).join('');
    var inert = nd.inert
      ? '<li class="nc-li nc-subpart nc-inert"><span class="nc-ore">Inert material</span>'
        + '<span class="nc-band">' + pct(nd.inert[0]) + '\u2013' + pct(nd.inert[1])
        + '%</span></li>'
      : '';
    return '<ul class="nc-parts">' + own + subs + inert + '</ul>';
  }

  /* ONE ROCK IS ONE CARD. The badge carries the rock's own name — which is the
     primary material — and everything inside the card's border belongs to that
     rock and nothing else. The earlier indented-text version left it ambiguous
     whether a second line was another rock or more of the first one. */
  function cardHtml(nd, material, kind) {
    var tag = nd.source === 'event' ? '<em class="nc-tag">event only</em>'
            : nd.source === 'cave' ? '<em class="nc-tag">caves</em>' : '';
    var body;
    if (kind === 'primary') {
      var subs = subParts(nd, material);
      body = '<span class="nc-lbl">also contains</span>'
           + (subs.length
               ? subs.map(function (p) { return chip(p.ore); }).join('')
               : chip('nothing else \u2014 single-ore rock', 'nc-chip-none'));
    } else {
      var own = ownParts(nd, material)[0];
      body = '<span class="nc-lbl">' + esc(material) + ' here is</span>'
           + chip(own ? bandText(own) : '\u2014', 'nc-chip-band');
    }
    return '<div class="nc-card nc-card-' + kind + '" data-k="' + esc(nd.key) + '">'
         + '<div class="nc-badge">' + esc(nd.name) + ' rock' + tag + '</div>'
         + '<div class="nc-body">' + body + '</div>'
         + '<div class="nc-parts-wrap" hidden></div></div>';
  }

  /* ---------------------------------------------------------------- the rows
     Decoration runs after the finder has drawn its list. It is idempotent —
     a row already carrying the note is skipped — because the observer fires
     again on our own insertions. */
  function methodOf(grp) {
    return !grp ? null
         : grp.classList.contains('Ship') ? 'Ship'
         : grp.classList.contains('ROC') ? 'ROC'
         : grp.classList.contains('Hand') ? 'Hand' : null;
  }

  /* JUMP LINKS PER LOCATION.
     Ship is always the first and longest section, so Vehicle and Hand sit
     below the fold on every card -- which is why the tool reads as
     ship-only. Collapsing the rock detail shortens the cards; this makes the
     other methods reachable regardless of how long they get.

     Built from the sections that are actually present on THAT card, so a
     ship-only location (an asteroid belt) gets no bar rather than dead links
     to sections it does not have. */
  function addJumpBar(card) {
    if (card.getAttribute('data-nc-jump')) return;
    var groups = card.querySelectorAll('.loc-method-group');
    if (groups.length < 2) { card.setAttribute('data-nc-jump', '0'); return; }
    card.setAttribute('data-nc-jump', '1');

    var bar = document.createElement('div');
    bar.className = 'nc-jump';
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (!g.id) {
        g.id = 'ncj-' + Math.random().toString(36).slice(2, 9);
      }
      var head = (g.textContent || '').trim().split('\n')[0];
      // "Ship Mining Deposits" -> "Ship". The heading is the tool's, not ours.
      var label = head.replace(/\s*Mining Deposits\s*$/i, '').trim() || head;
      var a = document.createElement('button');
      a.type = 'button';
      a.className = 'nc-jump-lnk';
      a.setAttribute('data-ncj', g.id);
      a.textContent = label;
      bar.appendChild(a);
    }
    var anchor = card.querySelector('.loc-method-group');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor);
  }

  function decorate(root) {
    if (!NC) return;
    ensureFilterWiring();
    installControl();
    var cards = (root || document).querySelectorAll('.loc-card');
    for (var c = 0; c < cards.length; c++) addSynthRows(cards[c]);
    for (var j = 0; j < cards.length; j++) addJumpBar(cards[j]);
    var groups = (root || document).querySelectorAll('.loc-method-group');
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      var method = methodOf(grp);
      var cells = grp.querySelectorAll('.loc-mat-name');
      for (var i = 0; i < cells.length; i++) {
        var cell = cells[i];
        if (cell.getAttribute('data-nc')) continue;
        cell.setAttribute('data-nc', '1');
        var mat = (cell.textContent || '').trim();
        var html = summaryHtml(mat, nodeGroups(mat, method));
        if (!html) continue;
        var box = document.createElement('div');
        box.className = 'nc-sub';
        box.innerHTML = html;
        cell.appendChild(box);
      }
    }
  }

  /* THE COLLAPSED LINE IS THE IMPORTANT ONE -- most players will only read that.
     It has to say "these are inside the rock" and not "these are also here",
     which is exactly what the old inline list failed to do. The bands sit one
     click away so a location card stays a list and not a wall. */
  function summaryHtml(material, grpd) {
    var out = '';
    if (grpd.primary.length) {
      out += '<div class="nc-grp">' + grpd.primary.map(function (nd) {
        return cardHtml(nd, material, 'primary');
      }).join('') + '</div>';
    }
    /* Rocks where the searched ore is itself the sub-material. Kept in their
       own labelled group, because "you can get aslarite out of a titanium rock
       at a twentieth the share" is a different trip from "go mine aslarite". */
    if (grpd.passenger.length) {
      out += '<div class="nc-grp nc-grp-alt"><div class="nc-grp-lbl">'
           + esc(material) + ' is only a sub-material in</div>'
           + grpd.passenger.map(function (nd) {
               return cardHtml(nd, material, 'alt');
             }).join('') + '</div>';
    }
    if (!out) return '';
    out += '<button type="button" class="nc-toggle" aria-expanded="false">'
         + 'show mass shares</button>';

    /* COLLAPSED BY DEFAULT, because expanded it buried the rest of the page.
       Each material went from a one-line row to a ~140px block, which
       multiplied a location's SHIP section by its number of ores: measured on
       Aberdeen, the ship section alone ran 1,827px and pushed Vehicle to
       1,913px and Hand to 2,396px down a 2,995px card. Nothing was missing,
       but nobody scrolls two screens to find out. Collapsed, a material is one
       line again and every method section is reachable; the detail is one
       click away for the people who want it. */
    var nPrim = grpd.primary.length, nPass = grpd.passenger.length;
    var bits = [];
    if (nPrim) bits.push('in ' + nPrim + ' rock' + (nPrim === 1 ? '' : 's'));
    if (nPass) bits.push('inside ' + nPass + ' other' + (nPass === 1 ? '' : 's'));
    return '<button type="button" class="nc-rocks-toggle" aria-expanded="false">'
         + esc(bits.join(', ')) + '</button>'
         + '<div class="nc-rocks" hidden>' + out + '</div>';
  }

  /* Opened per block, and built on first open, so the collapsed cards cost
     nothing for the 600+ rows nobody expands. */
  function toggleBlock(box, b) {
    var cell = box.closest ? box.closest('.loc-mat-name') : null;
    /* The FIRST child node, not textContent -- our own cards are inside the
       cell now, so textContent would hand back the ore name with every chip
       glued to the end of it. */
    var mat = cell
      ? ((cell.childNodes[0] && cell.childNodes[0].nodeValue) || '').trim() : '';
    var cards = box.querySelectorAll('.nc-card');
    var open = box.getAttribute('data-open') === '1';
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var wrap = c.querySelector('.nc-parts-wrap');
      var body = c.querySelector('.nc-body');
      if (!wrap) continue;
      if (!open && !wrap.innerHTML) {
        var nd = NC.nodes[c.getAttribute('data-k')];
        wrap.innerHTML = nd ? partsListHtml(nd, mat) : '';
      }
      wrap.hidden = open;
      if (body) body.hidden = !open;
    }
    var foot = box.querySelector('.nc-foot');
    if (!open && !foot) {
      foot = document.createElement('div');
      foot.className = 'nc-foot';
      foot.innerHTML = 'Shares of the rock&rsquo;s mass. The exact split is '
        + 'rolled per rock; the range is fixed. The bold rows are ' + esc(mat)
        + ' itself &mdash; the rest is what comes up with it.';
      box.insertBefore(foot, b.nextSibling);
    } else if (foot) {
      foot.hidden = open;
    }
    box.setAttribute('data-open', open ? '0' : '1');
    b.setAttribute('aria-expanded', String(!open));
    b.textContent = open ? 'show mass shares' : 'hide mass shares';
  }

  /* Delegated, because the finder redraws its list and would strip handlers. */
  function wireToggle() {
    document.addEventListener('click', function (ev) {
      var b = ev.target;
      if (!b || !b.classList) return;
      /* The outer collapse: reveals the rock cards for one material. */
      if (b.classList.contains('nc-jump-lnk')) {
        var tgt = document.getElementById(b.getAttribute('data-ncj'));
        if (tgt) tgt.scrollIntoView({ block: 'start', behavior: 'smooth' });
        ev.preventDefault();
        return;
      }
      if (b.classList.contains('nc-rocks-toggle')) {
        var wrap = b.nextElementSibling;
        if (wrap && wrap.classList.contains('nc-rocks')) {
          var open = wrap.hidden;
          wrap.hidden = !open;
          b.setAttribute('aria-expanded', open ? 'true' : 'false');
          b.classList.toggle('nc-open', open);
        }
        ev.preventDefault();
        return;
      }
      if (!b.classList.contains('nc-toggle')) return;
      toggleBlock(b.parentNode, b);
      ev.preventDefault();
    });
  }

  /* ======================================================== the filter itself
     THE FINDER'S REQUIRED-MATERIAL FILTER DID NOT KNOW ABOUT ANY OF THIS. It
     matches on `allMatsSet`, which is built from the materials a location
     LISTS, so a sub-material that never gets its own row is invisible to it.

     That is not a theoretical gap. Measured across all 62 locations: **17 of
     them carry 43 sub-materials they do not list.** Hephaestanite rock carries
     quartz at 18 locations and laranite rock carries tungsten at 12, so asking
     the finder for quartz used to hide every hephaestanite site even though
     every single rock there contains 5-10% of it.

     THE TWO CASES ARE NOT MERGED. A location that lists an ore has its own
     deposits of it; a location that only carries it inside another rock does
     not, and saying otherwise would be a worse lie than omitting it. So the
     sub-material match is added, labelled on the card, and switchable. It also
     sorts last for free: the finder ranks by summed chance over LISTED rows,
     and a sub-material-only match contributes nothing to that sum. */
  var SUB_INDEX = null;

  function flatLocs() {
    try {
      return typeof FLAT_LOCS !== 'undefined' && FLAT_LOCS ? FLAT_LOCS : null;
    } catch (e) { return null; }       /* their binding, not ours -- never throw */
  }

  function reqFilters() {
    try {
      return typeof locFilters !== 'undefined' && locFilters
        ? locFilters.filter(function (x) { return x; }) : [];
    } catch (e) { return []; }
  }

  function subsOn() {
    var el = document.getElementById('nc-subs-toggle');
    return !el || el.checked;
  }

  /* KEYED BY THE PARENT ROW, NOT BY THE ROCK RECORD. A material is usually
     authored twice -- a surface rock and an asteroid rock with the same name
     and the same contents -- and an earlier draft pushed one entry per record,
     so Aaron Halo listed "Hephaestanite rock" twice and reported 13.8% for a
     6.9% row. The location offers the parent ONCE; that is the unit. */
  function buildSubIndex(locs) {
    var idx = {};
    locs.forEach(function (loc) {
      var per = {};
      ['Ship', 'ROC', 'Hand'].forEach(function (meth) {
        var rows = (loc.methods && loc.methods[meth]) || [];
        var listed = {};
        rows.forEach(function (r) { listed[r.name] = 1; });
        rows.forEach(function (r) {
          nodesFor(r.name, meth).forEach(function (nd) {
            if (!nd.parts[0] || nd.parts[0].ore !== r.name) return;
            nd.parts.forEach(function (pp) {
              if (pp.ore === r.name || listed[pp.ore]) return;
              var bucket = (per[pp.ore] = per[pp.ore] || []);
              var hit = null;
              bucket.forEach(function (h) {
                if (h.from === r.name && h.method === meth) hit = h;
              });
              if (!hit) {
                hit = {from: r.name, rock: nd.name, method: meth,
                       chance: r.chance, bands: []};
                bucket.push(hit);
              }
              /* Identical bands across the variants collapse to one; a genuine
                 difference between them would show as two, which is correct. */
              var b = bandText(pp);
              if (hit.bands.indexOf(b) === -1) hit.bands.push(b);
            });
          });
        });
      });
      if (Object.keys(per).length) idx[loc.name] = per;
    });
    return idx;
  }

  function applyAugmentation(on) {
    var locs = flatLocs();
    if (!locs || !SUB_INDEX) return;
    locs.forEach(function (loc) {
      if (!loc._ncMats) loc._ncMats = new Set(loc.allMatsSet);
      var s = new Set(loc._ncMats);
      if (on) {
        Object.keys(SUB_INDEX[loc.name] || {}).forEach(function (o) { s.add(o); });
      }
      loc.allMatsSet = s;   /* `allMats` is left alone: it feeds the dropdowns */
    });
  }

  function ensureFilterWiring() {
    var locs = flatLocs();
    if (!locs || !locs.length) return;            /* their data has not landed */
    if (locs[0]._ncMats) return;                  /* already augmented */
    SUB_INDEX = buildSubIndex(locs);
    applyAugmentation(subsOn());
    if (reqFilters().length && window.renderLocationResults) {
      window.renderLocationResults();   /* a filter was already set: redo it */
    }
  }

  function installControl() {
    var host = document.querySelector('.loc-filters');
    if (!host || document.getElementById('nc-subs-toggle')) return;
    var lab = document.createElement('label');
    lab.className = 'nc-subs-ctl';
    lab.innerHTML = '<input type="checkbox" id="nc-subs-toggle" checked> '
      + 'Include locations where a required material is only a '
      + '<b>sub-material</b> of another rock';
    host.appendChild(lab);
    lab.querySelector('input').addEventListener('change', function (ev) {
      applyAugmentation(ev.target.checked);
      if (window.renderLocationResults) window.renderLocationResults();
    });
  }

  /* A MATCH THE PLAYER CANNOT SEE IS A BUG. If a location matched only because
     a required ore hides inside another rock, the card has no row for that ore
     at all -- so one is added, saying which rock it is in and at what share.
     Its chance is the chance of drawing the PARENT rock, because that is when
     you get it. */
  function addSynthRows(card) {
    if (!SUB_INDEX || !subsOn()) return;
    var nameEl = card.querySelector('.loc-name');
    if (!nameEl) return;
    var per = SUB_INDEX[nameEl.textContent.trim()];
    if (!per) return;
    var req = reqFilters();
    if (!req.length) return;
    var grps = card.querySelectorAll('.loc-method-group');
    for (var g = 0; g < grps.length; g++) {
      var grp = grps[g];
      if (grp.getAttribute('data-nc-synth')) continue;
      grp.setAttribute('data-nc-synth', '1');
      var meth = methodOf(grp);
      var tb = grp.querySelector('tbody');
      if (!tb) continue;
      var listed = {};
      grp.querySelectorAll('.loc-mat-name').forEach(function (c) {
        listed[((c.childNodes[0] && c.childNodes[0].nodeValue) || '').trim()] = 1;
      });
      req.forEach(function (ore) {
        if (listed[ore]) return;
        var hits = (per[ore] || []).filter(function (h) { return h.method === meth; });
        if (!hits.length) return;
        var chance = 0;
        hits.forEach(function (h) { chance += h.chance || 0; });
        var tr = document.createElement('tr');
        tr.className = 'loc-mat-row loc-mat-row-highlight nc-synth';
        tr.innerHTML = '<td class="loc-mat-name" data-nc="1">' + esc(ore)
          + '<div class="nc-sub"><div class="nc-grp nc-grp-alt">'
          + '<div class="nc-grp-lbl">no deposits of its own here &mdash; it '
          + 'comes out of</div>'
          + hits.map(function (h) {
              return '<div class="nc-card nc-card-alt"><div class="nc-badge">'
                   + esc(h.rock) + ' rock</div><div class="nc-body">'
                   + '<span class="nc-lbl">' + esc(ore) + ' here is</span>'
                   + h.bands.map(function (b) {
                       return chip(b, 'nc-chip-band');
                     }).join('')
                   + '<span class="nc-lbl">of the rock, at '
                   + h.chance.toFixed(1) + '% of deposits</span></div></div>';
            }).join('')
          + '</div></div></td>'
          + '<td class="loc-mat-pct nc-synth-pct">' + chance.toFixed(1) + '%</td>';
        tb.appendChild(tr);
      });
    }
  }

  /* ------------------------------------------------------------- the scanner
     RS_TABLE is built from the node data: a ship node's own signature, times
     the cluster sizes that material can actually spawn in. */
  var RS_TABLE = null;

  function buildRsTable() {
    if (!NC || !NC.clusters) return null;
    var rows = [];
    Object.keys(NC.clusters).forEach(function (mat) {
      var c = NC.clusters[mat];
      (c.sizes || []).forEach(function (n) {
        rows.push({r: c.rs * n, n: mat, t: c.tier, k: n, b: c.rs});
      });
    });
    rows.sort(function (a, b) { return a.r - b.r; });
    return rows;
  }

  function compositionHtml(material, method) {
    var nds = nodesFor(material, method || 'Ship');
    if (!nds.length) return '';
    var nd = nds[0];
    /* Same hierarchy as the location rows: the rock's own ore first, then its
       sub-materials indented under it. The scanner already named the material,
       so the question this box answers is "and what else is in there". */
    var rows = ownParts(nd, material).map(function (p) {
      return partLine(p, 'nc-own');
    }).join('') + subParts(nd, material).map(function (p) {
      return partLine(p, 'nc-subpart');
    }).join('');
    var inert = nd.inert
      ? '<li class="nc-li nc-subpart nc-inert"><span class="nc-ore">Inert material</span>'
        + '<span class="nc-band">' + pct(nd.inert[0]) + '\u2013' + pct(nd.inert[1])
        + '%</span></li>'
      : '';
    var note = nd.source === 'event'
      ? '<div class="nc-note">Event content — this node only spawns during an event.</div>'
      : nd.source === 'cave'
      ? '<div class="nc-note">Found in caves.</div>' : '';
    return '<div class="nc-box"><div class="nc-title">What one ' + esc(nd.name)
         + ' rock contains</div><ul class="nc-parts">' + rows + inert + '</ul>' + note
         + '<div class="nc-foot">Shares of the rock’s mass. The exact split '
         + 'is rolled per rock; the range is fixed.</div></div>';
  }

  function installScanner() {
    if (!RS_TABLE || !RS_TABLE.length) return;
    var ROC = NC.rocShared || [];

    window.updateRSScanner = function (raw) {
      var el = document.getElementById('rs-result');
      if (!el) return;
      var v = parseInt(raw, 10);
      if (!v || v < 100) {
        el.innerHTML = '<span style="color:var(--text-muted);font-size:0.9rem;">'
                     + 'Enter an RS reading from your ship HUD...</span>';
        return;
      }
      /* The method-only answer comes FIRST: every ROC material shares one
         signature value, so naming one of them would be a guess. */
      for (var i = 0; i < ROC.length; i++) {
        if (v % ROC[i] === 0 && v / ROC[i] <= 25) {
          el.innerHTML = '<div class="sig-result-primary">Vehicle (ROC) deposit</div>'
            + '<div class="sig-result-nodes">Every ROC material shares this '
            + 'signature, so the reading identifies the method and not the '
            + 'material.</div>';
          return;
        }
      }
      var hits = RS_TABLE.filter(function (x) { return x.r === v; });
      /* A BASE VALUE THAT NO LEGAL CLUSTER CAN REACH. 4285 is aluminium's own
         per-rock signature, and common rocks never spawn alone, so no cluster
         produces it — but answering NO MATCH would hide the single reading
         that tests the whole model. If a player really sees 4285 on their HUD,
         the signature does NOT sum across a cluster and the "× N rocks" half
         of this is wrong. So it is named, not swallowed. */
      if (!hits.length) {
        var base = null;
        Object.keys(NC.clusters).forEach(function (m) {
          if (NC.clusters[m].rs === v) base = {n: m, t: NC.clusters[m].tier,
                                               s: NC.clusters[m].sizes};
        });
        if (base) {
          var col0 = 'var(--tier-' + String(base.t).toLowerCase().charAt(0) + ')';
          el.innerHTML =
            '<div class="sig-result-primary"><span style="color:' + col0 + '">'
            + esc(base.n) + '</span><span style="color:var(--text-main);'
            + 'font-weight:400;"> &mdash; single-rock value</span></div>'
            + '<div class="sig-result-nodes">This is ' + esc(base.n) + '&rsquo;s own '
            + 'signature, but it never spawns alone &mdash; the smallest cluster '
            + 'is <b>' + base.s[0] + '</b>, reading <b>' + (v * base.s[0]) + '</b>. '
            + 'If you really saw this on your HUD, please report it: it would mean '
            + 'the signature does not add up across a cluster.</div>'
            + compositionHtml(base.n, 'Ship');
          return;
        }
      }
      if (!hits.length) {
        var best = null;
        RS_TABLE.forEach(function (x) {
          if (!best || Math.abs(x.r - v) < Math.abs(best.r - v)) best = x;
        });
        el.innerHTML = '<div class="sig-result-primary" style="color:var(--error);">'
          + 'NO MATCH</div><div class="sig-result-nodes">No ship-mineable cluster '
          + 'can produce this reading &mdash; cluster sizes are limited, so most '
          + 'numbers are impossible rather than close.'
          + (best ? ' Nearest valid reading: <b>' + best.r + '</b> (' + esc(best.n)
                  + ' &times; ' + best.k + ').' : '') + '</div>';
        return;
      }
      var h = hits[0];
      var col = 'var(--tier-' + String(h.t).toLowerCase().charAt(0) + ')';
      el.innerHTML =
        '<div class="sig-result-primary"><span style="color:' + col + '">'
        + esc(h.n) + '</span><span style="color:var(--text-main);font-weight:400;">'
        + ' &times; ' + h.k + ' rock' + (h.k > 1 ? 's' : '') + '</span></div>'
        + '<div class="sig-result-nodes">Base <span style="font-family:var(--mono)">'
        + h.b + '</span> &middot; <span style="color:' + col + ';text-transform:'
        + 'uppercase;font-size:0.75rem;font-weight:bold;">' + esc(h.t) + '</span>'
        + (hits.length > 1 ? ' &middot; <b>also matches</b> '
            + hits.slice(1).map(function (x) { return esc(x.n) + ' ×' + x.k; })
                  .join(', ') : '')
        + '</div>' + compositionHtml(h.n, 'Ship');
    };
  }

  function style() {
    var css = ''
      /* The indent and the rule down the left are the whole point: they say
         "contained by" at a glance, which a comma-separated tail never did. */
      + '.nc-sub{margin:.25rem 0 .1rem .85rem;padding-left:.6rem;'
      + 'border-left:2px solid rgba(255,255,255,.14);font-size:.82em;'
      + 'font-weight:400;line-height:1.45;opacity:.92}'
      + '.nc-grp{margin:.2rem 0}'
      + '.nc-grp-alt{margin-top:.3rem}'
      + '.nc-grp-lbl{opacity:.6;margin-bottom:.15rem}'
      /* One bordered card per rock: the border is what says "these belong
         together and to this rock", which indented text never managed. */
      + '.nc-card{border:1px solid rgba(255,255,255,.13);border-radius:5px;'
      + 'padding:.3rem .45rem;margin:.18rem 0;background:rgba(255,255,255,.03)}'
      + '.nc-card-alt{opacity:.8;border-style:dashed}'
      + '.nc-badge{display:inline-block;font-weight:700;letter-spacing:.02em;'
      + 'padding:.05rem .4rem;border-radius:3px;margin-bottom:.2rem;'
      + 'background:rgba(255,255,255,.1)}'
      + '.nc-card-alt .nc-badge{font-weight:600;background:rgba(255,255,255,.06)}'
      + '.nc-body{display:flex;flex-wrap:wrap;gap:.3rem;align-items:baseline}'
      /* display:flex is a class rule and the UA [hidden] rule is not, so the
         author style wins and .hidden does nothing without this. */
      + '.nc-body[hidden]{display:none}'
      + '.nc-lbl{opacity:.6}'
      + '.nc-chip{display:inline-block;padding:.02rem .35rem;border-radius:3px;'
      + 'border:1px solid rgba(255,255,255,.15)}'
      + '.nc-chip-none{border-style:dashed;opacity:.6;font-style:italic}'
      + '.nc-chip-band{font-family:var(--mono,monospace)}'
      + '.nc-parts-wrap{margin-top:.25rem}'
      + '.nc-subs-ctl{display:block;margin-top:.5rem;font-size:.8rem;opacity:.85;'
      + 'cursor:pointer}'
      + '.nc-synth .loc-mat-name{opacity:.95;font-style:italic}'
      + '.nc-synth-pct{opacity:.75}'
      /* Growing the name cell made the CHANCE column centre itself against a
         tall block and drift to the bottom, away from the ore it belongs to.
         Scoped to rows we actually changed. */
      + 'tr:has(> .loc-mat-name[data-nc]) > td{vertical-align:top}'

      /* EACH MATERIAL IS ITS OWN BLOCK.
         The rock cards belong to the ore named above them, but with rows sat
         flush against each other there was nothing marking where one ore's
         evidence stopped and the next one's started -- the taller the block,
         the worse it read.
         Separation needs a real GAP, which a border-collapse:collapse table
         cannot produce, so border-spacing is switched on for the ONE table
         this add-on decorates and scoped by :has() so no other table on the
         page moves. Colours are the host's own --bg-card on --bg-base, the
         same figure/ground the location cards already use, rather than a new
         palette. */
      + 'table:has(.loc-mat-name[data-nc]){border-collapse:separate;'
      + 'border-spacing:0 7px}'
      + 'tr:has(> .loc-mat-name[data-nc]) > td{'
      + 'background:var(--bg-card,#0c0f14);'
      + 'border-top:1px solid var(--border,#172030);'
      + 'border-bottom:1px solid var(--border,#172030);'
      + 'padding-top:.5rem;padding-bottom:.55rem}'
      + 'tr:has(> .loc-mat-name[data-nc]) > td:first-child{'
      + 'border-left:3px solid var(--accent,#00e5a0);'
      + 'border-top-left-radius:6px;border-bottom-left-radius:6px;'
      + 'padding-left:.6rem}'
      + 'tr:has(> .loc-mat-name[data-nc]) > td:last-child{'
      + 'border-right:1px solid var(--border,#172030);'
      + 'border-top-right-radius:6px;border-bottom-right-radius:6px}'
      /* Alternating tint, so two adjacent blocks still read as separate
         where a 1px border is easy to miss. */
      + 'tr:has(> .loc-mat-name[data-nc]):nth-of-type(even) > td{'
      + 'background:#0a0d12}'
      + 'tr:has(> .loc-mat-name[data-nc]):nth-of-type(even) > td:first-child{'
      + 'border-left-color:var(--theme,#60a0ff)}'
      + '.nc-toggle{margin-top:.15rem;padding:0;border:0;background:none;'
      + 'font:inherit;font-size:.95em;color:inherit;opacity:.6;cursor:pointer;'
      + 'text-decoration:underline dotted}'
      + '.nc-toggle:hover{opacity:1}'

      /* The collapsed summary line. Reads as a control, not a heading, so it
         is obvious there is more behind it. */
      + '.nc-rocks-toggle{display:inline-block;margin-top:.15rem;padding:.05rem 0;'
      + 'border:0;background:none;font:inherit;font-size:.9em;color:inherit;'
      + 'opacity:.72;cursor:pointer;text-decoration:underline dotted}'
      + '.nc-rocks-toggle:hover{opacity:1}'
      + '.nc-rocks-toggle::before{content:"\\25B8";display:inline-block;'
      + 'margin-right:.3rem;transition:transform .12s}'
      + '.nc-rocks-toggle.nc-open::before{transform:rotate(90deg)}'
      + '.nc-rocks[hidden]{display:none}'

      /* Jump bar. Sits above the first method section in each location card. */
      + '.nc-jump{display:flex;flex-wrap:wrap;gap:.35rem;margin:0 0 .5rem}'
      + '.nc-jump-lnk{padding:.1rem .5rem;border-radius:99px;cursor:pointer;'
      + 'font:inherit;font-size:.8em;letter-spacing:.02em;'
      + 'color:var(--text-muted,#5a7a94);background:var(--bg-base,#050709);'
      + 'border:1px solid var(--border,#172030)}'
      + '.nc-jump-lnk:hover{color:var(--text-main,#e0eaf5);'
      + 'border-color:var(--accent,#00e5a0)}'
      + '.nc-tag{font-weight:400;opacity:.6;font-style:normal;font-size:.9em}'
      + '.nc-parts{list-style:none;margin:.15rem 0 0 .9rem;padding:0;'
      + 'border-left:1px solid rgba(255,255,255,.12)}'
      + '.nc-li{display:flex;gap:.55rem;align-items:baseline;'
      + 'padding:.05rem 0 .05rem .55rem}'
      + '.nc-own{font-weight:600}'
      + '.nc-subpart{opacity:.82}'
      + '.nc-box{margin-top:.75rem;padding:.6rem .7rem;border-radius:6px;'
      + 'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}'
      + '.nc-title{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;'
      + 'opacity:.7;margin-bottom:.45rem}'
      + '.nc-ore{min-width:9rem}'
      + '.nc-band{font-family:var(--mono,monospace);opacity:.9}'
      + '.nc-chance{font-size:.78rem;opacity:.65}'
      + '.nc-inert{opacity:.55}'
      + '.nc-note{margin-top:.4rem;font-size:.8rem;opacity:.8}'
      + '.nc-foot{margin-top:.45rem;font-size:.75rem;opacity:.6}';
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function boot() {
    style();
    /* The finder redraws its list on every filter change, so this watches
       rather than decorating once. Watching the whole body keeps it working if
       the results move to a different container. */
    wireToggle();
    var mo = new MutationObserver(function () { decorate(document); });
    mo.observe(document.body, {childList: true, subtree: true});
    decorate(document);
    installScanner();
  }

  fetch(DATA_URL)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;                 /* no data file: add nothing, break nothing */
      NC = d;
      /* A card has to name the rock it opens, and the only handle on a node is
         the key it is stored under, so carry it on the node itself. */
      Object.keys(NC.nodes).forEach(function (k) { NC.nodes[k].key = k; });
      RS_TABLE = buildRsTable();
      if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', boot);
      else boot();
    })
    .catch(function () { /* the finder works exactly as before */ });
})();
