const fs = require('node:fs/promises');
const path = require('node:path');

class AppStateStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = createDefaultState();
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = mergeState(parsed);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      await this.save();
    }
  }

  async save() {
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  getState() {
    return this.state;
  }

  getDeckAssignments(deckId, profileId = 'default') {
    const deckAssignments = ensureDeckAssignments(this.state, deckId);

    if (!deckAssignments[profileId]) {
      deckAssignments[profileId] = {};
    }

    return deckAssignments[profileId];
  }

  getProfileCollection(deckId) {
    return ensureProfileCollection(this.state, deckId);
  }

  getObsConnection() {
    return this.state.obsConnection;
  }

  async updateObsConnection(partialConfig) {
    this.state.obsConnection = {
      ...this.state.obsConnection,
      ...partialConfig
    };
    await this.save();
    return this.state.obsConnection;
  }
}

function createDefaultState() {
  return {
    version: 2,
    layoutAssignmentsByDeck: {},
    profilesByDeck: {},
    obsConnection: {
      url: 'ws://127.0.0.1:4455',
      password: '',
      autoConnect: true
    }
  };
}

function mergeState(parsed) {
  const defaults = createDefaultState();
  const layoutAssignmentsByDeck = normalizeLayoutAssignmentsByDeck(parsed?.layoutAssignmentsByDeck || {});
  const profilesByDeck = normalizeProfilesByDeck(parsed?.profilesByDeck || {}, layoutAssignmentsByDeck);

  return {
    ...defaults,
    ...parsed,
    version: 2,
    layoutAssignmentsByDeck,
    profilesByDeck,
    obsConnection: {
      ...defaults.obsConnection,
      ...(parsed?.obsConnection || {})
    }
  };
}

function normalizeLayoutAssignmentsByDeck(layoutAssignmentsByDeck) {
  const normalized = {};

  for (const [deckId, value] of Object.entries(layoutAssignmentsByDeck || {})) {
    if (!value || typeof value !== 'object') {
      normalized[deckId] = {
        default: {}
      };
      continue;
    }

    if (looksLikeLegacySlotMap(value)) {
      normalized[deckId] = {
        default: {
          ...value
        }
      };
      continue;
    }

    normalized[deckId] = {};

    for (const [profileId, assignments] of Object.entries(value)) {
      normalized[deckId][profileId] = assignments && typeof assignments === 'object'
        ? { ...assignments }
        : {};
    }
  }

  return normalized;
}

function normalizeProfilesByDeck(profilesByDeck, layoutAssignmentsByDeck) {
  const normalized = {};
  const deckIds = new Set([
    ...Object.keys(layoutAssignmentsByDeck || {}),
    ...Object.keys(profilesByDeck || {})
  ]);

  for (const deckId of deckIds) {
    const candidate = profilesByDeck?.[deckId];
    const profilesById = {};
    const knownProfileIds = new Set([
      'default',
      ...Object.keys(layoutAssignmentsByDeck?.[deckId] || {}),
      ...Object.keys(candidate?.profilesById || {})
    ]);

    for (const profileId of knownProfileIds) {
      const existingProfile = candidate?.profilesById?.[profileId];
      profilesById[profileId] = normalizeProfileRecord(existingProfile, profileId);
    }

    normalized[deckId] = {
      activeProfileId: profilesById[candidate?.activeProfileId] ? candidate.activeProfileId : 'default',
      profilesById
    };
  }

  return normalized;
}

function ensureDeckAssignments(state, deckId) {
  if (!state.layoutAssignmentsByDeck[deckId]) {
    state.layoutAssignmentsByDeck[deckId] = {
      default: {}
    };
  }

  return state.layoutAssignmentsByDeck[deckId];
}

function ensureProfileCollection(state, deckId) {
  if (!state.profilesByDeck[deckId]) {
    state.profilesByDeck[deckId] = {
      activeProfileId: 'default',
      profilesById: {
        default: normalizeProfileRecord(null, 'default')
      }
    };
  }

  if (!state.profilesByDeck[deckId].profilesById.default) {
    state.profilesByDeck[deckId].profilesById.default = normalizeProfileRecord(null, 'default');
  }

  if (!state.profilesByDeck[deckId].activeProfileId || !state.profilesByDeck[deckId].profilesById[state.profilesByDeck[deckId].activeProfileId]) {
    state.profilesByDeck[deckId].activeProfileId = 'default';
  }

  return state.profilesByDeck[deckId];
}

function normalizeProfileRecord(profile, profileId) {
  const now = new Date().toISOString();
  const safeName = profileId === 'default'
    ? 'Default Profile'
    : startCase(profileId.replace(/^profile:/, ''));

  return {
    id: profileId,
    name: typeof profile?.name === 'string' && profile.name.trim() !== '' ? profile.name : safeName,
    autoSwitchRules: Array.isArray(profile?.autoSwitchRules)
      ? profile.autoSwitchRules.map((rule) => normalizeAutoSwitchRule(rule))
      : [],
    createdAt: typeof profile?.createdAt === 'string' ? profile.createdAt : now,
    updatedAt: typeof profile?.updatedAt === 'string' ? profile.updatedAt : now,
    lastActivatedAt: typeof profile?.lastActivatedAt === 'string' ? profile.lastActivatedAt : null,
    lastActivationSource: typeof profile?.lastActivationSource === 'string' ? profile.lastActivationSource : null
  };
}

function normalizeAutoSwitchRule(rule) {
  return {
    id: typeof rule?.id === 'string' && rule.id.trim() !== ''
      ? rule.id
      : `rule:${Math.random().toString(36).slice(2, 10)}`,
    enabled: rule?.enabled !== false,
    matchStrategy: typeof rule?.matchStrategy === 'string' ? rule.matchStrategy : 'processName',
    matchType: typeof rule?.matchType === 'string' ? rule.matchType : 'includes',
    pattern: typeof rule?.pattern === 'string' ? rule.pattern : '',
    desktopBackend: typeof rule?.desktopBackend === 'string' ? rule.desktopBackend : 'any'
  };
}

function looksLikeLegacySlotMap(value) {
  const keys = Object.keys(value || {});

  return keys.length > 0 && keys.every((key) => key.startsWith('button:'));
}

function startCase(value) {
  return String(value || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

module.exports = {
  AppStateStore
};
