class ProfileService {
  constructor({ store, layoutService }) {
    this.store = store;
    this.layoutService = layoutService;
  }

  getActiveProfileId(deckProfile) {
    const collection = this.store.getProfileCollection(deckProfile.id);
    return collection.activeProfileId;
  }

  getState(deckProfile, activeWindow = null) {
    const collection = this.store.getProfileCollection(deckProfile.id);
    const activeProfile = collection.profilesById[collection.activeProfileId] || collection.profilesById.default;

    return {
      activeProfileId: activeProfile.id,
      activeProfileName: activeProfile.name,
      profiles: Object.values(collection.profilesById),
      activeWindow
    };
  }

  async switchProfile(deckProfile, profileId, { source = 'manual' } = {}) {
    const collection = this.store.getProfileCollection(deckProfile.id);
    const profile = collection.profilesById[profileId];

    if (!profile) {
      throw new Error(`Unknown profile "${profileId}".`);
    }

    collection.activeProfileId = profileId;
    collection.profilesById[profileId] = {
      ...profile,
      lastActivatedAt: new Date().toISOString(),
      lastActivationSource: source,
      updatedAt: new Date().toISOString()
    };

    await this.store.save();
    return collection.profilesById[profileId];
  }

  async createProfile(deckProfile, { name, cloneFromProfileId = null } = {}) {
    const collection = this.store.getProfileCollection(deckProfile.id);
    const normalizedName = String(name || '').trim();

    if (!normalizedName) {
      throw new Error('Profile name is required.');
    }

    const profileId = buildProfileId(collection, normalizedName);
    const now = new Date().toISOString();

    collection.profilesById[profileId] = {
      id: profileId,
      name: normalizedName,
      autoSwitchRules: [],
      createdAt: now,
      updatedAt: now,
      lastActivatedAt: null,
      lastActivationSource: null
    };

    if (cloneFromProfileId) {
      await this.layoutService.cloneProfileLayout(deckProfile, cloneFromProfileId, profileId);
    }

    collection.activeProfileId = profileId;
    await this.store.save();

    return collection.profilesById[profileId];
  }

  async updateProfileRules(deckProfile, { profileId, autoSwitchRules }) {
    const collection = this.store.getProfileCollection(deckProfile.id);
    const profile = collection.profilesById[profileId];

    if (!profile) {
      throw new Error(`Unknown profile "${profileId}".`);
    }

    collection.profilesById[profileId] = {
      ...profile,
      autoSwitchRules: Array.isArray(autoSwitchRules)
        ? autoSwitchRules.map((rule, index) => normalizeRule(rule, index))
        : [],
      updatedAt: new Date().toISOString()
    };

    await this.store.save();
    return collection.profilesById[profileId];
  }

  async applyAutoSwitch(deckProfile, activeWindow) {
    if (!activeWindow) {
      return null;
    }

    const collection = this.store.getProfileCollection(deckProfile.id);
    const matchingProfile = Object.values(collection.profilesById).find((profile) =>
      profile.autoSwitchRules.some((rule) => ruleMatchesActiveWindow(rule, activeWindow))
    );

    if (!matchingProfile || matchingProfile.id === collection.activeProfileId) {
      return null;
    }

    await this.switchProfile(deckProfile, matchingProfile.id, {
      source: `auto:${activeWindow.backend || 'linux'}`
    });

    return matchingProfile;
  }
}

function buildProfileId(collection, name) {
  const baseId = `profile:${slugify(name) || 'profile'}`;

  if (!collection.profilesById[baseId]) {
    return baseId;
  }

  let index = 2;

  while (collection.profilesById[`${baseId}-${index}`]) {
    index += 1;
  }

  return `${baseId}-${index}`;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeRule(rule, index) {
  return {
    id: typeof rule?.id === 'string' && rule.id.trim() !== '' ? rule.id : `rule:${index + 1}`,
    enabled: rule?.enabled !== false,
    matchStrategy: typeof rule?.matchStrategy === 'string' ? rule.matchStrategy : 'processName',
    matchType: typeof rule?.matchType === 'string' ? rule.matchType : 'includes',
    pattern: typeof rule?.pattern === 'string' ? rule.pattern.trim() : '',
    desktopBackend: typeof rule?.desktopBackend === 'string' ? rule.desktopBackend : 'any'
  };
}

function ruleMatchesActiveWindow(rule, activeWindow) {
  if (!rule.enabled || !rule.pattern) {
    return false;
  }

  if (rule.desktopBackend !== 'any' && rule.desktopBackend !== activeWindow.backend) {
    return false;
  }

  const haystack = getRuleHaystack(rule.matchStrategy, activeWindow);

  if (!haystack) {
    return false;
  }

  if (rule.matchType === 'equals') {
    return haystack.toLowerCase() === rule.pattern.toLowerCase();
  }

  if (rule.matchType === 'regex') {
    try {
      return new RegExp(rule.pattern, 'i').test(haystack);
    } catch {
      return false;
    }
  }

  return haystack.toLowerCase().includes(rule.pattern.toLowerCase());
}

function getRuleHaystack(strategy, activeWindow) {
  if (strategy === 'windowTitle') {
    return activeWindow.title || '';
  }

  if (strategy === 'appId') {
    return activeWindow.appId || '';
  }

  return activeWindow.processName || '';
}

module.exports = {
  ProfileService
};
