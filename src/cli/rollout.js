import * as shell from '../shell.js'
import * as fs from '../fs.js'
import { Context } from '../operator/context.js'
import { Operation } from '../operator/operation.js'
import { Config } from './config.js'

export const Rollout = {
  command: 'rollout <resource> [options]',
  desc: 'rollout a resource: namespace/name ',
  builder: (yargs) => {
    yargs.option('file', {
      type: 'string',
      alias: 'f'
    }).option('set', {
      type: 'array',
      alias: 's'
    })
  },
  handler: async (argv) => {
    await shell.wrap(async () => {
      shell.mustExist(['gsg', 'kubectl', 'helm'])
      if (!argv.file) {
        shell.throwError('missing resource definition')
      }
      if (!await fs.pathExists(argv.file, { mode: 'file' })) {
        shell.throwError(`${argv.file} is not a valid path`)
      }
      const context = new Context(argv.resource, await Config())
      await context.run(async (context) => {
        try {
          const templatedValue = await fs.yamlLoad(argv.file)
          if (!templatedValue.app) {
            throw new Error('resource payload invalid: key app not found')
          }
          if (argv.set) {
            for (const pair of argv.set) {
              const [key, value] = pair.split('=')
              if (!key || !value) {
                throw new Error(`invalid --set option: ${pair}`)
              }
              const keys = key.split('.')
              if (keys.length < 1) {
                throw new Error(`invalid --set option: ${pair}`)
              }
              let base = templatedValue.app
              for (const key of keys.slice(0, -1)) {
                const numKey = Number.parseInt(key)
                base = base[numKey || key]
              }
              const lastKey = keys[keys.length - 1]
              const lastNumKey = Number.parseInt(lastKey)
              base[lastNumKey || lastKey] = value
            }
          }
          await context.resource().schemaCheck(context, templatedValue)
          await context.resource().update(context, templatedValue)
          context.wait = argv.wait
          await Operation.rollout(context)
        } catch (e) {
          shell.throwError(`failed to rollout resource ${argv.resource}: ${e.message || e}`)
        }
      }, true)
    })
  }
}
