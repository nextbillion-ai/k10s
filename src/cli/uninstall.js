import * as shell from '../shell.js'
import { Context } from '../operator/context.js'
import { Operation } from '../operator/operation.js'
import { Config } from './config.js'

export const Uninstall = {
  command: 'uninstall <resource> [options]',
  desc: 'uninstall a resource: namespace/name ',
  handler: async (argv) => {
    shell.wrap(async () => {
      shell.mustExist(['gsg', 'kubectl', 'helm'])
      const context = new Context(argv.resource, await Config())
      await context.run(async (context) => {
        try {
          context.wait = argv.wait
          await Operation.uninstall(context)
        } catch (e) {
          shell.throwError(`failed to uninstall resource ${argv.resource}: ${e.message || e}`)
        }
      }, true)
    })
  }
}
