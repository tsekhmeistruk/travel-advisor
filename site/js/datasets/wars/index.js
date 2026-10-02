// The Wars mode: the map coloured by deaths in armed violence over 12 months (UCDP), and on the
// overview card the number of wars and how it moves. It is the risk mode on the `conflict`
// category (search, feed, countries list, country view, URL state and settings come from there),
// with its own overview and place cards, legend and header. Pure rules are in ./logic.js.
//
// UCDP's figures are preliminary and a month or two behind: the header names the month.

import { esc, safeUrl } from '../../core/dom.js';
import { createRiskMode } from '../risk/index.js';
import { levelOf } from '../risk/logic.js';
import { titleSize } from '../travel-advisories/logic.js';
import { overviewModel, placeModel, bandRows, conflictName, sparkPoints, barRects, conflictUrl } from './logic.js';

const SPARK = { w: 120, h: 34 };
const BARS = { w: 320, h: 46 };

export function createWarsMode(ctx) {
  const base = createRiskMode({ ...ctx, mode: 'wars', view: 'category', category: 'conflict' });
  const { i18n, places } = ctx;
  const tw = (key, params) => i18n.t(`wars.${key}`, params);
  const tr = (key, params) => i18n.t(`risk.${key}`, params);
  const num = (n) => i18n.formatNumber(n);
  const month = (ym) => i18n.formatMonth(ym);
  const placeName = (id) => (places.get(id) ? i18n.placeName(places.get(id)) : id);
  const swatch = (l) => (l === 1 ? 'var(--risk-normal)' : l ? `var(--l${l})` : 'var(--land-none)');
  const arrow = (dir) => `<span class="arrow ${dir}" title="${esc(tw(dir === 'up' ? 'escalating' : 'calming'))}">${dir === 'up' ? '▲' : '▼'}</span>`;
  const conflict = () => base.data().conflict;
  const level = (id) => levelOf(base.data().current, id, 'conflict');

  /** A conflict's name, or who fights it when UCDP hasn't named it yet. */
  const nameOf = (c) => conflictName(c, tw, placeName);

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
    const row = (key, ids, dir) => `<div class="wars-trend"><div class="history-label">${esc(tw(key))}</div><div class="wars-chips">${ids.length ? placeButtons(ids, dir) : `<span class="dim">${esc(tw('none'))}</span>`}</div></div>`;
    return `
      <div class="eyebrow">${esc(tw('eyebrow', { month: month(c.through) }))}</div>
      <div class="wars-head">
        <div class="wars-count"><b>${esc(num(m.wars))}</b><span>${esc(tw('wars', { count: m.wars }))}</span></div>
        ${m.spark.length > 1 ? sparkHtml(m) : ''}
      </div>
      <p class="wars-sub">${esc(tw('armed', { count: m.armed - m.wars, deaths: num(c.warDeaths) }))}</p>
      <p class="wars-deaths">${deathsText}</p>
      ${row('escalatingTitle', m.escalating, 'up')}
      ${row('calmingTitle', m.calming, 'down')}
      <p class="hint">${esc(tw('note'))}</p>
      <div class="card-actions"><button class="link link-btn" data-action="list">${esc(tr('list.open'))}</button></div>`;
  }

  function barsHtml(p) {
    const rects = barRects(p.months.map(x => x.deaths), BARS.w, BARS.h);
    const peak = Math.max(...p.months.map(x => x.deaths));
    return `<div class="wars-bars">
        <div class="history-label">${esc(tw('perMonth'))}<span class="dim">${esc(tw('peak', { deaths: num(peak) }))}</span></div>
        <svg viewBox="0 0 ${BARS.w} ${BARS.h}" preserveAspectRatio="none" aria-hidden="true">
          ${rects.map((r, i) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="1.5"><title>${esc(`${month(p.months[i].month)}: ${num(p.months[i].deaths)}`)}</title></rect>`).join('')}
        </svg>
        <div class="wars-axis"><span>${esc(month(p.months[0].month))}</span><span>${esc(month(p.months.at(-1).month))}</span></div>
      </div>`;
  }

  function conflictsHtml(p) {
    const line = (c, text) => `<li title="${esc(text)}"><span class="swatch" style="background:${swatch(c.war ? 4 : 3)}"></span><span class="what">${esc(text)}</span></li>`;
    const rows = [
      ...p.fought.map(c => line(c, tw(c.war ? 'foughtWar' : 'foughtConflict', { name: nameOf(c), deaths: num(c.deaths12) }))),
      ...p.elsewhere.map(c => line(c, tw('partyTo', { name: nameOf(c), war: tw(c.war ? 'war' : 'armedConflict'), place: placeName(c.places[0]) }))),
    ];
    if (!rows.length) rows.push(`<li class="dim"><span class="what">${esc(tw('noConflicts'))}</span></li>`);
    // Deaths between armed groups and attacks on civilians: no government is a side, so no conflict above names them.
    const other = p.byType.nonState + p.byType.oneSided ? tw('otherViolence', { groups: num(p.byType.nonState), civilians: num(p.byType.oneSided) }) : null;
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
      ${p ? barsHtml(p) + conflictsHtml(p) : `<p class="wars-quiet">${esc(tw('quiet', { month: month(c.through) }))}</p>`}
      <div class="card-actions">
        <button class="link link-btn" data-action="country" data-place="${esc(placeId)}">${esc(tr('card.details'))}</button>
        ${link ? `<a class="link" href="${esc(link)}" target="_blank" rel="noopener" title="${esc(link)}">${esc(tr('card.report', { source: tr('sources.ucdp') }))}</a>` : ''}
      </div>`;
  }

  return {
    ...base,
    id: 'wars',

    header() {
      const c = conflict();
      const meta = base.data().current.categories.conflict;
      const text = tw('header', { month: month(c.through) });
      return meta?.status && meta.status !== 'healthy' ? tr('headerIssue', { base: text, source: tr('sources.ucdp'), status: tr(`status.${meta.status}`) }) : text;
    },
    // Monthly data: its age is the month in the header, not hours since an update.
    stale: () => false,

    // No alerts here (UCDP has no events to mark): an event target shows its place.
    details(target) {
      return target?.placeId ? placeHtml(target.placeId) : overviewHtml();
    },

    tooltip(placeId) {
      const p = placeModel(conflict(), placeId);
      const l = level(placeId);
      const text = l == null ? tr('noData') : p ? tw('badge', { level: tr(`levels.${l}`), count: p.deaths12, deaths: num(p.deaths12) }) : tw('badgeNone', { level: tr(`levels.${l}`) });
      const trend = p?.trend ? `<div class="tt-row">${arrow(p.trend)}${esc(tw(p.trend === 'up' ? 'escalating' : 'calming'))}</div>` : '';
      return `<strong>${esc(placeName(placeId))}</strong><div class="tt-row"><span class="swatch" style="background:${swatch(l)}"></span>${esc(text)}</div>${trend}`;
    },

    legend() {
      const bands = bandRows(conflict().bands).map(b => `<span class="legend-item"><span class="swatch" style="background:${swatch(b.level)}"></span>${esc(
        b.level === 1 ? tw('legend.fewer', { min: num(b.max + 1) }) : b.max == null ? tw('legend.over', { min: num(b.min) }) : tw('legend.range', { min: num(b.min), max: num(b.max) }))}</span>`).join('');
      const days = ctx.settings.scope('risk', { recentDays: 30 }).get('recentDays');
      const window = days === 1 ? tr('window.day') : tr('window.days', { days });
      return `<span class="legend-item legend-title">${esc(tw('legend.title'))}</span>${bands}`
        + `<span class="legend-item"><span class="swatch none"></span>${esc(tr('legend.none'))}</span>`
        + `<span class="legend-item"><span class="legend-pulse"></span>${esc(tr('legend.recent', { window }))}</span>`;
    },
  };
}
