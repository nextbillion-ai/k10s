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

        // we still put the old items in the 'toRemoves' list because we want to keep them temporarily in the genOnly mode
        const removes = (removeAll ? current.items : current.items.slice(0, -1))
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
      if (item.kind === 'CronJob' && this.rewriteCronHpaScaleTarget(item, stsNameToRealName)) {
        // a cron-managed HPA embeds the StatefulSet name inside its container
        // command (a `kubectl apply` HPA manifest), so the scaleTargetRef rewrite
        // above does not reach it. Always re-apply (like HPA) since a rotation can
        // change the real target StatefulSet name.
        changes[key] = true
      }
      // `foreman/apply-policy: create-only` resources are applied only when they
      // do not already exist. Used by the cron-managed HPA's baseline object so an
      // HPA is present right after deploy, while its live min/max stays owned by
      // the CronJobs (re-applying would clobber whatever the crons last set).
      if (!context.genOnly &&
          item.metadata.annotations &&
          item.metadata.annotations['foreman/apply-policy'] === 'create-only') {
        if (await this.lib.K8s.resourceExists(context, item.kind, item.metadata.name)) {
          // exists: don't re-apply (keep cron-owned fields like min/max). But for
          // an HPA, still sync scaleTargetRef — it was rewritten above to the
          // rotated StatefulSet name, so the HPA follows a rotation immediately
          // instead of pointing at the deleted target until the next cron run.
          if (item.kind === 'HorizontalPodAutoscaler' && item.spec && item.spec.scaleTargetRef) {
            await this.lib.K8s.mergePatch(context, item.kind, item.metadata.name, { spec: { scaleTargetRef: item.spec.scaleTargetRef } })
          }
          context.info(`applyManifest skipped create-only item that already exists: ${key}`)
          continue
        }
        // absent: force creation even if the manifest is otherwise unchanged, so
        // the resource is reliably recreated (e.g. after a manual delete)
        changes[key] = true
      }
      if (changes[key] === false) {
        context.info(`applyManifest skipped for item: ${key}`)
        continue
      }
      await this.lib.K8s.rolloutResource(context, item)
    }
  }

  /**
   * Rewrite the StatefulSet name referenced by a cron-managed HPA.
   *
   * Cron-managed HPAs are CronJobs whose container command runs
   * `kubectl apply` against an inline HorizontalPodAutoscaler manifest. The
   * StatefulSet name in that manifest's `scaleTargetRef.name` is plain text
   * inside the command string, so it is not covered by the scaleTargetRef
   * rewrite applied to real HPA objects. This replaces the embedded
   * StatefulSet name with its rotated real name (e.g. `nbval-foo` ->
   * `nbval-foo---0`) using the same mapping.
   *
   * @param {*} item a CronJob manifest item
   * @param {Object<string,string>} stsNameToRealName plain -> rotated name map
   * @returns {boolean} true if the CronJob embeds an HPA scaleTargetRef to a StatefulSet
   */
  rewriteCronHpaScaleTarget (item, stsNameToRealName) {
    const containers = item?.spec?.jobTemplate?.spec?.template?.spec?.containers || []
    let found = false
    const rewrite = (part) => {
      if (typeof part !== 'string' || !part.includes('scaleTargetRef')) return part
      // Match a `scaleTargetRef:` mapping and its indented child lines (lines
      // indented deeper than the `scaleTargetRef:` key). Field order inside the
      // block is irrelevant: we only rewrite the block's `name:` when the block
      // also targets a StatefulSet. The name may be unquoted or wrapped in
      // matching single/double quotes; the quote is preserved on output.
      return part.replace(
        /^([ \t]*)scaleTargetRef:[ \t]*\n((?:\1[ \t]+.*(?:\n|$))*)/gm,
        (block) => {
          if (!/(^|\n)[ \t]*kind:[ \t]*StatefulSet\b/.test(block)) return block
          return block.replace(
            /((?:^|\n)[ \t]*name:[ \t]*)(["']?)([^\s"']+)\2/,
            (m, prefix, quote, name) => {
              const real = stsNameToRealName[name]
              if (!real) return m
              found = true
              return `${prefix}${quote}${real}${quote}`
            }
          )
        }
      )
    }
    for (const c of containers) {
      // the script may live in either `command` or `args` (the common
      // `command: ['/bin/sh','-c']` + script-in-`args` form)
      for (const field of ['command', 'args']) {
        if (!Array.isArray(c[field])) continue
        c[field] = c[field].map(rewrite)
      }
    }
    return found
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
          await this.lib.K8s.deleteResource(context, toDelete, item.kind)
        } catch (e) {
          context.error(`failed to delete ${item.kind}/${toDelete} from ${context.namespace}`)
        }
      }
    }
    await this.lib.K8s.deleteRelease(context)
  }
}
