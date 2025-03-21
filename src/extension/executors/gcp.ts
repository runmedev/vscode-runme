import { window } from 'vscode'

import { OutputType } from '../../constants'
import { GCPResolver, GCPSupportedView } from '../resolvers/gcpResolver'

import { getClusterDetails, getClusters } from './gcp/gke/clusters'
import { getVMInstances, getVMInstanceDetail, getDisk } from './gcp/gce/vmInstances'
import { listRevisions } from './gcp/run'

import { IKernelExecutor } from '.'

export const gcp: IKernelExecutor = async (executor) => {
  const { cellText, exec, outputs } = executor

  try {
    const text = cellText ?? ''
    const gcpResolver = new GCPResolver(text).get()
    if (!gcpResolver?.data.project) {
      throw new Error('Could not resolve Google Cloud Platform resource')
    }

    switch (gcpResolver.view) {
      case GCPSupportedView.CLUSTERS: {
        const clusters = await getClusters(gcpResolver.data.project)
        outputs.setState({
          type: OutputType.gcp,
          state: {
            project: gcpResolver.data.project,
            view: gcpResolver.view,
            cellId: exec.cell.metadata['runme.dev/id'],
            clusters,
          },
        })
        await outputs.showOutput(OutputType.gcp)
        break
      }

      case GCPSupportedView.CLUSTER: {
        const { cluster, location, project } = gcpResolver.data
        const clusterDetails = await getClusterDetails(cluster, location, project)
        outputs.setState({
          type: OutputType.gcp,
          state: {
            project: gcpResolver.data.project,
            view: gcpResolver.view,
            cellId: exec.cell.metadata['runme.dev/id'],
            cluster,
            clusterDetails,
            location,
          },
        })
        await outputs.showOutput(OutputType.gcp)
        break
      }

      case GCPSupportedView.VM_INSTANCES: {
        const { project } = gcpResolver.data
        const instances = await getVMInstances(project)
        outputs.setState({
          type: OutputType.gcp,
          state: {
            project: gcpResolver.data.project,
            view: gcpResolver.view,
            cellId: exec.cell.metadata['runme.dev/id'],
            instances,
          },
        })
        await outputs.showOutput(OutputType.gcp)
        break
      }

      case GCPSupportedView.VM_INSTANCE: {
        const { project, instance, location } = gcpResolver.data
        const vmInstance = await getVMInstanceDetail(project, instance, location)

        if (Array.isArray(vmInstance)) {
          throw new Error('Could not resolve Google Cloud Platform resource')
        }

        const promises = vmInstance?.disks?.map(async (disk) => {
          const deviceName = disk.boot ? vmInstance.name : disk.deviceName
          return await getDisk(project, location, deviceName!)
        })

        const disks = await Promise.all(promises!)

        outputs.setState({
          type: OutputType.gcp,
          state: {
            project: gcpResolver.data.project,
            view: gcpResolver.view,
            cellId: exec.cell.metadata['runme.dev/id'],
            disks: disks,
            instance: vmInstance,
          },
        })
        await outputs.showOutput(OutputType.gcp)
        break
      }

      case GCPSupportedView.CLOUD_RUN_SERVICES: {
        outputs.setState({
          type: OutputType.gcp,
          state: {
            project: gcpResolver.data.project,
            view: gcpResolver.view,
            cellId: exec.cell.metadata['runme.dev/id'],
          },
        })
        await outputs.showOutput(OutputType.gcp)
        break
      }

      case GCPSupportedView.CLOUD_RUN_REVISIONS: {
        const { project, service, region } = gcpResolver.data
        const revisions = await listRevisions({
          project,
          service,
          location: region,
        })
        outputs.setState({
          type: OutputType.gcp,
          state: {
            project,
            service,
            view: gcpResolver.view,
            cellId: exec.cell.metadata['runme.dev/id'],
            revisions,
            region,
          },
        })
        await outputs.showOutput(OutputType.gcp)
        break
      }
    }
    return true
  } catch (error: any) {
    window.showErrorMessage(`Failed to get Google Cloud resource data, reason: ${error.message}`)
    return false
  }
}
