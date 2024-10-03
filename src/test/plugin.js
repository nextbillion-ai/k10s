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
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: false, names: [] } }
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
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: false, names: [] } }
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
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: false, names: [] } }
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
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: false, names: [] } }
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
              getCurrentRotations (ctx, stsName) { return { rotation: 0, exists: true, names: [] } }
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
