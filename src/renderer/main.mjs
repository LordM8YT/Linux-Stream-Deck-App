import { buildHardwarePayload, drawKeyPreview } from './previewRenderer.mjs';

const elements = {
  deckTitle: document.querySelector('#deck-title'),
  deckMode: document.querySelector('#deck-mode'),
  deckCopy: document.querySelector('#deck-copy'),
  deckGrid: document.querySelector('#deck-grid'),
  pluginCount: document.querySelector('#plugin-count'),
  pluginList: document.querySelector('#plugin-list'),
  pluginDirectoryList: document.querySelector('#plugin-directory-list'),
  pluginImportInput: document.querySelector('#plugin-import-input'),
  pluginImportButton: document.querySelector('#plugin-import-button'),
  pluginPreviewButton: document.querySelector('#plugin-preview-button'),
  pluginImportMetaText: document.querySelector('#plugin-import-meta-text'),
  deviceStatus: document.querySelector('#device-status'),
  obsStatusBadge: document.querySelector('#obs-status-badge'),
  obsUrlInput: document.querySelector('#obs-url-input'),
  obsPasswordInput: document.querySelector('#obs-password-input'),
  obsConnectButton: document.querySelector('#obs-connect-button'),
  obsDisconnectButton: document.querySelector('#obs-disconnect-button'),
  obsRefreshScenesButton: document.querySelector('#obs-refresh-scenes-button'),
  obsMetaText: document.querySelector('#obs-meta-text'),
  inspectorContent: document.querySelector('#inspector-content'),
  selectionBadge: document.querySelector('#selection-badge'),
  selectionHint: document.querySelector('#selection-hint'),
  feedbackMessage: document.querySelector('#feedback-message'),
  rescanButton: document.querySelector('#rescan-button'),
  reloadPluginsButton: document.querySelector('#reload-plugins-button'),
  actionSearchInput: document.querySelector('#action-search-input'),
  keysTabButton: document.querySelector('#keys-tab-button'),
  pluginsTabButton: document.querySelector('#plugins-tab-button'),
  keysPanel: document.querySelector('#keys-panel'),
  pluginsPanel: document.querySelector('#plugins-panel')
};

const state = {
  data: null,
  selectedSlotId: null,
  activeTab: 'keys',
  actionSearchQuery: '',
  lastHardwareDeckSignature: null,
  bridgeAvailable: true,
  collapsedLibrarySections: new Set()
};

const dragState = {
  actionId: null
};

function getAppApi() {
  if (!window.streamDeckApp) {
    throw new Error('OpenDeck desktop bridge failed to load. Restart the app. If it still fails, the Electron preload bridge is not available.');
  }

  return window.streamDeckApp;
}

async function bootstrapApp() {
  try {
    state.bridgeAvailable = true;
    state.data = await getAppApi().getBootstrapState();
    ensureSelectionIsValid();
    renderApp();
    await syncHardwareDeck({ force: true });
  } catch (error) {
    console.error(error);
    state.bridgeAvailable = false;
    state.data = createFallbackBootstrapState();
    ensureSelectionIsValid();
    renderApp();
    setFeedback('Desktop bridge is unavailable right now, so OpenDeck is showing a local UI preview instead of the live app state.', true);
  }
}

elements.rescanButton.addEventListener('click', async () => {
  setFeedback('Rescanning for connected Stream Deck hardware...');
  await refreshState(() => getAppApi().rescanDevices(), {
    syncHardware: true
  });
});

elements.reloadPluginsButton.addEventListener('click', async () => {
  setFeedback('Reloading plugin folders from disk...');
  await refreshState(() => getAppApi().reloadPlugins());
});

elements.pluginPreviewButton.addEventListener('click', async () => {
  const sourceUrl = elements.pluginImportInput.value.trim();

  if (!sourceUrl) {
    setFeedback('Paste a plugin URL first so OpenDeck can inspect it.', true);
    return;
  }

  setFeedback('Inspecting plugin source...');

  try {
    const preview = await getAppApi().inspectPluginSource({ sourceUrl });
    const actionLabel = preview.actionCount === 1 ? 'action' : 'actions';
    const fileLabel = preview.fileCount === 1 ? 'file' : 'files';

    elements.pluginImportMetaText.textContent = `Ready to import ${preview.pluginName} ${preview.pluginVersion}. ${preview.actionCount} ${actionLabel}, ${preview.fileCount} ${fileLabel}.`;
    setFeedback(`Found plugin "${preview.pluginName}" from ${preview.resolver}.`);
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Failed to inspect the plugin source.', true);
  }
});

