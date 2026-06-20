const { ipcMain } = require('electron');
const { CHANNELS } = require('./channels');

function registerAppHandlers(runtime) {
  ipcMain.handle(CHANNELS.GET_BOOTSTRAP_STATE, async () => runtime.getBootstrapState());
  ipcMain.handle(CHANNELS.RESCAN_DEVICES, async () => runtime.rescanDevices());
  ipcMain.handle(CHANNELS.RELOAD_PLUGINS, async () => runtime.reloadPlugins());
  ipcMain.handle(CHANNELS.INSPECT_PLUGIN_SOURCE, async (_event, payload) => runtime.inspectPluginSource(payload));
  ipcMain.handle(CHANNELS.IMPORT_PLUGIN, async (_event, payload) => runtime.importPlugin(payload));
  ipcMain.handle(CHANNELS.SWITCH_PROFILE, async (_event, payload) => runtime.switchProfile(payload));
  ipcMain.handle(CHANNELS.CREATE_PROFILE, async (_event, payload) => runtime.createProfile(payload));
  ipcMain.handle(CHANNELS.UPDATE_PROFILE_RULES, async (_event, payload) => runtime.updateProfileRules(payload));
  ipcMain.handle(CHANNELS.ASSIGN_ACTION, async (_event, payload) => runtime.assignAction(payload));
  ipcMain.handle(CHANNELS.UPDATE_ASSIGNMENT_CONFIG, async (_event, payload) => runtime.updateAssignmentConfig(payload));
  ipcMain.handle(CHANNELS.CLEAR_ACTION, async (_event, payload) => runtime.clearAction(payload));
  ipcMain.handle(CHANNELS.RENDER_KEY, async (_event, payload) => runtime.renderKey(payload));
  ipcMain.handle(CHANNELS.TRIGGER_ASSIGNED_ACTION, async (_event, payload) => runtime.triggerAssignedAction(payload));
  ipcMain.handle(CHANNELS.UPDATE_OBS_CONNECTION, async (_event, payload) => runtime.updateObsConnection(payload));
  ipcMain.handle(CHANNELS.CONNECT_OBS, async () => runtime.connectObs());
  ipcMain.handle(CHANNELS.DISCONNECT_OBS, async () => runtime.disconnectObs());
  ipcMain.handle(CHANNELS.REFRESH_OBS_SCENES, async () => runtime.refreshObsScenes());
}

module.exports = {
  registerAppHandlers
};
