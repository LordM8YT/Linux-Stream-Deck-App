const fs = require('node:fs/promises');
const path = require('node:path');

class PluginManager {
  constructor({ pluginsRoot, pluginRoots, getExecutionContext }) {
    this.pluginRoots = normalizePluginRoots(pluginRoots || pluginsRoot);
    this.getExecutionContext = getExecutionContext || (() => ({}));
    this.plugins = [];
    this.actions = new Map();
    this.errors = [];
  }

  async scan() {
    this.plugins = [];
    this.actions.clear();
    this.errors = [];

    for (const pluginParentRoot of this.pluginRoots) {
      const entries = await this.readPluginRootEntries(pluginParentRoot);

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const pluginRoot = path.join(pluginParentRoot, entry.name);

        try {
          await this.loadPlugin(pluginRoot);
        } catch (error) {
          this.errors.push({
            folder: `${entry.name} (${pluginParentRoot})`,
            message: error.message
          });
        }
      }
    }
  }

  getCatalog() {
    return {
      plugins: this.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        root: plugin.root,
        source: plugin.source,
        actions: plugin.actions
      })),
      actions: Array.from(this.actions.values()).map((action) => this.serializeAction(action)),
      errors: this.errors
    };
  }

  hasAction(actionId) {
    return this.actions.has(actionId);
  }

  getAction(actionId) {
    return this.actions.get(actionId) || null;
  }

  getPlugin(pluginId) {
    return this.plugins.find((plugin) => plugin.id === pluginId) || null;
  }

  getDefaultConfigForAction(actionId) {
    const action = this.getAction(actionId);

    if (!action) {
      return {};
    }

    const defaults = {};

    for (const field of action.configFields || []) {
      if (field.defaultValue !== undefined) {
        defaults[field.id] = field.defaultValue;
      }
    }

    return defaults;
  }

  async triggerAction(actionId, context) {
    const action = this.actions.get(actionId);

    if (!action) {
      throw new Error(`Unknown action "${actionId}".`);
    }

    if (typeof action.onTrigger !== 'function') {
      return {
        ok: false,
        reason: 'NO_HANDLER'
      };
    }

    const executionContext = this.getExecutionContext();
    const result = await action.onTrigger({
      ...context,
      services: executionContext.services || {}
    });

    return {
      ok: true,
      result: result ?? null
    };
  }

  async loadPlugin(pluginRoot) {
    const manifestPath = path.join(pluginRoot, 'manifest.json');
    const manifestRaw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);
    validateManifest(manifest);
    const source = await readPluginSourceMetadata(pluginRoot);

    const entryPath = path.resolve(pluginRoot, manifest.entry || 'index.js');
    delete require.cache[require.resolve(entryPath)];

    const pluginModule = require(entryPath);
    const loadedActions = [];

    const registerAction = (definition) => {
      if (!definition || typeof definition.id !== 'string') {
        throw new Error(`Plugin "${manifest.id}" registered an action without a valid id.`);
      }

      const manifestAction = manifest.actions.find((action) => action.id === definition.id);

      if (!manifestAction) {
        throw new Error(`Action "${definition.id}" must be declared in manifest.json.`);
      }

      const qualifiedId = `${manifest.id}:${definition.id}`;

      if (this.actions.has(qualifiedId)) {
        throw new Error(`Duplicate action id "${qualifiedId}".`);
      }

      const actionRecord = {
        qualifiedId,
        pluginId: manifest.id,
        id: definition.id,
        name: manifestAction.name || definition.name || definition.id,
        description: manifestAction.description || definition.description || '',
        defaultLabel: manifestAction.defaultLabel || definition.defaultLabel || manifestAction.name || definition.id,
        accentColor: manifestAction.accentColor || definition.accentColor || '#3dd9c1',
        icon: manifestAction.icon || definition.icon || null,
        configFields: normalizeConfigFields(manifestAction.configFields || definition.configFields || []),
        onTrigger: definition.onTrigger || definition.run || null
      };

      this.actions.set(qualifiedId, actionRecord);
      loadedActions.push(this.serializeAction(actionRecord));
    };

    if (typeof pluginModule.activate === 'function') {
      await pluginModule.activate({
        plugin: manifest,
        registerAction,
        logger: createPluginLogger(manifest.id),
        services: this.getExecutionContext().services || {}
      });
    }

    if (Array.isArray(pluginModule.actions)) {
      for (const actionDefinition of pluginModule.actions) {
        registerAction(actionDefinition);
      }
    }

    this.plugins.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || '',
      root: pluginRoot,
      source,
      actions: loadedActions
    });
  }

  serializeAction(action) {
    return {
      qualifiedId: action.qualifiedId,
      pluginId: action.pluginId,
      id: action.id,
      name: action.name,
      description: action.description,
      defaultLabel: action.defaultLabel,
      accentColor: action.accentColor,
      icon: action.icon,
      configFields: action.configFields
    };
  }

  async readPluginRootEntries(pluginParentRoot) {
    try {
      return await fs.readdir(pluginParentRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(pluginParentRoot, { recursive: true });
        return fs.readdir(pluginParentRoot, { withFileTypes: true });
      }

      throw error;
    }
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Plugin manifest must be a JSON object.');
  }

  for (const fieldName of ['id', 'name', 'version']) {
    if (typeof manifest[fieldName] !== 'string' || manifest[fieldName].trim() === '') {
      throw new Error(`Plugin manifest field "${fieldName}" is required.`);
    }
  }

  if (!Array.isArray(manifest.actions)) {
    throw new Error('Plugin manifest must include an actions array.');
  }

  for (const action of manifest.actions) {
    if (typeof action.id !== 'string' || action.id.trim() === '') {
      throw new Error('Each manifest action requires an id.');
    }

    if (typeof action.name !== 'string' || action.name.trim() === '') {
      throw new Error(`Manifest action "${action.id}" requires a name.`);
    }
  }
}

function normalizeConfigFields(configFields) {
  return configFields.map((field) => ({
    id: field.id,
    label: field.label || field.id,
    type: field.type || 'text',
    description: field.description || '',
    defaultValue: field.defaultValue,
    placeholder: field.placeholder || '',
    optionsSource: field.optionsSource || null,
    options: Array.isArray(field.options) ? field.options : []
  }));
}

async function readPluginSourceMetadata(pluginRoot) {
  const metadataPath = path.join(pluginRoot, '.opendeck-source.json');

  try {
    const metadataRaw = await fs.readFile(metadataPath, 'utf8');
    const metadata = JSON.parse(metadataRaw);

    if (!metadata || typeof metadata !== 'object') {
      return null;
    }

    return {
      resolver: typeof metadata.resolver === 'string' ? metadata.resolver : null,
      sourceUrl: typeof metadata.sourceUrl === 'string' ? metadata.sourceUrl : null,
      reference: typeof metadata.reference === 'string' ? metadata.reference : null,
      importedAt: typeof metadata.importedAt === 'string' ? metadata.importedAt : null
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function createPluginLogger(pluginId) {
  return {
    info: (...args) => console.log(`[plugin:${pluginId}]`, ...args),
    warn: (...args) => console.warn(`[plugin:${pluginId}]`, ...args),
    error: (...args) => console.error(`[plugin:${pluginId}]`, ...args)
  };
}

function normalizePluginRoots(pluginRoots) {
  const roots = Array.isArray(pluginRoots) ? pluginRoots : [pluginRoots];

  return Array.from(new Set(
    roots
      .filter(Boolean)
      .map((candidate) => path.resolve(candidate))
  ));
}

module.exports = {
  PluginManager,
  validateManifest
};