elements.pluginImportButton.addEventListener('click', async () => {
  const sourceUrl = elements.pluginImportInput.value.trim();

  if (!sourceUrl) {
    setFeedback('Paste a plugin URL first so OpenDeck can import it.', true);
    return;
  }

  setFeedback('Importing plugin into your local plugin folder...');

  try {
    const result = await getAppApi().importPlugin({ sourceUrl });

    if (result.state) {
      state.data = result.state;
      ensureSelectionIsValid();
      renderApp();
    }

    elements.pluginImportInput.value = '';
    elements.pluginImportMetaText.textContent = `Installed ${result.pluginName} into ${result.installRoot}.`;
    setFeedback(`Imported plugin "${result.pluginName}" successfully.`);
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Failed to import the plugin.', true);
  }
});

elements.actionSearchInput.addEventListener('input', () => {
  state.actionSearchQuery = elements.actionSearchInput.value;
  renderLibraries();
});

elements.keysTabButton.addEventListener('click', () => {
  state.activeTab = 'keys';
  renderLibraries();
});

elements.pluginsTabButton.addEventListener('click', () => {
  state.activeTab = 'plugins';
  renderLibraries();
});

elements.obsConnectButton.addEventListener('click', async () => {
  await saveObsConnection();
  setFeedback('Connecting to OBS Studio...');

  try {
    await refreshState(() => getAppApi().connectObs());
    setFeedback('Connected to OBS Studio.');
  } catch (error) {
    await refreshState(() => getAppApi().getBootstrapState());
    console.error(error);
    setFeedback(error.message || 'Failed to connect to OBS Studio.', true);
  }
});

elements.obsDisconnectButton.addEventListener('click', async () => {
  await refreshState(() => getAppApi().disconnectObs());
  setFeedback('Disconnected from OBS Studio.');
});

elements.obsRefreshScenesButton.addEventListener('click', async () => {
  try {
    await refreshState(() => getAppApi().refreshObsScenes());
    setFeedback('Refreshed OBS scene list.');
  } catch (error) {
    await refreshState(() => getAppApi().getBootstrapState());
    console.error(error);
    setFeedback(error.message || 'Failed to refresh OBS scenes.', true);
  }
});

await bootstrapApp();

async function refreshState(loader, { syncHardware = false } = {}) {
  const previousSignature = getDeckSignature(state.data);

  try {
    state.data = await loader();
    ensureSelectionIsValid();
    renderApp();

    const currentSignature = getDeckSignature(state.data);

    if (syncHardware || (currentSignature && currentSignature !== previousSignature)) {
      await syncHardwareDeck({
        force: syncHardware
      });
    }
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Something went wrong while refreshing the app state.', true);
  }
}

function ensureSelectionIsValid() {
  if (!state.selectedSlotId) {
    return;
  }

  const slot = getSlots().find((candidate) => candidate.slotId === state.selectedSlotId);

  if (!slot) {
    state.selectedSlotId = null;
  }
}

function renderApp() {
  renderDeckSummary();
  renderBridgeAvailability();
  renderObsPanel();
  renderLibraries();
  renderDeckGrid();
  renderInspector();
  renderSelectionHint();
}

function renderBridgeAvailability() {
  const offline = !state.bridgeAvailable;

  elements.rescanButton.disabled = offline;
  elements.reloadPluginsButton.disabled = offline;
  elements.pluginImportButton.disabled = offline;
  elements.pluginPreviewButton.disabled = offline;
  elements.obsConnectButton.disabled = offline;
  elements.obsDisconnectButton.disabled = offline || !state.data.obs.connected;
  elements.obsRefreshScenesButton.disabled = offline || !state.data.obs.connected;

  if (offline) {
    elements.deviceStatus.textContent = 'Preview Mode';
    elements.deviceStatus.classList.add('status-chip--warning');
    elements.deviceStatus.classList.remove('status-chip--live');
  }
}

function renderDeckSummary() {
  const { deck, plugins } = state.data;
  const connectedDevice = deck.devices.find((device) => device.path === deck.activeDevicePath);
  const layoutLabel = `${deck.profile.columns} x ${deck.profile.rows}`;
  const deviceLabel = connectedDevice
    ? `${connectedDevice.modelName} ${layoutLabel}`
    : deck.driver.available
      ? `Mock layout ${layoutLabel}`
      : 'Driver unavailable';

  if (state.bridgeAvailable) {
    elements.deviceStatus.textContent = deviceLabel;
    elements.deviceStatus.classList.toggle('status-chip--warning', !connectedDevice);
    elements.deviceStatus.classList.toggle('status-chip--live', Boolean(connectedDevice));
  }

  elements.deckTitle.textContent = connectedDevice ? connectedDevice.modelName : 'Stream Deck';
  elements.deckMode.textContent = deck.profile.isMock ? 'Default Profile' : 'Live Hardware Profile';

  const description = deck.profile.isMock
    ? `No hardware is connected right now, so OpenDeck is showing a mock ${layoutLabel} layout for setup and testing.`
    : `${deck.profile.productName} is connected. The editor grid, key sizing, and assignment layout now follow this device automatically.`;
  const setupHint = deck.setupHints?.[0];

  elements.deckCopy.textContent = setupHint ? `${description} ${setupHint}` : description;
}

