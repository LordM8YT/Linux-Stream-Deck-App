module.exports.activate = async ({ registerAction }) => {
  registerAction(createSceneSwitchAction());
  registerAction(createMuteAction({
    id: 'mute-input',
    name: 'Mute Input',
    targetMuted: true
  }));
  registerAction(createMuteAction({
    id: 'unmute-input',
    name: 'Unmute Input',
    targetMuted: false
  }));
  registerAction(createToggleMuteAction());
  registerAction(createOutputAction({
    id: 'start-stream',
    handlerName: 'startStream'
  }));
  registerAction(createOutputAction({
    id: 'stop-stream',
    handlerName: 'stopStream'
  }));
  registerAction(createOutputAction({
    id: 'start-record',
    handlerName: 'startRecord'
  }));
  registerAction(createOutputAction({
    id: 'stop-record',
    handlerName: 'stopRecord'
  }));
  registerAction(createStudioModeAction({
    id: 'enable-studio-mode',
    studioModeEnabled: true
  }));
  registerAction(createStudioModeAction({
    id: 'disable-studio-mode',
    studioModeEnabled: false
  }));
  registerAction(createStudioTransitionAction());
  registerAction(createSourceVisibilityAction());
};

function createSceneSwitchAction() {
  return {
    id: 'scene-switch',
    configFields: [
      {
        id: 'sceneName',
        label: 'Target scene',
        type: 'select',
        optionsSource: 'obs.scenes',
        placeholder: 'Choose an OBS scene'
      }
    ],
    onTrigger: async ({ assignment, services }) => {
      const sceneName = assignment?.config?.sceneName;

      if (!sceneName) {
        throw new Error('No OBS scene is configured for this key.');
      }

      await services.obs.switchScene(sceneName);

      return {
        sceneName
      };
    }
  };
}

function createMuteAction({ id, name, targetMuted }) {
  return {
    id,
    name,
    configFields: [createInputSelectField()],
    onTrigger: async ({ assignment, services }) => {
      const inputName = assignment?.config?.inputName;

      if (!inputName) {
        throw new Error('No OBS input is configured for this key.');
      }

      await services.obs.setInputMute(inputName, targetMuted);

      return {
        inputName,
        inputMuted: targetMuted
      };
    }
  };
}

function createToggleMuteAction() {
  return {
    id: 'toggle-input-mute',
    configFields: [createInputSelectField()],
    onTrigger: async ({ assignment, services }) => {
      const inputName = assignment?.config?.inputName;

      if (!inputName) {
        throw new Error('No OBS input is configured for this key.');
      }

      const result = await services.obs.toggleInputMute(inputName);

      return {
        inputName,
        inputMuted: result.inputMuted
      };
    }
  };
}

function createOutputAction({ id, handlerName }) {
  return {
    id,
    onTrigger: async ({ services }) => {
      await services.obs[handlerName]();
      return {
        handlerName
      };
    }
  };
}

function createStudioModeAction({ id, studioModeEnabled }) {
  return {
    id,
    onTrigger: async ({ services }) => {
      await services.obs.setStudioModeEnabled(studioModeEnabled);
      return {
        studioModeEnabled
      };
    }
  };
}

function createStudioTransitionAction() {
  return {
    id: 'studio-transition',
    onTrigger: async ({ services }) => {
      await services.obs.triggerStudioModeTransition();
      return {
        transitioned: true
      };
    }
  };
}

function createSourceVisibilityAction() {
  return {
    id: 'toggle-source-visibility',
    configFields: [
      {
        id: 'sceneName',
        label: 'Scene',
        type: 'select',
        optionsSource: 'obs.scenes',
        placeholder: 'Choose a scene',
        resetOnChange: ['sceneItemId']
      },
      {
        id: 'sceneItemId',
        label: 'Source',
        type: 'select',
        optionsSource: 'obs.sceneItems',
        placeholder: 'Choose a source inside the selected scene'
      }
    ],
    onTrigger: async ({ assignment, services }) => {
      const sceneName = assignment?.config?.sceneName;
      const rawSceneItemId = assignment?.config?.sceneItemId;
      const sceneItemId = Number(rawSceneItemId);

      if (!sceneName) {
        throw new Error('No OBS scene is configured for this key.');
      }

      if (!rawSceneItemId || Number.isNaN(sceneItemId)) {
        throw new Error('No OBS source is configured for this key.');
      }

      const result = await services.obs.toggleSceneItemEnabled(sceneName, sceneItemId);

      return {
        sceneName,
        sceneItemId,
        sceneItemEnabled: result.sceneItemEnabled
      };
    }
  };
}

function createInputSelectField() {
  return {
    id: 'inputName',
    label: 'Input',
    type: 'select',
    optionsSource: 'obs.inputs',
    placeholder: 'Choose an OBS input'
  };
}
