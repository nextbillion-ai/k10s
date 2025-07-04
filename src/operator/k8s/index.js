import { shell, fs } from '../../index.js'
import * as diff from 'deep-object-diff'
import { Context } from '../context.js'
import { Common } from '../common.js'
import { v4 as uuidv4 } from 'uuid'

export const K8s = {
  /**
   *
   * @param {Context} context
   * @param {*} content
   * @param {*} closure
   */
  async _withTempFile (context, content, closure) {
    Common.assertType(context, Context)
    const tempFile = await context.tempFile(`${Date.now()}-${uuidv4()}.yaml`)
    switch (content.type) {
      case 'yamlAll':
        await fs.yamlWriteAll(tempFile, content.value)
        break
      case 'yaml':
        await fs.yamlWrite(tempFile, content.value)
        break
      case 'json':
        await fs.jsonWrite(tempFile, content.value)
        break
      default:
        throw new Error(`k8s._withTempFile unsupported content type: ${content.type}`)
    }
    await closure(tempFile)
  },

  async dry (context, oldManifest, newManifest) {
    if (oldManifest.length === 0) {
      context.info('No manifest found, operator does not know how to perform diff')
      return
    }
    const omf = await context.tempFile('.old.manifest.yaml')
    const nmf = await context.tempFile('.new.manifest.yaml')
    await fs.yamlWrite(omf, oldManifest)
    await fs.yamlWrite(nmf, newManifest)
    context.info('====diff begins====')
    await shell.run(`diff -u -N ${omf} ${nmf}`, { silent: false, nothrow: true })
    context.info('====diff ends====')
  },

  async diff (value1, value2) {
    return diff.diff(value1, value2)
  },
  async getManifestFromChart (context, chart, specObj) {
    let result
    await K8s._withTempFile(context, { type: 'yaml', value: specObj }, async (tempFile) => {
      result = await fs.yamlLoadsAll((await shell.run(`helm template ${chart} -f ${tempFile}`)).stdout)
    })
    return result.filter(x => x && x.kind)
  },

  async getPvcs (context, stsName) {
    const pvcs = []
    const stsSpec = await fs.yamlLoads((await shell.run(`kubectl get sts/${stsName} -n ${context.namespace} -o yaml`)).stdout)
    for (const ct of stsSpec.spec.volumeClaimTemplates) {
      const namePattern = `${ct.metadata.name}-${stsName}-`
      const items = (await shell.run(`kubectl get pvc -n ${context.namespace} | grep ${namePattern} | awk '{print $1}'`)).stdout.split('\n').filter(x => x.length > 0)
      pvcs.push(...items)
    }
    return pvcs
  },

  async waitForPodsOfDeploy (context, item, num) {
    const target = Math.min(item.spec.replicas, num)
    const revision = (await shell.run(`kubectl get deploy/${item.metadata.name} -n ${context.namespace} -o=jsonpath="{.metadata.annotations['deployment\\.kubernetes\\.io/revision']}"`)).stdout
    let log = ''
    while (true) {
      context.checkTimeout()
      const readyCount = Number.parseInt((await shell.run(`kubectl get rs -n ${context.namespace} -l app.kubernetes.io/name=${item.metadata.name} -o=jsonpath="{.items[?(@.metadata.annotations['deployment\\.kubernetes\\.io/revision']=='${revision}')].status.availableReplicas}"`)).stdout.trim())
      if (readyCount >= target) {
        context.info(`revision ${revision} reached target ready: ${readyCount}/${target}`)
        break
      }
      const newLog = `waiting for revision ${revision} ready: ${readyCount}/${target}`
      if (log !== newLog) {
        log = newLog
        context.info(log)
      }
      await shell.sleep(2000)
    }
  },

  async waitForPodsOfSts (context, item, num) {
    const target = Math.min(item.spec.replicas, num)
    let controllerRevisionHash = null
    context.info('getting controllerRevisionHash')
    while (true) {
      context.checkTimeout()
      const currentHash = (await shell.run(`kubectl get sts/${item.metadata.name} -n ${context.namespace} -o=jsonpath='{.status.currentRevision}'`)).stdout
      const updateHash = (await shell.run(`kubectl get sts/${item.metadata.name} -n ${context.namespace} -o=jsonpath='{.status.updateRevision}'`)).stdout
      if (updateHash.length > 0) {
        controllerRevisionHash = updateHash
        break
      }
      if (currentHash.length > 0) {
        controllerRevisionHash = currentHash
        break
      }
      await shell.sleep(2000)
    }
    let log = ''
    while (true) {
      context.checkTimeout()
      const statuses = (await shell.run(`kubectl get pod -n ${context.namespace} -l controller-revision-hash=${controllerRevisionHash} -o=jsonpath='{..status.conditions[?(@.type=="Ready")]}'`)).stdout.trim()
      let readyCount = 0
      if (statuses.length > 0) {
        const parts = statuses.replaceAll('}', '__split__').split('__split__')
        readyCount = parts.filter((x) => {
          if (x.length === 0) {
            return false
          }
          try {
            return JSON.parse(x + '}').status === 'True'
          } catch (e) {
            context.error(`failed to parse json ${x} : ${e}`)
          }
          return false
        }).length
      }
      if (readyCount >= target) {
        context.info(`${controllerRevisionHash} reached target ready: ${readyCount}/${target}`)
        break
      }
      const newLog = `waiting for ${controllerRevisionHash} ready: ${readyCount}/${target}`
      if (log !== newLog) {
        log = newLog
        context.info(log)
      }
      await shell.sleep(2000)
    }
  },

  async rolloutResource (context, item) {
    if (context.genOnly) {
      // skip as we don't need to rollout in genOnly mode
      return
    }
    await K8s._withTempFile(context, { type: 'yaml', value: item }, async (tempFile) => {
      await shell.run(`kubectl apply -f ${tempFile}`)
      if (!context.wait) {
        return
      }
      switch (item.kind) {
        case 'StatefulSet':
          await K8s.waitForPodsOfSts(context, item, 2)
          break
        case 'Deployment':
          await K8s.waitForPodsOfDeploy(context, item, 2)
          break
        default:
          break
      }
    })
  },

  async deleteResource (context, name, kind) {
    if (context.genOnly) {
      // skip as we don't need to delete in genOnly mode
      return
    }
    const wait = context.wait ? '' : '--wait=false'
    switch (kind) {
      case 'StatefulSet':
        {
          const pvcs = await K8s.getPvcs(context, name)
          await shell.run(`kubectl delete ${kind}/${name} -n ${context.namespace} ${wait}`, { nothrow: true })
          for (const pvc of pvcs) {
            await shell.run(`kubectl delete pvc/${pvc} -n ${context.namespace} ${wait}`, { nothrow: true })
          }
        }
        break
      default:
        await shell.run(`kubectl delete ${kind}/${name} -n ${context.namespace} ${wait}`, { nothrow: true })
        break
    }
  },

  async getCurrentRotations (context, name) {
    let names
    let items = []
    if (context.genOnly) {
      // get the names from the raw manifest
      const rawManifest = await K8s.getRawManifestOutput(context, { nothrow: true })
      // sort the raw manifest by name to make sure the rotation is in the correct order
      //   so that the last item is the current rotation
      items = rawManifest
        .filter(item => item.kind === 'StatefulSet' && item.metadata.name.startsWith(`${name}---`))
        .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
      names = items.map(item => item.metadata.name)
    } else {
      // get the names from the k8s
      names = (await shell.run(`kubectl get sts -n ${context.namespace} | grep -v NAME | grep -v 'No resources found' | grep "^${name}---"| awk '{print $1}'`,
        { silent: true, nothrow: true }))
        .stdout
        .trim()
        .split('\n')
        .filter(x => x.length > 0)
        .sort()

      // creating a shell object for each item for completeness of api contract
      items = names.map(name => ({ kind: 'StatefulSet', metadata: { name, namespace: context.namespace } }))
    }

    let rotation = 0
    let exists = false
    if (names.length > 0) {
      const parts = names[names.length - 1].split('---')
      if (parts.length > 0) {
        rotation = Number.parseInt(parts[parts.length - 1])
        exists = true
      }
    }
    return {
      names,
      rotation,
      exists,
      items
    }
  },

  async writeRelease (context, release, newRawManifes = [], toRemoves = []) {
    if (context.genOnly) {
      const manifestPath = context.getManifestOutputPathNamespace()
      const manifestFile = context.getManifestOutputPathApp()
      if (manifestPath) {
        await fs.mkdirp(manifestPath)
      }

      // using newRawManifes insteaad of release because rawManifest carries rotation info
      // we are also adding the toRemoves to the manifest, so that old items are not deleted to guarantee availabiliy
      // but if pruneRotation is true, we will not include those items into the manifest
      await fs.yamlWriteAll(manifestFile, context.pruneRotation ? newRawManifes : newRawManifes.concat(toRemoves))
    } else {
      const name = `${context.name}-manifest`
      await K8s.writeConfigMap(context, name, { manifest: await fs.yamlDumpsAll(release) })
    }
  },

  removeRotationInfo (manifest) {
    // Group StatefulSets by base name and keep only latest version
    const groups = {}
    for (const x of manifest) {
      if (x.kind === 'StatefulSet') {
        const match = x.metadata.name.match(/^(.+)---(\d+)$/)
        if (match) {
          const baseName = match[1]
          const version = match[2]
          if (!groups[baseName] || Number(version) > Number(groups[baseName].version)) {
            const item = JSON.parse(JSON.stringify(x)) // Deep clone
            item.metadata.name = baseName // Remove rotation info from name
            groups[baseName] = {
              item,
              version: Number(version)
            }
          }
          continue
        }
      }
      groups[x.metadata.name] = {
        item: x,
        version: -1 // Non-StatefulSet items or StatefulSets without version
      }
    }

    return Object.values(groups).map(g => g.item)
  },

  async getRawManifestOutput  (context, options = {}) {
    const localPath = context.getManifestOutputPathApp()
    try {
      const oldManifest = await fs.yamlLoadsAll(await fs.readFile(localPath, 'utf8'))
      return oldManifest
    } catch (e) {
      if (options.nothrow) {
        context.error(`failed to read old manifest from ${localPath}: ${e.message || e}`)
        return []
      }
      throw e
    }
  },

  async getRelease (context, options = {}) {
    if (context.genOnly) {
      const oldManifest = await K8s.getRawManifestOutput(context, options)
      // need to remove rotation info from the raw manifest
      return K8s.removeRotationInfo(oldManifest)
    }

    let oldManifest
    try {
      const name = `${context.name}-manifest`
      oldManifest = await fs.yamlLoadsAll((await K8s.readConfigMap(context, name)).manifest)
    } catch (e) {
      if (options.nothrow) {
        context.error(`failed to get release for ${context.namespace}/${context.name}`)
        oldManifest = []
      } else {
        throw e
      }
    }
    return oldManifest
  },

  async deleteRelease (context) {
    if (context.genOnly) {
      const manifestFile = context.getManifestOutputPathApp()
      if (await fs.pathExists(manifestFile, { mode: 'file' })) {
        await fs.rm(manifestFile)
      }
      return
    }
    const name = `${context.name}-manifest`
    await shell.run(`kubectl delete cm/${name} -n ${context.namespace}`)
  },

  async readConfigMap (context, name) {
    const obj = await fs.yamlLoads((await shell.run(`kubectl get cm/${name} -n ${context.namespace} -o yaml`)).stdout)
    return obj.data
  },

  async writeConfigMap (context, name, values) {
    const manifest = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      data: values,
      metadata: {
        name,
        namespace: context.namespace
      }
    }
    await K8s._withTempFile(context, { type: 'yaml', value: manifest }, async (tempFile) => {
      await shell.run(`kubectl apply -f ${tempFile}`)
    })
  }
}
