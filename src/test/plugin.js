import assert from 'assert'
import { describe } from 'mocha'
import { TestCommon } from './test_common.js'
import { Default } from '../operator/plugins/default.js'

describe('Plugin', () => {
  TestCommon.testModule({
    name: 'hpa',
    cases: [
      {
        name: 'happy path',
        run: async () => {
          const lib = {
            K8s: {
              diff () { return { spec: { wocao: true } } },
              writeRelease (ctx, release) {},
              rolloutResource (ctx, item) {},
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: false, names: [], items: [] } }
            }
          }
          const ctx = {
            info () {}
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: {
                name: 'sts1',
                annotations: {
                  'foreman/rotation': 'disabled'
                },
                labels: {
                  'app.kubernetes.io/name': 'sts1',
                  'app.kubernetes.io/realname': 'should be this'
                }
              },
              spec: {
                template: {
                  metadata: {
                    labels: {}
                  },
                  spec: {
                    containers: [
                      {
                        image: 'haha:1'
                      }
                    ]
                  }
                }
              }
            },
            {
              kind: 'HorizontalPodAutoscaler',
              metadata: {
                name: 'hpa1',
                labels: {}
              },
              spec: {
                scaleTargetRef: {
                  kind: 'StatefulSet',
                  name: 'sts1'
                }
              }
            }
          ]
          await p.applyManifest(ctx, oldManifest, {})
          assert.equal(oldManifest[1].spec.scaleTargetRef.name, 'should be this')
        }
      },
      {
        name: 'no realname label',
        run: async () => {
          const lib = {
            K8s: {
              diff () { return { spec: { wocao: true } } },
              writeRelease (ctx, release) {},
              rolloutResource (ctx, item) {},
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: false, names: [], items: [] } }
            }
          }
          const ctx = {
            info () {}
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: {
                name: 'sts1'
              },
              spec: {
                template: {
                  metadata: {
                    labels: {}
                  },
                  spec: {
                    containers: [
                      {
                        image: 'haha:1'
                      }
                    ]
                  }
                }
              }
            },
            {
              kind: 'HorizontalPodAutoscaler',
              metadata: {
                name: 'hpa1',
                labels: {}
              },
              spec: {
                scaleTargetRef: {
                  kind: 'StatefulSet',
                  name: 'sts1'
                }
              }
            }
          ]
          await p.applyManifest(ctx, oldManifest, {})
          assert.equal(oldManifest[1].spec.scaleTargetRef.name, 'sts1---0')
        }
      },
      {
        name: 'cron-managed hpa rewrites embedded statefulset target',
        run: async () => {
          const lib = {
            K8s: {
              diff () { return { spec: { wocao: true } } },
              writeRelease (ctx, release) {},
              rolloutResource (ctx, item) {},
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: false, names: [], items: [] } }
            }
          }
          const ctx = {
            info () {}
          }
          const p = new Default(lib)
          const cronCommand = [
            '/bin/sh',
            '-c',
            [
              'set -e',
              "cat <<'EOF' | kubectl apply -f -",
              'apiVersion: autoscaling/v2',
              'kind: HorizontalPodAutoscaler',
              'metadata:',
              '  name: sts1',
              'spec:',
              '  scaleTargetRef:',
              '    apiVersion: apps/v1',
              '    kind: StatefulSet',
              '    name: sts1',
              '  minReplicas: 6',
              '  maxReplicas: 12',
              'EOF'
            ].join('\n')
          ]
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: {
                name: 'sts1'
              },
              spec: {
                template: {
                  metadata: {
                    labels: {}
                  },
                  spec: {
                    containers: [
                      {
                        image: 'haha:1'
                      }
                    ]
                  }
                }
              }
            },
            {
              kind: 'CronJob',
              metadata: {
                name: 'sts1-hpa-scale-up',
                labels: {}
              },
              spec: {
                jobTemplate: {
                  spec: {
                    template: {
                      spec: {
                        containers: [
                          {
                            name: 'hpa-manager',
                            command: cronCommand
                          }
                        ]
                      }
                    }
                  }
                }
              }
            }
          ]
          await p.applyManifest(ctx, oldManifest, {})
          const cmd = oldManifest[1].spec.jobTemplate.spec.template.spec.containers[0].command[2]
          // the embedded scaleTargetRef is rewritten to the rotated statefulset name
          assert.ok(cmd.includes('    name: sts1---0'), 'scaleTargetRef should be rewritten to sts1---0')
          // the HPA object's own metadata.name stays plain (not rotated)
          assert.ok(cmd.includes('  name: sts1\n'), 'hpa metadata.name should stay sts1')
          // exactly one occurrence of the rotated name (the scaleTargetRef target)
          assert.equal((cmd.match(/sts1---0/g) || []).length, 1)
        }
      },
      {
        name: 'cron-managed hpa rewrites embedded target when script is in args',
        run: async () => {
          const lib = {
            K8s: {
              diff () { return { spec: { wocao: true } } },
              writeRelease (ctx, release) {},
              rolloutResource (ctx, item) {},
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: false, names: [], items: [] } }
            }
          }
          const ctx = {
            info () {}
          }
          const p = new Default(lib)
          const script = [
            'set -e',
            "cat <<'EOF' | kubectl apply -f -",
            'apiVersion: autoscaling/v2',
            'kind: HorizontalPodAutoscaler',
            'metadata:',
            '  name: sts1',
            'spec:',
            '  scaleTargetRef:',
            '    apiVersion: apps/v1',
            '    kind: StatefulSet',
            '    name: "sts1"',
            'EOF'
          ].join('\n')
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: {
                name: 'sts1'
              },
              spec: {
                template: {
                  metadata: {
                    labels: {}
                  },
                  spec: {
                    containers: [
                      {
                        image: 'haha:1'
                      }
                    ]
                  }
                }
              }
            },
            {
              kind: 'CronJob',
              metadata: {
                name: 'sts1-hpa-scale-up',
                labels: {}
              },
              spec: {
                jobTemplate: {
                  spec: {
                    template: {
                      spec: {
                        containers: [
                          {
                            name: 'hpa-manager',
                            command: ['/bin/sh', '-c'],
                            args: [script]
                          }
                        ]
                      }
                    }
                  }
                }
              }
            }
          ]
          await p.applyManifest(ctx, oldManifest, {})
          const args0 = oldManifest[1].spec.jobTemplate.spec.template.spec.containers[0].args[0]
          // quotes around the target name are preserved on rewrite
          assert.ok(args0.includes('    name: "sts1---0"'), 'quoted scaleTargetRef in args should be rewritten to "sts1---0"')
          assert.equal((args0.match(/sts1---0/g) || []).length, 1)
        }
      },
      {
        name: 'cron-managed hpa rewrite is independent of scaleTargetRef field order',
        run: async () => {
          const lib = {
            K8s: {
              diff () { return { spec: { wocao: true } } },
              writeRelease (ctx, release) {},
              rolloutResource (ctx, item) {},
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: false, names: [], items: [] } }
            }
          }
          const ctx = {
            info () {}
          }
          const p = new Default(lib)
          // name appears BEFORE kind inside scaleTargetRef
          const cmd = [
            "cat <<'EOF' | kubectl apply -f -",
            'apiVersion: autoscaling/v2',
            'kind: HorizontalPodAutoscaler',
            'metadata:',
            '  name: sts1',
            'spec:',
            '  scaleTargetRef:',
            '    name: sts1',
            '    apiVersion: apps/v1',
            '    kind: StatefulSet',
            '  minReplicas: 6',
            'EOF'
          ].join('\n')
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: {
                name: 'sts1'
              },
              spec: {
                template: {
                  metadata: {
                    labels: {}
                  },
                  spec: {
                    containers: [
                      {
                        image: 'haha:1'
                      }
                    ]
                  }
                }
              }
            },
            {
              kind: 'CronJob',
              metadata: {
                name: 'sts1-hpa-scale-up',
                labels: {}
              },
              spec: {
                jobTemplate: {
                  spec: {
                    template: {
                      spec: {
                        containers: [
                          {
                            name: 'hpa-manager',
                            command: ['/bin/sh', '-c', cmd]
                          }
                        ]
                      }
                    }
                  }
                }
              }
            }
          ]
          await p.applyManifest(ctx, oldManifest, {})
          const out = oldManifest[1].spec.jobTemplate.spec.template.spec.containers[0].command[2]
          // scaleTargetRef.name is rewritten even though it precedes kind
          assert.ok(out.includes('    name: sts1---0'), 'scaleTargetRef name before kind should still be rewritten')
          // the HPA metadata.name (also "sts1", outside scaleTargetRef) stays plain
          assert.ok(out.includes('metadata:\n  name: sts1\n'), 'hpa metadata.name should stay sts1')
          assert.equal((out.match(/sts1---0/g) || []).length, 1)
        }
      },
      {
        name: 'create-only: skips full apply when it exists, but syncs scaleTargetRef on rotation',
        run: async () => {
          const applied = []
          const patched = []
          const lib = {
            K8s: {
              diff () { return {} },
              writeRelease () {},
              rolloutResource (ctx, item) { applied.push(item.metadata.name) },
              getCurrentRotations () { return { rotation: 0, exists: false, names: [], items: [] } },
              resourceExists () { return true },
              mergePatch (ctx, kind, name, patch) { patched.push({ kind, name, patch }) }
            }
          }
          const ctx = {
            info () {}
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: {
                name: 'sts1'
              },
              spec: {
                template: {
                  metadata: { labels: {} },
                  spec: { containers: [{ image: 'haha:1' }] }
                }
              }
            },
            {
              kind: 'HorizontalPodAutoscaler',
              metadata: {
                name: 'hpa1',
                labels: {},
                annotations: { 'foreman/apply-policy': 'create-only' }
              },
              spec: {
                scaleTargetRef: { kind: 'StatefulSet', name: 'sts1' }
              }
            }
          ]
          await p.applyManifest(ctx, oldManifest, {})
          // create-only HPA is not re-applied (cron owns min/max) ...
          assert.ok(!applied.includes('hpa1'), 'create-only HPA should not be re-applied')
          // ... but its scaleTargetRef is patched to the rotated StatefulSet name
          assert.equal(patched.length, 1)
          assert.equal(patched[0].kind, 'HorizontalPodAutoscaler')
          assert.equal(patched[0].patch.spec.scaleTargetRef.name, 'sts1---0')
        }
      },
      {
        name: 'create-only: applies when the resource does not exist',
        run: async () => {
          const applied = []
          const lib = {
            K8s: {
              diff () { return {} },
              writeRelease () {},
              rolloutResource (ctx, item) { applied.push(item.metadata.name) },
              getCurrentRotations () { return { rotation: 0, exists: false, names: [], items: [] } },
              resourceExists () { return false }
            }
          }
          const ctx = {
            info () {}
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'HorizontalPodAutoscaler',
              metadata: {
                name: 'hpa1',
                labels: {},
                annotations: { 'foreman/apply-policy': 'create-only' }
              },
              spec: {
                scaleTargetRef: { kind: 'StatefulSet', name: 'sts1' }
              }
            }
          ]
          await p.applyManifest(ctx, oldManifest, {})
          assert.deepEqual(applied, ['hpa1'])
        }
      },
      {
        name: 'create-only: recreates when absent even if manifest is unchanged',
        run: async () => {
          const applied = []
          const lib = {
            K8s: {
              diff () { return {} },
              writeRelease () {},
              rolloutResource (ctx, item) { applied.push(item.metadata.name) },
              getCurrentRotations () { return { rotation: 0, exists: false, names: [], items: [] } },
              resourceExists () { return false }
            }
          }
          const ctx = {
            info () {}
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'HorizontalPodAutoscaler',
              metadata: {
                name: 'hpa1',
                labels: {},
                annotations: { 'foreman/apply-policy': 'create-only' }
              },
              spec: {
                scaleTargetRef: { kind: 'StatefulSet', name: 'sts1' }
              }
            }
          ]
          // changes marks the item unchanged; an absent create-only resource must
          // still be (re)created rather than skipped as unchanged
          await p.applyManifest(ctx, oldManifest, { 'HorizontalPodAutoscaler-hpa1': false })
          assert.deepEqual(applied, ['hpa1'])
        }
      }
    ]
  })
  TestCommon.testModule({
    name: 'rotateManifest',
    cases: [
      {
        name: 'without annotations',
        run: async () => {
          const lib = {
            K8s: {
              diff () { return { spec: { wocao: true } } },
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: false, names: [], items: [] } }
            }
          }
          const ctx = {
            info () {}
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: {
                name: 'name1',
                labels: {}
              },
              spec: {
                template: {
                  metadata: {
                    labels: {}
                  },
                  spec: {
                    containers: [
                      {
                        image: 'haha:1'
                      }
                    ]
                  }
                }
              }
            },
            {
              kind: 'StatefulSet',
              metadata: {
                name: 'name2',
                labels: {}
              },
              spec: {
                template: {
                  metadata: {
                    labels: {}
                  },
                  spec: {
                    containers: [
                      {
                        image: 'redis:1'
                      }
                    ]
                  }
                }
              }
            }
          ]
          const newManifest = JSON.parse(JSON.stringify(oldManifest))

          await p.rotateManifest(ctx, oldManifest, newManifest, {})
          assert.equal(newManifest[0].metadata.name, 'name1---1')
          assert.equal(newManifest[1].metadata.name, 'name2')
        }
      },
      {
        name: 'with annotations',
        run: async () => {
          const lib = {
            K8s: {
              diff () { return { spec: { wocao: true } } },
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: false, names: [], items: [] } }
            }
          }
          const ctx = {
            info () {}
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: {
                name: 'name1',
                annotations: {
                  'foreman/rotation': 'disabled'
                },
                labels: {}
              },
              spec: {
                template: {
                  metadata: {
                    labels: {}
                  },
                  spec: {
                    containers: [
                      {
                        image: 'haha:1'
                      }
                    ]
                  }
                }
              }
            },
            {
              kind: 'StatefulSet',
              metadata: {
                name: 'name2',
                annotations: {
                  'foreman/rotation': 'enabled'
                },
                labels: {}
              },
              spec: {
                template: {
                  metadata: {
                    labels: {}
                  },
                  spec: {
                    containers: [
                      {
                        image: 'redis:1'
                      }
                    ]
                  }
                }
              }
            }
          ]
          const newManifest = JSON.parse(JSON.stringify(oldManifest))

          await p.rotateManifest(ctx, oldManifest, newManifest, {})
          assert.equal(newManifest[0].metadata.name, 'name1')
          assert.equal(newManifest[1].metadata.name, 'name2---1')
        }
      },
      {
        name: 'with only replicas change',
        run: async () => {
          const lib = {
            K8s: {
              diff () { return { spec: { replicas: true } } },
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: true, names: [], items: [] } },
              getLiveReplicas () { return null },
              getLiveVolumeClaimTemplates () { return null }
            }
          }
          const ctx = {
            info () {}
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: {
                name: 'name2',
                labels: {}
              },
              spec: {
                template: {
                  metadata: {
                    labels: {}
                  },
                  spec: {
                    replicas: 1,
                    containers: [
                      {
                        image: 'whocares'
                      }
                    ]
                  }
                }
              }
            }
          ]
          const newManifest = JSON.parse(JSON.stringify(oldManifest))

          await p.rotateManifest(ctx, oldManifest, newManifest, {})
          assert.equal(newManifest[0].metadata.name, 'name2---0')
        }
      },
      {
        name: 'HPA-scaled single-seed STS updates in place instead of rotating',
        run: async () => {
          const ctx = { info () {}, rotated: false }
          const lib = {
            K8s: {
              // a template (image) change — the kind that CAN be applied in place
              diff () { return { spec: { template: { metadata: {} } } } },
              getCurrentRotations () { return { rotation: 3, exists: true, names: ['name1---3'], items: [{ kind: 'StatefulSet', metadata: { name: 'name1---3' } }] } },
              // chart seeds replicas: 1, but the HPA has scaled the live STS to 6
              getLiveReplicas () { return 6 },
              getLiveVolumeClaimTemplates () { return null }
            }
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: { name: 'name1', labels: {} },
              spec: {
                replicas: 1,
                template: {
                  metadata: { labels: {} },
                  spec: { containers: [{ image: 'haha:1' }] }
                }
              }
            }
          ]
          const newManifest = JSON.parse(JSON.stringify(oldManifest))

          await p.rotateManifest(ctx, oldManifest, newManifest, {})
          // no rotation: stays on the current rotation (in-place update)
          assert.equal(newManifest[0].metadata.name, 'name1---3')
          assert.equal(ctx.rotated, false)
          // the live HPA-managed replica count is preserved (not scaled to the seed)
          assert.equal(newManifest[0].spec.replicas, 6)
        }
      },
      {
        name: 'OnDelete StatefulSet rotates even when HPA-scaled above one replica',
        run: async () => {
          const ctx = { info () {}, rotated: false }
          const lib = {
            K8s: {
              diff () { return { spec: { template: { metadata: {} } } } },
              getCurrentRotations () { return { rotation: 3, exists: true, names: ['name1---3'], items: [{ kind: 'StatefulSet', metadata: { name: 'name1---3' } }] } },
              getLiveReplicas () { return 6 },
              getLiveVolumeClaimTemplates () { return null }
            }
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: { name: 'name1', labels: {} },
              spec: {
                replicas: 1,
                updateStrategy: { type: 'OnDelete' },
                template: {
                  metadata: { labels: {} },
                  spec: { containers: [{ image: 'haha:1' }] }
                }
              }
            }
          ]
          const newManifest = JSON.parse(JSON.stringify(oldManifest))

          await p.rotateManifest(ctx, oldManifest, newManifest, {})
          // OnDelete won't roll pods in place, so it must still rotate
          assert.equal(newManifest[0].metadata.name, 'name1---4')
          assert.equal(ctx.rotated, true)
        }
      },
      {
        name: 'OnDelete STS with only an updateStrategy change applies in place',
        run: async () => {
          const ctx = { info () {}, rotated: false }
          const lib = {
            K8s: {
              // no template change — only the updateStrategy itself changed
              diff () { return { spec: { updateStrategy: { type: true } } } },
              getCurrentRotations () { return { rotation: 3, exists: true, names: ['name1---3'], items: [{ kind: 'StatefulSet', metadata: { name: 'name1---3' } }] } },
              getLiveReplicas () { return 6 },
              getLiveVolumeClaimTemplates () { return null }
            }
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: { name: 'name1', labels: {} },
              spec: {
                replicas: 1,
                updateStrategy: { type: 'OnDelete' },
                template: {
                  metadata: { labels: {} },
                  spec: { containers: [{ image: 'haha:1' }] }
                }
              }
            }
          ]
          const newManifest = JSON.parse(JSON.stringify(oldManifest))

          await p.rotateManifest(ctx, oldManifest, newManifest, {})
          // updateStrategy-only change is in-place-able, so no rotation is forced
          assert.equal(newManifest[0].metadata.name, 'name1---3')
          assert.equal(ctx.rotated, false)
        }
      },
      {
        name: 'explicit chart replica scale-down is honored, not overwritten by live count',
        run: async () => {
          const ctx = { info () {}, rotated: false }
          const lib = {
            K8s: {
              // the chart changed replicas (6 -> 3)
              diff () { return { spec: { replicas: 3 } } },
              getCurrentRotations () { return { rotation: 3, exists: true, names: ['name1---3'], items: [{ kind: 'StatefulSet', metadata: { name: 'name1---3' } }] } },
              getLiveReplicas () { return 6 },
              getLiveVolumeClaimTemplates () { return null }
            }
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: { name: 'name1', labels: {} },
              spec: {
                replicas: 6,
                template: {
                  metadata: { labels: {} },
                  spec: { containers: [{ image: 'haha:1' }] }
                }
              }
            }
          ]
          const newManifest = JSON.parse(JSON.stringify(oldManifest))
          newManifest[0].spec.replicas = 3

          await p.rotateManifest(ctx, oldManifest, newManifest, {})
          // the requested scale-down is applied, not reset to the live count
          assert.equal(newManifest[0].spec.replicas, 3)
        }
      },
      {
        name: 'live replica count is preserved even when below the chart seed',
        run: async () => {
          const ctx = { info () {}, rotated: false }
          const lib = {
            K8s: {
              diff () { return { spec: { template: { metadata: {} } } } },
              getCurrentRotations () { return { rotation: 3, exists: true, names: ['name1---3'], items: [{ kind: 'StatefulSet', metadata: { name: 'name1---3' } }] } },
              // chart seed is 6, but the HPA has scaled the live STS down to 2
              getLiveReplicas () { return 2 },
              getLiveVolumeClaimTemplates () { return null }
            }
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: { name: 'name1', labels: {} },
              spec: {
                replicas: 6,
                template: {
                  metadata: { labels: {} },
                  spec: { containers: [{ image: 'haha:1' }] }
                }
              }
            }
          ]
          const newManifest = JSON.parse(JSON.stringify(oldManifest))

          await p.rotateManifest(ctx, oldManifest, newManifest, {})
          // HPA owns the count: preserve the live value (2), don't reset to seed (6)
          assert.equal(newManifest[0].spec.replicas, 2)
        }
      },
      {
        name: 'live replica count of zero (scale-to-zero) is preserved',
        run: async () => {
          const ctx = { info () {}, rotated: false }
          const lib = {
            K8s: {
              diff () { return { spec: { template: { metadata: {} } } } },
              getCurrentRotations () { return { rotation: 3, exists: true, names: ['name1---3'], items: [{ kind: 'StatefulSet', metadata: { name: 'name1---3' } }] } },
              // the live workload is scaled to zero (off-hours)
              getLiveReplicas () { return 0 },
              getLiveVolumeClaimTemplates () { return null }
            }
          }
          const p = new Default(lib)
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: { name: 'name1', labels: {} },
              spec: {
                replicas: 1,
                template: {
                  metadata: { labels: {} },
                  spec: { containers: [{ image: 'haha:1' }] }
                }
              }
            }
          ]
          const newManifest = JSON.parse(JSON.stringify(oldManifest))

          await p.rotateManifest(ctx, oldManifest, newManifest, {})
          // 0 is a valid live count: don't fall back to the seed and create pods
          assert.equal(newManifest[0].spec.replicas, 0)
          assert.equal(ctx.rotated, false)
        }
      }
    ]
  })
  TestCommon.testModule({
    name: 'rotateManifest volumeClaimTemplates',
    cases: [
      ...[
        {
          name: 'rotates when the live claim differs from the release record',
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', resources: { requests: { storage: '273Gi' } } } }],
          rotation: 'name1---10',
          rotated: true
        },
        {
          name: 'updates in place when the live claim matches',
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---9',
          rotated: false
        },
        {
          name: 'updates in place when the live claims cannot be read',
          live: null,
          rotation: 'name1---9',
          rotated: false
        },
        {
          name: 'does not compare a class the chart leaves to the cluster default',
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'standard-rwo', resources: { requests: { storage: '180Gi' } } } }],
          wantedClass: null,
          rotation: 'name1---9',
          rotated: false
        },
        {
          // sub-milli precision is rounded up on write: 0.1m is stored as 1m
          name: 'does not rotate on a quantity rounded up to milli',
          wantedSpec: { resources: { requests: { storage: '0.1m' } } },
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', resources: { requests: { storage: '1m' } } } }],
          rotation: 'name1---9',
          rotated: false
        },
        {
          name: 'rotates when the live storage class differs',
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'nb-ssd', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---10',
          rotated: true
        },
        {
          // the API server canonicalizes quantities: 1.5Gi reads back as 1536Mi
          name: 'does not rotate on a quantity the API server rewrote',
          wantedSpec: { resources: { requests: { storage: '1.5Gi' } } },
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', resources: { requests: { storage: '1536Mi' } } } }],
          rotation: 'name1---9',
          rotated: false
        },
        {
          name: 'rotates when the chart asks for no class and the live claim has one',
          wantedSpec: { storageClassName: '' },
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'standard-rwo', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---10',
          rotated: true
        },
        {
          name: 'does not rotate when both sides ask for no class',
          wantedSpec: { storageClassName: '' },
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: '', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---9',
          rotated: false
        },
        {
          name: 'rotates when the live volume mode differs from the chart',
          wantedSpec: { volumeMode: 'Block' },
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', volumeMode: 'Filesystem', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---10',
          rotated: true
        },
        {
          // Filesystem is what the API server fills in, so an unset live value matches
          name: 'does not rotate when the chart spells out the default volume mode',
          wantedSpec: { volumeMode: 'Filesystem' },
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---9',
          rotated: false
        },
        {
          name: 'rotates when the live selector differs',
          wantedSpec: { selector: { matchLabels: { disk: 'ssd' } } },
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', selector: { matchLabels: { disk: 'hdd' } }, resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---10',
          rotated: true
        },
        {
          // the same selector, written with its keys in another order
          name: 'does not rotate on selector key order',
          wantedSpec: { selector: { matchLabels: { disk: 'ssd', zone: 'a' } } },
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', selector: { matchLabels: { zone: 'a', disk: 'ssd' } }, resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---9',
          rotated: false
        },
        {
          // a quantity may be written without its integer part
          name: 'does not rotate on a quantity written without a leading digit',
          wantedSpec: { resources: { requests: { storage: '.5Gi' } } },
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', resources: { requests: { storage: '512Mi' } } } }],
          rotation: 'name1---9',
          rotated: false
        },
        {
          // one byte apart at Ei scale: a double cannot tell these two apart
          name: 'rotates on a difference a double would round away',
          wantedSpec: { resources: { requests: { storage: '1Ei' } } },
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', resources: { requests: { storage: '1152921504606846975' } } } }],
          rotation: 'name1---10',
          rotated: true
        },
        {
          name: 'rotates when a chart-set template label differs',
          wantedMeta: { labels: { tier: 'new' } },
          live: [{ metadata: { name: 'data', labels: { tier: 'old' } }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---10',
          rotated: true
        },
        {
          name: 'does not rotate when the template annotations match',
          wantedMeta: { annotations: { owner: 'maps' } },
          live: [{ metadata: { name: 'data', annotations: { owner: 'maps' } }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---9',
          rotated: false
        },
        {
          // the apply would drop it, which is an update to the immutable template
          name: 'rotates when the chart drops a label the live template carries',
          live: [{ metadata: { name: 'data', labels: { tier: 'old' } }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---10',
          rotated: true
        },
        {
          // an omitted mode means Filesystem, so a live Block is drift
          name: 'rotates when the chart omits the mode and the live claim is Block',
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', volumeMode: 'Block', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---10',
          rotated: true
        },
        {
          name: 'rotates when the chart drops the volume attributes class',
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', volumeAttributesClassName: 'old', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---10',
          rotated: true
        },
        {
          // the chart leaves the class to the cluster, so the class it was given is not drift
          name: 'still does not compare a class the chart leaves out',
          wantedClass: null,
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'standard-rwo', volumeMode: 'Filesystem', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---9',
          rotated: false
        },
        {
          name: 'rotates when the live volume attributes class differs',
          wantedSpec: { volumeAttributesClassName: 'new' },
          live: [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'dynamic-rwo', volumeAttributesClassName: 'old', resources: { requests: { storage: '180Gi' } } } }],
          rotation: 'name1---10',
          rotated: true
        }
      ].map(tt => ({
        name: tt.name,
        run: async () => {
          const ctx = { info () {}, rotated: false, namespace: 'ns' }
          const asked = []
          const lib = {
            K8s: {
              // the release record and the new manifest differ in the template only
              diff () { return { spec: { template: { metadata: {} } } } },
              getCurrentRotations () { return { rotation: 9, exists: true, names: ['name1---9'], items: [{ kind: 'StatefulSet', metadata: { name: 'name1---9' } }] } },
              getLiveReplicas () { return 2 },
              getLiveVolumeClaimTemplates (ctx, name) { asked.push(name); return tt.live }
            }
          }
          const p = new Default(lib)
          const claim = { metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '180Gi' } } } }
          if (tt.wantedClass !== null) {
            claim.spec.storageClassName = 'dynamic-rwo'
          }
          Object.assign(claim.spec, tt.wantedSpec || {})
          Object.assign(claim.metadata, tt.wantedMeta || {})
          const oldManifest = [
            {
              kind: 'StatefulSet',
              metadata: { name: 'name1', labels: {} },
              spec: {
                replicas: 2,
                template: { metadata: { labels: {} }, spec: { containers: [{ image: 'haha:1' }] } },
                volumeClaimTemplates: [claim]
              }
            }
          ]
          const newManifest = JSON.parse(JSON.stringify(oldManifest))

          const toRemoves = await p.rotateManifest(ctx, oldManifest, newManifest, {})
          assert.deepEqual(asked, ['name1---9'])
          assert.equal(newManifest[0].metadata.name, tt.rotation)
          assert.equal(Boolean(ctx.rotated), tt.rotated)
          // after a rotation the replaced StatefulSet is removed
          assert.deepEqual(toRemoves.map(r => r.name), tt.rotated ? ['name1---9'] : [])
        }
      }))
    ]
  })
})
