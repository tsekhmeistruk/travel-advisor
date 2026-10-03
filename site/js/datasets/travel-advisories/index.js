// The travel-advisories dataset: official advisory levels (1–4) from several governments
// ("providers"), one provider shown at a time. Implements the dataset interface described in
// ../registry.js. Pure rules are in ./logic.js; this module renders and handles input.

import { esc, safeUrl } from '../../core/dom.js';
import { indexByPlace, isRecent, latestChange, recentRecords, pulseOpacity, noAdvisoryReason, titleSize } from './logic.js';

const ID = 'travel-advisories';
const MARK = '\u0000';   // placeholder for HTML inserted into an escaped message
const STALE_DAYS = 7;     // the header warns about data older than this
const WINDOWS = [7, 30, 90];   // the Latest level changes block's switch

export function createTravelAdvisories(ctx) {
  const { i18n, manifest, places, client } = ctx;
  const levelsAll = manifest.scale.values;
  const settings = ctx.settings.scope(ID, {
    provider: manifest.providers[0].id,
    levels: levelsAll.slice(),
    recentDays: manifest.defaultRecentWindow,
    dimOthers: false,
  });
  let data = null;          // active provider file
  let byPlace = new Map();  // placeId -> { record, direct }

  const tx = (key, params) => i18n.t(`datasets.${ID}.${key}`, params);
  const tp = (key, params) => tx(`providers.${data.provider}.${key}`, params);
  const levelInfo = (level) => ({ name: tp(`levels.${level}.name`), short: tp(`levels.${level}.short`), desc: tp(`levels.${level}.desc`) });
  const windowDays = () => settings.get('recentDays');
  const levels = () => settings.get('levels');
  const recent = (record) => isRecent(record, windowDays(), i18n.ageDays);
  const placeName = (id) => (places.get(id) ? i18n.placeName(places.get(id)) : id);
  const recordName = (r) => (r.places.length === 1 ? placeName(r.places[0]) : r.title);

  // Validate saved settings against what's available now.
  if (!manifest.providers.some(p => p.id === settings.get('provider'))) settings.set('provider', manifest.providers[0].id);
  // The Filters are gone (Oct 2026): a window of 7, 30 or 90 days (no "off"), no fading.
  if (!WINDOWS.includes(windowDays())) settings.set('recentDays', WINDOWS.includes(manifest.defaultRecentWindow) ? manifest.defaultRecentWindow : 30);
  settings.set('dimOthers', false);
  if (!Array.isArray(levels())) settings.set('levels', levelsAll.slice());

  /** The records with a level change in the window, on shown levels, newest change first. */
  const changedRecords = () => recentRecords(data.records, { windowDays: windowDays(), levels: levels(), ageDays: i18n.ageDays });

  async function load() {
    const entry = manifest.providers.find(p => p.id === settings.get('provider'));
    data = await client.file(entry.file, entry.asOf);
    byPlace = indexByPlace(data.records);
  }

  function recordFor(target) {
    if (!target) return null;
    if (target.recordKey) return data.records.find(r => r.title === target.recordKey) ?? null;
    return byPlace.get(target.placeId)?.record ?? null;
  }

  // ---- views

  function badge(color, text) {
    return `<span class="badge" style="--c:${color}"><span class="swatch"></span>${esc(text)}</span>`;
  }
  function title(name) {
    return `<h3 class="${titleSize(name)}" title="${esc(name)}">${esc(name)}</h3>`;
  }

  /** The overview: one "Now" block (the government's advisories by level); the changes are the block below. */
  function overviewHtml() {
    const counts = levelsAll.map(l => data.records.filter(r => r.level === l).length);
    const desc = [...levelsAll].reverse();
    return `<section class="card block">
      <div class="eyebrow">${esc(tx('overview.eyebrow', { provider: tp('name') }))}</div>
      <h3>${esc(tx('overview.count', { count: data.records.length }))}</h3>
      <div class="stack" aria-hidden="true">
        ${desc.map(l => `<span style="--c:var(--l${l});flex:${counts[l - 1]}"></span>`).join('')}
      </div>
      <div class="overview-grid">
        ${desc.map(l => `<div><span class="swatch" style="background:var(--l${l})"></span>${esc(i18n.t(`risk.levels.${l}`))}<b>${counts[l - 1]}</b></div>`).join('')}
      </div>
    </section>`;
  }

  function noAdvisoryHtml(placeId) {
    const reason = noAdvisoryReason(placeId, data);
    const text = reason === 'home' ? tx('none.home', { agency: tp('agency') })
      : reason === 'territory' ? tx('none.territory', { short: tp('short') })
        : tx('none.missing');
    return `
      <div class="eyebrow">${esc(tx('none.eyebrow'))}</div>
      ${title(placeName(placeId))}
      ${badge('var(--land-none)', tx('none.badge'))}
      <p class="desc">${esc(text)}</p>`;
  }

  // "Level 2 → 3"
  function changeText(c) {
    return tx('change.fromTo', { from: c.from, to: c.to });
  }
  function arrow(c) {
    return `<span class="arrow ${c.up ? 'up' : 'down'}" title="${esc(tx(c.up ? 'change.raised' : 'change.lowered'))}">${c.up ? '▲' : '▼'}</span>`;
  }

  // The level history: the latest changes, newest first, then since when levels are tracked.
  // Fixed height (four lines) like every slot of the card.
  function historyBlock(r) {
    const rows = (r.levelChanges ?? []).map(c =>
      `<li>${arrow(c)}<span class="what">${esc(changeText(c))}</span><span class="date">${esc(i18n.formatDate(c.date))}</span></li>`);
    if (r.trackedSince) {
      const date = i18n.formatDate(r.trackedSince);
      rows.push(r.levelChanges
        ? `<li class="since">${esc(tx('details.trackedSince', { date }))}</li>`
        : `<li class="since none">${esc(tx('details.noChange', { date }))}</li>`);
    }
    return `<div class="history"><div class="history-label">${esc(tx('details.history'))}</div><ul class="history-list">${rows.join('')}</ul></div>`;
  }

  function recordHtml(r, placeId) {
    const entry = placeId ? byPlace.get(placeId) : null;
    const L = levelInfo(r.level);
    const days = i18n.ageDays(r.updated);
    const note = r.noteKey ? tp(`notes.${r.noteKey}`) : null;
    const status = [
      r.regional ? `<span class="tag" title="${esc(tx('details.regionalTitle'))}">${esc(tx('details.regional'))}</span>` : '',
      note ? `<span class="note" title="${esc(note)}">${esc(note)}</span>` : '',
    ].join('');
    const url = safeUrl(r.url) ?? safeUrl(data.links?.list);
    const updated = tx('details.updatedValue', { date: i18n.formatDate(r.updated), age: i18n.relativeAge(days) });
    return `
      <div class="eyebrow">${esc(entry && !entry.direct ? tx('details.coveredBy', { title: r.title }) : tx('details.eyebrow'))}</div>
      ${title(placeId ? placeName(placeId) : r.title)}
      ${badge(`var(--l${r.level})`, tx('details.levelBadge', { level: r.level, name: L.name }))}
      <div class="scale" style="--c:var(--l${r.level})" aria-hidden="true">
        ${levelsAll.map(l => `<span class="${l <= r.level ? 'on' : ''}"></span>`).join('')}
      </div>
      <p class="desc">${esc(L.desc)}</p>
      <dl class="meta">
        <div><dt>${esc(tx('details.lastUpdated'))}</dt><dd title="${esc(updated)}">${esc(updated)}</dd></div>
      </dl>
      ${historyBlock(r)}
      <div class="status">${status}</div>
      ${url ? `<a class="link" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(url)}">${esc(tx('details.readMore', { host: displayHost(url) }))}</a>` : ''}`;
  }

  // "nederlandwereldwijd.nl", not "www.nederlandwereldwijd.nl": shorter, and the card has one line for it.
  function displayHost(url) {
    return new URL(url).hostname.replace(/^www\./, '');
  }


  // ---- the dataset interface

  return {
    id: ID,
    load,

    providers: () => manifest.providers.map(p => ({
      id: p.id,
      flag: p.flag,
      label: i18n.t(`datasets.${ID}.providers.${p.id}.short`),
      title: tx('providerSwitchTitle', { agency: i18n.t(`datasets.${ID}.providers.${p.id}.agency`) }),
    })),
    provider: () => settings.get('provider'),
    async setProvider(id) { settings.set('provider', id); await load(); },

    mapLabel: () => tx('mapLabel'),
    providerSwitchLabel: () => tx('providerSwitch'),

    // One line, as in the risk modes, so the panel doesn't move between modes. The agency is
    // named in the overview and the footer.
    header() {
      const age = i18n.ageDays(data.asOf);
      const params = { date: i18n.formatDate(data.asOf), age: i18n.relativeAge(age) };
      return age > STALE_DAYS ? tx('headerStale', params) : tx('header', params);
    },
    stale: () => i18n.ageDays(data.asOf) > STALE_DAYS,
    /** Footer HTML: the translated sentence with the agency linked to its advisory list. */
    footer() {
      const url = safeUrl(data.links?.list);
      const agency = url ? `<a id="sourceLink" href="${esc(url)}" target="_blank" rel="noopener">${esc(tp('agency'))}</a>` : esc(tp('agency'));
      return `${esc(tx('footer', { agency: MARK })).replace(MARK, agency)} · <button class="link-btn" data-action="help">${esc(i18n.t('help.short'))}</button>`;
    },

    /** How the map draws a place (see WorldMap). */
    style(placeId) {
      const entry = byPlace.get(placeId);
      const r = entry?.record;
      const on = windowDays() > 0;
      return {
        cls: r ? `l${r.level}` : 'none',
        muted: !!r && !levels().includes(r.level),
        dim: settings.get('dimOthers') && on && !recent(r),
        dot: !!entry?.direct,
        // One marker per record, on its first place.
        pulse: r && on && r.places[0] === placeId && recent(r) && levels().includes(r.level) ? pulseOpacity(r, windowDays(), i18n.ageDays) : null,
      };
    },

    hasPlace: (placeId) => byPlace.has(placeId),

    /** Details card for a target ({ placeId } or { recordKey }), or the overview for null. */
    details(target) {
      if (!target) return overviewHtml();
      const r = recordFor(target);
      if (!r) return target.placeId ? noAdvisoryHtml(target.placeId) : overviewHtml();
      return recordHtml(r, target.placeId ?? null);
    },

    tooltip(placeId) {
      const r = byPlace.get(placeId)?.record;
      const lines = [];
      if (r) {
        lines.push(`<span class="swatch" style="background:var(--l${r.level})"></span>${esc(tx('tooltip.level', { level: r.level, short: levelInfo(r.level).short }))}`);
        const c = latestChange(r);
        if (c) lines.push(`${arrow(c)}${esc(tx('tooltip.change', { change: changeText(c), age: i18n.relativeAge(i18n.ageDays(c.date)) }))}`);
      } else {
        lines.push(esc(tx('tooltip.none')));
      }
      return `<strong>${esc(placeName(placeId))}</strong>${lines.map(l => `<div class="tt-row">${l}</div>`).join('')}`;
    },

    // Each level in the legend shows or hides its places (main.js calls toggleLevel).
    legend() {
      return levelsAll.map(l => `<button class="legend-item legend-toggle" data-level="${l}" aria-pressed="${levels().includes(l)}" title="${esc(`${levelInfo(l).name} · ${i18n.t('panel.levelToggle')}`)}"><span class="swatch" style="background:var(--l${l})"></span>${esc(i18n.t(`risk.levels.${l}`))}</button>`).join('')
        + `<span class="legend-item"><span class="swatch none"></span>${esc(tx('legend.none'))}</span>`
        + (windowDays() > 0 ? `<span class="legend-item"><span class="legend-pulse"></span>${esc(tx('legend.recent', { days: windowDays() }))}</span>` : '');
    },

    toggleLevel(l) {
      settings.set('levels', levels().includes(l) ? levels().filter(x => x !== l) : [...levels(), l].sort());
      ctx.changed();
    },

    /** The Latest level changes block, with its window switch. Items carry data-key (record title) for hover/select wiring. */
    renderFeed(container) {
      const section = container.closest('.recent');
      section.hidden = false;
      const items = changedRecords();
      section.querySelector('#recentTitle').textContent = tx('feed.latest');
      section.querySelector('#recentCount').textContent = items.length;
      const tools = section.querySelector('#recentTools');
      if (tools) {
        tools.innerHTML = `<div class="segmented" id="recentSeg" role="radiogroup" aria-label="${esc(tx('settings.recent'))}">
          ${WINDOWS.map(d => `<button role="radio" data-days="${d}" aria-checked="${d === windowDays()}">${esc(i18n.t('risk.settings.daysShort', { days: d }))}</button>`).join('')}
        </div>`;
        tools.onclick = (e) => {
          const d = e.target.closest('[data-days]');
          if (d) { settings.set('recentDays', Number(d.dataset.days)); ctx.changed(); }
        };
      }
      container.innerHTML = items.length
        ? items.map(r => {
          const c = latestChange(r);
          return `<li><button data-key="${esc(r.title)}" title="${esc(`${changeText(c)} · ${levelInfo(r.level).name}`)}">
            <span class="row">
              <span class="swatch" style="--c:var(--l${r.level})"></span>
              <span class="name">${esc(recordName(r))}</span>
              <span class="when">${esc(i18n.shortAge(i18n.ageDays(c.date)))}</span>
            </span>
            <span class="what">${arrow(c)}${esc(changeText(c))}</span>
          </button></li>`;
        }).join('')
        : '';   // the heading and 0 say it; the overview card says so too, and offers more days
    },

    /** A feed item's target: its first place, or the record itself if it has no place. */
    feedTarget(key) {
      const r = data.records.find(x => x.title === key);
      return r?.places.length ? { placeId: r.places[0] } : r ? { recordKey: r.title } : null;
    },
    /** Which feed item matches the current hover/selection target. */
    feedKeyFor: (target) => recordFor(target)?.title ?? null,

    /** Search entries: every place (by name), plus source titles that differ ("Burma"). */
    searchEntries() {
      const entries = [];
      for (const place of places.values()) {
        const r = byPlace.get(place.id)?.record;
        const aliases = r && r.places.length === 1 && r.title !== place.name ? [r.title, place.name] : [place.name];
        entries.push({
          label: i18n.placeName(place),
          aliases,
          swatch: r ? `var(--l${r.level})` : 'var(--land-none)',
          sub: r ? tx('search.level', { level: r.level }) : tx('search.none'),
          target: { placeId: place.id },
        });
      }
      for (const r of data.records.filter(x => !x.places.length)) {
        entries.push({ label: r.title, aliases: [], swatch: `var(--l${r.level})`, sub: tx('search.level', { level: r.level }), target: { recordKey: r.title } });
      }
      return entries;
    },
  };
}
