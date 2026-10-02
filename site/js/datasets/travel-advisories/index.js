// The travel-advisories dataset: official advisory levels (1–4) from several governments
// ("providers"), one provider shown at a time. Implements the dataset interface described in
// ../registry.js. Pure rules are in ./logic.js; this module renders and handles input.

import { esc, safeUrl } from '../../core/dom.js';
import { indexByPlace, isRecent, latestChange, recentRecords, pulseOpacity, noAdvisoryReason, titleSize } from './logic.js';

const ID = 'travel-advisories';
const MARK = '\u0000';   // placeholder for HTML inserted into an escaped message
const STALE_DAYS = 7;     // the header warns about data older than this

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
  if (!manifest.recentWindows.includes(windowDays())) settings.set('recentDays', manifest.defaultRecentWindow);
  if (!Array.isArray(levels())) settings.set('levels', levelsAll.slice());

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

  function overviewHtml() {
    const counts = levelsAll.map(l => data.records.filter(r => r.level === l).length);
    const recentCount = windowDays() > 0 ? data.records.filter(recent).length : 0;
    const desc = [...levelsAll].reverse();
    return `
      <div class="eyebrow">${esc(tx('overview.eyebrow', { provider: tp('name') }))}</div>
      <h3>${esc(tx('overview.count', { count: data.records.length }))}</h3>
      <div class="stack" aria-hidden="true">
        ${desc.map(l => `<span style="--c:var(--l${l});flex:${counts[l - 1]}"></span>`).join('')}
      </div>
      <div class="overview-grid">
        ${desc.map(l => `<div><span class="swatch" style="background:var(--l${l})"></span>${esc(levelInfo(l).short)}<b>${counts[l - 1]}</b></div>`).join('')}
      </div>
      ${windowDays() > 0 ? `<p>${esc(tx('overview.recent', { count: MARK, days: windowDays() })).replace(MARK, `<strong>${recentCount}</strong>`)}</p>` : ''}
      <p class="hint">${esc(tx('overview.hint'))}</p>
      ${ctx.countryView ? `<div class="card-actions"><button class="link link-btn" data-action="list">${esc(tx('overview.list'))}</button></div>` : ''}`;
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

  // "Level 2 → 3", or "Raised to Level 4" when the source announced only the direction.
  function changeText(c) {
    return c.from != null ? tx('change.fromTo', { from: c.from, to: c.to }) : tx(c.up ? 'change.up' : 'change.down', { to: c.to });
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
      // The country view (every government, other risks), when the site has one.
      ctx.countryView && placeId ? `<button class="link-btn cv-open" data-action="country" data-place="${esc(placeId)}">${esc(tx('details.country'))}</button>` : '',
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
      return esc(tx('footer', { agency: MARK })).replace(MARK, agency);
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

    legend() {
      return levelsAll.map(l => `<span class="legend-item"><span class="swatch" style="background:var(--l${l})"></span>${esc(levelInfo(l).short)}</span>`).join('')
        + `<span class="legend-item"><span class="swatch none"></span>${esc(tx('legend.none'))}</span>`
        + (windowDays() > 0 ? `<span class="legend-item"><span class="legend-pulse"></span>${esc(tx('legend.recent', { days: windowDays() }))}</span>` : '');
    },

    renderSettings(container) {
      const days = manifest.recentWindows;
      container.innerHTML = `
        <div class="setting">
          <span class="setting-label">${esc(tx('settings.levels'))}</span>
          <div class="chips" id="levelChips">
            ${levelsAll.map(l => `<button class="chip" data-level="${l}" style="--c:var(--l${l})" title="${esc(levelInfo(l).name)}"
              aria-pressed="${levels().includes(l)}"><span class="swatch"></span>${l} · ${esc(levelInfo(l).short)}</button>`).join('')}
          </div>
        </div>
        <div class="setting">
          <span class="setting-label">${esc(tx('settings.recent'))}</span>
          <div class="segmented" id="recentSeg" role="radiogroup" aria-label="${esc(tx('settings.recent'))}">
            ${days.map(d => `<button role="radio" data-days="${d}" aria-checked="${d === windowDays()}">${esc(d ? tx('settings.days', { days: d }) : tx('settings.off'))}</button>`).join('')}
          </div>
        </div>
        <label class="setting row${windowDays() === 0 ? ' is-disabled' : ''}">
          <span class="setting-label">${esc(tx('settings.dim'))}</span>
          <span class="switch"><input type="checkbox" id="dimToggle" ${settings.get('dimOthers') ? 'checked' : ''}><span></span></span>
        </label>`;
      container.onclick = (e) => {
        const chip = e.target.closest('.chip');
        if (chip) {
          const l = Number(chip.dataset.level);
          settings.set('levels', levels().includes(l) ? levels().filter(x => x !== l) : [...levels(), l].sort());
          return ctx.changed();
        }
        const seg = e.target.closest('[data-days]');
        if (seg) { settings.set('recentDays', Number(seg.dataset.days)); ctx.changed(); }
      };
      container.onchange = (e) => {
        if (e.target.id === 'dimToggle') { settings.set('dimOthers', e.target.checked); ctx.changed(); }
      };
    },

    /** The change feed. Items carry data-key (record title) for hover/select wiring. */
    renderFeed(container) {
      const section = container.closest('.recent');
      section.hidden = windowDays() === 0;
      if (section.hidden) return;
      const longest = Math.max(...manifest.recentWindows);
      const items = recentRecords(data.records, { windowDays: windowDays(), levels: levels(), ageDays: i18n.ageDays });
      section.querySelector('#recentTitle').textContent = tx('feed.title', { days: windowDays() });
      section.querySelector('#recentCount').textContent = items.length;
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
        : `<li class="recent-empty">${esc(tx('feed.empty'))}${windowDays() < longest
          ? ` <button class="link-btn" data-show-days="${longest}">${esc(tx('feed.showDays', { days: longest }))}</button>` : ''}</li>`;
    },
    showWindow(days) { settings.set('recentDays', days); ctx.changed(); },

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
