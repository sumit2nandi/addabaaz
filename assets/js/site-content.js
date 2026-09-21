import { pairs } from './workbook.js?v=6fbd4bccb8bf';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderContent(tables) {
  const copy = pairs(tables.Copy);
  document.querySelectorAll('[data-copy]').forEach(node => { node.textContent = copy[node.dataset.copy] ?? ''; });
  for (const attr of ['href', 'src', 'alt', 'title', 'aria-label', 'placeholder']) {
    document.querySelectorAll(`[data-copy-${attr}]`).forEach(node => {
      const value = copy[node.getAttribute(`data-copy-${attr}`)] ?? '';
      // Keep the editable original logo path in Excel, but serve small UI copies.
      // Custom branding paths are left untouched.
      let displayValue = value;
      if (value === 'images/addabaaz-logo.png') {
        if (attr === 'src' && node.matches('img.logo')) displayValue = 'images/addabaaz-logo-small.webp';
        if (attr === 'href' && node.matches('link[rel="icon"], link[rel="apple-touch-icon"]')) displayValue = 'images/addabaaz-icon.png';
      }
      if (value) node.setAttribute(attr, displayValue);
      else node.removeAttribute(attr);
    });
  }
  const team = document.getElementById('teamGrid');
  tables.Team.forEach(row => {
    const card = element('div', 'team-card');
    if (row.image) {
      const image = element('img', 'team-avatar');
      image.src = row.image;
      image.alt = row.name;
      image.loading = 'lazy';
      image.addEventListener('error', () => { image.hidden = true; });
      card.append(image);
    }
    const info = element('div', 'team-info');
    info.append(element('div', 'team-role', row.role), element('h3', 'team-name', row.name));
    if (row.quote) info.append(element('p', 'team-quote', row.quote));
    card.append(info);
    team.append(card);
  });
  const services = document.getElementById('servicesGrid');
  tables.Services.forEach(row => {
    const card = element('div', 'service-card');
    card.append(element('div', 'service-num', row.number), element('h4', '', row.title), element('p', '', row.description));
    services.append(card);
  });
  document.querySelectorAll('[data-missions]').forEach(list => {
    tables.Missions.filter(row => row.language === list.dataset.missions).forEach(row => {
      list.append(element('li', row.language === 'bn' ? 'bengali-text' : '', row.text));
    });
  });
}

export function runtimeData(tables) {
  const settings = pairs(tables.Settings);
  const projectDetails = Object.create(null);
  for (const show of tables.Shows) {
    const episodes = tables.Episodes.filter(ep => ep.project === show.key);
    projectDetails[show.key] = { ...show, episodes, videoCount: episodes.length };
  }
  return {
    projectDetails,
    projectOrder: tables.Shows.map(show => show.key),
    promoVideos: tables.Promos,
    upcomingReleases: tables.Upcoming,
    behindTheScenes: tables.BTS,
    UPCOMING_FOLDER: settings.upcomingFolder,
    BTS_FOLDER: settings.btsFolder,
    UPCOMING_HOME_LIMIT: Number(settings.upcomingHomeLimit),
    BTS_HOME_LIMIT: Number(settings.btsHomeLimit),
    FORM_CONFIG: {
      appsScriptUrl: settings.appsScriptUrl,
      googleFormAction: settings.googleFormAction,
      googleFormFields: Object.fromEntries(['name', 'email', 'phone', 'message'].map(field => [field, settings[`formField.${field}`]]))
    }
  };
}
