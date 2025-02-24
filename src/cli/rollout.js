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
    }).option('config', {
      type: 'string',
      alias: 'c'
    })
    .option('update-namespace', {
      alias: 'n',
      type: 'boolean',
      describe: 'Update the namespace if needed',
      default: false // or true, depending on your needs
    })
  },
  handler: async (argv) => {
    await shell.wrap(async () => {
      shell.mustExist(['gsg', 'kubectl', 'helm'])
      const context = new Context(argv.resource, await Config(argv.config))
      await context.run(async (context) => {
        try {
          let templatedValue
          if (argv.file) {
            if (!await fs.pathExists(argv.file, { mode: 'file' })) {
              shell.throwError(`${argv.file} is not a valid path`)
            }
            templatedValue = await fs.yamlLoad(argv.file)
          } else {
            templatedValue = await context.resource().get(context)
          }
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
          await context.ensureNamespace(argv.updateNamespace)
          context.wait = argv.wait
          await Operation.rollout(context)
        } catch (e) {
          shell.throwError(`failed to rollout resource ${argv.resource}: ${e.message || e}`)
        }
      }, true)
    })
  }
}