function renderObsPanel() {
  const { obs } = state.data;

  if (document.activeElement !== elements.obsUrlInput) {
    elements.obsUrlInput.value = obs.config.url || '';
  }

  if (document.activeElement !== elements.obsPasswordInput) {
    elements.obsPasswordInput.value = obs.config.password || '';
  }

  elements.obsStatusBadge.textContent = obs.connected
    ? `OBS: ${obs.currentProgramSceneName || 'Connected'}`
    : obs.connecting
      ? 'OBS: Connecting'
      : 'OBS: Offline';
  elements.obsStatusBadge.classList.toggle('status-chip--live', obs.connected);
  elements.obsStatusBadge.classList.toggle('status-chip--warning', !obs.connected);

  if (obs.connected) {
    const sceneLabel = obs.scenes.length === 1 ? 'scene' : 'scenes';
    const versionText = obs.obsWebSocketVersion ? `OBS WS ${obs.obsWebSocketVersion}` : 'Connected';
    elements.obsMetaText.textContent = `${versionText}. ${obs.scenes.length} ${sceneLabel} available.`;
  } else if (obs.setupHint) {
    elements.obsMetaText.textContent = `${obs.setupHint}${obs.lastError ? ` Last error: ${obs.lastError}` : ''}`;
  } else if (obs.lastError) {
    elements.obsMetaText.textContent = obs.lastError;
  } else {
    elements.obsMetaText.textContent = 'Auto-connect is enabled. Open OBS with its WebSocket server active to populate scene actions.';
  }

  if (state.bridgeAvailable) {
    elements.obsDisconnectButton.disabled = !obs.connected && !obs.connecting;
    elements.obsRefreshScenesButton.disabled = !obs.connected;
  }
}

function renderLibraries() {
  const showKeys = state.activeTab === 'keys';

  elements.keysPanel.classList.toggle('u-hidden', !showKeys);
  elements.pluginsPanel.classList.toggle('u-hidden', showKeys);
  elements.keysTabButton.classList.toggle('tab-button--active', showKeys);
  elements.pluginsTabButton.classList.toggle('tab-button--active', !showKeys);
  elements.keysTabButton.setAttribute('aria-selected', String(showKeys));
  elements.pluginsTabButton.setAttribute('aria-selected', String(!showKeys));

  renderActionLibrary();
  renderPluginImportPanel();
  renderPluginDirectory();
}

function renderActionLibrary() {
  elements.pluginList.innerHTML = '';

  if (state.data.plugins.errors.length > 0) {
    const errorBlock = document.createElement('div');
    errorBlock.className = 'plugin-error';
    errorBlock.textContent = state.data.plugins.errors
      .map((error) => `${error.folder}: ${error.message}`)
      .join(' | ');
    elements.pluginList.append(errorBlock);
  }

  const query = state.actionSearchQuery.trim().toLowerCase();
  const sections = buildLibrarySections(query);
  const visibleActionCount = sections.reduce((total, section) => total + section.actions.length, 0);

  elements.pluginCount.textContent = `${visibleActionCount} actions`;

  if (sections.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = query
      ? 'No actions matched this search.'
      : 'No actions are available yet. Add a plugin folder with a manifest.json and index.js inside /plugins.';
    elements.pluginList.append(empty);
    return;
  }

  for (const sectionData of sections) {
    const section = document.createElement('section');
    section.className = 'library-section';
    section.classList.toggle('library-section--collapsed', state.collapsedLibrarySections.has(sectionData.id));

    const heading = document.createElement('button');
    heading.type = 'button';
    heading.className = 'library-section__header';
    heading.innerHTML = `
      <span class="library-section__title">
        <strong>${sectionData.title}</strong>
        <small>${sectionData.subtitle}</small>
      </span>
      <span class="library-section__count">${sectionData.actions.length}</span>
      <span class="library-section__chevron" aria-hidden="true"></span>
    `;
    heading.addEventListener('click', () => {
      toggleLibrarySection(sectionData.id);
    });

    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'library-section__actions';

    for (const action of sectionData.actions) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'library-action';
      row.draggable = true;
      row.innerHTML = `
        <span class="library-action__glyph">${getActionGlyph(action)}</span>
        <span class="library-action__copy">
          <strong>${action.name}</strong>
          <span>${action.description || 'Drop onto a key to assign this action.'}</span>
        </span>
        <span class="library-action__tag">${action.defaultLabel}</span>
      `;

      row.addEventListener('dragstart', () => {
        dragState.actionId = action.qualifiedId;
      });

      row.addEventListener('dragend', () => {
        dragState.actionId = null;
      });

      row.addEventListener('click', async () => {
        if (!state.selectedSlotId) {
          setFeedback('Select a key first, or drag this action onto the deck grid.', true);
          return;
        }

        await assignActionToSlot(state.selectedSlotId, action.qualifiedId);
      });

      actionsWrapper.append(row);
    }

    section.append(heading, actionsWrapper);
    elements.pluginList.append(section);
  }
}

