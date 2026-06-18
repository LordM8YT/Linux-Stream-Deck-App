const { OBSWebSocket } = require('obs-websocket-js');

class ObsService {
  constructor({ store }) {
    this.store = store;
    this.client = null;
    this.state = {
      config: this.store.getObsConnection(),
      connected: false,
      connecting: false,
      obsWebSocketVersion: null,
      currentProgramSceneName: null,
      scenes: [],
      inputs: [],
      sceneItemsBySceneName: {},
      stream: {
        active: false,
        reconnecting: false
      },
      record: {
        active: false,
        paused: false
      },
      studioModeEnabled: false,
      lastError: null,
      setupHint: null
    };
    this.boundHandlers = null;
  }

  async start() {
    this.state.config = this.store.getObsConnection();

    if (this.state.config.autoConnect !== false) {
      await this.connect({
        suppressThrow: true,
        tryFallbacks: true
      });
    }
  }

  async dispose() {
    await this.disconnect();
  }

  getState() {
    return this.state;
  }

  async updateConnectionConfig(partialConfig) {
    this.state.config = await this.store.updateObsConnection(sanitizeObsConfig(partialConfig));
    return this.getState();
  }

  async connect({ suppressThrow = false, tryFallbacks = true } = {}) {
    await this.disconnect();

    this.state.connecting = true;
    this.state.lastError = null;
    this.state.setupHint = null;

    const candidates = buildConnectionCandidates(this.state.config.url, tryFallbacks);
    let lastError = null;

    for (const url of candidates) {
      const client = new OBSWebSocket();

      try {
        const result = await client.connect(
          url,
          this.state.config.password || undefined,
          { rpcVersion: 1 }
        );

        this.client = client;
        this.attachClientHandlers();
        this.state.connected = true;
        this.state.connecting = false;
        this.state.obsWebSocketVersion = result.obsWebSocketVersion;
        this.state.lastError = null;
        this.state.setupHint = null;

        if (url !== this.state.config.url) {
          this.state.config = await this.store.updateObsConnection({ url });
        }

        await this.refreshScenes();
        return this.getState();
      } catch (error) {
        lastError = error;

        try {
          await client.disconnect();
        } catch (_disconnectError) {
          // Ignore cleanup failures while trying fallback endpoints.
        }
      }
    }

    this.state.connecting = false;
    this.state.connected = false;
    this.state.scenes = [];
    this.state.currentProgramSceneName = null;
    this.state.obsWebSocketVersion = null;
    this.state.lastError = formatObsError(lastError, candidates);
    this.state.setupHint = buildSetupHint(lastError);

    if (!suppressThrow) {
      throw new Error(this.state.lastError);
    }

    return this.getState();
  }

  async disconnect() {
    if (this.client) {
      this.detachClientHandlers();

      try {
        await this.client.disconnect();
      } catch (_error) {
        // Ignore disconnect failures during shutdown or reconnect.
      }
    }

    this.client = null;
    this.resetRuntimeState();
    this.state.lastError = null;
    this.state.setupHint = null;
    return this.getState();
  }

  async refreshScenes() {
    if (!this.client || !this.state.connected) {
      return this.getState();
    }

    try {
      const sceneResponse = await this.client.call('GetSceneList');
      this.state.scenes = (sceneResponse.scenes || []).map((scene) => ({
        sceneIndex: scene.sceneIndex,
        sceneName: scene.sceneName,
        sceneUuid: scene.sceneUuid
      }));
      this.state.currentProgramSceneName = sceneResponse.currentProgramSceneName || null;
      this.state.inputs = await this.fetchInputs();
      this.state.sceneItemsBySceneName = await this.fetchSceneItemsByScene();
      await this.refreshOutputStates();
      this.state.lastError = null;
      this.state.setupHint = null;
    } catch (error) {
      this.state.lastError = error.message;
      throw error;
    }

    return this.getState();
  }

  async switchScene(sceneName) {
    if (!this.client || !this.state.connected) {
      throw new Error('OBS is not connected.');
    }

    if (!sceneName) {
      throw new Error('A scene name is required.');
    }

    await this.client.call('SetCurrentProgramScene', {
      sceneName
    });

    this.state.currentProgramSceneName = sceneName;
    this.state.lastError = null;
    this.state.setupHint = null;
    return this.getState();
  }

