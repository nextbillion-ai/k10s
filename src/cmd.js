import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { Rollout } from './cli/rollout.js'
import { Uninstall } from './cli/uninstall.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))

function cli () {
  return yargs(hideBin(process.argv))
    .usage('$0 [args]')
    .command(Rollout)
    .command(Uninstall)
    .help('h')
    .version(packageJson.version).argv
}

export {
  cli
}
