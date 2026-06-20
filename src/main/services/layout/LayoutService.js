class LayoutService {
  constructor({ store }) {
    this.store = store;
  }

  getDeckLayout(deckProfile, profileId = 'default') {
    const assignments = this.ensureDeckAssignments(deckProfile, profileId);

    return {
      deckId: deckProfile.id,
      profileId,
      slots: deckProfile.buttons.map((button) => ({
        ...button,
        assignment: assignments[button.slotId] ?? null
      }))
    };
  }

  async assignAction(deckProfile, profileId, slotId, actionId, initialConfig = {}) {
    const assignments = this.ensureDeckAssignments(deckProfile, profileId);
    const slot = deckProfile.buttons.find((button) => button.slotId === slotId);

    if (!slot) {
      throw new Error(`Unknown slot "${slotId}" for deck "${deckProfile.id}".`);
    }

    assignments[slotId] = {
      actionId,
      config: {
        ...initialConfig
      },
      assignedAt: new Date().toISOString()
    };
    await this.store.save();
  }

  async updateAssignmentConfig(deckProfile, profileId, slotId, configPatch) {
    const assignments = this.ensureDeckAssignments(deckProfile, profileId);
    const assignment = assignments[slotId];

    if (!(slotId in assignments)) {
      throw new Error(`Unknown slot "${slotId}" for deck "${deckProfile.id}".`);
    }

    if (!assignment) {
      throw new Error(`Slot "${slotId}" has no assigned action to configure.`);
    }

    assignment.config = {
      ...(assignment.config || {}),
      ...configPatch
    };
    await this.store.save();
  }

  async clearAction(deckProfile, profileId, slotId) {
    const assignments = this.ensureDeckAssignments(deckProfile, profileId);

    if (!(slotId in assignments)) {
      throw new Error(`Unknown slot "${slotId}" for deck "${deckProfile.id}".`);
    }

    assignments[slotId] = null;
    await this.store.save();
  }

  async cloneProfileLayout(deckProfile, sourceProfileId, targetProfileId) {
    const sourceAssignments = this.ensureDeckAssignments(deckProfile, sourceProfileId);
    const targetAssignments = this.ensureDeckAssignments(deckProfile, targetProfileId);

    for (const [slotId, assignment] of Object.entries(sourceAssignments)) {
      targetAssignments[slotId] = assignment
        ? {
          ...assignment,
          config: {
            ...(assignment.config || {})
          }
        }
        : null;
    }

    await this.store.save();
  }

  ensureDeckAssignments(deckProfile, profileId) {
    const assignments = this.store.getDeckAssignments(deckProfile.id, profileId);

    for (const button of deckProfile.buttons) {
      if (!(button.slotId in assignments)) {
        assignments[button.slotId] = null;
      }
    }

    return assignments;
  }
}

module.exports = {
  LayoutService
};