  async setInputMute(inputName, inputMuted) {
    if (!this.client || !this.state.connected) {
      throw new Error('OBS is not connected.');
    }

    if (!inputName) {
      throw new Error('An OBS input name is required.');
    }

    await this.client.call('SetInputMute', {
      inputName,
      inputMuted
    });

    const inputRecord = this.state.inputs.find((input) => input.inputName === inputName);

    if (inputRecord) {
      inputRecord.inputMuted = inputMuted;
    }

    return {
      ...this.getState(),
      lastMutation: {
        inputName,
        inputMuted
      }
    };
  }

  async toggleInputMute(inputName) {
    if (!this.client || !this.state.connected) {
      throw new Error('OBS is not connected.');
    }

    if (!inputName) {
      throw new Error('An OBS input name is required.');
    }

    const response = await this.client.call('ToggleInputMute', {
      inputName
    });

    const inputRecord = this.state.inputs.find((input) => input.inputName === inputName);

    if (inputRecord && typeof response.inputMuted === 'boolean') {
      inputRecord.inputMuted = response.inputMuted;
    }

    return response;
  }

  async startStream() {
    await this.ensureOutputState('stream', true);
    return this.getState();
  }

  async stopStream() {
    await this.ensureOutputState('stream', false);
    return this.getState();
  }

  async startRecord() {
    await this.ensureOutputState('record', true);
    return this.getState();
  }

  async stopRecord() {
    await this.ensureOutputState('record', false);
    return this.getState();
  }

  async setStudioModeEnabled(studioModeEnabled) {
    if (!this.client || !this.state.connected) {
      throw new Error('OBS is not connected.');
    }

    await this.client.call('SetStudioModeEnabled', {
      studioModeEnabled
    });

    this.state.studioModeEnabled = studioModeEnabled;
    return this.getState();
  }

  async triggerStudioModeTransition() {
    if (!this.client || !this.state.connected) {
      throw new Error('OBS is not connected.');
    }

    await this.client.call('TriggerStudioModeTransition');
    return this.getState();
  }

  async toggleSceneItemEnabled(sceneName, sceneItemId) {
    if (!this.client || !this.state.connected) {
      throw new Error('OBS is not connected.');
    }

    if (!sceneName) {
      throw new Error('A scene name is required.');
    }

    if (typeof sceneItemId !== 'number' || Number.isNaN(sceneItemId)) {
      throw new Error('A valid scene item is required.');
    }

    const currentState = await this.client.call('GetSceneItemEnabled', {
      sceneName,
      sceneItemId
    });
    const nextEnabledState = !currentState.sceneItemEnabled;
    const result = await this.client.call('SetSceneItemEnabled', {
      sceneName,
      sceneItemId,
      sceneItemEnabled: nextEnabledState
    });

    const sceneItems = this.state.sceneItemsBySceneName[sceneName];
    const sceneItem = sceneItems?.find((candidate) => candidate.sceneItemId === sceneItemId);

    if (sceneItem) {
      sceneItem.sceneItemEnabled = result.sceneItemEnabled;
    }

    return {
      sceneName,
      sceneItemId,
      sceneItemEnabled: result.sceneItemEnabled
    };
  }

  async ensureOutputState(outputType, shouldBeActive) {
    if (!this.client || !this.state.connected) {
      throw new Error('OBS is not connected.');
    }

    await this.refreshOutputStates();

    if (outputType === 'stream') {
      if (this.state.stream.active === shouldBeActive) {
        return;
      }

      await this.client.call(shouldBeActive ? 'StartStream' : 'StopStream');
    } else {
      if (this.state.record.active === shouldBeActive) {
        return;
      }

      await this.client.call(shouldBeActive ? 'StartRecord' : 'StopRecord');
    }

    await this.refreshOutputStates();
  }

  async refreshOutputStates() {
    if (!this.client || !this.state.connected) {
      return;
    }

    const [streamStatus, recordStatus, studioModeStatus] = await Promise.all([
      this.client.call('GetStreamStatus'),
      this.client.call('GetRecordStatus'),
      this.client.call('GetStudioModeEnabled')
    ]);

    this.state.stream = {
      active: Boolean(streamStatus.outputActive),
      reconnecting: Boolean(streamStatus.outputReconnecting)
    };
    this.state.record = {
      active: Boolean(recordStatus.outputActive),
      paused: Boolean(recordStatus.outputPaused)
    };
    this.state.studioModeEnabled = Boolean(studioModeStatus.studioModeEnabled);
  }

