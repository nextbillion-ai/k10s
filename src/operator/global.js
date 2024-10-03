import yaml from 'js-yaml'
import { GCS } from './gcs/index.js'

export const Global = {
  async spec (context, app) {
    let globalSpec
    try {
      globalSpec = (yaml.load(await GCS.cat(`gs://nb-data/infra/asgard/clusters/${context.cluster}.yaml`))).global
      context.info(`loaded global spec for ${context.cluster} from asgard`)
    } catch (e) {
      globalSpec = (yaml.load(await GCS.cat(`${context.basePath}/assets/global/${context.cluster}.yaml`))).global
    }
    globalSpec.namespace = context.namespace
    globalSpec.cluster = context.cluster
    globalSpec.name = context.name
    globalSpec.ts = Number.parseInt(Date.now() / 1000)
    globalSpec.deployTime = `${globalSpec.ts}`
    for (const plugin of context.globalSpecPlugins) {
      if (!plugin.url || !plugin.name || !plugin.keys) {
        continue
      }
      await Global._loadPlugin(plugin, context, app, globalSpec)
    }
    return globalSpec
  },
  async _loadPlugin (plugin, context, app, spec) {
    try {
      let url = plugin.url
      url = url.replaceAll('{cluster}', context.cluster)
      url = url.replaceAll('{namespace}', context.namespace)
      url = url.replaceAll('{name}', context.name)
      for (const item of ['area', 'mode', 'context']) {
        if (url.indexOf(`{${item}}`) !== -1) {
          if (!app[item] && app[item] !== '') {
            return
          }
          url = url.replaceAll(`{${item}}`, app[item])
        }
      }
      const values = await yaml.load(await GCS.cat(url))
      const object = {}
      for (const key of plugin.keys) {
        object[key] = values[key]
      }
      spec[plugin.name] = object
    } catch (e) {
      throw new Error(`error loading plugin ${plugin.name}: ${e.message || e}`)
    }
  }
}
