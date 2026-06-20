const path = require('node:path');
const { LayoutService } = require('../services/layout/LayoutService');
const { LinuxActiveWindowService } = require('../services/linux/LinuxActiveWindowService');
const { ObsService } = require('../services/obs/ObsService');
const { PluginImportService } = require('../services/plugins/PluginImportService');
const { PluginManager } = require('../services/plugins/PluginManager');
const { ProfileService } = require('../services/profiles/ProfileService');
const { AppStateStore } = require('../services/storage/AppStateStore');
const { SystemActionService } = require('../services/system/SystemActionService');
const { StreamDeckService } = require('../services/streamDeck/StreamDeckService');

class AppRuntime {
  constructor({ rootDir, dataDir }) {
    this.rootDir = rootDir;
    this.dataDir = dataDir;
    this.bundledPluginsDir = path.join(rootDir, 'plugins');
    this.userPluginsDir = path.join(dataDir, 'plugins');
    this.store = new AppStateStore({
      filePath: path.join(dataDir, 'decksmith-state.json')
    });
    this.layoutService = new LayoutService({
      store: this.store
    });
    this.profileService = new ProfileService({
      store: this.store,
      layoutService: this.layoutService
    });
    this.obsService = new ObsService({
      store: this.store
    });
    this.systemActionService = new SystemActionService();
    this.pluginManager = new PluginManager({
      pluginRoots: [
        this.bundledPluginsDir,
        this.userPluginsDir
      ],
      getExecutionContext: () => ({
        services: {
          obs: this.obsService,
          system: this.systemActionService
        }
      })
    });
    this.pluginImportService = new PluginImportService({
      pluginManager: this.pluginManager,
      userPluginsRoot: this.userPluginsDir
    });
    this.streamDeckService = new StreamDeckService({
      onButtonDown: ({ slotId }) => {
        void this.handleHardwareButtonDown(slotId);
      }
    });
    this.activeWindowService = new LinuxActiveWindowService({
      onFocusChanged: async (activeWindow) => {
        await this.handleActiveWindowChanged(activeWindow);
      }
    });
  }

  async start() {
    await this.store.load();

    await Promise.all([
      this.pluginManager.scan(),
      this.obsService.start(),
      this.streamDeckService.start()
    ]);
    await this.activeWindowService.start();

    return this.getBootstrapState();
  }

  async dispose() {
    await Promise.all([
      this.activeWindowService.dispose(),
      this.obsService.dispose(),
      this.streamDeckService.dispose()
    ]);
  }

  getCurrentDeckProfile() {
    return this.streamDeckService.getDeckProfile();
  }

  async getBootstrapState() {
    const deckState = this.streamDeckService.getState();
    const activeProfileId = this.profileService.getActiveProfileId(deckState.profile);

    return {
      app: {
        name: 'DeckSmith',
        pluginDirectory: this.userPluginsDir,
        bundledPluginDirectory: this.bundledPluginsDir,
        pluginImportExamples: [
          'https://github.com/owner/repo',
          'https://github.com/owner/repo/tree/main/plugin-folder',
          'https://example.com/decksmith-plugin.zip',
          'https://example.com/decksmith-marketplace.json#plugin-id'
        ]
      },
      deck: deckState,
      obs: this.obsService.getState(),
      layout: this.layoutService.getDeckLayout(deckState.profile, activeProfileId),
      plugins: this.pluginManager.getCatalog(),
      profiles: this.profileService.getState(deckState.profile, this.activeWindowService.getState())
    };
  }

  async rescanDevices() {
    await this.streamDeckService.rescan();
    return this.getBootstrapState();
  }

  async reloadPlugins() {
    await this.pluginManager.scan();
    return this.getBootstrapState();
  }

  async inspectPluginSource({ sourceUrl }) {
    if (!sourceUrl) {
      throw new Error('sourceUrl is required to inspect a plugin source.');
    }

    return this.pluginImportService.inspectSource(sourceUrl);
  }

  async importPlugin({ sourceUrl }) {
    if (!sourceUrl) {
      throw new Error('sourceUrl is required to import a plugin.');
    }

    const result = await this.pluginImportService.installFromUrl(sourceUrl);
    await this.pluginManager.scan();

    return {
      ...result,
      state: await this.getBootstrapState()
    };
  }

