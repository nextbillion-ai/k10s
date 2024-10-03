import * as shell from '../../shell.js'
import { Common } from '../common.js'
import { Config } from '../config.js'

export const Helm = {
  async status (context) {
    return (await shell.run(`helm status ${context.name} -n ${context.namespace}`, { nothrow: true, silent: true }))
  },

  async rollout (context, chart, spec) {
    const timeout = context.timeout ? `--wait --timeout ${context.timeout}` : ''
    let r = await shell.run(`kubectl get ns/${context.namespace}`, { silent: true, nothrow: true })
    if (r.code !== 0) {
      Common.info(context, `creating namespace: ${context.namespace}`)
      await shell.run(`bash -c "set -e;gsg cp ${Config.operatorBasePath}/assets/namespace/releases/${Config.namespaceVersion}/chart.tgz ./${context.namespace}.tgz; 
      helm install ${context.namespace} ./${context.namespace}.tgz --set global.namespace=${context.namespace} --wait --timeout 20s;rm ${context.namespace}.tgz;"`)
    }

    r = await shell.run(`helm get notes ${context.name} -n ${context.namespace}`, { nothrow: true, silent: true })
    if (r.code === 0) {
      // there is existing installation, upgrade
      Common.info(context, `upgrading release: ${context.name}`)
      await shell.run(`helm upgrade ${context.name} ${chart} -f ${spec}  -n ${context.namespace} ${timeout}`)
    } else {
      // fresh install
      Common.info(context, `installing release: ${context.name}`)
      await shell.run(`helm install ${context.name} ${chart} -f ${spec}  -n ${context.namespace} ${timeout}`)
    }
  },

  async uninstall (context) {
    Common.info(context, `uninstalling release: ${context.name}`)
    const timeout = context.timeout ? `--wait --timeout ${context.timeout}` : ''
    await shell.run(`helm uninstall ${context.name} -n ${context.namespace} ${timeout}`)
  }

}