function renderPluginDirectory() {
  elements.pluginDirectoryList.innerHTML = '';

  if (state.data.plugins.plugins.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No plugin folders were found yet.';
    elements.pluginDirectoryList.append(empty);
    return;
  }

  const query = state.actionSearchQuery.trim().toLowerCase();

  for (const plugin of state.data.plugins.plugins) {
    if (query && !matchesPluginQuery(plugin, query)) {
      continue;
    }

    const card = document.createElement('article');
    card.className = 'plugin-directory-card';
    card.innerHTML = `
      <div>
        <h3>${plugin.name}</h3>
        <p>${plugin.description || 'No description provided.'}</p>
      </div>
      <div class="plugin-directory-card__meta">
        <span class="rail-badge">${plugin.version}</span>
        <span class="rail-badge">${plugin.actions.length} actions</span>
        <span class="rail-badge">${plugin.source?.resolver ? 'Imported' : 'Bundled'}</span>
      </div>
      <div class="plugin-directory-card__source">${getPluginSourceText(plugin)}</div>
      <div class="plugin-directory-card__root">${plugin.root}</div>
    `;
    elements.pluginDirectoryList.append(card);
  }

  if (!elements.pluginDirectoryList.children.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No plugins matched this search.';
    elements.pluginDirectoryList.append(empty);
  }
}

function renderPluginImportPanel() {
  const pluginDirectory = state.data?.app?.pluginDirectory || 'plugins';
  const bundledPluginDirectory = state.data?.app?.bundledPluginDirectory || 'plugins';
  const examples = state.data?.app?.pluginImportExamples || [];
  const firstExample = examples[0];

  if (document.activeElement !== elements.pluginImportInput && !elements.pluginImportInput.value) {
    elements.pluginImportInput.placeholder = firstExample || 'https://github.com/owner/repo/tree/main/plugin-folder';
  }

  if (!elements.pluginImportMetaText.textContent || elements.pluginImportMetaText.textContent === 'Imported plugins are installed into your writable user plugin folder.') {
    elements.pluginImportMetaText.textContent = `Imports land in ${pluginDirectory}. Bundled plugins stay in ${bundledPluginDirectory}.`;
  }
}

function renderDeckGrid() {
  const slots = getSlots();
  const { profile } = state.data.deck;
  const columns = profile.columns || 5;
  const keySize = getDeckKeySize(profile);
  const gap = getDeckGap(profile);

  elements.deckGrid.innerHTML = '';
  elements.deckGrid.style.setProperty('--deck-columns', columns);
  elements.deckGrid.style.setProperty('--deck-key-size', `${keySize}px`);
  elements.deckGrid.style.setProperty('--deck-gap', `${gap}px`);

  for (const slot of slots) {
    const action = getAssignedAction(slot);
    const plugin = action ? getPlugin(action.pluginId) : null;
    const key = document.createElement('button');

    key.type = 'button';
    key.className = 'deck-key';
    key.classList.toggle('deck-key--selected', slot.slotId === state.selectedSlotId);
    key.classList.toggle('deck-key--filled', Boolean(action));
    key.dataset.slotId = slot.slotId;
    key.title = action ? getDisplayLabel(slot, action) : `Key ${slot.index + 1}`;

    const canvas = document.createElement('canvas');
    canvas.className = 'deck-key__canvas';
    drawKeyPreview(canvas, {
      slot,
      action,
      plugin,
      label: action ? getDisplayLabel(slot, action) : null,
      isSelected: slot.slotId === state.selectedSlotId
    });

    key.append(canvas);

    key.addEventListener('click', () => {
      state.selectedSlotId = slot.slotId;
      renderDeckGrid();
      renderInspector();
      renderSelectionHint();
    });

    key.addEventListener('dragover', (event) => {
      event.preventDefault();
      key.classList.add('deck-key--drop-target');
    });

    key.addEventListener('dragleave', () => {
      key.classList.remove('deck-key--drop-target');
    });

    key.addEventListener('drop', async (event) => {
      event.preventDefault();
      key.classList.remove('deck-key--drop-target');

      if (!dragState.actionId) {
        return;
      }

      await assignActionToSlot(slot.slotId, dragState.actionId);
    });

    elements.deckGrid.append(key);
  }
}

