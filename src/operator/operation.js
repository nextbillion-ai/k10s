// TODO: spec, list, update-spec, status, begin-transaction, end-transaction, rollout, remove
import { K8s } from './k8s/index.js'
import { Global } from './global.js'
import { Common } from './common.js'
import { Context } from './context.js'
import merge from 'deepmerge'
import { Default } from './plugins/default.js'

// cluster should be checked against CLUSTER env var, because operator is supposed to a fist class resident in a k8s cluster
export const Operation = {
/**
 *
 * @param {Context} context
 * @returns
 */
  async status (context) {
    const resource = context.resource()
    const plugin = await Operation._getPlugin(context, (await resource.get()).asset)
    return await plugin.status(context)
  },

  /**
   *
   * @param {Context} context
   * @param {*} asset
   * @returns
   */
  async _getPlugin (context, asset) {
    let PluginClass = Default
    if (asset) {
      try {
        const ast = await context.asset(asset.type, asset.release)
        PluginClass = await ast.plugin(context)
      } catch (e) {
        throw new Error(`failed to load plugin for asset: ${JSON.stringify(asset)}, ${e.message || e}`)
      }
    }
    // generate spec.yaml here
    context.info(`pluginClass loaded: ${PluginClass.name}`)
    const plugin = new PluginClass({ K8s })
    context.info('plugin inited')
    return plugin
  },
  /**
 *
 * @param {Context} context
 * @param {*} spec
 */
  async rollout (context, spec) {
    Common.assertType(context, Context)
    const resource = context.resource()
    if (spec) {
      await resource.update(context, spec)
    } else {
      spec = await resource.get()
    }
    await context.lock()
    try {
      // generate spec.yaml here
      let global = await Global.spec(context, spec.app)
      // merge spec.global if exists
      if (spec.global) {
        global = merge(global, spec.global)
      }
      const values = { global, app: spec.app }
      const plugin = await Operation._getPlugin(context, spec.asset)
      await plugin.rollout(context, (await context.asset(spec.asset.type, spec.asset.release)).chartPath(), values)
    } finally {
      await context.unlock()
    }
  },

  /**
 *
 * @param {Context} context
 */
  async uninstall (context) {
    await context.lock()
    try {
      const plugin = await Operation._getPlugin(context, null)
      await plugin.uninstall(context)
    } finally {
      await context.unlock()
    }
  }

}
