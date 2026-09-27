// The risk modes: the map coloured by our risk level (1–4) per place, from the published risk
// files. One factory serves every risk mode (see ../registry.js):
//   view 'highest'   the highest level of any category
//   view 'category'  one category, e.g. disaster
//   view 'changes'   the highest level, with places that had no change in the window faded
// Implements the dataset interface described in ../registry.js. Pure rules are in ./logic.js.
//
// Our levels are a summary of the sources, never presented as a source's own level: the card
// names the source facts behind each level (a government's advisory, a GDACS alert).

import { esc, safeUrl } from '../../core/dom.js';
import { levelOf, highest, filterChanges, changesFor, changePlaces, direction, pulseOpacity, countByLevel, countDirections, cardModel, ageHours, PULSE_KINDS } from './logic.js';
import { titleSize } from '../travel-advisories/logic.js';

const MARK = '\u0000';   // placeholder for HTML inserted into an escaped message
export const WINDOWS = [1, 7, 30, 90];
const FEED_LIMIT = 50;
const LEVELS = [1, 2, 3, 4];

/**
 * @param ctx  { i18n, settings, client, manifest (the manifest's `risk` entry), places, changed,
 *              mode (its id), view, category, now? }
 */
export function createRiskMode(ctx) {
  const { i18n, manifest, places, client, mode, view, category } = ctx;
  const now = () => ctx.now?.() ?? Date.now();
  const settings = ctx.settings.scope('risk', { levels: LEVELS.slice(), recentDays: 30, direction: 'all', dimOthers: false });
  let current = null;
  let changes = [];
  let events = [];

  const tr = (key, params) => i18n.t(`risk.${key}`, params);
  const levelName = (l) => (l == null ? tr('noData') : tr(`levels.${l}`));
  const catName = (c) => tr(`categories.${c}`);
  const typeName = (t) => (i18n.has(`risk.eventTypes.${t}`) ? tr(`eventTypes.${t}`) : t);
  const alertName = (a) => (i18n.has(`risk.alerts.${a}`) ? tr(`alerts.${a}`) : a);
  const sourceName = (id) => (i18n.has(`risk.sources.${id}`) ? tr(`sources.${id}`) : i18n.t(`datasets.travel-advisories.providers.${id}.short`));
  const windowText = (d) => (d === 1 ? tr('window.day') : tr('window.days', { days: d }));
  const modeName = () => i18n.t(`modes.${mode}.label`);
  const placeName = (id) => (places.get(id) ? i18n.placeName(places.get(id)) : id);
  const windowDays = () => settings.get('recentDays');
  const levels = () => settings.get('levels');
  const swatch = (l) => (l ? `var(--l${l})` : 'var(--land-none)');

  // Validate saved settings against what's available now.
  if (!WINDOWS.includes(windowDays())) settings.set('recentDays', 30);
  if (!Array.isArray(levels())) settings.set('levels', LEVELS.slice());
  if (!['all', 'up', 'down'].includes(settings.get('direction'))) settings.set('direction', 'all');

  const categories = view === 'category' ? new Set([category]) : null;
  const viewLevel = (id) => (view === 'category' ? levelOf(current, id, category) : highest(current, id).level);

  // The changes the map and feed show, recomputed only when the settings change.
  let memo = null;
  function shown() {
    const key = `${windowDays()}|${settings.get('direction')}`;
    if (memo?.key !== key) {
      memo = { key, list: filterChanges(changes, { windowDays: windowDays(), direction: settings.get('direction'), categories, now: now() }) };
    }
    return memo.list;
  }

  async function load() {
    const [c, ch, ev] = await Promise.all([
      client.file(manifest.current, manifest.asOf), client.file(manifest.changes, manifest.asOf), client.file(manifest.events, manifest.asOf),
    ]);
    current = c;
    changes = ch.changes;
    events = ev.events;
    memo = null;
  }

  // ---- text

  function changeText(c) {
    if (c.kind === 'level') return tr('change.level', { category: catName(c.category), from: levelName(c.from), to: levelName(c.to) });
    if (c.kind === 'advisory') {
      const provider = sourceName(c.source);
      if (c.from != null) return tr('change.advisory', { provider, from: c.from, to: c.to });
      return tr(c.up ? 'change.advisoryUp' : 'change.advisoryDown', { provider, to: c.to });
    }
    const params = { source: sourceName(c.source), alert: alertName(c.native), type: typeName(c.type) };
    if (c.new) return tr('change.eventNew', params);
    return tr(c.up ? 'change.eventUp' : 'change.eventDown', params);
  }

  function arrow(dir) {
    return `<span class="arrow ${dir}" title="${esc(tr(dir === 'up' ? 'change.raised' : 'change.lowered'))}">${dir === 'up' ? '▲' : '▼'}</span>`;
  }

  /** "Mexico", "Kenya +7" for a change on several places, or the event's name when it is on none. */
  function changeName(c) {
    const ids = changePlaces(c);
    if (!ids.length) return events.find(e => e.id === c.eventId)?.name ?? typeName(c.type);
    return ids.length > 1 ? `${placeName(ids[0])} +${ids.length - 1}` : placeName(ids[0]);
  }

  function levelLabel(id) {
    if (view === 'category') return tr('card.categoryLevel', { category: catName(category), level: levelName(levelOf(current, id, category)) });
    const h = highest(current, id);
    if (h.level == null) return levelName(null);
    return h.by.length ? tr('card.highestBy', { level: levelName(h.level), categories: h.by.map(catName).join(', ') }) : tr('card.highest', { level: levelName(h.level) });
  }

  // ---- views

  function badge(level, text) {
    return `<span class="badge" style="--c:${swatch(level)}"><span class="swatch"></span>${esc(text)}</span>`;
  }

  function overviewHtml() {
    const counts = countByLevel(places.keys(), viewLevel);
    const desc = [...LEVELS].reverse();
    const moves = countDirections(filterChanges(changes, { windowDays: windowDays(), categories, now: now() }));
    return `
      <div class="eyebrow">${esc(tr('overview.eyebrow', { mode: modeName() }))}</div>
      <h3>${esc(tr('overview.above', { count: counts[1] + counts[2] + counts[3] }))}</h3>
      <div class="stack" aria-hidden="true">
        ${desc.map(l => `<span style="--c:var(--l${l});flex:${counts[l - 1]}"></span>`).join('')}
      </div>
      <div class="overview-grid">
        ${desc.map(l => `<div><span class="swatch" style="background:var(--l${l})"></span>${esc(levelName(l))}<b>${counts[l - 1]}</b></div>`).join('')}
      </div>
      <p class="moves">${esc(tr('overview.changes', { window: windowText(windowDays()), up: MARK, down: '\u0001' }))
    .replace(MARK, `${arrow('up')} <strong>${moves.up}</strong>`).replace('\u0001', `${arrow('down')} <strong>${moves.down}</strong>`)}</p>
      <p class="hint">${esc(tr('overview.hint'))}</p>`;
  }

  function basisText(row) {
    if (row.basis?.travel) return tr('card.travelBasis', { agree: row.basis.travel.agree, count: row.basis.travel.count });
    const first = row.basis?.events?.[0];
    if (first) {
      const text = tr('card.eventBasis', { source: sourceName(first.source), alert: alertName(first.native.value), type: typeName(first.type) });
      return row.basis.events.length > 1 ? tr('card.more', { text, count: row.basis.events.length - 1 }) : text;
    }
    if (row.category === 'travel') return tr('card.notCovered');
    return row.level == null ? tr('card.unavailable') : '';
  }

  function cardHtml(placeId) {
    const m = cardModel(placeId, { current, changes, events, now: now(), windowDays: windowDays() });
    const name = placeName(placeId);
    const level = viewLevel(placeId);
    const rows = m.rows.map(r => `
      <li class="${r.category === category ? 'is-focus' : ''}">
        <span class="swatch" style="background:${swatch(r.level)}"></span>
        <span class="cat">${esc(catName(r.category))}</span>
        <span class="lvl">${esc(levelName(r.level))}</span>
        ${r.changed ? arrow(r.changed) : ''}
        <span class="basis" title="${esc(basisText(r))}">${esc(basisText(r))}</span>
      </li>`).join('');
    const history = m.history.length
      ? m.history.map(c => `<li>${arrow(direction(c))}<span class="what">${esc(changeText(c))}</span><span class="date">${esc(i18n.formatDate(c.at.slice(0, 10)))}</span></li>`).join('')
      : `<li class="since none">${esc(tr('card.noChanges', { days: 90 }))}</li>`;
    const link = safeUrl(m.link);
    return `
      <div class="eyebrow">${esc(tr('card.eyebrow'))}</div>
      <h3 class="${titleSize(name)}" title="${esc(name)}">${esc(name)}</h3>
      ${badge(level, levelLabel(placeId))}
      <div class="trend">${m.trend ? `${arrow(m.trend)}${esc(tr(m.trend === 'up' ? 'card.raised24' : 'card.lowered24'))}` : ''}</div>
      <ul class="risk-rows">${rows}</ul>
      <p class="later">${esc(tr('card.later'))}</p>
      <div class="history"><div class="history-label">${esc(tr('card.history'))}</div><ul class="history-list">${history}</ul></div>
      ${link ? `<a class="link" href="${esc(link)}" target="_blank" rel="noopener" title="${esc(link)}">${esc(tr('card.report', { source: sourceName('gdacs') }))}</a>` : ''}`;
  }

  /** The card of one event (a marker or a feed item): the source's facts, with our level beside them. */
  function eventHtml(e) {
    const url = safeUrl(e.url);
    const where = e.placeIds.length ? e.placeIds.map(placeName).join(', ') : tr('event.offshore');
    const row = (label, value) => `<div><dt>${esc(label)}</dt><dd title="${esc(value)}">${esc(value)}</dd></div>`;
    return `
      <div class="eyebrow">${esc(tr('event.eyebrow', { source: sourceName(e.source), category: catName(e.category) }))}</div>
      <h3 class="${titleSize(e.name)}" title="${esc(e.name)}">${esc(e.name)}</h3>
      ${badge(e.level, tr('event.badge', { alert: alertName(e.native.value), level: levelName(e.level) }))}
      <p class="desc">${esc(e.severity ?? typeName(e.type))}</p>
      <dl class="meta">
        ${row(tr('event.started'), i18n.formatDate(e.startedAt.slice(0, 10)))}
        ${row(tr(e.current ? 'event.current' : 'event.ended'), i18n.formatDate(e.toDate.slice(0, 10)))}
        ${row(tr('event.places'), where)}
      </dl>
      <p class="event-note">${esc(tr('event.note', { source: sourceName(e.source) }))}</p>
      ${url ? `<a class="link" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(url)}">${esc(tr('card.report', { source: sourceName(e.source) }))}</a>` : ''}`;
  }

  // ---- the dataset interface

  return {
    id: mode,
    load,

    providers: () => [],
    provider: () => null,
    async setProvider() {},

    mapLabel: () => tr('mapLabel', { mode: modeName() }),
    providerSwitchLabel: () => '',

    header() {
      const age = i18n.relativeHours(ageHours(current.asOf, now()));
      const issue = Object.entries(current.categories)
        .filter(([c, meta]) => (!categories || categories.has(c)) && meta.status && meta.status !== 'healthy')
        .map(([, meta]) => meta)[0];
      return issue ? tr('headerIssue', { age, source: sourceName(issue.sources[0]), status: tr(`status.${issue.status}`) }) : tr('header', { age });
    },
    /** Footer HTML: the sources, linked, and that the levels are ours. */
    footer() {
      const links = Object.entries(current.sources ?? {}).map(([id, s]) => {
        const url = safeUrl(s.url);
        return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(sourceName(id))}</a>` : esc(sourceName(id));
      });
      return esc(tr('footer', { sources: MARK })).replace(MARK, links.join(', '));
    },

    style(placeId) {
      const level = viewLevel(placeId);
      const muted = level != null && !levels().includes(level);
      const list = shown();
      const changed = list.some(c => changePlaces(c).includes(placeId));
      // A pulse means the colour moved: none on a hidden level or on a place without data.
      const pulse = level != null && !muted ? list.find(c => PULSE_KINDS.has(c.kind) && changePlaces(c)[0] === placeId) : null;
      return {
        cls: level ? `l${level}` : 'none',
        muted,
        dim: (view === 'changes' || settings.get('dimOthers')) && !changed,
        // Every place is covered (GDACS is global), so a dot for every tiny Normal place would
        // cover the oceans: only places above Normal get one. Search still finds the others.
        dot: level > 1,
        pulse: pulse ? pulseOpacity(pulse, windowDays(), now()) : null,
      };
    },

    hasPlace: (placeId) => viewLevel(placeId) != null,

    details(target) {
      const event = target?.eventId && events.find(e => e.id === target.eventId);
      if (event) return eventHtml(event);
      if (!target?.placeId) return overviewHtml();
      return cardHtml(target.placeId);
    },

    /**
     * Event markers for the map: the mode's category, or every major event (Orange and Red) in
     * the highest mode; none in the changes mode. Hidden levels hide their markers too.
     */
    markers() {
      if (view === 'changes') return [];
      return events
        .filter(e => e.point && (view === 'category' ? e.category === category : (e.level ?? 1) >= 3) && levels().includes(e.level ?? 1))
        .map(e => ({ id: e.id, lon: e.point.lon, lat: e.point.lat, kind: e.type, level: e.level ?? 1 }));
    },
    /** A marker's selection target: the event, on its first place. */
    eventTarget(id) {
      const e = events.find(x => x.id === id);
      return e ? { eventId: id, ...(e.placeIds[0] && { placeId: e.placeIds[0] }) } : null;
    },
    /** Tooltip for a marker, or a cluster of several. */
    markerTooltip(ids) {
      const list = ids.map(id => events.find(e => e.id === id)).filter(Boolean);
      const line = (e) => `<span class="swatch" style="background:${swatch(e.level)}"></span>${esc(tr('event.badge', { alert: alertName(e.native.value), level: levelName(e.level) }))} · ${esc(typeName(e.type))}`;
      if (list.length === 1) return `<strong>${esc(list[0].name)}</strong><div class="tt-row">${line(list[0])}</div>`;
      const shown = list.slice(0, 4).map(e => `<div class="tt-row">${line(e)}</div>`).join('');
      const more = list.length > 4 ? `<div class="tt-row">${esc(tr('feed.more', { count: list.length - 4 }))}</div>` : '';
      return `<strong>${esc(tr('markers.count', { count: list.length }))}</strong>${shown}${more}`;
    },

    tooltip(placeId) {
      const level = viewLevel(placeId);
      const lines = [`<span class="swatch" style="background:${swatch(level)}"></span>${esc(levelLabel(placeId))}`];
      const c = filterChanges(changesFor(placeId, changes), { windowDays: windowDays(), categories, now: now() })[0];
      if (c) lines.push(`${arrow(direction(c))}${esc(tr('tooltip.change', { change: changeText(c), age: i18n.relativeHours(ageHours(c.at, now())) }))}`);
      return `<strong>${esc(placeName(placeId))}</strong>${lines.map(l => `<div class="tt-row">${l}</div>`).join('')}`;
    },

    legend() {
      return LEVELS.map(l => `<span class="legend-item"><span class="swatch" style="background:var(--l${l})"></span>${esc(levelName(l))}</span>`).join('')
        + `<span class="legend-item"><span class="swatch none"></span>${esc(tr('legend.none'))}</span>`
        + `<span class="legend-item"><span class="legend-pulse"></span>${esc(tr('legend.recent', { window: windowText(windowDays()) }))}</span>`
        + (view === 'changes' ? '' : `<span class="legend-item"><span class="legend-marker"></span>${esc(tr('legend.markers'))}</span>`);
    },

    renderSettings(container) {
      const dir = settings.get('direction');
      container.innerHTML = `
        <div class="setting">
          <span class="setting-label">${esc(tr('settings.levels'))}</span>
          <div class="chips" id="riskLevelChips">
            ${LEVELS.map(l => `<button class="chip" data-level="${l}" style="--c:var(--l${l})" aria-pressed="${levels().includes(l)}"><span class="swatch"></span>${esc(levelName(l))}</button>`).join('')}
          </div>
        </div>
        <div class="setting">
          <span class="setting-label">${esc(tr('settings.window'))}</span>
          <div class="segmented" id="riskWindowSeg" role="radiogroup" aria-label="${esc(tr('settings.window'))}">
            ${WINDOWS.map(d => `<button role="radio" data-days="${d}" aria-checked="${d === windowDays()}">${esc(d === 1 ? tr('settings.hours24') : tr('settings.days', { days: d }))}</button>`).join('')}
          </div>
        </div>
        <div class="setting">
          <span class="setting-label">${esc(tr('settings.direction'))}</span>
          <div class="segmented" id="riskDirectionSeg" role="radiogroup" aria-label="${esc(tr('settings.direction'))}">
            ${['all', 'up', 'down'].map(d => `<button role="radio" data-dir="${d}" aria-checked="${d === dir}">${esc(tr(`settings.${d}`))}</button>`).join('')}
          </div>
        </div>
        ${view === 'changes' ? '' : `<label class="setting row">
          <span class="setting-label">${esc(tr('settings.dim'))}</span>
          <span class="switch"><input type="checkbox" id="riskDimToggle" ${settings.get('dimOthers') ? 'checked' : ''}><span></span></span>
        </label>`}`;
      container.onclick = (e) => {
        const chip = e.target.closest('.chip');
        if (chip) {
          const l = Number(chip.dataset.level);
          settings.set('levels', levels().includes(l) ? levels().filter(x => x !== l) : [...levels(), l].sort());
          return ctx.changed();
        }
        const seg = e.target.closest('[data-days]');
        if (seg) { settings.set('recentDays', Number(seg.dataset.days)); return ctx.changed(); }
        const d = e.target.closest('[data-dir]');
        if (d) { settings.set('direction', d.dataset.dir); ctx.changed(); }
      };
      container.onchange = (e) => {
        if (e.target.id === 'riskDimToggle') { settings.set('dimOthers', e.target.checked); ctx.changed(); }
      };
    },

    /** The change feed. Items carry data-key (the change id) for hover/select wiring. */
    renderFeed(container) {
      const section = container.closest('.recent');
      section.hidden = false;
      const items = shown().filter(c => c.to == null || levels().includes(c.to));
      section.querySelector('#recentTitle').textContent = tr('feed.title', { window: windowText(windowDays()) });
      section.querySelector('#recentCount').textContent = items.length;
      const more = items.length - FEED_LIMIT;
      container.innerHTML = items.length
        ? items.slice(0, FEED_LIMIT).map(c => `<li><button data-key="${esc(c.id)}" title="${esc(changeText(c))}">
            <span class="row">
              <span class="swatch" style="--c:${swatch(c.to)}"></span>
              <span class="name">${esc(changeName(c))}</span>
              <span class="when">${esc(i18n.shortHours(ageHours(c.at, now())))}</span>
            </span>
            <span class="what">${arrow(direction(c))}${esc(changeText(c))}</span>
          </button></li>`).join('') + (more > 0 ? `<li class="recent-empty">${esc(tr('feed.more', { count: more }))}</li>` : '')
        : `<li class="recent-empty">${esc(tr('feed.empty'))}</li>`;
    },

    /** A feed item's target: its first place, and its event when it is about one (the card then shows the event). */
    feedTarget(key) {
      const c = changes.find(x => x.id === key);
      if (!c) return null;
      const id = changePlaces(c)[0];
      const event = c.eventId && events.some(e => e.id === c.eventId) ? { eventId: c.eventId } : null;
      return id || event ? { ...event, ...(id && { placeId: id }) } : null;
    },
    feedKeyFor(target) {
      if (target?.eventId) {
        const hit = shown().find(c => c.eventId === target.eventId);
        if (hit) return hit.id;
      }
      return target?.placeId ? shown().find(c => changePlaces(c).includes(target.placeId))?.id ?? null : null;
    },

    searchEntries() {
      return [...places.values()].map(place => {
        const level = viewLevel(place.id);
        return { label: i18n.placeName(place), aliases: [place.name], swatch: swatch(level), sub: levelName(level), target: { placeId: place.id } };
      });
    },
  };
}