function renderInspector() {
  const slot = getSlots().find((candidate) => candidate.slotId === state.selectedSlotId);

  if (!slot) {
    elements.selectionBadge.textContent = 'No key selected';
    elements.inspectorContent.innerHTML = '<p class="empty-state">Select a key to inspect it, configure an action, and test it before going live.</p>';
    return;
  }

  const action = getAssignedAction(slot);
  const plugin = action ? getPlugin(action.pluginId) : null;
  elements.selectionBadge.textContent = `Key ${slot.index + 1}`;

  const wrapper = document.createElement('div');
  wrapper.className = 'inspector-card';

  const top = document.createElement('div');
  top.className = 'inspector-card__top';

  const preview = document.createElement('canvas');
  preview.className = 'inspector-card__preview';
  drawKeyPreview(preview, {
    slot,
    action,
    plugin,
    label: action ? getDisplayLabel(slot, action) : null,
    isSelected: true
  });

  const summary = document.createElement('div');
  summary.className = 'inspector-card__summary';
  summary.innerHTML = `
    <h3>${action ? action.name : 'Unassigned key'}</h3>
    <p>${action ? action.description || 'This action is ready to trigger from the UI or the physical device.' : 'Pick an action from the library, then assign it to this key.'}</p>
    <dl class="metadata-list">
      <div><dt>Position</dt><dd>Row ${slot.row + 1}, Column ${slot.column + 1}</dd></div>
      <div><dt>Plugin</dt><dd>${plugin ? plugin.name : 'None'}</dd></div>
      <div><dt>Action</dt><dd>${action ? action.defaultLabel : 'Empty'}</dd></div>
    </dl>
  `;

  top.append(preview, summary);
  wrapper.append(top);

  const configForm = action ? renderAssignmentConfig(slot, action) : null;

  if (configForm) {
    wrapper.append(configForm);
  }

  const actionsBar = document.createElement('div');
  actionsBar.className = 'inspector-card__actions';

  const triggerButton = document.createElement('button');
  triggerButton.type = 'button';
  triggerButton.className = 'control-button';
  triggerButton.textContent = action ? 'Run Action' : 'Assign Action';

  triggerButton.addEventListener('click', async () => {
    if (!action) {
      setFeedback('Choose an action from the library, then assign it to this key.', true);
      return;
    }

    try {
      const result = await getAppApi().triggerAssignedAction({
        slotId: slot.slotId
      });

      if (result.state) {
        state.data = result.state;
      }

      if (!result.ok && result.errorMessage) {
        setFeedback(result.errorMessage, true);
      } else {
        setFeedback(result.ok ? 'Plugin action executed successfully.' : `Action did not run: ${result.reason}`);
      }

      renderApp();
    } catch (error) {
      console.error(error);
      setFeedback(error.message || 'Failed to execute the selected plugin action.', true);
    }
  });

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'control-button control-button--secondary';
  clearButton.textContent = 'Clear Key';
  clearButton.disabled = !action;

  clearButton.addEventListener('click', async () => {
    await refreshState(() => getAppApi().clearAction({ slotId: slot.slotId }));
    await pushPreviewToHardware(slot.slotId);
    setFeedback(`Cleared assignment from key ${slot.index + 1}.`);
  });

  actionsBar.append(triggerButton, clearButton);
  wrapper.append(actionsBar);

  elements.inspectorContent.innerHTML = '';
  elements.inspectorContent.append(wrapper);
}

function renderAssignmentConfig(slot, action) {
  if (!Array.isArray(action.configFields) || action.configFields.length === 0) {
    return null;
  }

  const fieldset = document.createElement('section');
  fieldset.className = 'config-form';
  fieldset.innerHTML = `
    <div>
      <p class="rail-kicker">Action Settings</p>
      <h3>Configuration</h3>
    </div>
  `;

  for (const field of action.configFields) {
    const wrapper = document.createElement('label');
    wrapper.className = 'field-group';

    const title = document.createElement('span');
    title.textContent = field.label;
    wrapper.append(title);

    const control = createConfigControl(slot, field);
    wrapper.append(control);

    if (field.description) {
      const description = document.createElement('small');
      description.className = 'field-hint';
      description.textContent = field.description;
      wrapper.append(description);
    }

    fieldset.append(wrapper);
  }

  return fieldset;
}

