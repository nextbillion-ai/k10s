import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { Rollout } from './cli/rollout.js'
import { Uninstall } from './cli/uninstall.js'

function cli () {
  return yargs(hideBin(process.argv))
    .usage('$0 [args]')
    .command(Rollout)
    .command(Uninstall)
    .help('h')
    .version().argv
}

export {
  cli
}
