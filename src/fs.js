import fs from 'fs'
import yaml from 'js-yaml'
import shelljs from 'shelljs'

async function readFile (path) {
  return await new Promise((resolve, reject) => {
    fs.readFile(path, 'utf8', (err, data) => {
      if (err) {
        reject(err)
      }
      resolve(data)
    })
  })
}

async function jsonWrite (path, values) {
  await plainWrite(path, JSON.stringify(values, null, 2))
}

async function jsonLoad (path) {
  return JSON.parse(await readFile(path))
}

async function plainWrite (path, values) {
  await new Promise((resolve, reject) => {
    fs.writeFile(path, values, 'utf8', (err) => {
      if (err) {
        reject(err)
      }
      resolve()
    })
  })
}

async function yamlWrite (path, values) {
  await plainWrite(path, yaml.dump(values))
}

async function yamlWriteAll (path, values) {
  await plainWrite(path, await yamlDumpsAll(values))
}

async function yamlDumps (value) {
  return yaml.dump(value)
}

async function yamlDumpsAll (values) {
  if (!Array.isArray(values)) {
    throw new Error('yamlDumpsAll expects array input')
  }
  const items = ['']
  for (const value of values) {
    items.push(yaml.dump(value))
  }
  return items.join('---\n')
}

async function yamlLoads (value) {
  return yaml.load(value)
}

async function yamlLoadsAll (value) {
  return yaml.loadAll(value)
}

async function yamlLoad (path) {
  return yaml.load(await readFile(path))
}

async function yamlLoadAll (path) {
  return yaml.loadAll(await readFile(path))
}

async function pathExists (path, options) {
  if (!options || !options.mode) {
    options = { mode: 'any' }
  }
  if (options.mode === 'any') {
    return shelljs.test('-e', path)
  } else if (options.mode === 'file') {
    return shelljs.test('-f', path)
  } else if (options.mode === 'dir') {
    return shelljs.test('-d', path)
  } else {
    throw new Error(`invalid options: ${JSON.stringify(options)}`)
  }
}

export {
  yamlLoad,
  yamlLoads,
  yamlDumps,
  yamlDumpsAll,
  yamlLoadsAll,
  yamlLoadAll,
  yamlWrite,
  yamlWriteAll,
  jsonLoad,
  jsonWrite,
  plainWrite,
  pathExists,
  readFile
}