function createConfigControl(slot, field) {
  const currentValue = slot.assignment?.config?.[field.id] ?? '';
  const isSelect = field.type === 'select';
  const control = document.createElement(isSelect ? 'select' : 'input');

  if (!isSelect) {
    control.type = field.type || 'text';
    control.placeholder = field.placeholder || '';
    control.value = currentValue;
  } else {
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = resolveFieldPlaceholder(field);
    control.append(placeholderOption);

    const options = resolveFieldOptions(field);

    for (const option of options) {
      const optionElement = document.createElement('option');
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      optionElement.selected = option.value === currentValue;
      control.append(optionElement);
    }

    if (currentValue) {
      control.value = currentValue;
    }

    if (!options.length) {
      control.disabled = true;
    }
  }

  control.addEventListener('change', async () => {
    await updateAssignmentConfig(slot.slotId, {
      [field.id]: control.value
    });
    setFeedback(`Updated ${field.label.toLowerCase()} for key ${slot.index + 1}.`);
  });

  return control;
}

function resolveFieldPlaceholder(field) {
  if (field.optionsSource === 'obs.scenes' && state.data.obs.scenes.length === 0) {
    return 'Connect OBS to load scenes';
  }

  return field.placeholder || `Select ${field.label}`;
}

function resolveFieldOptions(field) {
  if (field.optionsSource === 'obs.scenes') {
    return state.data.obs.scenes.map((scene) => ({
      value: scene.sceneName,
      label: scene.sceneName
    }));
  }

  return (field.options || []).map((option) => {
    if (typeof option === 'string') {
      return {
        value: option,
        label: option
      };
    }

    return {
      value: option.value,
      label: option.label
    };
  });
}

async function assignActionToSlot(slotId, actionId) {
  state.selectedSlotId = slotId;
  await refreshState(() => getAppApi().assignAction({ slotId, actionId }));
  await pushPreviewToHardware(slotId);

  const slot = getSlots().find((candidate) => candidate.slotId === slotId);
  const action = slot ? getAssignedAction(slot) : null;
  setFeedback(action ? `Assigned "${action.name}" to key ${slot.index + 1}.` : 'Assignment updated.');
}

async function updateAssignmentConfig(slotId, configPatch) {
  await refreshState(() => getAppApi().updateAssignmentConfig({
    slotId,
    config: configPatch
  }));
  await pushPreviewToHardware(slotId);
}

async function pushPreviewToHardware(slotId) {
  const slot = getSlots().find((candidate) => candidate.slotId === slotId);

  if (!slot) {
    return;
  }

  const action = getAssignedAction(slot);
  const plugin = action ? getPlugin(action.pluginId) : null;
  const payload = buildHardwarePayload({
    slot,
    action,
    plugin,
    label: action ? getDisplayLabel(slot, action) : null,
    isSelected: false
  });

  try {
    const result = await getAppApi().renderKey({
      deckId: state.data.deck.profile.id,
      keyIndex: slot.index,
      imageData: payload
    });

    if (!result.ok && result.reason !== 'NO_ACTIVE_DEVICE') {
      setFeedback(`Preview was not pushed to hardware: ${result.reason}.`, true);
    }
  } catch (error) {
    console.error(error);
    setFeedback(error.message || 'Failed to render the key preview to hardware.', true);
  }
}

async function syncHardwareDeck({ force = false } = {}) {
  const signature = getDeckSignature(state.data);

  if (!signature || (!force && signature === state.lastHardwareDeckSignature)) {
    return;
  }

  for (const slot of getSlots()) {
    await pushPreviewToHardware(slot.slotId);
  }

  state.lastHardwareDeckSignature = signature;
}

async function saveObsConnection() {
  await refreshState(() => getAppApi().updateObsConnection({
    url: elements.obsUrlInput.value,
    password: elements.obsPasswordInput.value
  }));
}

function renderSelectionHint() {
  const slot = getSlots().find((candidate) => candidate.slotId === state.selectedSlotId);

  if (!slot) {
    elements.selectionHint.textContent = 'Select a key to configure its action.';
    return;
  }

  const action = getAssignedAction(slot);

  elements.selectionHint.textContent = action
    ? `Key ${slot.index + 1} is ready to run "${getDisplayLabel(slot, action)}".`
    : `Key ${slot.index + 1} is empty. Pick an action from the right rail.`;
}

function matchesActionQuery(action, plugin, query) {
  if (!query) {
    return true;
  }

  return [
    action.name,
    action.description,
    action.defaultLabel,
    plugin.name,
    plugin.description
  ].some((value) => String(value || '').toLowerCase().includes(query));
}

