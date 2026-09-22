import { pairs } from './workbook.js';

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
