import shelljs from 'shelljs'
import chalk from 'chalk'
import { finalize } from './operator/context.js'

async function sleep (ms) {
  return await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function throwError (msg) {
  throw new Error(msg)
}

async function run (cmd, options) {
  if (!options) {
    options = {
      silent: true
    }
  }
  if (options.dry) {
    console.log(`[dry-run:] ${cmd}`)
    return {
      code: 0
    }
  }

  return new Promise((resolve, reject) => {
    shelljs.exec(cmd, options, (code, stdout, stderr) => {
      if (code !== 0 && options && !options.nothrow) {
        if (stderr) {
          reject(stderr)
        }
        reject(Error(`${cmd} non-zero exit: ${code}`))
      }
      resolve({
        code,
        stdout,
        stderr
      })
    })
  })
}

const logLevelMap = {
  debug: 4,
  info: 3,
  warn: 2,
  error: 1,
  fatal: 0
}

const logLevel = logLevelMap[process.env.LOG_LEVEL] || 3

function log (type, msg, options) {
  if (type === 'plain') {
    console.log(msg)
    return
  }
  const level = logLevelMap[type] || 3
  if (level >= logLevel) {
    console.log(`${chalk.grey(`[${type}:]`)} ${msg}`)
  }
}

function info (msg, options) {
  log('info', msg, options)
}

function debug (msg, options) {
  log('debug', msg, options)
}

function warn (msg, options) {
  log('warn', msg, options)
}

function error (msg, options) {
  log('error', msg, options)
}

function plain (msg, options) {
  log('plain', msg, options)
}

function fatal (msg, options) {
  log('fatal', msg.trim(), options)
}

async function doFinalize (exitCode) {
  debug('performing finalize')
  finalize().then(() => {
    process.exit(exitCode)
  }
  ).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}

async function mustExist (apps) {
  const notFound = []
  for (const app of apps) {
    if (shelljs.exec(`which ${app}`, { silent: true }).code !== 0) {
      notFound.push(app)
    }
  }
  if (notFound.length > 0) {
    throwError(notFound.join(',') + ' not found')
  }
}

async function wrap (closure) {
  const tss = Date.now()
  process.on('SIGINT', async () => { doFinalize(1) })
  process.on('SIGTERM', async () => { doFinalize(1) })
  process.on('beforeExit', async () => {
    await doFinalize(0)
  })
  try {
    await closure()
    const d = (Date.now() - tss) / 1000
    plain(`${chalk.cyan('\u2615  Done')} in ${chalk.magenta(d)} seconds`, {
      temp: false
    })
  } catch (e) {
    console.error(e)
    if (e.type && e.message) {
      log(e.type, chalk.red(e.message))
    } else {
      console.log(e.stack)
      fatal(chalk.red(e.message || e), {
        temp: false
      })
    }
    await finalize(1)
  }
}
export {
  run,
  sleep,
  plain,
  info,
  debug,
  error,
  warn,
  fatal,
  mustExist,
  throwError,
  wrap
}
