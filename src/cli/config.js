import * as fs from '../fs.js'
import * as shell from '../shell.js'
import os from 'os'
export async function Config () {
  const home = os.homedir()
  const workingDir = `${home}/.k10s`
  await shell.run(`mkdir -p ${workingDir}`)
  const options = await fs.yamlLoad(process.env.FOREMAN_CONFIG || home + '/.foreman.yaml')
  options.workingDir = workingDir
  options.logging = {
    info: shell.info,
    debug: shell.debug,
    warn: shell.warn,
    error: shell.error,
    fatal: shell.fatal,
  }
  return options
}