function matchesPluginQuery(plugin, query) {
  return [
    plugin.name,
    plugin.description,
    plugin.version,
    plugin.root
  ].some((value) => String(value || '').toLowerCase().includes(query));
}

function getActionGlyph(action) {
  const label = action.defaultLabel || action.name || 'A';
  const compact = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();

  return compact || 'A';
}

function toggleLibrarySection(sectionId) {
  if (state.collapsedLibrarySections.has(sectionId)) {
    state.collapsedLibrarySections.delete(sectionId);
  } else {
    state.collapsedLibrarySections.add(sectionId);
  }

  renderActionLibrary();
}

function buildLibrarySections(query) {
  return state.data.plugins.plugins
    .flatMap((plugin) => splitPluginIntoSections(plugin))
    .map((section) => ({
      ...section,
      actions: section.actions.filter((action) => matchesActionQuery(action, section.plugin, query))
    }))
    .filter((section) => section.actions.length > 0);
}

function splitPluginIntoSections(plugin) {
  if (plugin.id === 'com.linuxstreamdeck.core') {
    return buildCoreActionSections(plugin);
  }

  return [
    {
      id: `plugin:${plugin.id}`,
      title: plugin.name,
      subtitle: plugin.description || 'Plugin actions',
      plugin,
      actions: plugin.actions
    }
  ];
}

function buildCoreActionSections(plugin) {
  const groups = new Map([
    ['navigation', {
      id: `plugin:${plugin.id}:navigation`,
      title: 'Navigation',
      subtitle: 'Folders, pages, and movement',
      plugin,
      actions: []
    }],
    ['streamdeck', {
      id: `plugin:${plugin.id}:streamdeck`,
      title: 'Stream Deck',
      subtitle: 'Device-level deck controls',
      plugin,
      actions: []
    }],
    ['system', {
      id: `plugin:${plugin.id}:system`,
      title: 'System',
      subtitle: 'Desktop and utility actions',
      plugin,
      actions: []
    }]
  ]);

  for (const action of plugin.actions) {
    groups.get(categorizeCoreAction(action)).actions.push(action);
  }

  return Array.from(groups.values()).filter((section) => section.actions.length > 0);
}

function categorizeCoreAction(action) {
  const signature = `${action.id} ${action.name} ${action.defaultLabel}`.toLowerCase();

  if (signature.includes('page') || signature.includes('folder') || signature.includes('profile')) {
    return 'navigation';
  }

  if (signature.includes('deck') || signature.includes('sleep') || signature.includes('brightness') || signature.includes('timer')) {
    return 'streamdeck';
  }

  return 'system';
}

function getDeckKeySize(profile) {
  if ((profile.columns || 0) >= 8) {
    return 72;
  }

  if ((profile.columns || 0) >= 6 || (profile.rows || 0) >= 4) {
    return 82;
  }

  return 96;
}

function getDeckGap(profile) {
  if ((profile.columns || 0) >= 8) {
    return 12;
  }

  if ((profile.columns || 0) >= 6) {
    return 14;
  }

  return 18;
}

function getDeckSignature(appState) {
  if (!appState?.deck?.profile?.id) {
    return null;
  }

  return `${appState.deck.profile.id}:${appState.deck.activeDevicePath || 'mock'}`;
}

function getSlots() {
  return state.data?.layout?.slots || [];
}

function getAssignedAction(slot) {
  if (!slot.assignment?.actionId) {
    return null;
  }

  return state.data.plugins.actions.find((action) => action.qualifiedId === slot.assignment.actionId) || null;
}

function getPlugin(pluginId) {
  return state.data.plugins.plugins.find((plugin) => plugin.id === pluginId) || null;
}

function getPluginSourceText(plugin) {
  if (!plugin.source?.sourceUrl) {
    return 'Bundled with OpenDeck.';
  }

  const importedAt = plugin.source.importedAt
    ? ` Imported ${new Date(plugin.source.importedAt).toLocaleString()}.`
    : '';

  return `Imported from ${plugin.source.sourceUrl}.${importedAt}`;
}

function getDisplayLabel(slot, action) {
  return slot.assignment?.config?.sceneName || action.defaultLabel;
}

function setFeedback(message, isError = false) {
  elements.feedbackMessage.textContent = message;
  elements.feedbackMessage.classList.toggle('feedback-message--error', isError);
}

