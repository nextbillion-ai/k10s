import * as shell from '../shell.js'
import { Common } from './common.js'
import { GCS } from './gcs/index.js'
import { Validator } from 'jsonschema'
import { pathExists } from '../fs.js'
import { Default } from './plugins/default.js'
import { Context } from './context.js'
import { fs } from '../index.js'

const commonOptions = ['type', 'release']
const validator = new Validator()

export class Asset {
  /**
   *
   * @param {Context} context
   * @param {string} type
   * @param {string} release
   */
  constructor (context, type, release) {
    Common.assertType(context, Context)
    Common.validateOptions({ type, release }, commonOptions)
    this.type = type
    this.release = release
    this.loaded = false
  }

  /**
 *
 * @param {Context} context
 */
  async load (context) {
    if (this.loaded) {
      return
    }

    this.basePath = context.workingDir || './.operator/cache/assets'
    this.basePath = `${this.basePath}/${this.type}/${this.release}`
    await shell.run(`mkdir -p ${this.basePath}`)
    const assetUrl = `${context.basePath}/assets/${this.type}/releases/${this.release}`
    let assetLockUrl = `${assetUrl}.local.lock`
    if (process.env.CLUSTER) {
      assetLockUrl = `${assetUrl}.foreman.${process.env.CLUSTER}.lock`
    }

    let ok = false
    while (!ok) {
      try {
        await GCS.lock(assetLockUrl, 5)
        context.debug(`locked ${assetLockUrl}`)
        ok = true
        break
      } catch {
        context.debug(`failed to lock ${assetLockUrl}`)
      }
    }
    if (!(await fs.pathExists(`${this.basePath}/chart.tgz`))) {
      await GCS.rsync(`${assetUrl}`, this.basePath)
    }
    await GCS.unlock(assetLockUrl, { nothrow: true })
    if (!(await fs.pathExists(`${this.basePath}/chart.tgz`))) {
      throw new Error(`invalid ${this.type}/${this.release} asset: chart.tgz not found`)
    }
    if (!(await fs.pathExists(`${this.basePath}/schema.json`))) {
      throw new Error(`invalid ${this.type}/${this.release} asset: schema.json not found`)
    }
    this.loaded = true
  }

  /**
   *
   * @param {Context} context
   * @returns
   */
  async plugin (context) {
    const ppath = `${this.basePath}/plugin.js`
    if (await pathExists(ppath)) {
      return (await import(ppath)).Impl
    }
    return Default
  }

  /**
 *
 * @param {Context} context
 * @returns
 */
  chartPath (context) {
    return `${this.basePath}/chart.tgz`
  }

  /**
 *
 * @param {Context} context
 * @returns
 */
  async getSchema (context) {
    await this.load(context)
    return JSON.parse((await shell.run(`cat ${this.basePath}/schema.json`)).stdout)
  }

  /**
 *
 * @param {Context} context
 * @param {*} values
 */
  async check (context, values) {
    const r = validator.validate(values, await this.getSchema(context), { required: true })
    if (!r.valid) {
      throw new Error(`schema check failed: ${JSON.stringify(r.errors.map(x => x.toString()))}`)
    }
  }

  /**
 *
 * @param {Context} context
 * @returns Array
 */
  async listReleases (context) {
    return (await GCS.ls(`${context.basePath}/assets/${this.type}/releases/`))
      .map((x) => {
        if (x.endsWith('/')) {
          x = x.substring(0, x.length - 1)
        }
        return x.substring(x.lastIndexOf('/') + 1)
      })
  }
}
