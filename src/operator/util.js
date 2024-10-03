import * as shell from '../shell.js'
import * as fs from '../fs.js'
import jsonSchemaGenerator from 'json-schema-generator'

export async function examineAsset (context) {
  let chartDir = context.chartDir
  if (chartDir.endsWith('/')) {
    chartDir = chartDir.substring()
  }
  const chartVersion = (await shell.run(`cat ${chartDir}/Chart.yaml| grep ^version: | sed 's/^version:\\s*//'`)).stdout.trim()
  const chartName = (await shell.run(`cat ${chartDir}/Chart.yaml| grep ^name: | sed 's/^name:\\s*//'`)).stdout.trim()
  if (!chartVersion) {
    throw new Error(`invalid chartVersion: ${chartVersion}`)
  }
  if (!chartName) {
    throw new Error(`invalid chartName: ${chartName}`)
  }

  const baseName = (await shell.run(`basename ${chartDir}`)).stdout.trim()
  if (baseName !== chartName) {
    throw new Error(`invalid chart dir. must named as chart name: ${chartName}`)
  }
  try {
    const schema = jsonSchemaGenerator((await fs.yamlLoad(`${chartDir}/values.yaml`)).app)
    return { chartVersion, chartName, schema }
  } catch (e) {
    throw new Error(`error generating schema from ${chartDir + '/values.yaml'}`)
  }
}

export async function uploadAsset (context) {
  const chartDir = context.chartDir
  const { schema, chartVersion, chartName } = await examineAsset(context)
  const dryRun = context.dryRun
  const force = context.force
  context.info('examining chart')
  context.info(`chartVersion:${chartVersion}`)
  const tarCmd = `bash -c "set -e;
        chartname=$(basename ${chartDir});
        tar zcf chart.tgz -C ${chartDir}/.. \\$chartname; 
        "`

  const assetPaths = process.env.ASSET_PATHS ? process.env.ASSET_PATHS.split(',') : []
  const uploadCmds = ['set -e;', `chartname=$(basename ${chartDir});`]
  for (const ap of assetPaths) {
    uploadCmds.push(`gsg cp chart.tgz gs://${ap}/assets/${chartName}/releases/${chartVersion}/chart.tgz;`)
    uploadCmds.push(`gsg cp ./schema.json gs://${ap}/assets/${chartName}/releases/${chartVersion}/schema.json;`)
  }

  const uploadCmd = `bash -c "${uploadCmds.join('\n')}"`

  const cleanUpCmd = `bash -c "set -e;
        rm ./schema.json;
        rm ./chart.tgz;
        "`

  const r = await shell.run(`gsg ls gs://nb-data/foreman/operator/assets/${chartName}/releases/${chartVersion}`, { nothrow: true, silent: true })
  if (r.code === 0 && !force) {
    throw new Error('chart exists. try set force option?')
  }
  if (!dryRun) {
    await fs.jsonWrite('./schema.json', schema)
    await shell.run(tarCmd)
    await shell.run(uploadCmd)
    await shell.run(cleanUpCmd)
    context.info('chart uploaded')
  } else {
    context.info(`[dry-run]:${tarCmd} ${uploadCmd} ${cleanUpCmd}`)
    return `${tarCmd} ${uploadCmd} ${cleanUpCmd}`
  }
}
