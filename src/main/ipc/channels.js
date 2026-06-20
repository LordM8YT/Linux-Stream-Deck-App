const CHANNELS = {
  GET_BOOTSTRAP_STATE: 'app:get-bootstrap-state',
  RESCAN_DEVICES: 'streamDeck:rescan-devices',
  RELOAD_PLUGINS: 'plugins:reload',
  INSPECT_PLUGIN_SOURCE: 'plugins:inspect-source',
  IMPORT_PLUGIN: 'plugins:import',
  SWITCH_PROFILE: 'profiles:switch',
  CREATE_PROFILE: 'profiles:create',
  UPDATE_PROFILE_RULES: 'profiles:update-rules',
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

module.exports = {
  CHANNELS
};
