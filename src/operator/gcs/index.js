import { shell, fs } from '../../index.js'
let gsgSupportLockTTL = null

export const GCS = {
  async cat (path, options) {
    const r = await shell.run(`gsg cat ${path}`, options)
    return r.stdout.trim()
  },

  async cp (from, to, options) {
    await shell.run(`gsg cp -r ${from} ${to}`, options)
  },

  async rsync (from, to, options) {
    await shell.run(`gsg -m rsync -r ${from} ${to}`, options)
  },

  async write (path, value) {
    const filename = `${Date.now()}`
    if (typeof (value) === 'string') {
      await fs.plainWrite(filename, value)
    } else {
      await fs.jsonWrite(filename, value)
    }
    await GCS.mv(filename, path)
    await shell.run(`rm ${filename}`)
  },

  async mv (from, to, options) {
    await shell.run(`bash -c "gsg cp ${from} ${to};rm ${from}"`, options)
  },

  async rm (path, options) {
    await shell.run(`gsg rm ${path}`, options)
  },

  async gsgInit () {
    if (gsgSupportLockTTL !== null) {
      return
    }
    const r = await shell.run('gsg help lock | grep ttl', { silent: true, nothrow: true })
    gsgSupportLockTTL = r.code === 0
  },

  async lock (path, ttl, options) {
    await GCS.gsgInit()
    if (!ttl) {
      ttl = '60'
    }
    if (gsgSupportLockTTL) {
      await shell.run(`gsg lock ${path} ${ttl}`, options)
    } else {
      await shell.run(`gsg lock ${path}`, options)
    }
  },

  async unlock (path, options) {
    await GCS.gsgInit()
    if (gsgSupportLockTTL) {
      await shell.run(`gsg unlock ${path}`, options)
    } else {
      await shell.run(`gsg rm ${path}`, options)
    }
  },

  async ls (path) {
    const r = await shell.run(`gsg ls ${path}`, { nothrow: true, silent: true })
    if (r.code !== 0) {
      return []
    }
    return r.stdout.trim().split('\n')
  }
}
