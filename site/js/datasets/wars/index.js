// The Wars mode: the map coloured by deaths in armed violence over 12 months (UCDP), and on the
// overview card the number of wars and how it moves. It is the risk mode on the `conflict`
// category (search, countries list, country view, URL state and settings come from there), with
// its own overview, place and war cards, legend, header and footer, and a list of the wars in
// place of the change feed (conflict levels rarely change; the wars are the news).
//
// A war (a target { warKey }) shows who fights whom: UCDP's sides, with the countries Wikipedia
// puts beside them and their backers (risk/wars.json). Hovered or selected, it colours its two
// sides on the map and fades the rest. The latest month's deaths are one dot per country, at its
// centre (risk/conflict-events.json, grouped by countryDots()). Pure rules are in ./logic.js.
//
// UCDP's figures are preliminary and a month or two behind: the header names the month.

import { esc, safeUrl } from '../../core/dom.js';
import { createRiskMode } from '../risk/index.js';
import { levelOf } from '../risk/logic.js';
import { titleSize } from '../travel-advisories/logic.js';
import {
  overviewModel, placeModel, bandRows, sparkPoints, barRects, conflictUrl, tensionRows,
  sideActors, firstNames, warRows, newRows, quietRows, warModel, warFocus, dotRadius, warTitle, countryDots, otherViolence,
} from './logic.js';

const SPARK = { w: 120, h: 34 };
const BARS = { w: 320, h: 46 };
const LIST_SHORT = 5;    // the Wars list shows this many until "Show all"
const MARK = '\u0000';   // placeholder for HTML inserted into an escaped message

