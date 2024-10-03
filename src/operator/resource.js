import * as fs from '../fs.js'
import { Common } from './common.js'
import { GCS } from './gcs/index.js'
import { Context } from './context.js'

const resourceOptions = ['cluster', 'namespace', 'name']

function genUrl (context, cluster, namespace, name) {
  if (!cluster || !namespace) {
    throw new Error('unabled to gen resource url without cluster or namespace')
  }
  if (name) {
    return `${context.basePath}/resources/${cluster}/${namespace}/${name}.yaml`
  }
  return `${context.basePath}/resources/${cluster}/${namespace}/`
}

export class Resource {
  /**
   *
   * @param {Context} context
   * @param {string} cluster
   * @param {string} namespace
   * @param {string} name
   */
  constructor (context, cluster, namespace, name) {
    Common.assertType(context, Context)
    Common.validateOptions({ cluster, namespace, name }, resourceOptions)
    this.cluster = cluster
    this.namespace = namespace
    this.name = name
    this.url = genUrl(context, cluster, namespace, name)
    this._lock = 0
  }

  /**
 *
 * @param {Context} context
 */
  async lock (context) {
    if (this._lock === 0) {
      const lockUrl = `${this.url}.lock`
      await GCS.lock(lockUrl, '60', { silent: true })
    }
    this._lock++
  }

  /**
 *
 * @param {Context} context
 */
  async unlock (context) {
    this._lock--
    if (this._lock < 0) {
      throw new Error(`unlock error: lock ${this.url} has negative reference count`)
    }
    if (this._lock === 0) {
      const lockUrl = `${this.url}.lock`
      await GCS.unlock(lockUrl, { nothrow: true, silent: true })
    }
  }

  /**
 *
 * @param {Context} context
 */
  async finalize (context) {
    if (this._lock > 0) {
      this._lock = 0
      const lockUrl = `${this.url}.lock`
      await GCS.unlock(lockUrl, { nothrow: true, silent: true })
    }
  }

  /**
 *
 * @param {Context} context
 * @param {*} spec
 */
  async schemaCheck (context, spec) {
    if (!spec.asset) {
      throw new Error('missing asset from spec')
    }
    if (!spec.app) {
      throw new Error('missing app from spec')
    }
    const asset = await context.asset(spec.asset.type, spec.asset.release)
    await asset.check(context, spec.app)
  }

  /**
 *
 * @param {Context} context
 * @param {*} spec
 */
  async update (context, spec) {
    await this.lock(context)
    try {
      const tempFile = `${Date.now()}`
      await this.schemaCheck(context, spec)
      await fs.yamlWrite(tempFile, spec)
      await GCS.mv(tempFile, this.url)
      context.info(`resource ${this.url} updated`)
    } finally {
      await this.unlock(context)
    }
  }

  /**
 *
 * @param {Context} context
 * @returns
 */
  async get (context) {
    return await fs.yamlLoads(await GCS.cat(this.url))
  }

  /**
 *
 * @param {Context} context
 * @returns
 */
  async delete (context) {
    await this.lock(context)
    try {
      return await GCS.rm(this.url)
    } finally {
      await this.unlock(context)
    }
  }
}
/**
 *
 * @param {Context} context
 * @param {string} cluster
 * @param {string} namespace
 * @returns
 */
export async function list (context, cluster, namespace) {
  const url = genUrl(context, cluster, namespace)
  const rs = await GCS.ls(url)
  const result = []
  for (const r of rs) {
    const li = r.lastIndexOf('/')
    result.push(r.substring(li + 1, r.length - 5))
  }
  result.filter(x => x.length > 0)
  return result
}

/**
 *
 * @param {Context} context
 * @param {Resource} from
 * @param {Resource} to
 */
export async function copy (context, from, to) {
  await to.lock(context)
  try {
    await GCS.cp(from.url, to.url)
  } finally {
    await Resource.unlock(to)
  }
}