  async fetchInputs() {
    const response = await this.client.call('GetInputList');
    const inputs = [];

    for (const input of response.inputs || []) {
      let inputMuted = false;

      try {
        const muteState = await this.client.call('GetInputMute', {
          inputName: input.inputName
        });
        inputMuted = Boolean(muteState.inputMuted);
      } catch (_error) {
        inputMuted = false;
      }

      inputs.push({
        inputName: input.inputName,
        inputKind: input.inputKind,
        inputUuid: input.inputUuid,
        unversionedInputKind: input.unversionedInputKind || null,
        inputMuted
      });
    }

    return inputs;
  }

  async fetchSceneItemsByScene() {
    const sceneItemsBySceneName = {};

    for (const scene of this.state.scenes) {
      const response = await this.client.call('GetSceneItemList', {
        sceneName: scene.sceneName
      });

      sceneItemsBySceneName[scene.sceneName] = (response.sceneItems || []).map((sceneItem) => ({
        sceneItemId: sceneItem.sceneItemId,
        sceneItemIndex: sceneItem.sceneItemIndex,
        sourceName: sceneItem.sourceName,
        sceneItemEnabled: sceneItem.sceneItemEnabled,
        isGroup: Boolean(sceneItem.isGroup)
      }));
    }

    return sceneItemsBySceneName;
  }

  resetRuntimeState() {
    this.state.connected = false;
    this.state.connecting = false;
    this.state.obsWebSocketVersion = null;
    this.state.currentProgramSceneName = null;
    this.state.scenes = [];
    this.state.inputs = [];
    this.state.sceneItemsBySceneName = {};
    this.state.stream = {
      active: false,
      reconnecting: false
    };
    this.state.record = {
      active: false,
      paused: false
    };
    this.state.studioModeEnabled = false;
  }

  refreshScenesFromEvent() {
    void this.refreshScenes().catch((error) => {
      this.state.lastError = error.message;
      this.state.setupHint = buildSetupHint(error);
    });
  }

  refreshOutputStatesFromEvent() {
    void this.refreshOutputStates().catch((error) => {
      this.state.lastError = error.message;
      this.state.setupHint = buildSetupHint(error);
    });
  }

  attachClientHandlers() {
    if (!this.client) {
      return;
    }

    this.boundHandlers = {
      connectionClosed: (error) => {
        this.resetRuntimeState();
        this.state.lastError = error?.message || 'OBS connection closed.';
        this.state.setupHint = buildSetupHint(error);
      },
      connectionError: (error) => {
        this.state.lastError = error?.message || 'OBS connection error.';
        this.state.setupHint = buildSetupHint(error);
      },
      currentProgramSceneChanged: ({ sceneName }) => {
        this.state.currentProgramSceneName = sceneName;
      },
      sceneListChanged: () => {
        this.refreshScenesFromEvent();
      },
      inputCreated: () => {
        this.refreshScenesFromEvent();
      },
      inputRemoved: () => {
        this.refreshScenesFromEvent();
      },
      sceneItemCreated: () => {
        this.refreshScenesFromEvent();
      },
      sceneItemRemoved: () => {
        this.refreshScenesFromEvent();
      },
      inputMuteStateChanged: ({ inputName, inputMuted }) => {
        const inputRecord = this.state.inputs.find((input) => input.inputName === inputName);

        if (inputRecord) {
          inputRecord.inputMuted = Boolean(inputMuted);
        }
      },
      sceneItemEnableStateChanged: ({ sceneName, sceneItemId, sceneItemEnabled }) => {
        const sceneItems = this.state.sceneItemsBySceneName[sceneName];
        const sceneItem = sceneItems?.find((candidate) => candidate.sceneItemId === sceneItemId);

        if (sceneItem) {
          sceneItem.sceneItemEnabled = Boolean(sceneItemEnabled);
        }
      },
      streamStateChanged: () => {
        this.refreshOutputStatesFromEvent();
      },
      recordStateChanged: () => {
        this.refreshOutputStatesFromEvent();
      },
      studioModeStateChanged: ({ studioModeEnabled }) => {
        this.state.studioModeEnabled = Boolean(studioModeEnabled);
      }
    };

    this.client.on('ConnectionClosed', this.boundHandlers.connectionClosed);
    this.client.on('ConnectionError', this.boundHandlers.connectionError);
    this.client.on('CurrentProgramSceneChanged', this.boundHandlers.currentProgramSceneChanged);
    this.client.on('SceneListChanged', this.boundHandlers.sceneListChanged);
    this.client.on('InputCreated', this.boundHandlers.inputCreated);
    this.client.on('InputRemoved', this.boundHandlers.inputRemoved);
    this.client.on('SceneItemCreated', this.boundHandlers.sceneItemCreated);
    this.client.on('SceneItemRemoved', this.boundHandlers.sceneItemRemoved);
    this.client.on('InputMuteStateChanged', this.boundHandlers.inputMuteStateChanged);
    this.client.on('SceneItemEnableStateChanged', this.boundHandlers.sceneItemEnableStateChanged);
    this.client.on('StreamStateChanged', this.boundHandlers.streamStateChanged);
    this.client.on('RecordStateChanged', this.boundHandlers.recordStateChanged);
    this.client.on('StudioModeStateChanged', this.boundHandlers.studioModeStateChanged);
  }

