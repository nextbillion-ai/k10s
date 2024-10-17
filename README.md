# Project K10S

## The Name
**k10s** works on top of **k8s**, to rollout/uninstall resources. More specifically it utilizes following software:

 1. [kubectl](https://kubernetes.io/docs/reference/kubectl/)
 2. [helm](https://helm.sh/)
 3. [gsg](https://github.com/nextbillion-ai/gsg)

> Note: you need all these binaries locatable in `PATH` before you can use **k10s**

## The Config
```
basePath: gs://<bucket-and-path-to-k10s>
cluster: <cluster-name>
namespaceVersion: <namespace-version>
globalSpecPlugins: []
```

### basePath
a gcs path that stores all `assets` and `resources`, see `The Concepts` section below.

### cluster
name of the k8s `cluster` for `resource` identification purpose, see `Resource` section under `The Concepts` below.

### namespaceVersion
verison of namespace `asset`, which will be used to create namespace if not exists.

## The Concepts
### Asset
Assets are proper **named and versioned** helm charts.
An Asset is stored in `<base-path>/foreman/operator/assets/<asset-name>/releases/<asset-version>/`
under the above path, there are always 2 files: 

 1. chart.tgz
 2. schema.json

where schema.json is [json schema](https://json-schema.org/) of configurable values of chart.

### Resource
Resources are combination of an `asset` and `values`.
```
asset:
  type: gateway
  release: 1.0.20
app:
  ...
```

> NOTE: object `app` has configurable values of the **asset** (helm chart with specific version) and will be validated against **asset schema**

resources are stored in `<base-path>/foreman/operator/resources/<cluster-name>/<namespace>/<resource-name>.yaml`

## Install and Run
### Install
`yarn global add @nbai/k19s`

### Run
 - make sure your `kubectl` is configured to access the target clsuter
 - create a proper `~/.k10s.yaml` config file.

`k10s rollout <namespace>/<resource-name> -f resource.yaml`
where `resource.yaml` contains the resource definition, if `-f` argument is not supplied, `k10s` will try to download and use from resource gcs path. `k10s` will always upload the resource to its path during rolling out.
`k10s uninstall <namespace>/<resource-name>`
`k10s` will uninstall all k8s objects installed perviously under the <resource-name> in the <namespace>