function createFallbackBootstrapState() {
  const profile = {
    id: 'preview:streamdeck-mk2',
    model: 'original-mk2',
    productName: 'Stream Deck MK.2',
    serialNumber: null,
    rows: 3,
    columns: 5,
    isMock: true,
    buttons: createPreviewButtons(5, 3, { width: 72, height: 72 })
  };

  const plugins = [
    {
      id: 'com.linuxstreamdeck.obs',
      name: 'OBS Studio',
      version: '0.1.0',
      description: 'Live scene switching for OBS Studio.',
      root: 'plugins/com.linuxstreamdeck.obs',
      actions: [
        {
          qualifiedId: 'com.linuxstreamdeck.obs:scene-switch',
          pluginId: 'com.linuxstreamdeck.obs',
          id: 'scene-switch',
          name: 'Scene Switch',
          description: 'Switch directly to a chosen OBS scene.',
          defaultLabel: 'Scene',
          accentColor: '#56b3ff',
          icon: null,
          configFields: [
            {
              id: 'sceneName',
              label: 'Target scene',
              type: 'select',
              description: 'Connect OBS to populate live scenes.',
              defaultValue: '',
              placeholder: 'Connect OBS to load scenes',
              optionsSource: 'obs.scenes',
              options: []
            }
          ]
        }
      ]
    },
    {
      id: 'com.linuxstreamdeck.core',
      name: 'Core Actions',
      version: '0.1.0',
      description: 'Basic navigation and device actions for the first alpha.',
      root: 'plugins/com.linuxstreamdeck.core',
      actions: [
        {
          qualifiedId: 'com.linuxstreamdeck.core:create-folder',
          pluginId: 'com.linuxstreamdeck.core',
          id: 'create-folder',
          name: 'Create Folder',
          description: 'Create a nested page or folder layout.',
          defaultLabel: 'Folder',
          accentColor: '#d6d6d6',
          icon: null,
          configFields: []
        },
        {
          qualifiedId: 'com.linuxstreamdeck.core:next-page',
          pluginId: 'com.linuxstreamdeck.core',
          id: 'next-page',
          name: 'Next Page',
          description: 'Move to the next page of keys.',
          defaultLabel: 'Next',
          accentColor: '#d6d6d6',
          icon: null,
          configFields: []
        },
        {
          qualifiedId: 'com.linuxstreamdeck.core:sleep',
          pluginId: 'com.linuxstreamdeck.core',
          id: 'sleep',
          name: 'Sleep Deck',
          description: 'Put the Stream Deck display to sleep.',
          defaultLabel: 'Sleep',
          accentColor: '#d6d6d6',
          icon: null,
          configFields: []
        }
      ]
    }
  ];

  const actions = plugins.flatMap((plugin) => plugin.actions);
  const assignmentsBySlotId = {
    'button:0': {
      actionId: 'com.linuxstreamdeck.core:create-folder',
      config: {},
      assignedAt: new Date().toISOString()
    },
    'button:1': {
      actionId: 'com.linuxstreamdeck.obs:scene-switch',
      config: {
        sceneName: 'Gameplay'
      },
      assignedAt: new Date().toISOString()
    },
    'button:2': {
      actionId: 'com.linuxstreamdeck.core:next-page',
      config: {},
      assignedAt: new Date().toISOString()
    },
    'button:11': {
      actionId: 'com.linuxstreamdeck.core:sleep',
      config: {},
      assignedAt: new Date().toISOString()
    }
  };

  return {
    app: {
      name: 'OpenDeck',
      pluginDirectory: 'plugins',
      bundledPluginDirectory: 'plugins',
      pluginImportExamples: [
        'https://github.com/owner/repo/tree/main/plugin-folder',
        'https://example.com/opendeck-marketplace.json#plugin-id'
      ]
    },
    deck: {
      driver: {
        available: true,
        reason: null
      },
      devices: [],
      activeDevicePath: null,
      profile,
      lastError: null,
      lastInputEvent: null,
      setupHints: []
    },
    obs: {
      config: {
        url: 'ws://127.0.0.1:4455',
        password: '',
        autoConnect: true
      },
      connected: false,
      connecting: false,
      obsWebSocketVersion: null,
      currentProgramSceneName: null,
      scenes: [],
      lastError: null,
      setupHint: 'Connect the desktop bridge to populate OBS scenes and live status.'
    },
    layout: {
      deckId: profile.id,
      slots: profile.buttons.map((button) => ({
        ...button,
        assignment: assignmentsBySlotId[button.slotId] || null
      }))
    },
    plugins: {
      plugins,
      actions,
      errors: []
    }
  };
}

function createPreviewButtons(columns, rows, pixelSize) {
  const buttons = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;

      buttons.push({
        slotId: `button:${index}`,
        index,
        hidIndex: index,
        row,
        column,
        feedbackType: 'lcd',
        pixelSize
      });
    }
  }

  return buttons;
}
