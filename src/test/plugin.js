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
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: true, names: [], items: [] } }
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
      }
    ]
  })
})
