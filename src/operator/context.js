import { Resource } from './resource.js'
import { Asset } from './asset.js'
import { shell } from '../index.js'

const _contexts = {}

export async function finalize () {
  for (const key in _contexts) {
    const c = _contexts[key]
    await c._resource.finalize()
    for (const tf of c.tempFiles) {
      if (tf.path.length > 0) {
        await shell.run(`rm -rf ${c.workingDir}/${tf.path}`, { silent: true, nothrow: true })
      }
    }
  }
}

export class Context {
  /**
   *
   * @param {string} resource
   * @param {*} options
   */
  constructor (resource, options) {
    this.id = `${Date.now()}`
    this.assets = {}
    this.tempFiles = []
    this.cluster = options.cluster
    this.basePath = options.basePath
    this.namespaceVersion = options.namespaceVersion || options.namespaceVesion
    this.globalSpecPlugins = options.globalSpecPlugins
    this.workingDir = options.workingDir
    this.logging = options.logging
    this.dry = options.dry

    const [namespace, name] = resource.split('/')
    if (!namespace || !name) {
      throw new Error(`invalid resource id: ${resource}`)
    }
    this.namespace = namespace
    this.name = name
    this._resource = new Resource(this, this.cluster, this.namespace, this.name)
    _contexts[this.id] = this
  }

  async ensureNamespace () {
    const r = await shell.run(`kubectl get ns/${this.namespace}`, { silent: true, nothrow: true })
    if (r.code !== 0) {
      this.info(`creating namespace: ${this.namespace}`)
      await shell.run(`bash -c "set -e;gsg cp ${this.basePath}/assets/namespace/releases/${this.namespaceVersion}/chart.tgz ./${this.namespace}.tgz;gsg cp ${this.basePath}/assets/global/${this.cluster}.yaml ./${this.cluster}.yaml; 
      helm install ${this.namespace} ./${this.namespace}.tgz -f ./${this.cluster}.yaml --set global.namespace=${this.namespace} --wait --timeout 20s;rm ${this.namespace}.tgz;rm ./${this.cluster}.yaml"`)
    }
  }

  setTimeout () {
    if (typeof this.wait !== 'undefined') {
      switch (typeof this.wait) {
        case 'boolean':
          if (this.wait === false) {
            this.wait = undefined
            return
          }
          this.wait = Date.now() + 10 * 60 * 1000
          break
        case 'number':
          if (this.wait <= 0) {
            this.wait = undefined
            return
          }
          this.wait = Date.now() + this.wait * 60 * 1000
          break
        default:
          this.info(`unsupported context.wait : ${this.wait}`)
          this.wait = undefined
          break
      }
    }
  }

  checkTimeout () {
    if (this.wait) {
      if (Date.now() > this.wait) {
        throw new Error('context timeout')
      }
    }
  }

  /**
   * should be the last method called, to perform clean up (temp files, resource locks)
   */
  async done () {
    delete _contexts[this.id]
    await this._resource.finalize()
    for (const tf of this.tempFiles) {
      if (tf.path.length > 0) {
        await shell.run(`rm -rf ${this.workingDir}/${tf.path}`, { silent: true, nothrow: true })
      }
    }
  }

  /**
 *
 * @param {*} closure
 * @param {boolean} lock
 * @returns
 */
  async run (closure, lock) {
    if (!lock) {
      return await closure(this)
    }
    await this.lock()
    try {
      return await closure(this)
    } finally {
      await this.unlock()
    }
  }

  async lock () {
    await this._resource.lock(this)
  }

  async unlock () {
    await this._resource.unlock(this)
  }

  /**
 *
 * @param {string} path relative path to workingDir
 */
  async tempDir (path) {
    await shell.run(`mkdir -p ${this.workingDir}/${path}`)
    this.tempFiles.push({ path, type: 'dir' })
    return `${this.workingDir}/${path}`
  }

  /**
 *
 * @param {string} path relative file path. Note: if there is relative dir, tempDir will be called instead
 * @returns
 */
  async tempFile (path) {
    const lastSlashIndex = path.lastIndexOf('/')
    if (lastSlashIndex !== -1) {
      this.tempDir(path.substring(0, lastSlashIndex))
      return
    }
    this.tempFiles.push({ path, type: 'file' })
    return `${this.workingDir}/${path}`
  }

  /**
 *
 * @param {string} type
 * @param {string} release
 * @returns {Asset}
 */
  async asset (type, release) {
    const key = `${type}-${release}`
    if (!(key in this.assets)) {
      const a = new Asset(this, type, release)
      await a.load(this)
      this.assets[key] = a
    }
    return this.assets[key]
  }

  /**
 *
 * @returns Resource
 */
  resource () {
    return this._resource
  }

  info (msg) {
    this._log('info', msg)
  }

  debug (msg) {
    this._log('debug', msg)
  }

  error (msg) {
    this._log('error', msg)
  }

  _log (level, msg) {
    if (!this.logging || !this.logging[level]) {
      return
    }
    this.logging[level](msg)
  }
}