  async assignAction({ slotId, actionId }) {
    if (!slotId || !actionId) {
      throw new Error('slotId and actionId are required to assign an action.');
    }

    if (!this.pluginManager.hasAction(actionId)) {
      throw new Error(`Unknown action "${actionId}".`);
    }

    const initialConfig = this.pluginManager.getDefaultConfigForAction(actionId);

    await this.layoutService.assignAction(
      this.getCurrentDeckProfile(),
      this.getCurrentProfileId(),
      slotId,
      actionId,
      initialConfig
    );
    return this.getBootstrapState();
  }

  async updateAssignmentConfig({ slotId, config }) {
    if (!slotId) {
      throw new Error('slotId is required to update assignment config.');
    }

    await this.layoutService.updateAssignmentConfig(
      this.getCurrentDeckProfile(),
      this.getCurrentProfileId(),
      slotId,
      config || {}
    );
    return this.getBootstrapState();
  }

  async clearAction({ slotId }) {
    if (!slotId) {
      throw new Error('slotId is required to clear an action.');
    }

    await this.layoutService.clearAction(this.getCurrentDeckProfile(), this.getCurrentProfileId(), slotId);
    return this.getBootstrapState();
  }

  async renderKey(payload) {
    return this.streamDeckService.renderKey(payload);
  }

  async triggerAssignedAction({ slotId, triggeredBy = 'ui' }) {
    if (!slotId) {
      throw new Error('slotId is required to trigger an action.');
    }

    const deckProfile = this.getCurrentDeckProfile();
    const layout = this.layoutService.getDeckLayout(deckProfile, this.getCurrentProfileId());
    const slot = layout.slots.find((candidate) => candidate.slotId === slotId);

    if (!slot?.assignment?.actionId) {
      return {
        ok: false,
        reason: 'NO_ASSIGNMENT',
        state: await this.getBootstrapState()
      };
    }

    try {
      const result = await this.pluginManager.triggerAction(slot.assignment.actionId, {
        slot,
        assignment: slot.assignment,
        deck: this.streamDeckService.getState().profile,
        triggeredBy
      });

      return {
        ...result,
        state: await this.getBootstrapState()
      };
    } catch (error) {
      return {
        ok: false,
        reason: 'ACTION_ERROR',
        errorMessage: error.message,
        state: await this.getBootstrapState()
      };
    }
  }

  async updateObsConnection(payload) {
    await this.obsService.updateConnectionConfig(payload || {});
    return this.getBootstrapState();
  }

  async connectObs() {
    await this.obsService.connect();
    return this.getBootstrapState();
  }

  async disconnectObs() {
    await this.obsService.disconnect();
    return this.getBootstrapState();
  }

  async refreshObsScenes() {
    await this.obsService.refreshScenes();
    return this.getBootstrapState();
  }

  async switchProfile({ profileId }) {
    if (!profileId) {
      throw new Error('profileId is required to switch profiles.');
    }

    await this.profileService.switchProfile(this.getCurrentDeckProfile(), profileId);
    return this.getBootstrapState();
  }

  async createProfile({ name, cloneFromProfileId = null } = {}) {
    const sourceProfileId = cloneFromProfileId || this.getCurrentProfileId();

    await this.profileService.createProfile(this.getCurrentDeckProfile(), {
      name,
      cloneFromProfileId: sourceProfileId
    });

    return this.getBootstrapState();
  }

  async updateProfileRules({ profileId, autoSwitchRules }) {
    if (!profileId) {
      throw new Error('profileId is required to update profile rules.');
    }

    await this.profileService.updateProfileRules(this.getCurrentDeckProfile(), {
      profileId,
      autoSwitchRules
    });

    return this.getBootstrapState();
  }

  async handleHardwareButtonDown(slotId) {
    const result = await this.triggerAssignedAction({
      slotId,
      triggeredBy: 'hardware'
    });

    if (!result.ok && result.reason !== 'NO_ASSIGNMENT') {
      console.error(`Failed to trigger hardware action for ${slotId}:`, result.errorMessage || result.reason);
    }
  }

  async handleActiveWindowChanged(activeWindow) {
    const deckProfile = this.getCurrentDeckProfile();

    await this.profileService.applyAutoSwitch(deckProfile, activeWindow);
  }

  getCurrentProfileId() {
    return this.profileService.getActiveProfileId(this.getCurrentDeckProfile());
  }
}

module.exports = {
  AppRuntime
};