  detachClientHandlers() {
    if (!this.client || !this.boundHandlers) {
      return;
    }

    this.client.off('ConnectionClosed', this.boundHandlers.connectionClosed);
    this.client.off('ConnectionError', this.boundHandlers.connectionError);
    this.client.off('CurrentProgramSceneChanged', this.boundHandlers.currentProgramSceneChanged);
    this.client.off('SceneListChanged', this.boundHandlers.sceneListChanged);
    this.client.off('InputCreated', this.boundHandlers.inputCreated);
    this.client.off('InputRemoved', this.boundHandlers.inputRemoved);
    this.client.off('SceneItemCreated', this.boundHandlers.sceneItemCreated);
    this.client.off('SceneItemRemoved', this.boundHandlers.sceneItemRemoved);
    this.client.off('InputMuteStateChanged', this.boundHandlers.inputMuteStateChanged);
    this.client.off('SceneItemEnableStateChanged', this.boundHandlers.sceneItemEnableStateChanged);
    this.client.off('StreamStateChanged', this.boundHandlers.streamStateChanged);
    this.client.off('RecordStateChanged', this.boundHandlers.recordStateChanged);
    this.client.off('StudioModeStateChanged', this.boundHandlers.studioModeStateChanged);
    this.boundHandlers = null;
  }
}

function sanitizeObsConfig(partialConfig) {
  const sanitized = {};

  if ('url' in partialConfig) {
    sanitized.url = String(partialConfig.url || 'ws://127.0.0.1:4455').trim() || 'ws://127.0.0.1:4455';
  }

  if ('password' in partialConfig) {
    sanitized.password = String(partialConfig.password || '');
  }

  if ('autoConnect' in partialConfig) {
    sanitized.autoConnect = partialConfig.autoConnect !== false;
  }

  return sanitized;
}

function buildConnectionCandidates(configuredUrl, tryFallbacks) {
  const primaryUrl = sanitizeObsUrl(configuredUrl || 'ws://127.0.0.1:4455');
  const urls = [primaryUrl];

  if (tryFallbacks && isDefaultObsUrl(primaryUrl)) {
    urls.push('ws://127.0.0.1:4444');
    urls.push('ws://localhost:4455');
    urls.push('ws://localhost:4444');
  }

  return Array.from(new Set(urls));
}

function sanitizeObsUrl(url) {
  return String(url || 'ws://127.0.0.1:4455').trim() || 'ws://127.0.0.1:4455';
}

function isDefaultObsUrl(url) {
  return [
    'ws://127.0.0.1:4455',
    'ws://localhost:4455',
    'ws://127.0.0.1:4444',
    'ws://localhost:4444'
  ].includes(url);
}

function formatObsError(error, attemptedUrls) {
  const message = error?.message || 'Unable to connect to OBS.';

  if (message.includes('ECONNREFUSED')) {
    return `Could not reach the OBS WebSocket server. Tried: ${attemptedUrls.join(', ')}.`;
  }

  if (message.toLowerCase().includes('authentication')) {
    return 'OBS rejected the WebSocket password. Update the password and try again.';
  }

  return message;
}

function buildSetupHint(error) {
  const message = error?.message || '';

  if (message.includes('ECONNREFUSED')) {
    return 'Open OBS, go to Tools > WebSocket Server Settings, enable the server, and confirm the port is 4455.';
  }

  if (message.toLowerCase().includes('authentication')) {
    return 'Open OBS > Tools > WebSocket Server Settings and copy the same server password into OpenDeck.';
  }

  return 'Verify OBS is running with its WebSocket server enabled, then try reconnecting.';
}

module.exports = {
  ObsService
};
