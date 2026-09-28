/* Star Wars Saga Edition feat and talent picker.
   Needs swse_data.js loaded first (defines window.SWSE_DATA).
   Usage:  SWSEPicker.mount(document.getElementById('box'), { onChange: function (state) { ... } });
   State is plain JSON: SWSEPicker.getState() / SWSEPicker.setState(obj).
   Rules used (Saga Edition core rulebook):
   - Feats by character level: 1st, 3rd, 6th, 9th, 12th, 15th, 18th, plus a Human bonus feat at 1st.
   - Class bonus feats at every even class level, chosen from that class's bonus list.
   - Talents at every odd class level, chosen from that class's talent trees.
   - Trained skills at 1st level: class number + Intelligence modifier; Skill Training feats add one each.
   - A new class gives one starting feat of choice from that class's starting list. */
(function () {
  var D = window.SWSE_DATA;
  var FEAT_LEVELS = [1, 3, 6, 9, 12, 15, 18];
  var featById = {};
  D.feats.forEach(function (f) { featById[f.id] = f; });

  function baseName(n) { return String(n).replace(/\s*\(.*\)$/, ''); }
  function abilMod(score) { return Math.floor((Number(score) - 10) / 2); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function featLabel(f, choice) { return f.name + (choice ? ' (' + choice + ')' : ''); }

  function defaultState() {
    return {
      species: 'Human', droid: false,
      abilities: { Str: 10, Dex: 10, Con: 10, Int: 10, Wis: 10, Cha: 10 },
      plan: ['Soldier'], picks: {}, skillPicks: [], extraSkills: 0, traditions: [],
      sources: D.sources.reduce(function (o, s) { o[s.key] = true; return o; }, {}),
      showAll: false
    };
  }

  function babFor(plan, upto) {
    var counts = {}, total = 0;
    for (var i = 0; i < upto; i++) {
      var c = plan[i]; counts[c] = (counts[c] || 0) + 1;
      var L = counts[c];
      total += D.classes[c].bab === 'full' ? 1 : (Math.floor(L * 0.75) - Math.floor((L - 1) * 0.75));
    }
    return total;
  }

  function buildSlots(state) {
    var slots = [], counts = {}, seen = {};
    state.plan.forEach(function (cls, i) {
      var lvl = i + 1;
      counts[cls] = (counts[cls] || 0) + 1;
      var cl = counts[cls];
      var first = !seen[cls]; seen[cls] = true;
      var base = { lvl: lvl, cls: cls, cl: cl };
      if (i === 0) {
        D.classes[cls].startingFeats.forEach(function (n, k) {
          slots.push(Object.assign({ id: 'L1:start' + k, kind: 'start', fixed: n, label: 'Starting feat' }, base));
        });
      } else if (first) {
        slots.push(Object.assign({ id: 'L' + lvl + ':startpick', kind: 'startpick', label: 'Starting feat for new class (choose one)' }, base));
      }
      if (FEAT_LEVELS.indexOf(lvl) >= 0) slots.push(Object.assign({ id: 'L' + lvl + ':feat', kind: 'feat', label: 'Feat (character level ' + lvl + ')' }, base));
      if (lvl === 1 && /^human$/i.test(String(state.species).trim())) slots.push(Object.assign({ id: 'L1:human', kind: 'feat', label: 'Human bonus feat' }, base));
      if (cl % 2 === 0) slots.push(Object.assign({ id: 'L' + lvl + ':bonus', kind: 'bonus', label: cls + ' bonus feat (class level ' + cl + ')' }, base));
      if (cl % 2 === 1) slots.push(Object.assign({ id: 'L' + lvl + ':talent', kind: 'talent', label: cls + ' talent (class level ' + cl + ')' }, base));
    });
    return slots;
  }

  function initialSkillCount(state) {
    var c = D.classes[state.plan[0]];
    return Math.max(1, c.trained + abilMod(state.abilities.Int)) + (Number(state.extraSkills) || 0);
  }

  function skillsFor(state, classes) {
    var out = [];
    classes.forEach(function (c) {
      D.classes[c].skills.forEach(function (s) {
        if (/^Knowledge \((any|tactics)\)$/.test(s)) {
          if (s === 'Knowledge (any)') D.skills.filter(function (x) { return x.indexOf('Knowledge') === 0; }).forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); });
          else if (out.indexOf('Knowledge (tactics)') < 0) out.push('Knowledge (tactics)');
        } else if (out.indexOf(s) < 0) out.push(s);
      });
    });
    return out.sort();
  }

  function pickedFeat(pick) { return pick && pick.feat != null ? featById[pick.feat] : null; }

  // Context (what the character has just before slot index si)
  function contextAt(state, slots, si) {
    var ctx = { labels: [], talents: [], trained: [], lvl: slots[si] ? slots[si].lvl : state.plan.length };
    (state.skillPicks || []).forEach(function (s) { if (s) ctx.trained.push(s); });
    for (var i = 0; i < si; i++) {
      var s = slots[i], p = state.picks[s.id];
      if (s.kind === 'start') { ctx.labels.push(s.fixed); continue; }
      if (s.kind === 'talent') { if (p && p.talent) ctx.talents.push(p.talent); continue; }
      var f = pickedFeat(p);
      if (f) {
        ctx.labels.push(featLabel(f, p.choice));
        if (f.name === 'Skill Training' && p.choice) ctx.trained.push(p.choice);
      }
    }
    ctx.bab = babFor(state.plan, ctx.lvl);
    return ctx;
  }

  function hasFeatToken(ctx, tok) {
    if (tok.indexOf('talent:') === 0) return ctx.talents.indexOf(tok.slice(7)) >= 0;
    var tb = baseName(tok), hasParen = tok !== tb;
    return ctx.labels.some(function (l) {
      if (l.toLowerCase() === tok.toLowerCase()) return true;
      if (baseName(l).toLowerCase() === tb.toLowerCase()) return true;
      return false;
    });
  }

  function trainedHas(ctx, sk) {
    if (sk === 'Knowledge (any)') return ctx.trained.some(function (t) { return t.indexOf('Knowledge') === 0; });
    return ctx.trained.some(function (t) { return t.toLowerCase() === sk.toLowerCase(); });
  }

  // Returns list of unmet requirement strings for a feat.
  function unmetFeat(state, ctx, f) {
    var r = f.req, out = [];
    Object.keys(r.abil).forEach(function (k) { if (Number(state.abilities[k]) < r.abil[k]) out.push(k + ' ' + r.abil[k]); });
    if (ctx.bab < r.bab) out.push('base attack bonus +' + r.bab);
    r.feats.forEach(function (t) { if (!hasFeatToken(ctx, t)) out.push(t.replace('talent:', '')); });
    (r.anyFeats || []).forEach(function (a) { if (!a.some(function (t) { return hasFeatToken(ctx, t); })) out.push(a.map(function (t) { return t.replace('talent:', ''); }).join(' or ')); });
    r.skills.forEach(function (sk) { if (!trainedHas(ctx, sk)) out.push('trained in ' + sk); });
    r.anySkills.forEach(function (a) { if (!a.some(function (sk) { return trainedHas(ctx, sk); })) out.push('trained in ' + a.join(' or ')); });
    if (r.species.length && !r.species.some(function (s) { return String(state.species).toLowerCase() === s.toLowerCase(); })) out.push('species: ' + r.species.join(' or '));
    if (r.droid && !state.droid) out.push('droid');
    if (r.nondroid && state.droid) out.push('non-droid');
    return out;
  }

  var ABIL_WORD = { strength: 'Str', dexterity: 'Dex', constitution: 'Con', intelligence: 'Int', wisdom: 'Wis', charisma: 'Cha' };
  // Splits a talent's extra text into checkable parts (enforced) and text we can only show (notes).
  function talentExtras(t) {
    var enforced = [], notes = [];
    String(t.extra || '').split(/;\s*/).forEach(function (part) {
      if (!part) return;
      if (/^base attack bonus \+\d+/i.test(part) || /^Trained in /i.test(part) || /^(strength|dexterity|constitution|intelligence|wisdom|charisma) \d+$/i.test(part) || /Weapon Focus/i.test(part)) enforced.push(part);
      else notes.push(part);
    });
    return { enforced: enforced, notes: notes };
  }

  function unmetTalent(state, ctx, t) {
    var out = [];
    t.pre.forEach(function (p) { if (ctx.talents.indexOf(p) < 0) out.push(p); });
    talentExtras(t).enforced.forEach(function (part) {
      var m;
      if ((m = /^base attack bonus \+(\d+)/i.exec(part))) { if (ctx.bab < Number(m[1])) out.push('base attack bonus +' + m[1]); }
      else if ((m = /^Trained in (.+)$/i.exec(part))) { if (!trainedHas(ctx, m[1])) out.push('trained in ' + m[1]); }
      else if ((m = /^(strength|dexterity|constitution|intelligence|wisdom|charisma) (\d+)$/i.exec(part))) { if (Number(state.abilities[ABIL_WORD[m[1].toLowerCase()]]) < Number(m[2])) out.push(m[1] + ' ' + m[2]); }
      else if (/Weapon Focus/i.test(part)) { if (!ctx.labels.some(function (l) { return baseName(l) === 'Weapon Focus' || l.toLowerCase().indexOf('weapon focus') === 0; })) out.push(part); }
    });
    return out;
  }

  // Force talents: any Force Sensitive character may take one in place of a class talent.
  function forceTalentOk(state, ctx, t) {
    if (t.cls !== 'Force') return false;
    if (!classHasForce(ctx)) return false;
    if ((D.traditions || []).indexOf(t.tree) >= 0 && (state.traditions || []).indexOf(t.tree) < 0) return false;
    return true;
  }
  function talentAllowed(state, ctx, t, cls) { return t.cls === cls || forceTalentOk(state, ctx, t); }

  function enabledSrc(state, src) { return state.sources[src] !== false; }

  function classHasForce(ctx) { return ctx.labels.some(function (l) { return l === 'Force Sensitivity'; }); }

  // Options for a slot: [{value, label, group, unmet, note}]
  function optionsFor(state, slots, si) {
    var s = slots[si], ctx = contextAt(state, slots, si), out = [];
    if (s.kind === 'talent') {
      var taken = ctx.talents;
      D.talents.filter(function (t) { return talentAllowed(state, ctx, t, s.cls) && enabledSrc(state, t.src || 'core'); }).forEach(function (t) {
        var dup = taken.indexOf(t.name) >= 0 && !t.rep;
        if (dup) return;
        var nt = [t.rep ? 'can repeat' : ''].concat(talentExtras(t).notes.map(function (n) { return 'also needs ' + n; })).filter(Boolean).join('; ');
        var force = t.cls === 'Force';
        var srcTag = force || (t.src && t.src !== 'core') ? (D.sources.filter(function (z) { return z.key === (t.src || 'core'); })[0] || {}).tag : '';
        out.push({ value: t.name, label: t.name, group: force ? 'Force: ' + t.tree : t.tree, unmet: unmetTalent(state, ctx, t), note: nt, tag: srcTag });
      });
      return out;
    }
    var list;
    if (s.kind === 'bonus') {
      var seen = {};
      list = (D.bonus[s.cls] || []).filter(function (b) { return enabledSrc(state, b.s); }).map(function (b) { return { f: featById[b.f], note: b.note }; })
        .filter(function (x) { var k = x.f.id; if (seen[k]) return false; seen[k] = 1; return true; });
    } else if (s.kind === 'startpick') {
      list = D.classes[s.cls].startingFeats.map(function (n) {
        var f = D.feats.filter(function (x) { return x.name === n || x.name === baseName(n); })[0];
        return f ? { f: f, note: n !== f.name ? n : '' } : null;
      }).filter(Boolean);
    } else {
      list = D.feats.filter(function (f) { return enabledSrc(state, f.src); }).map(function (f) { return { f: f, note: '' }; });
    }
    list.forEach(function (x) {
      var f = x.f;
      if (!f.choice) {
        var dup = ctx.labels.some(function (l) { return l.toLowerCase() === f.name.toLowerCase(); });
        if (dup) return;
      }
      var um = unmetFeat(state, ctx, f);
      var srcTag = D.sources.filter(function (z) { return z.key === f.src; })[0].tag;
      out.push({ value: String(f.id), label: f.name, group: D.sources.filter(function (z) { return z.key === f.src; })[0].label, unmet: um, note: x.note, tag: srcTag });
    });
    out.sort(function (a, b) { return a.label < b.label ? -1 : 1; });
    return out;
  }

  // Full validation: array of {slotId, problems:[...]}
  function validate(state) {
    var slots = buildSlots(state), res = [];
    slots.forEach(function (s, i) {
      var p = state.picks[s.id];
      if (!p || s.kind === 'start') return;
      var ctx = contextAt(state, slots, i), problems = [];
      if (s.kind === 'talent') {
        var t = D.talents.filter(function (x) { return x.name === p.talent && talentAllowed(state, ctx, x, s.cls); })[0];
        if (!t) problems.push('not available to ' + s.cls + ' here (Force talents need Force Sensitivity and, for traditions, membership)'); else unmetTalent(state, ctx, t).forEach(function (u) { problems.push('needs ' + u); });
      } else {
        var f = pickedFeat(p);
        if (f) {
          unmetFeat(state, ctx, f).forEach(function (u) { problems.push('needs ' + u); });
          if (s.kind === 'bonus' && !(D.bonus[s.cls] || []).some(function (b) { return b.f === f.id && enabledSrc(state, b.s); })) problems.push('not on the ' + s.cls + ' bonus feat list');
          if (f.choice && !p.choice) problems.push('choose a ' + (f.choice === 'skill' ? 'skill' : 'weapon or option'));
        }
      }
      if (problems.length) res.push({ slotId: s.id, problems: problems });
    });
    return res;
  }

  // ---- UI ----
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'class') e.className = attrs[k];
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  var STYLE = '.sw{font-family:system-ui,Segoe UI,Roboto,sans-serif;color:var(--sw-fg,#1b2330);max-width:920px;margin:0 auto;padding:16px;line-height:1.4}' +
    '.sw h2{font-size:18px;margin:20px 0 8px;border-bottom:2px solid #c9a227;padding-bottom:4px}' +
    '.sw .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:6px 0}' +
    '.sw label{font-size:13px}.sw input,.sw select{font:inherit;padding:5px 7px;border:1px solid #9aa4b2;border-radius:6px;background:#fff;color:#1b2330}' +
    '.sw input[type=number]{width:64px}.sw button{font:inherit;padding:5px 11px;border-radius:6px;border:1px solid #6b7686;background:#eef1f5;color:#1b2330;cursor:pointer}' +
    '.sw button:hover{background:#dde3ea}.sw .chips span{display:inline-block;background:#1b2330;color:#f4d35e;border-radius:12px;padding:2px 9px;margin:2px;font-size:12px}' +
    '.sw .slot{display:grid;grid-template-columns:170px 1fr;gap:8px;padding:8px;border:1px solid #d5dae1;border-radius:8px;margin:6px 0;background:#fafbfc}' +
    '.sw .slot.talent{background:#f4f8ff}.sw .slot.bad{border-color:#c0392b;background:#fff3f1}' +
    '.sw .slot .lab{font-size:13px;font-weight:600}.sw .lvl{font-size:11px;color:#5b6675;font-weight:400}' +
    '.sw .warn{color:#b03a2e;font-size:12px;margin-top:3px}.sw .note{color:#5b6675;font-size:12px;margin-top:3px}' +
    '.sw .fixed{font-size:14px}.sw .small{font-size:12px;color:#5b6675}' +
    '.sw.embedded{padding:0;max-width:none;color:var(--text,#1b2330);font-family:inherit}' +
    '.sw.embedded h2{font-size:14px;margin:14px 0 6px;color:var(--gold,#c9a227);border-bottom:1px solid var(--border,#c9a227)}' +
    '.sw.embedded input,.sw.embedded select{background:var(--raised,#fff);color:var(--text,#1b2330);border:1px solid var(--border,#9aa4b2);max-width:100%}' +
    '.sw.embedded .slot{background:var(--raised,#fafbfc);border-color:var(--border,#d5dae1)}.sw.embedded .slot.talent{background:var(--panel,#f4f8ff)}' +
    '.sw.embedded .slot.bad{border-color:var(--crimson,#c0392b)}.sw.embedded .warn{color:var(--crimson-soft,#b03a2e)}' +
    '.sw.embedded .note,.sw.embedded .small,.sw.embedded .lvl{color:var(--text-dim,#5b6675)}' +
    '.sw.embedded .slot select{width:100%}' +
    '@media(max-width:600px){.sw .slot{grid-template-columns:1fr}}';

  var api = { data: D, buildSlots: buildSlots, optionsFor: optionsFor, validate: validate, contextAt: contextAt, defaultState: defaultState, initialSkillCount: initialSkillCount, skillsFor: skillsFor };
  var current = null, root = null, onChangeCb = null, embedded = false, ctxFn = null, api_summarize = null;

  api.getState = function () { return JSON.parse(JSON.stringify(current)); };
  api.setState = function (s) { current = Object.assign(defaultState(), s); render(); };

  function change(mut) { mut(current); prune(); render(); if (onChangeCb) onChangeCb(api.getState(), api.validate ? validate(current) : []); }

  // Remove picks for slots that no longer exist (after removing a level or changing species).
  function prune() {
    var slots = buildSlots(current), ids = {};
    slots.forEach(function (s) { ids[s.id] = 1; });
    Object.keys(current.picks).forEach(function (k) { if (!ids[k]) delete current.picks[k]; });
    if (!embedded) {
      var n = initialSkillCount(current);
      current.skillPicks = (current.skillPicks || []).slice(0, n);
    }
  }

  // Embedded mode: the host app owns species, abilities, class, level and trained skills.
  function applyContext() {
    if (!embedded || !ctxFn) return;
    var c = ctxFn() || {};
    current.species = c.species || 'Human';
    current.droid = !!c.droid;
    if (c.abilities) current.abilities = c.abilities;
    if (c.plan && c.plan.length) current.plan = c.plan.slice(0, 20);
    current.skillPicks = (c.trained || []).slice();
  }

  function summarize(state) {
    var slots = buildSlots(state), feats = [], talents = [];
    slots.forEach(function (s, i) {
      var p = state.picks[s.id];
      if (s.kind === 'start') {
        var f = D.feats.filter(function (x) { return x.name === s.fixed || x.name === baseName(s.fixed); })[0];
        if (f && unmetFeat(state, contextAt(state, slots, i), f).length) return;
        feats.push(s.fixed);
        return;
      }
      if (!p) return;
      if (s.kind === 'talent') { if (p.talent) talents.push(p.talent); return; }
      var ft = pickedFeat(p);
      if (ft) feats.push(featLabel(ft, p.choice));
    });
    return { feats: feats, talents: talents };
  }
  api_summarize = summarize;

  function render() {
    applyContext();
    root.innerHTML = '';
    var st = current, slots = buildSlots(st), bad = {};
    validate(st).forEach(function (v) { bad[v.slotId] = v.problems; });
    var wrap = h('div', { class: 'sw' + (embedded ? ' embedded' : '') });

    if (!embedded) {
    // Character
    wrap.appendChild(h('h2', { text: 'Character' }));
    var dl = h('datalist', { id: 'sw-species' }, ['Human', 'Twi\'lek', 'Wookiee', 'Rodian', 'Duros', 'Zabrak', 'Cathar', 'Miraluka'].concat(D.species).filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (n) { return h('option', { value: n }); }));
    var sp = h('input', { type: 'text', list: 'sw-species', value: st.species, onchange: function (e) { change(function (s) { s.species = e.target.value; }); } });
    var dr = h('input', { type: 'checkbox', onchange: function (e) { change(function (s) { s.droid = e.target.checked; }); } }); dr.checked = !!st.droid;
    wrap.appendChild(h('div', { class: 'row' }, [h('label', { text: 'Species ' }, [sp, dl]), h('label', {}, [dr, ' Droid'])]));
    var ab = h('div', { class: 'row' });
    ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'].forEach(function (k) {
      var inp = h('input', { type: 'number', min: 1, max: 30, value: st.abilities[k], onchange: function (e) { change(function (s) { s.abilities[k] = Number(e.target.value) || 10; }); } });
      ab.appendChild(h('label', {}, [k + ' ', inp, ' (' + (abilMod(st.abilities[k]) >= 0 ? '+' : '') + abilMod(st.abilities[k]) + ')']));
    });
    wrap.appendChild(ab);
    wrap.appendChild(h('div', { class: 'small', text: 'Use your final ability scores. Feat prerequisites are checked against these scores.' }));

    // Levels
    wrap.appendChild(h('h2', { text: 'Levels' }));
    var counts = {}; st.plan.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    var chips = h('div', { class: 'chips' }, [h('span', { text: 'Character level ' + st.plan.length }), h('span', { text: 'Base attack bonus +' + babFor(st.plan, st.plan.length) })]);
    Object.keys(counts).forEach(function (c) { chips.appendChild(h('span', { text: c + ' ' + counts[c] })); });
    wrap.appendChild(chips);
    var lv = h('div', { class: 'row' });
    D.classNames.forEach(function (c) { lv.appendChild(h('button', { type: 'button', text: '+ ' + c + ' level', disabled: st.plan.length >= 20, onclick: function () { change(function (s) { s.plan.push(c); }); } })); });
    lv.appendChild(h('button', { type: 'button', text: 'Remove last level', disabled: st.plan.length <= 1, onclick: function () { change(function (s) { s.plan.pop(); }); } }));
    wrap.appendChild(lv);
    wrap.appendChild(h('div', { class: 'small', text: 'Order of levels matters: feats come from total character level, bonus feats and talents from levels in each class. Level 1 class: ' + st.plan[0] + '.' }));
    var first = h('select', { onchange: function (e) { change(function (s) { s.plan[0] = e.target.value; s.skillPicks = []; }); } }, D.classNames.map(function (c) { var o = h('option', { value: c, text: 'First level in ' + c }); if (c === st.plan[0]) o.selected = true; return o; }));
    wrap.appendChild(h('div', { class: 'row' }, [first]));

    // Skills
    var n = initialSkillCount(st), pool = skillsFor(st, [st.plan[0]]);
    wrap.appendChild(h('h2', { text: 'Trained skills at 1st level (' + n + ')' }));
    wrap.appendChild(h('div', { class: 'small', text: st.plan[0] + ' trains ' + D.classes[st.plan[0]].trained + ' plus your Intelligence modifier (at least 1). Later trained skills come from Skill Training feats.' }));
    var sk = h('div', { class: 'row' });
    for (var i = 0; i < n; i++) {
      (function (i) {
        var used = (st.skillPicks || []).filter(function (x, j) { return j !== i && x; });
        var sel = h('select', { onchange: function (e) { change(function (s) { s.skillPicks[i] = e.target.value; }); } }, [h('option', { value: '', text: '(choose a class skill)' })].concat(pool.filter(function (x) { return used.indexOf(x) < 0; }).map(function (x) { var o = h('option', { value: x, text: x }); if (st.skillPicks[i] === x) o.selected = true; return o; })));
        sk.appendChild(sel);
      })(i);
    }
    wrap.appendChild(sk);
    var ex = h('input', { type: 'number', min: 0, max: 5, value: st.extraSkills || 0, onchange: function (e) { change(function (s) { s.extraSkills = Number(e.target.value) || 0; }); } });
    wrap.appendChild(h('div', { class: 'row' }, [h('label', {}, ['Extra trained skills from species or GM ruling ', ex])]));

    }
    // Sources
    var srcStart = wrap.childNodes.length;
    wrap.appendChild(h('h2', { text: embedded ? 'Sourcebooks, traditions and GM override' : 'Sourcebooks allowed' }));
    var srcRow = h('div', { class: 'row' });
    D.sources.forEach(function (s) {
      var cb = h('input', { type: 'checkbox', onchange: function (e) { change(function (x) { x.sources[s.key] = e.target.checked; }); } }); cb.checked = st.sources[s.key] !== false;
      srcRow.appendChild(h('label', {}, [cb, ' ' + s.label]));
    });
    wrap.appendChild(srcRow);
    if ((D.traditions || []).length) {
      wrap.appendChild(h('div', { class: 'small', text: 'Force traditions you belong to (each opens that tradition\'s talent tree for Force Sensitive characters; ask your GM):' }));
      var trRow = h('div', { class: 'row' });
      D.traditions.forEach(function (n) {
        var cb2 = h('input', { type: 'checkbox', onchange: function (e) { change(function (x) { x.traditions = x.traditions || []; var i = x.traditions.indexOf(n); if (e.target.checked && i < 0) x.traditions.push(n); if (!e.target.checked && i >= 0) x.traditions.splice(i, 1); }); } });
        cb2.checked = (st.traditions || []).indexOf(n) >= 0;
        trRow.appendChild(h('label', {}, [cb2, ' ' + n]));
      });
      wrap.appendChild(trRow);
    }
    var sa = h('input', { type: 'checkbox', onchange: function (e) { change(function (x) { x.showAll = e.target.checked; }); } }); sa.checked = !!st.showAll;
    wrap.appendChild(h('div', { class: 'row' }, [h('label', {}, [sa, ' GM override: also list options whose prerequisites are not met'])]));

    var srcNodes = [];
    while (wrap.childNodes.length > srcStart) srcNodes.push(wrap.childNodes[srcStart]), wrap.removeChild(wrap.childNodes[srcStart]);
    if (!embedded) srcNodes.forEach(function (n) { wrap.appendChild(n); });
    // Slots
    if (!embedded) wrap.appendChild(h('h2', { text: 'Feats and talents' }));
    else wrap.appendChild(h('div', { class: 'small', text: 'Level ' + st.plan.length + ' ' + st.plan.filter(function (c, i, a) { return a.indexOf(c) === i; }).map(function (c) { return c + ' ' + st.plan.filter(function (x) { return x === c; }).length; }).join(', ') + '. Slots update when you change class, level, ability scores, species or trained skills above.' }));
    var lastLvl = 0;
    slots.forEach(function (s, si) {
      var p = st.picks[s.id];
      var box = h('div', { class: 'slot ' + (s.kind === 'talent' ? 'talent' : '') + (bad[s.id] ? ' bad' : '') });
      box.appendChild(h('div', { class: 'lab' }, [s.label, h('div', { class: 'lvl', text: 'Level ' + s.lvl + ' (' + s.cls + ' ' + s.cl + ')' })]));
      var body = h('div');
      if (s.kind === 'start') {
        body.appendChild(h('div', { class: 'fixed', text: s.fixed }));
        if (s.fixed === 'Shake It Off' || s.fixed === 'Linguist') body.appendChild(h('div', { class: 'note', text: 'Only gained if you meet its prerequisite.' }));
      } else {
        var opts = optionsFor(st, slots, si);
        var showUnmet = st.showAll;
        var sel = h('select', { onchange: function (e) { change(function (x) { var v = e.target.value; if (!v) delete x.picks[s.id]; else x.picks[s.id] = s.kind === 'talent' ? { talent: v } : { feat: Number(v) }; }); } });
        sel.appendChild(h('option', { value: '', text: '(choose)' }));
        var groups = {}, order = [];
        opts.forEach(function (o) {
          var ok = o.unmet.length === 0;
          var sel_ = p && (s.kind === 'talent' ? p.talent === o.value : String(p.feat) === o.value);
          if (!ok && !showUnmet && !sel_) return;
          if (!groups[o.group]) { groups[o.group] = h('optgroup', { label: o.group }); order.push(o.group); }
          var t = o.label + (o.tag && o.tag !== 'CORE' ? ' [' + o.tag + ']' : '') + (o.note ? ' (' + o.note + ')' : '') + (ok ? '' : '  needs ' + o.unmet.join(', '));
          var op = h('option', { value: o.value, text: t }); if (sel_) op.selected = true; groups[o.group].appendChild(op);
        });
        order.forEach(function (g) { sel.appendChild(groups[g]); });
        body.appendChild(sel);
        var f = pickedFeat(p);
        if (f && f.choice === 'skill') {
          var ctx = contextAt(st, slots, si);
          var pool2 = f.name === 'Skill Training' ? skillsFor(st, st.plan.filter(function (c, i2) { return i2 < s.lvl; })).filter(function (x) { return !trainedHas(ctx, x); }) : ctx.trained.slice();
          var cs = h('select', { onchange: function (e) { change(function (x) { x.picks[s.id].choice = e.target.value; }); } }, [h('option', { value: '', text: f.name === 'Skill Training' ? '(skill to train)' : '(trained skill)' })].concat(pool2.map(function (z) { var o = h('option', { value: z, text: z }); if (p.choice === z) o.selected = true; return o; })));
          body.appendChild(cs);
        } else if (f && f.choice === 'text') {
          body.appendChild(h('input', { type: 'text', placeholder: f.name === 'Mission Specialist' ? 'skill' : 'weapon or group', value: p.choice || '', onchange: function (e) { change(function (x) { x.picks[s.id].choice = e.target.value; }); } }));
        }
        if (f) {
          body.appendChild(h('div', { class: 'note', text: f.benefit }));
          if (f.req.notes.length) body.appendChild(h('div', { class: 'note', text: 'Also needs: ' + f.req.notes.join('; ') + '.' }));
          if (f.req.other.length) body.appendChild(h('div', { class: 'note', text: 'Check yourself: ' + f.req.other.join('; ') + '.' }));
        }
        if (bad[s.id]) body.appendChild(h('div', { class: 'warn', text: 'Problem: ' + bad[s.id].join('; ') + '.' }));
        if (s.kind === 'bonus' && p && f) {
          var bn = (D.bonus[s.cls] || []).filter(function (b) { return b.f === f.id && b.note; })[0];
          if (bn) body.appendChild(h('div', { class: 'note', text: 'For this class: ' + bn.note + '.' }));
        }
        if (s.kind === 'talent') {
          var ctx2 = contextAt(st, slots, si);
          if (classHasForce(ctx2)) body.appendChild(h('div', { class: 'note', text: 'You are Force Sensitive, so this slot can also take a Force talent (listed under Force: groups).' }));
        }
      }
      box.appendChild(body);
      wrap.appendChild(box);
    });

    var ex2 = embedded ? null : h('div', { class: 'row' }, [h('button', { type: 'button', text: 'Copy build as JSON', onclick: function () { var t = JSON.stringify(api.getState()); try { navigator.clipboard.writeText(t); } catch (err) {} } })]);
    if (ex2) wrap.appendChild(ex2);
    if (embedded) {
      var det = h('details', { class: 'srcbox' }, [h('summary', { text: 'Sourcebooks, Force traditions and GM override' })]);
      srcNodes.forEach(function (n) { if (n.tagName !== 'H2') det.appendChild(n); });
      wrap.appendChild(det);
    }
    root.appendChild(wrap);
  }

  api.mount = function (el, opts) {
    opts = opts || {};
    root = el; onChangeCb = opts.onChange || null;
    embedded = typeof opts.context === 'function'; ctxFn = embedded ? opts.context : null;
    if (!document.getElementById('sw-style')) { var st = document.createElement('style'); st.id = 'sw-style'; st.textContent = STYLE; document.head.appendChild(st); }
    current = Object.assign(defaultState(), opts.state || {});
    if (!current.picks) current.picks = {};
    render();
    return api;
  };
  // Re-read the host context (class, level, abilities, species, trained skills) and redraw.
  api.refresh = function () { if (root) { render(); } };
  api.summarize = function (state) { return summarize(state || current); };

  window.SWSEPicker = api;
})();
