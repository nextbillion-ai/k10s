import * as shell from '../shell.js'
import { Context } from '../operator/context.js'
import { Operation } from '../operator/operation.js'
import { Config } from './config.js'

export const Uninstall = {
  command: 'uninstall <resource> [options]',
  desc: 'uninstall a resource: namespace/name ',
  builder: (yargs) => {
    yargs.option('config', {
      type: 'string',
      alias: 'c'
    })
    yargs.option('gen-only', {
      type: 'boolean',
      alias: 'g',
      describe: 'Generate manifest only',
      default: false
    })
  },
  handler: async (argv) => {
    await shell.wrap(async () => {
      shell.mustExist(['gsg', 'kubectl', 'helm'])
      const context = new Context(argv.resource, await Config(argv.config))
      if (argv.genOnly) {
        if (!context.manifestOutputPath) {
          throw new Error('manifestOutputPath must be defined when using --gen-only')
        }
        context.genOnly = true
        context.info(`Runing in --gen-only mode, removing manifest file ${context.manifestOutputPath}`)      
      }
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
