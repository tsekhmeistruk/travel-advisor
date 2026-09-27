// The "Find a country" box. Entries come from the active dataset:
//   { label, aliases: [..], swatch: css colour, sub: text, target }
// Matching ignores accents and case; names starting with the query come first.

import { esc } from '../core/dom.js';

const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Precompute the normalized keys (label and aliases) of search entries. */
export function prepareEntries(list) {
  return list.map(e => ({ ...e, keys: [e.label, ...(e.aliases ?? [])].map(normalize) }));
}

/** Entries matching a query: names starting with it first, then names containing it. */
export function rankMatches(entries, query, limit = 7) {
  const q = normalize(query.trim());
  if (!q) return [];
  const starts = entries.filter(e => e.keys.some(k => k.startsWith(q)));
  const contains = entries.filter(e => !starts.includes(e) && e.keys.some(k => k.includes(q)));
  return [...starts, ...contains].slice(0, limit);
}

export function createSearch({ input, results, noMatchesText, onChoose }) {
  let entries = [];
  let matches = [];
  let active = 0;

  function setEntries(list) {
    entries = prepareEntries(list);
  }

  function render() {
    results.hidden = false;
    results.innerHTML = matches.length
      ? matches.map((m, i) => `<li role="option" data-i="${i}" aria-selected="${i === active}">
          <span class="swatch" style="background:${m.swatch}"></span>${esc(m.label)}<span class="lvl">${esc(m.sub)}</span></li>`).join('')
      : `<li class="recent-empty">${esc(noMatchesText())}</li>`;
  }
  function close() { results.hidden = true; matches = []; }
  function choose(m) {
    input.value = '';
    close();
    input.blur();
    onChoose(m.target);
  }

  input.addEventListener('input', () => {
    matches = rankMatches(entries, input.value);
    if (!input.value.trim()) return close();
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (results.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(matches.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && matches[active]) { choose(matches[active]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  results.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); choose(matches[Number(li.dataset.i)]); }
  });

  return { setEntries };
}
