const { contextBridge, ipcRenderer } = require('electron');

// Keep preload self-contained so the bridge still loads when Electron sandboxing is enabled.
const CHANNELS = {
  GET_BOOTSTRAP_STATE: 'app:get-bootstrap-state',
  RESCAN_DEVICES: 'streamDeck:rescan-devices',
  RELOAD_PLUGINS: 'plugins:reload',
  INSPECT_PLUGIN_SOURCE: 'plugins:inspect-source',
  IMPORT_PLUGIN: 'plugins:import',
  ASSIGN_ACTION: 'layout:assign-action',
  UPDATE_ASSIGNMENT_CONFIG: 'layout:update-assignment-config',
  CLEAR_ACTION: 'layout:clear-action',
  RENDER_KEY: 'streamDeck:render-key',
  TRIGGER_ASSIGNED_ACTION: 'actions:trigger-assigned-action',
  UPDATE_OBS_CONNECTION: 'obs:update-connection',
  CONNECT_OBS: 'obs:connect',
  DISCONNECT_OBS: 'obs:disconnect',
  REFRESH_OBS_SCENES: 'obs:refresh-scenes'
};

contextBridge.exposeInMainWorld('streamDeckApp', {
  getBootstrapState: () => ipcRenderer.invoke(CHANNELS.GET_BOOTSTRAP_STATE),
  rescanDevices: () => ipcRenderer.invoke(CHANNELS.RESCAN_DEVICES),
  reloadPlugins: () => ipcRenderer.invoke(CHANNELS.RELOAD_PLUGINS),
  inspectPluginSource: (payload) => ipcRenderer.invoke(CHANNELS.INSPECT_PLUGIN_SOURCE, payload),
  importPlugin: (payload) => ipcRenderer.invoke(CHANNELS.IMPORT_PLUGIN, payload),
  assignAction: (payload) => ipcRenderer.invoke(CHANNELS.ASSIGN_ACTION, payload),
  updateAssignmentConfig: (payload) => ipcRenderer.invoke(CHANNELS.UPDATE_ASSIGNMENT_CONFIG, payload),
  clearAction: (payload) => ipcRenderer.invoke(CHANNELS.CLEAR_ACTION, payload),
  renderKey: (payload) => ipcRenderer.invoke(CHANNELS.RENDER_KEY, payload),
  triggerAssignedAction: (payload) => ipcRenderer.invoke(CHANNELS.TRIGGER_ASSIGNED_ACTION, payload),
  updateObsConnection: (payload) => ipcRenderer.invoke(CHANNELS.UPDATE_OBS_CONNECTION, payload),
  connectObs: () => ipcRenderer.invoke(CHANNELS.CONNECT_OBS),
  disconnectObs: () => ipcRenderer.invoke(CHANNELS.DISCONNECT_OBS),
  refreshObsScenes: () => ipcRenderer.invoke(CHANNELS.REFRESH_OBS_SCENES)
});
