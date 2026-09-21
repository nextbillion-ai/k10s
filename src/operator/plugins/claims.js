// Comparison of a StatefulSet's volumeClaimTemplates against the live object.
//
// The release record can disagree with the live StatefulSet (it was replaced by
// another rollout whose record was not written), and volumeClaimTemplates cannot
// be updated in place: the API server refuses the apply. Compared on the fields
// a chart sets; a class the chart leaves to the cluster default is not compared.

export function claimsDiffer (live, wanted) {
  const byName = (claims) => Object.fromEntries((claims || []).map(c => [c.metadata && c.metadata.name, c]))
  const liveClaims = byName(live)
  const wantedClaims = byName(wanted)
  if (Object.keys(liveClaims).sort().join() !== Object.keys(wantedClaims).sort().join()) {
    return true
  }
  for (const [name, claim] of Object.entries(wantedClaims)) {
    const liveClaim = liveClaims[name] || {}
    if (claimMetadataDiffers(claim.metadata || {}, liveClaim.metadata || {})) {
      return true
    }
    if (claimSpecDiffers(claim.spec || {}, liveClaim.spec || {})) {
      return true
    }
  }
  return false
}

// Labels and annotations on the template are part of the same immutable field,
// and a key only the live side carries would be removed by the apply, so both
// directions count. Nothing but a rollout writes template metadata.
export function claimMetadataDiffers (wanted, live) {
  for (const field of ['labels', 'annotations']) {
    const wantedField = wanted[field] || {}
    const liveField = live[field] || {}
    for (const key of new Set([...Object.keys(wantedField), ...Object.keys(liveField)])) {
      if (wantedField[key] !== liveField[key]) {
        return true
      }
    }
  }
  return false
}

// Compared in both directions, because dropping a field the live claim carries is
// as much an update to the immutable template as changing it. The two exceptions
// are fields whose value the cluster, not the chart, decides: storageClassName
// (an omitted class becomes whatever the cluster defaults to) and the
// dataSource/dataSourceRef pair (the API server fills each one in from the other).
export function claimSpecDiffers (wanted, live) {
  const resource = (s, kind) => (s.resources && s.resources[kind]) || {}
  for (const kind of ['requests', 'limits']) {
    for (const key of new Set([...Object.keys(resource(wanted, kind)), ...Object.keys(resource(live, kind))])) {
      if (quantitiesDiffer(resource(wanted, kind)[key], resource(live, kind)[key])) {
        return true
      }
    }
  }
  if ([...(wanted.accessModes || [])].sort().join() !== [...(live.accessModes || [])].sort().join()) {
    return true
  }
  // Filesystem is what the API server fills in for an omitted mode on either side
  if ((wanted.volumeMode || 'Filesystem') !== (live.volumeMode || 'Filesystem')) {
    return true
  }
  for (const key of ['volumeName', 'volumeAttributesClassName']) {
    if (wanted[key] !== live[key]) {
      return true
    }
  }
  if (wanted.storageClassName !== undefined && wanted.storageClassName !== live.storageClassName) {
    return true
  }
  if (stableStringify(wanted.selector) !== stableStringify(live.selector)) {
    return true
  }
  const sources = ['dataSource', 'dataSourceRef']
  if (sources.every(key => wanted[key] === undefined)) {
    // The API server fills a source in only when the apply supplies one, so a live
    // source with neither wanted came from the unrecorded rollout and this apply
    // would drop it.
    if (sources.some(key => live[key] !== undefined)) {
      return true
    }
  } else {
    // With one supplied, its counterpart is the API server's copy, not drift.
    for (const key of sources) {
      if (wanted[key] === undefined) {
        continue
      }
      if (stableStringify(wanted[key]) !== stableStringify(live[key])) {
        return true
      }
    }
  }
  return false
}

// The API server canonicalizes quantities, so a chart asking for 1.5Gi reads back
// as 1536Mi. Comparing the strings would call that drift and rotate, and rotation
// deletes the old PVCs.
export function quantitiesDiffer (wanted, live) {
  const a = parseQuantity(wanted)
  const b = parseQuantity(live)
  if (a === null || b === null) {
    return `${wanted}` !== `${live}`
  }
  return a !== b
}

// Parses the Kubernetes quantity grammar and returns the value in milli-units as
// a BigInt: a quantity is never stored with more precision than milli and is
// rounded up to it (0.1m is stored as 1m), and at Ei scale a double cannot tell
// two values a byte apart from each other. Accepts a missing integer part
// (.5Gi), a missing fraction (5.Gi), scientific notation and both suffixes.
export function parseQuantity (value) {
  if (value === undefined || value === null) {
    return null
  }
  const matched = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?(Ki|Mi|Gi|Ti|Pi|Ei|n|u|m|k|M|G|T|P|E)?$/.exec(`${value}`.trim())
  if (!matched) {
    return null
  }
  const [, sign, whole, fraction = '', exponent, suffix] = matched
  if (!whole && !fraction) {
    return null
  }
  const decimalExponents = { n: -9, u: -6, m: -3, k: 3, M: 6, G: 9, T: 12, P: 15, E: 18 }
  const binaryExponents = { Ki: 10, Mi: 20, Gi: 30, Ti: 40, Pi: 50, Ei: 60 }
  let num = BigInt((whole || '0') + fraction)
  let den = 10n ** BigInt(fraction.length)
  const scale = (exponent ? Number(exponent) : 0) + (suffix && suffix in decimalExponents ? decimalExponents[suffix] : 0)
  if (scale > 0) {
    num *= 10n ** BigInt(scale)
  } else if (scale < 0) {
    den *= 10n ** BigInt(-scale)
  }
  if (suffix && suffix in binaryExponents) {
    num *= 2n ** BigInt(binaryExponents[suffix])
  }
  const milli = num * 1000n
  const rounded = milli % den === 0n ? milli / den : milli / den + 1n
  return sign === '-' ? -rounded : rounded
}

export function stableStringify (value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(v => stableStringify(v)).join(',')}]`
  }
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}