export function createWarsMode(ctx) {
  const base = createRiskMode({ ...ctx, mode: 'wars', view: 'category', category: 'conflict' });
  const { i18n, places, client, manifest } = ctx;
  let wars = null;       // risk/wars.json: the context of each war (Wikipedia), when published
  let dots = null;       // risk/conflict-events.json: the latest month's events, when published
  let focus = null;      // warFocus() of the war the map shows (hovered or selected)
  let listAll = false;   // "Show all" was clicked in the Wars list (for this page view)

  const tw = (key, params) => i18n.t(`wars.${key}`, params);
  const tr = (key, params) => i18n.t(`risk.${key}`, params);
  const num = (n) => i18n.formatNumber(n);
  const month = (ym) => i18n.formatMonth(ym);
  const placeName = (id) => (places.get(id) ? i18n.placeName(places.get(id)) : id);
  const swatch = (l) => (l === 1 ? 'var(--risk-normal)' : l ? `var(--l${l})` : 'var(--land-none)');
  const arrow = (dir) => `<span class="arrow ${dir}" title="${esc(tw(dir === 'up' ? 'escalating' : 'calming'))}">${dir === 'up' ? '▲' : '▼'}</span>`;
  const conflict = () => base.data().conflict;
  const level = (id) => levelOf(base.data().current, id, 'conflict');
  /** A level for a number of deaths, by the published bands (1,000+ Critical …). */
  const deathsLevel = (deaths) => {
    const i = conflict().bands.findIndex(b => deaths >= b);
    return i < 0 ? 1 : 4 - i;
  };
  const actorOpts = { placeName, unnamed: tw('unidentified') };

  /** "SFA, RSF", or "Hamas, PIJ +2": the first `max` short names and how many more. */
  const shortList = (names, max = 2) => {
    const { names: shown, more } = firstNames(names, max);
    return more ? tw('andMore', { names: shown.join(', '), count: more }) : shown.join(', ');
  };
  /** "Russia vs Ukraine": a war's sides by their short names. */
  const vs = (a, b, max = 2) => tw('vs', { a: shortList(a.map(x => x.short), max), b: shortList(b.map(x => x.short), max) });
  /** A conflict's name for a row: its sides ("Yemen vs AQAP"). */
  const conflictVs = (key) => {
    const c = conflict().conflicts[key];
    const names = wars?.conflicts?.[key]?.names ?? {};
    return vs(sideActors(c.sides.a, { ...actorOpts, names }), sideActors(c.sides.b, { ...actorOpts, names }), 1);
  };
  /** A conflict gone quiet by its title, else its parties. */
  const quietName = (q) => q.title ?? q.parties.map(placeName).join(' – ');

  function sparkHtml(m) {
    const values = m.spark.map(p => p.wars);
    const pts = sparkPoints(values, SPARK.w, SPARK.h, 3);
    const last = pts.split(' ').at(-1)?.split(',');
    const first = m.spark[0];
    return `<div class="wars-spark" title="${esc(tw('sparkTitle', { from: month(first.month), count: first.wars }))}">
        <svg viewBox="0 0 ${SPARK.w} ${SPARK.h}" width="${SPARK.w}" height="${SPARK.h}" aria-hidden="true">
          <polyline points="${pts}" fill="none" stroke="var(--l4)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          ${last ? `<circle cx="${last[0]}" cy="${last[1]}" r="3" fill="var(--l4)"/>` : ''}
        </svg>
        <span class="wars-spark-label">${esc(tw('since', { month: month(first.month), count: first.wars }))}</span>
      </div>`;
  }

  /** "Afghanistan – Pakistan": each side's places. */
  const pairName = (t) => t.sides.map(side => side.map(placeName).join(', ')).join(' – ');

  /** The overview's Tensions: up to three pairs, as buttons to the first side's place; the figures in the title. */
  function tensionsHtml() {
    const tensions = base.data().current.activity?.gdelt?.tensions;
    if (!tensions) return '';
    const rows = tensionRows(tensions, 3).map(t => `<li><button data-place="${esc(t.sides[0][0])}" title="${esc(tw('tensionTitle', { pair: pairName(t), count: t.count, expected: num(Math.round(t.expected)), days: tensions.windowDays }))}">
        <span class="name">${esc(pairName(t))}</span><span class="when">${esc(tw('tensionShort', { count: num(t.count), expected: num(Math.round(t.expected)) }))}</span></button></li>`).join('');
    return `<div class="wars-tensions" title="${esc(tw('tensionsAbout'))}"><div class="history-label">${esc(tw('tensionsTitle', { days: tensions.windowDays }))}</div>
        ${rows ? `<ul class="latest-list">${rows}</ul>` : `<p class="latest-empty">${esc(tw('none'))}</p>`}</div>`;
  }

  function placeButtons(ids, dir) {
    return ids.map(id => `<button data-place="${esc(id)}">${esc(placeName(id))}${arrow(dir)}</button>`).join('');
  }

  function overviewHtml() {
    const c = conflict();
    const m = overviewModel(c);
    const d = m.deaths;
    const deathsDir = d.previous == null || d.count === d.previous ? null : d.count > d.previous ? 'up' : 'down';
    const deathsText = esc(tw('deaths', { month: month(d.month), count: d.count, deaths: num(d.count) }))
      + (deathsDir ? ` ${arrow(deathsDir)} <span class="dim">${esc(tw('deathsBefore', { deaths: num(d.previous) }))}</span>` : '');
    const row = (key, chips) => `<div class="wars-trend"><div class="history-label">${esc(tw(key))}</div><div class="wars-chips">${chips || `<span class="dim">${esc(tw('none'))}</span>`}</div></div>`;
    // New conflicts: buttons to their war card.
    const fresh = newRows(c).map(k => `<button data-war="${esc(k)}" title="${esc(warTitle(c.conflicts[k], wars?.conflicts?.[k]) ?? conflictVs(k))}">${esc(conflictVs(k))}</button>`).join('');
    // Blocks: the wars now; what is changing; tensions in the news (the list of wars is the block below).
    const tensions = tensionsHtml();
    return `<section class="card block">
      <div class="eyebrow">${esc(tw('eyebrow', { month: month(c.through) }))}</div>
      <div class="wars-head">
        <div class="wars-count" title="${esc(tw('armed', { count: m.armed - m.wars, deaths: num(c.warDeaths) }))}"><b>${esc(num(m.wars))}</b><span>${esc(tw('wars', { count: m.wars }))}</span></div>
        ${m.spark.length > 1 ? sparkHtml(m) : ''}
      </div>
      <p class="wars-deaths">${deathsText}</p>
    </section>
    <section class="card block">
      <div class="eyebrow">${esc(tw('changingTitle'))}</div>
      ${row('escalatingTitle', placeButtons(m.escalating, 'up'))}
      ${row('calmingTitle', placeButtons(m.calming, 'down'))}
      ${row('newTitle', fresh)}
    </section>
    ${tensions ? `<section class="card block">${tensions}</section>` : ''}`;
  }

  /** Deaths per month as bars; the war card leaves out the label (its peak is in the title). */
  function barsHtml(months, { label = true } = {}) {
    const rects = barRects(months.map(x => x.deaths), BARS.w, BARS.h);
    const peak = Math.max(...months.map(x => x.deaths));
    const heading = `${tw('perMonth')}${tw('peak', { deaths: num(peak) })}`;
    return `<div class="wars-bars"${label ? '' : ` title="${esc(heading)}"`}>
        ${label ? `<div class="history-label">${esc(tw('perMonth'))}<span class="dim">${esc(tw('peak', { deaths: num(peak) }))}</span></div>` : ''}
        <svg viewBox="0 0 ${BARS.w} ${BARS.h}" preserveAspectRatio="none" aria-hidden="true">
          ${rects.map((r, i) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="1.5"><title>${esc(`${month(months[i].month)}: ${num(months[i].deaths)}`)}</title></rect>`).join('')}
        </svg>
        <div class="wars-axis"><span>${esc(month(months[0].month))}</span><span>${esc(month(months.at(-1).month))}</span></div>
      </div>`;
  }

  function conflictsHtml(p) {
    // Each conflict is a button to its war card: who fights whom, and the deaths.
    const line = (c, text) => `<li><button data-war="${esc(c.key)}" title="${esc(text)}"><span class="swatch" style="background:${swatch(c.war ? 4 : 3)}"></span><span class="what">${esc(text)}</span></button></li>`;
    const rows = [
      ...p.fought.map(c => line(c, tw(c.war ? 'foughtWar' : 'foughtConflict', { name: conflictVs(c.key), deaths: num(c.deaths12) }))),
      ...p.elsewhere.map(c => line(c, tw('partyTo', { name: conflictVs(c.key), war: tw(c.war ? 'war' : 'armedConflict'), place: placeName(c.places[0]) }))),
    ];
    if (!rows.length) rows.push(`<li class="dim"><span class="what">${esc(tw('noConflicts'))}</span></li>`);
    // Deaths between armed groups and attacks on civilians: no government is a side, so no conflict above names them.
    const o = otherViolence(p.byType);
    const other = o ? tw(o.key, Object.fromEntries(Object.entries(o.params).map(([k, v]) => [k, num(v)]))) : null;
    return `<div class="wars-conflicts"><div class="history-label">${esc(tw('conflicts'))}</div><ul>${rows.slice(0, 3).join('')}</ul>
        <p class="wars-other">${other ? esc(other) : ''}</p></div>`;
  }

  function placeHtml(placeId) {
    const c = conflict();
    const p = placeModel(c, placeId);
    const name = placeName(placeId);
    const l = level(placeId);
    const badgeText = l == null ? tr('noData') : p ? tw('badge', { level: tr(`levels.${l}`), count: p.deaths12, deaths: num(p.deaths12) }) : tw('badgeNone', { level: tr(`levels.${l}`) });
    const trend = p?.trend ? `${arrow(p.trend)}${esc(tw(p.trend === 'up' ? 'trendUp' : 'trendDown', { last: num(p.last3), before: num(p.prev3) }))}` : '';
    const top = p?.fought[0] ?? p?.elsewhere[0];
    const link = top && c.links?.conflict ? safeUrl(conflictUrl(c.links.conflict, top.key)) : safeUrl(c.links?.home);
    return `
      <div class="eyebrow">${esc(tw('placeEyebrow'))}</div>
      <h3 class="${titleSize(name)}" title="${esc(name)}">${esc(name)}</h3>
      <span class="badge" style="--c:${swatch(l)}"><span class="swatch"></span>${esc(badgeText)}</span>
      <div class="trend">${trend}</div>
      ${p ? barsHtml(p.months) + conflictsHtml(p) : `<p class="wars-quiet">${esc(tw('quiet', { month: month(c.through) }))}</p>`}
      <div class="card-actions">
        ${link ? `<a class="link" href="${esc(link)}" target="_blank" rel="noopener" title="${esc(link)}">${esc(tr('card.report', { source: tr('sources.ucdp') }))}</a>` : ''}
      </div>`;
  }

  /** Country names, the first three and how many more, with every name in the title. */
  function countries(key, ids) {
    if (!ids.length) return '';
    const names = ids.map(placeName);
    const { names: shown, more } = firstNames(names, 3);
    const text = tw(key, { names: more ? tw('andMore', { names: shown.join(', '), count: more }) : shown.join(', ') });
    return `<span title="${esc(tw(key, { names: names.join(', ') }))}">${esc(text)}</span>`;
  }

  /** One side of a war, in its colour: its fighters (a government is a button to its place), then Wikipedia's allies and backers. */
  function sideHtml(side, cls, lead = '') {
    const { names: shown, more } = firstNames(side.actors, 3);
    const actor = (x) => (x.place ? `<button data-place="${esc(x.place)}">${esc(x.text)}</button>` : `<span${x.short !== x.text ? ` title="${esc(x.short)}"` : ''}>${esc(x.text)}</span>`);
    const all = side.actors.map(x => (x.short !== x.text ? `${x.text} (${x.short})` : x.text)).join(', ');
    const extra = [countries('with', side.with), countries('backedBy', side.backers)].filter(Boolean).join(' · ');
    return `<div class="war-side ${cls}">
        <div class="war-names" title="${esc(all)}">${lead}${shown.map(actor).join(', ')}${more ? ` <span class="dim">+${more}</span>` : ''}</div>
        <div class="war-extra">${extra}</div>
      </div>`;
  }

  /** A war's card: who fights whom, its deaths by month, and Wikipedia's summary. null for an unknown war. */
  function warHtml(key) {
    const c = conflict();
    const m = warModel(c, wars, key, actorOpts);
    if (!m) return null;
    const title = m.title ?? (m.sides ? vs(m.sides.a.actors, m.sides.b.actors) : m.parties.map(placeName).join(' – '));
    const kind = tw(m.quiet ? 'kindQuiet' : m.war ? 'kindWar' : 'kindConflict');
    const since = m.start ? (m.start.length === 4 ? m.start : month(m.start)) : null;
    const l = deathsLevel(m.deaths12);
    const ucdp = c.links?.conflict ? safeUrl(conflictUrl(c.links.conflict, key)) : null;
    const wiki = safeUrl(m.url);
    const map = safeUrl(m.map);
    const figures = m.quiet
      ? `<span class="badge" style="--c:${swatch(1)}"><span class="swatch"></span>${esc(tw('quietBadge', { month: month(m.quiet.lastDeaths) }))}</span>
         <div class="trend">${esc(tw('quietBefore', { count: m.quiet.deaths, deaths: num(m.quiet.deaths) }))}</div>`
      : `<span class="badge" style="--c:${swatch(l)}" title="${esc(tw('civilians', { count: m.civilians12, deaths: num(m.civilians12) }))}"><span class="swatch"></span>${esc(tw('warBadge', { count: m.deaths12, deaths: num(m.deaths12) }))}</span>
         <div class="trend">${m.trend ? `${arrow(m.trend)}${esc(tw(m.trend === 'up' ? 'escalatingTitle' : 'calmingTitle'))} · ` : ''}${esc(tw('warLast', { count: m.last, deaths: num(m.last), month: month(c.through) }))}</div>`;
    return `
      <div class="eyebrow">${esc(since ? tw('warEyebrow', { kind, since }) : kind)}</div>
      <h3 class="${titleSize(title)}" title="${esc(title)}">${esc(title)}</h3>
      ${m.sides ? `<div class="war-sides">${sideHtml(m.sides.a, 'a')}${sideHtml(m.sides.b, 'b', `<span class="war-vs">${esc(tw('vsShort'))}</span> `)}</div>` : ''}
      ${figures}
      ${m.months.length ? barsHtml(m.months, { label: false }) : ''}
      ${m.extract ? `<p class="war-extract" title="${esc(m.extract)}">${esc(m.extract)}</p><p class="war-credit">${esc(tw('credit'))}</p>`
    : `<p class="war-extract dim">${esc(tw('noArticle'))}</p>`}
      <div class="card-actions">
        ${wiki ? `<a class="link" href="${esc(wiki)}" target="_blank" rel="noopener" title="${esc(wiki)}">${esc(tw('linkWikipedia'))}</a>` : ''}
        ${map ? `<a class="link" href="${esc(map)}" target="_blank" rel="noopener" title="${esc(map)}">${esc(tw('linkMap'))}</a>` : ''}
        ${ucdp ? `<a class="link" href="${esc(ucdp)}" target="_blank" rel="noopener" title="${esc(ucdp)}">${esc(tr('card.report', { source: tr('sources.ucdp') }))}</a>` : ''}
      </div>`;
  }

  /** A row of the Wars list: who fights whom, the deaths, and its title with the trend. */
  function rowHtml(r) {
    const what = `${r.trend ? arrow(r.trend) : ''}${esc(r.title ?? tw(r.war ? 'war' : 'armedConflict'))}`;
    return `<li><button data-key="war:${esc(r.key)}" title="${esc(tw('rowTitle', { name: vs(r.a, r.b, 9), count: r.deaths12, deaths: num(r.deaths12) }))}">
        <span class="row"><span class="swatch" style="--c:${swatch(deathsLevel(r.deaths12))}"></span><span class="name">${esc(vs(r.a, r.b))}</span><span class="when">${esc(num(r.deaths12))}</span></span>
        <span class="what">${what}</span>
      </button></li>`;
  }
  function quietHtml(q) {
    return `<li><button data-key="war:${esc(q.key)}" title="${esc(quietName(q))}">
        <span class="row"><span class="swatch" style="--c:${swatch(1)}"></span><span class="name">${esc(quietName(q))}</span><span class="when">${esc(num(q.deaths))}</span></span>
        <span class="what">${esc(tw('quietSince', { month: month(q.lastDeaths) }))}</span>
      </button></li>`;
  }

  /** Where a war is fought (or, gone quiet, its parties): the places to zoom to. */
  const warPlaces = (key) => {
    const m = warModel(conflict(), wars, key, actorOpts);
    return m ? (m.places.length ? m.places : m.parties) : [];
  };

  return {
    ...base,
    id: 'wars',

    async load() {
      const [, w, d] = await Promise.all([
        base.load(),
        manifest.wars ? client.file(manifest.wars, manifest.asOf).catch(() => null) : null,
        manifest.conflictEvents ? client.file(manifest.conflictEvents, manifest.asOf).catch(() => null) : null,
      ]);
      wars = w;
      dots = d;
      focus = null;
    },

    header() {
      const c = conflict();
      const meta = base.data().current.categories.conflict;
      const text = tw('header', { month: month(c.through) });
      return meta?.status && meta.status !== 'healthy' ? tr('headerIssue', { base: text, source: tr('sources.ucdp'), status: tr(`status.${meta.status}`) }) : text;
    },
    // Monthly data: its age is the month in the header, not hours since an update.
    stale: () => false,
    /** One line: the sources, linked, and "How it works". */
    footer() {
      const sources = base.data().current.sources ?? {};
      const links = ['ucdp', 'gdelt', 'wikipedia'].filter(id => sources[id]).map(id => {
        const url = safeUrl(sources[id].url);
        return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(tr(`sources.${id}`))}</a>` : esc(tr(`sources.${id}`));
      });
      return `${esc(tw('footer', { sources: MARK })).replace(MARK, links.join(', '))} · <button class="link-btn" data-action="help">${esc(i18n.t('help.short'))}</button>`;
    },
    // The Filters only filtered the change feed, which the Wars list replaces.

    // No alerts here (UCDP has no events to mark): an event target shows its place.
    details(target) {
      if (target?.warKey) return warHtml(target.warKey) ?? overviewHtml();
      return target?.placeId ? placeHtml(target.placeId) : overviewHtml();
    },

    /** The war the map shows: the hovered or selected one. True when that changed (the map repaints). */
    focus(target) {
      const key = target?.warKey ?? null;
      if ((focus?.key ?? null) === key) return false;
      const m = key ? warModel(conflict(), wars, key, actorOpts) : null;
      focus = m ? warFocus(m) : null;
      return true;
    },
    hasWar: (key) => !!warModel(conflict(), wars, key, actorOpts),
    warPlaces,

    style(placeId) {
      const s = base.style(placeId);
      if (!focus) return s;
      const side = focus.a.has(placeId) ? 'side-a' : focus.b.has(placeId) ? 'side-b'
        : focus.allyA.has(placeId) ? 'side-a ally' : focus.allyB.has(placeId) ? 'side-b ally' : null;
      if (side) return { ...s, cls: side, muted: false, dim: false, dot: true, pulse: null };
      // Where it is fought, beyond its sides: one neutral shade, not that place's own level.
      if (focus.fought.has(placeId)) return { ...s, cls: 'fought', muted: false, dim: false, dot: true, pulse: null };
      // Everything else steps back: one muted grey, so the war's colours stand alone.
      return { ...s, muted: true, dim: false, dot: false, pulse: null };
    },

    /**
     * The latest month's deaths, one dot per country at its centre, sized by its deaths; a country
     * outside the war shown fades.
     */
    points() {
      return countryDots(dots?.events).map(d => ({ id: d.place, placeId: d.place, r: dotRadius(d.deaths), dim: !!focus && !d.keys.some(([k]) => k === focus.key) }));
    },
    /** A country's dot: its deaths in the month, and its two deadliest conflicts (who fights whom). */
    pointTooltip(id) {
      const d = countryDots(dots?.events).find(x => x.place === id);
      if (!d) return '';
      const name = (key) => (conflict().conflicts[key] ? conflictVs(key) : (dots.conflicts[key] ?? '').replace(/\s*\([^)]*\)/g, '').replace(/XXX\d+/g, tw('unidentified')));
      const rows = d.keys.slice(0, 2).map(([key, deaths]) => `<div class="tt-row">${esc(tw('dots.conflict', { name: name(key), count: deaths, deaths: num(deaths) }))}</div>`).join('');
      return `<strong>${esc(placeName(id))}</strong>
        <div class="tt-row">${esc(tw('dots.country', { month: month(dots.through), count: d.deaths, deaths: num(d.deaths) }))}</div>${rows}`;
    },
    /** A country's dot selects its deadliest war of the month (a listed conflict), else the country. */
    pointTarget(id) {
      const d = countryDots(dots?.events).find(x => x.place === id);
      if (!d) return null;
      const war = d.keys.find(([k]) => conflict().conflicts[k]);
      return war ? { warKey: war[0] } : { placeId: id };
    },

    tooltip(placeId) {
      const p = placeModel(conflict(), placeId);
      const l = level(placeId);
      const text = l == null ? tr('noData') : p ? tw('badge', { level: tr(`levels.${l}`), count: p.deaths12, deaths: num(p.deaths12) }) : tw('badgeNone', { level: tr(`levels.${l}`) });
      const trend = p?.trend ? `<div class="tt-row">${arrow(p.trend)}${esc(tw(p.trend === 'up' ? 'escalating' : 'calming'))}</div>` : '';
      // Its deadliest conflict, who fights whom (fought there, else one it is a party to).
      const top = p?.fought[0] ?? p?.elsewhere[0];
      const war = top ? `<div class="tt-row">${esc(tw(top.war ? 'foughtWar' : 'foughtConflict', { name: conflictVs(top.key), deaths: num(top.deaths12) }))}</div>` : '';
      return `<strong>${esc(placeName(placeId))}</strong><div class="tt-row"><span class="swatch" style="background:${swatch(l)}"></span>${esc(text)}</div>${war}${trend}`;
    },
    /** A war in the phone's sheet: who fights whom and the deaths. */
    warTooltip(key) {
      const m = warModel(conflict(), wars, key, actorOpts);
      if (!m) return '';
      const name = m.sides ? vs(m.sides.a.actors, m.sides.b.actors) : m.title ?? m.parties.map(placeName).join(' – ');
      return `<strong>${esc(name)}</strong><div class="tt-row">${esc(m.quiet ? tw('quietBadge', { month: month(m.quiet.lastDeaths) }) : tw('warBadge', { count: m.deaths12, deaths: num(m.deaths12) }))}</div>`;
    },

    legend() {
      // Each band in the legend shows or hides its places (its level: main.js calls toggleLevel).
      const shown = ctx.settings.scope('risk', { levels: [1, 2, 3, 4] }).get('levels');
      const bands = bandRows(conflict().bands).map(b => `<button class="legend-item legend-toggle" data-level="${b.level}" aria-pressed="${shown.includes(b.level)}" title="${esc(i18n.t('panel.levelToggle'))}"><span class="swatch" style="background:${swatch(b.level)}"></span>${esc(
        b.level === 1 ? tw('legend.fewer', { min: num(b.max + 1) }) : b.max == null ? tw('legend.over', { min: num(b.min) }) : tw('legend.range', { min: num(b.min), max: num(b.max) }))}</button>`).join('');
      const days = ctx.settings.scope('risk', { recentDays: 30 }).get('recentDays');
      const window = days === 1 ? tr('window.day') : tr('window.days', { days });
      return `<span class="legend-item legend-title">${esc(tw('legend.title'))}</span>${bands}`
        + `<span class="legend-item"><span class="swatch none"></span>${esc(tr('legend.none'))}</span>`
        + (dots?.events.length ? `<span class="legend-item"><span class="legend-dot"></span>${esc(tw('legend.dots', { month: month(dots.through) }))}</span>` : '')
        + `<span class="legend-item"><span class="legend-pulse"></span>${esc(tr('legend.recent', { window }))}</span>`;
    },

    /** The Wars list (in place of the change feed): the deadliest first, then all, then those gone quiet. */
    renderFeed(container) {
      const section = container.closest('.recent');
      section.hidden = false;
      const rows = warRows(conflict(), wars, actorOpts);
      const quiet = quietRows(conflict(), wars);
      section.querySelector('#recentTitle').textContent = tw('listTitle');
      section.querySelector('#recentCount').textContent = rows.length;
      const tools = section.querySelector('#recentTools');
      if (tools) tools.innerHTML = '';
      const shown = listAll ? rows : rows.slice(0, LIST_SHORT);
      const tail = listAll
        ? (quiet.length ? `<li class="recent-sub" title="${esc(tw('quietAbout'))}">${esc(tw('quietTitle'))}</li>${quiet.map(quietHtml).join('')}` : '')
        : rows.length + quiet.length > shown.length ? `<li class="recent-more"><button class="link-btn" data-feed-all>${esc(tw('listAll', { count: rows.length }))}</button></li>` : '';
      container.innerHTML = rows.length ? shown.map(rowHtml).join('') + tail : `<li class="recent-empty">${esc(tw('none'))}</li>`;
      container.onclick = (e) => {
        if (!e.target.closest('[data-feed-all]')) return;
        listAll = true;
        this.renderFeed(container);
      };
    },
    feedTarget: (key) => (key?.startsWith('war:') ? { warKey: key.slice(4) } : base.feedTarget(key)),
    feedKeyFor: (target) => (target?.warKey ? `war:${target.warKey}` : null),

    /** Places, alerts, then the wars by who fights whom (and their titles). */
    searchEntries() {
      const c = conflict();
      const entries = warRows(c, wars, actorOpts).map(r => ({
        label: vs(r.a, r.b, 3), aliases: [r.title, c.conflicts[r.key].name].filter(Boolean), swatch: swatch(deathsLevel(r.deaths12)),
        sub: tw(r.war ? 'searchWar' : 'searchConflict', { count: r.deaths12, deaths: num(r.deaths12) }), target: { warKey: r.key },
      }));
      return [...base.searchEntries(), ...entries];
    },
  };
}
