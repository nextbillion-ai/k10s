import { Common } from '../common.js'
import { Context } from '../context.js'
const blackLists = [/^(docker.io\/)*redis/, /^(docker.io\/)*postgres/]
export class Default {
  constructor (lib) {
    this.lib = lib
  }

  /**
 *
 * @param {Context} context
 * @returns
 */
  async status (context) {
    Common.assertType(context, Context)
    try {
      const manifest = await this.lib.K8s.getRelease(context)
      const result = { status: 'deployed', rotations: {} }
      for (const o of manifest) {
        if (o.kind === 'StatefulSet') {
          const current = await this.lib.K8s.getCurrentRotations(context, o.metadata.name)
          result.rotations[o.metadata.name] = current.rotation
        }
      }
      return result
    } catch (e) {
      return { status: 'not-found', err: e }
    }
  }

  /**
 *
 * @param {Context} context
 * @param {*} chart
 * @param {*} values
 */
  async rollout (context, chart, values) {
    context.setTimeout()
    const newManifest = await this.lib.K8s.getManifestFromChart(context, chart, values)
    const release = JSON.parse(JSON.stringify(newManifest))
    const oldManifest = await this.lib.K8s.getRelease(context, { nothrow: true })
    if (context.dry && !context.genOnly) {
      return await this.lib.K8s.dry(context, oldManifest, newManifest)
    }
    const changes = {}
    const toRemoves = await this.rotateManifest(context, oldManifest, newManifest, changes)
    context.info('rolling out manifest')
    if (!context.rotated) {
      context.info('setting wait=false since there is no rotation performed')
      context.wait = false
    } else {
      context.wait = true
      context.setTimeout()
    }
    await this.applyManifest(context, newManifest, changes)
    for (const toRemove of toRemoves) {
      try {
        context.info(`deleting ${toRemove.kind}/${toRemove.name}`)
        await this.lib.K8s.deleteResource(context, toRemove.name, toRemove.kind)
      } catch (e) {
        context.error(`failed to delete ${toRemove.kind}/${toRemove.name}: ${e.message || e}`)
      }
    }
    await this.lib.K8s.writeRelease(context, release, newManifest, toRemoves.map(x => x.item))
  }

  /**
 *
 * @param {Context} context
 * @param {*} oldManifest
 * @param {*} newManifest
 * @returns
 */
  async rotateManifest (context, oldManifest, newManifest, changes) {
    const toRemoves = []
    for (const o of oldManifest) {
      const filtered = newManifest.filter((x) => {
        return x.kind === o.kind && x.metadata.name === o.metadata.name
      })
      if (filtered.length === 0) {
        if (context.genOnly) {
          // skip as we don't need to delete in genOnly mode
          // we will just override the raw manifest file with the new manifest
          continue
        }
        // this old item needs to be deleted
        let name = o.metadata.name
        if (o.kind === 'StatefulSet') {
          // check if we should add rotation in order to properly delete the old item
          const shouldRename = await this.shouldRename(o)
          if (shouldRename) {
            const current = await this.lib.K8s.getCurrentRotations(context, name)
            name = `${name}---${current.rotation}`
          }
        }
        toRemoves.push({ kind: o.kind, name })
        continue
      }

      // an old item exists
      const df = await this.lib.K8s.diff(o, filtered[0])
      const changed = Object.keys(df).length > 0
      if (o.kind === 'StatefulSet') {
        // it is a statefulset, we need to check if it is changed and whether rotation is needed
        const shouldRotateFlag = changed && await this.shouldRotate(context, df, o)
        const stsName = filtered[0].metadata.name
        context.info(`trying to rotate manifest for ${context.namespace}/${stsName}`)
        const current = await this.lib.K8s.getCurrentRotations(context, stsName)
        context.info(`current rotation for ${context.namespace}/${stsName} is ${current.rotation}`)
        let removeAll = false
        let newStsName
        const realNameLabel = 'app.kubernetes.io/realname'
        if (shouldRotateFlag) {
          removeAll = true
          newStsName = `${stsName}---${current.rotation + 1}`
          context.rotated = true
        } else if (current.exists) {
          newStsName = `${stsName}---${current.rotation}`
        } else {
          newStsName = stsName
        }
        filtered[0].metadata.name = newStsName
        filtered[0].metadata.labels[realNameLabel] = newStsName
        filtered[0].spec.template.metadata.labels[realNameLabel] = newStsName
        if (filtered[0].spec.template.spec.topologySpreadConstraints) {
          for (const tpc of filtered[0].spec.template.spec.topologySpreadConstraints) {
            if (tpc.labelSelector && tpc.labelSelector.matchLabels) {
              // replace topologyConstraints matching labels to realNameLabel=newStsName only
              tpc.labelSelector.matchLabels = {}
              tpc.labelSelector.matchLabels[realNameLabel] = newStsName
            }
          }
        }

        console.log(`current: ${JSON.stringify(current)}`)
        // we still put the old items in the 'toRemoves' list because we want to keep them temporarily in the genOnly mode
        const removes = (removeAll ? current.items : current.items.slice(0, -1))
        console.log(`removes: ${JSON.stringify(removes)}`)
        for (const remove of removes) {
          toRemoves.push({ kind: o.kind, name: remove.metadata.name, item: remove })
        }
        changes[`${o.kind}-${filtered[0].metadata.name}`] = changed
        context.info(`applying rotation: ${filtered[0].metadata.name}`)
        // apply the current rotation
      } else {
        changes[`${o.kind}-${o.metadata.name}`] = changed
      }
    }
    return toRemoves
  }

