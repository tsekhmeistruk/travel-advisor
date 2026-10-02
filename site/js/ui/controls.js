// Small generic controls: provider switch, theme toggle, language picker, tooltip.

import { esc } from '../core/dom.js';

/** Segmented pill with a sliding thumb and flags: one button per provider. */
export function createProviderSwitch(el, { onChange }) {
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-provider]');
    if (btn && btn.getAttribute('aria-checked') !== 'true') onChange(btn.dataset.provider);
  });
  return {
    render(providers, activeId, label) {
      el.setAttribute('aria-label', label);
      el.hidden = providers.length < 2;
      el.style.setProperty('--n', providers.length);
      el.style.setProperty('--i', Math.max(0, providers.findIndex(p => p.id === activeId)));
      el.innerHTML = '<span class="thumb" aria-hidden="true"></span>' + providers.map(p =>
        // aria-label: on phones only the flag is visible, so the name must not depend on the text.
        `<button role="radio" data-provider="${esc(p.id)}" aria-checked="${p.id === activeId}" aria-label="${esc(p.label)}" title="${esc(p.title)}">`
        + `${p.flag ? `<img class="flag" src="assets/flags/${esc(p.flag)}.svg" alt="" width="21" height="14">` : ''}<span>${esc(p.label)}</span></button>`).join('');
    },
  };
}

/** The map's modes as a pill on the map (Travel, Highest, Disasters, Wildfires, Changes). */
export function createModeSwitch(el, { onChange }) {
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (btn && btn.getAttribute('aria-checked') !== 'true') onChange(btn.dataset.mode);
  });
  return {
    render(modes, activeId, label) {
      el.setAttribute('aria-label', label);
      el.hidden = modes.length < 2;
      el.innerHTML = modes.map(m =>
        `<button role="radio" data-mode="${esc(m.id)}" aria-checked="${m.id === activeId}" title="${esc(m.title)}">${esc(m.label)}</button>`).join('');
      // On a narrow screen the row scrolls: keep the active mode in view.
      const on = el.querySelector('[aria-checked="true"]');
      if (on && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, on.offsetLeft - el.offsetLeft - (el.clientWidth - on.offsetWidth) / 2);
    },
  };
}

const THEME_ICONS = {
  auto: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
};
const THEME_ORDER = ['auto', 'light', 'dark'];

/** Theme button cycling auto → light → dark. */
export function createThemeToggle(btn, { settings, t }) {
  function apply() {
    const theme = THEME_ORDER.includes(settings.get('theme')) ? settings.get('theme') : 'auto';
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    btn.innerHTML = THEME_ICONS[theme];
    btn.title = t('panel.theme', { mode: t(`panel.themeModes.${theme}`) });
    btn.setAttribute('aria-label', btn.title);
  }
  btn.onclick = () => {
    const current = settings.get('theme');
    settings.set('theme', THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]);
    apply();
  };
  apply();
  return { apply };
}

/** Language picker; hidden while only one language is available. */
export function createLanguagePicker(select, { locales, names, current, onChange }) {
  select.hidden = locales.length < 2;
  select.innerHTML = locales.map(code => `<option value="${esc(code)}"${code === current ? ' selected' : ''}>${esc(names[code] ?? code)}</option>`).join('');
  select.onchange = () => onChange(select.value);
}

/** Tooltip that follows the mouse inside the map area. */
export function createTooltip(el, area) {
  function position(event) {
    const rect = area.getBoundingClientRect();
    const tw = el.offsetWidth, th = el.offsetHeight;
    let x = event.clientX - rect.left + 14;
    let y = event.clientY - rect.top + 14;
    if (x + tw > rect.width - 8) x = event.clientX - rect.left - tw - 14;
    if (y + th > rect.height - 8) y = event.clientY - rect.top - th - 14;
    el.style.transform = `translate(${x}px, ${y}px)`;
  }
  return {
    show(html, event) { el.innerHTML = html; el.hidden = false; position(event); },
    move: position,
    hide() { el.hidden = true; },
  };
}
