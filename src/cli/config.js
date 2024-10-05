import * as fs from '../fs.js'
import * as shell from '../shell.js'
import os from 'os'
export async function Config (cPath) {
  let configPath = cPath || process.env.K10S_CONFIG
  if (!configPath) {
    configPath = '~/.foreman.yaml'
  }
  configPath = configPath.replace(/^~\//, os.homedir() + '/')
  const workingDir = `${os.homedir()}/.k10s`
  await shell.run(`mkdir -p ${workingDir}`)
  const options = await fs.yamlLoad(configPath)
  options.workingDir = workingDir
  options.logging = {
    info: shell.info,
    debug: shell.debug,
    warn: shell.warn,
    error: shell.error,
    fatal: shell.fatal
  }
  return options
}