  /**
   *
   */

  async shouldRename (sts) {
    let rotationFlag = null
    if (sts.metadata.annotations) {
      rotationFlag = sts.metadata.annotations['foreman/rotation']
    }
    let hasRotationBlacklist = false
    for (const c of sts.spec.template.spec.containers) {
      for (const b of blackLists) {
        if (c.image.match(b)) {
          hasRotationBlacklist = true
          break
        }
      }
    }
    if (!rotationFlag) {
      rotationFlag = hasRotationBlacklist ? 'disabled' : 'enabled'
    }
    return rotationFlag === 'enabled'
  }

  /**
 *
 * @param {Context} context
 * @param {*} diff
 * @returns
 */
  async shouldRotate (context, diff, sts) {
    if (!diff || !diff.spec) return false

    if (!(await this.shouldRename(sts))) {
      return false
    }

    const specChanges = Object.keys(diff.spec)

    if (sts.spec.replicas === 1) {
      if (specChanges.length === 1 && specChanges[0] === 'replicas') {
        return false
      }
      return true
    }
    for (const key of specChanges) {
      if (!['template', 'replicas', 'updateStrategy'].includes(key)) {
        return true
      }
    }
    if (diff.spec.template && diff.spec.template.labels) {
      return true
    }
    return false
  }

  getChangedPaths (diff, path) {
    const keys = Object.keys(diff)
    for (const key of keys) {
      path.push(key)
      this.getChangedPaths(diff[key], path)
    }
  }

  /**
 *
 * @param {Context} context
 * @param {*} manifest
 */
  async applyManifest (context, manifest, changes) {
    const stsNameToRealName = {}

    for (const item of manifest) {
      // build a mapping so that later we can replace the scaleTargetRef.name of horizontal pod autoscaler
      if (item.kind === 'StatefulSet') {
        if (!item.metadata.name.match(/---\d+$/) && (await this.shouldRename(item))) {
          const originalName = item.metadata.name
          item.metadata.name += '---0'
          stsNameToRealName[originalName] = item.metadata.name
        } else {
          const originalName = item.metadata.labels['app.kubernetes.io/name']
          stsNameToRealName[originalName] = item.metadata.labels['app.kubernetes.io/realname']
        }
      }
    }

    for (const item of manifest) {
      const key = `${item.kind}-${item.metadata.name}`
      if (item.kind === 'HorizontalPodAutoscaler' && item.spec && item.spec.scaleTargetRef && item.spec.scaleTargetRef.kind === 'StatefulSet') {
        // we should always deploy HPA since there is possbility of rotation
        changes[key] = true
        const targetStsName = item.spec.scaleTargetRef.name
        if (stsNameToRealName[targetStsName]) {
          item.spec.scaleTargetRef.name = stsNameToRealName[targetStsName]
        }
      }
      if (changes[key] === false) {
        context.info(`applyManifest skipped for item: ${key}`)
        continue
      }
      await this.lib.K8s.rolloutResource(context, item)
    }
  }

  /**
 *
 * @param {Context} context
 */
  async uninstall (context) {
    if (context.genOnly) {
      // only need to delete the release in genOnly mode
      await this.lib.K8s.deleteRelease(context)
      return
    }
    if (context.dry) {
      context.info('uninstall dry run')
      return
    }
    context.setTimeout()
    const manifest = await this.lib.K8s.getRelease(context)
    for (const item of manifest) {
      const toDeletes = []
      const name = item.metadata.name
      switch (item.kind) {
        case 'StatefulSet':
        {
          const shouldRename = await this.shouldRename(item)
          if (shouldRename) {
            const current = await this.lib.K8s.getCurrentRotations(context, name)
            toDeletes.push(...current.names)
          } else {
            toDeletes.push(name)
          }
          break
        }
        default:
          toDeletes.push(name)
      }
      for (const toDelete of toDeletes) {
        try {
          context.info(`deleting ${item.kind}/${toDelete} from ${context.namespace}`)
          await this.lib.K8s.deleteResource(context, toDelete, item.kind)
        } catch (e) {
          context.error(`failed to delete ${item.kind}/${toDelete} from ${context.namespace}`)
        }
      }
    }
    await this.lib.K8s.deleteRelease(context)
  }
}
