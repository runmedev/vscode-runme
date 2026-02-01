import container from '@google-cloud/container'
import compute from '@google-cloud/compute'
import { KubeConfig, CoreV1Api } from '@kubernetes/client-node'

import { GcpGkeCluster } from '../../../../types'

const CLUSTER_PROGRESS_STATUS = ['PROVISIONING', 'RECONCILING', 'STOPPING']

export type OnClusterStatusUpdate = (clusterId: string, status: string) => void

export interface ClusterStatus {
  clusterId: string
  clusterName: string
  currentStatus: string
  projectId: string
  location: string
  onClusterStatus: OnClusterStatusUpdate
}

export function getClusterLink(zone: string, cluster: string, project: string) {
  return `https://console.cloud.google.com/kubernetes/clusters/details/${zone}/${cluster}/details?project=${project}`
}

export async function getClusters(
  project: string,
  useDefaultProject: boolean = false,
): Promise<GcpGkeCluster[] | undefined> {
  const oneGbInMb = 1024
  const clusterManagement = new container.v1.ClusterManagerClient()
  const machineTypes = new compute.v1.MachineTypesClient()
  const projectId = useDefaultProject ? await clusterManagement.getProjectId() : project

  const [response] = await clusterManagement.listClusters({
    projectId: projectId,
    zone: '-',
  })

  if (!response.clusters) {
    return
  }

  const clusters: GcpGkeCluster[] = []

  for await (const cluster of response.clusters) {
    if (cluster.nodeConfig && !cluster.autopilot?.enabled) {
      const location = cluster.location || ''
      const zones = cluster.locations || [location]

      let totalVCpus = 0
      let totalMemoryMb = 0

      for (const zone of zones) {
        const machineType = await machineTypes.get({
          machineType: cluster.nodeConfig.machineType,
          project: projectId,
          zone: zone,
        })

        if (!machineType.length) {
          continue
        }

        const [{ guestCpus, memoryMb }] = machineType
        const nodeCount = cluster.currentNodeCount || 0

        totalVCpus += (guestCpus || 0) * nodeCount
        totalMemoryMb += (memoryMb || 0) * nodeCount
      }

      clusters.push({
        clusterId: cluster.id!,
        status: (cluster.status || 'STATUS_UNSPECIFIED') as any,
        name: cluster.name || '',
        location: location,
        mode: 'Standard',
        nodes: cluster.currentNodeCount || 0,
        clusterLink: getClusterLink(cluster.location!, cluster.name!, projectId),
        vCPUs: totalVCpus,
        totalMemory: totalMemoryMb / oneGbInMb,
        labels: cluster.resourceLabels,
        statusMessage: cluster.statusMessage,
      })
    } else {
      clusters.push({
        clusterId: cluster.id!,
        status: (cluster.status || 'STATUS_UNSPECIFIED') as any,
        name: cluster.name || '',
        location: cluster.location || '',
        mode: cluster.autopilot?.enabled ? 'Autopilot' : 'Standard',
        nodes: cluster.currentNodeCount || 0,
        clusterLink: getClusterLink(cluster.location!, cluster.name!, projectId),
        vCPUs: 0,
        totalMemory: 0,
        labels: cluster.resourceLabels,
        statusMessage: cluster.statusMessage,
      })
    }
  }
  return clusters
}

export async function getCluster(clusterName: string, location: string, project: string) {
  try {
    const clusterManagement = new container.v1.ClusterManagerClient()
    const cluster = await clusterManagement.getCluster({
      name: `projects/${project}/locations/${location}/clusters/${clusterName}`,
    })
    return cluster
  } catch (_error) {
    return [] // Prevent errors when fetching a removed cluster
  }
}

type NodeInfo = {
  name: string
  instanceStatus: string
  cpuRequested?: string
  cpuAllocatable?: string
  memoryRequested?: string
  memoryAllocatable?: string
  storageRequested?: string
  storageAllocatable?: string
}

/**
 * Get full cluster details including Nodes information.
 * Response is mapped to reflect cluster details in Google Cloud Console.
 */
export async function getClusterDetails(clusterName: string, location: string, project: string) {
  try {
    const clusterManagement = new container.v1.ClusterManagerClient()
    const response = await clusterManagement.getCluster({
      name: `projects/${project}/locations/${location}/clusters/${clusterName}`,
    })

    const [cluster] = response
    const instanceGroupsUrls = cluster.instanceGroupUrls || []

    let gcloudNodes: NodeInfo[] = []

    for (const instanceGroupUrl of instanceGroupsUrls) {
      const parts = instanceGroupUrl.split('/')
      const instanceGroupName = parts.pop()
      const zone = parts[parts.indexOf('zones') + 1]
      if (!zone) {
        continue
      }

      const instancesClient = new compute.v1.InstanceGroupManagersClient()
      const [instances] = await instancesClient.listManagedInstances({
        project: project,
        zone: zone,
        instanceGroupManager: instanceGroupName,
      })

      const nodes: NodeInfo[] = instances.map((instance) => ({
        name: instance?.name?.split('/').pop()!,
        instanceStatus: instance.instanceStatus as string,
      }))

      gcloudNodes.push(...nodes)
    }

    const k8sClusterName = `gke_${project}_${location}_${cluster.name}`
    const kubeConfig = new KubeConfig()
    kubeConfig.loadFromDefault()

    const context = kubeConfig.getContexts().find((context) => context.cluster === k8sClusterName)
    if (context) {
      kubeConfig.setCurrentContext(context.name)
    }

    const coreV1Api = kubeConfig.makeApiClient(CoreV1Api)
    const k8sNodes = await coreV1Api.listNode()

    const clusterNodes = gcloudNodes.map((gcloudNode) => {
      const node = k8sNodes.items.find((node) => node.metadata?.name === gcloudNode.name)
      if (!node) {
        return gcloudNode
      }

      return {
        ...gcloudNode,
        cpuRequested: '-',
        cpuAllocatable: node?.status?.allocatable?.cpu,
        memoryRequested: node?.status?.capacity?.memory,
        memoryAllocatable: node?.status?.allocatable?.memory,
        storageRequested: node?.status?.capacity?.['ephemeral-storage'],
        storageAllocatable: node?.status?.allocatable?.['ephemeral-storage'],
      }
    })

    return {
      itFailed: false,
      data: {
        clusterBasics: {
          name: cluster.name,
          locationType: cluster.location,
          releaseChannel: cluster.releaseChannel?.channel,
          version: cluster.currentMasterVersion,
          totalSize: cluster.initialNodeCount,
          externalEndpoint: cluster.privateClusterConfig?.publicEndpoint || cluster.endpoint,
          privateEndpoint: cluster.privateClusterConfig?.privateEndpoint,
          clusterCertificate: cluster.masterAuth?.clusterCaCertificate,
          basicCredentialsEnabled: !!cluster.masterAuth?.password,
          nodePools: cluster.nodePools?.map((nodePool) => {
            return {
              name: nodePool.name,
              status: nodePool.status,
              version: nodePool.version,
              numberOfNodes: nodePool.initialNodeCount,
              machineType: nodePool.config?.machineType,
              imageType: nodePool.config?.imageType,
              autoscaling: nodePool.autoscaling?.enabled,
              ipv4PodAddressRange: nodePool.networkConfig?.podIpv4CidrBlock,
            }
          }),
          clusterNodes,
        },
        automation: {
          maintenance: cluster.maintenancePolicy?.window,
          notifications: cluster.notificationConfig?.pubsub,
          verticalPodAutoscaling: cluster.verticalPodAutoscaling,
          autoscaling: cluster.autoscaling,
        },
        networking: {
          privateCluster: cluster.privateClusterConfig,
          subnetwork: cluster.subnetwork,
          network: cluster.network,
          stackType: cluster.ipAllocationPolicy?.stackType,
          subnetDetails: cluster.ipAllocationPolicy,
          intranodeVisibility: cluster.networkConfig?.enableIntraNodeVisibility,
          httpLoadBalancingEnabled: !cluster.addonsConfig?.httpLoadBalancing?.disabled,
          l4InternalLoadBalancer: cluster.networkConfig?.enableL4ilbSubsetting,
          subsettingL4InternalLoadBalancers: cluster.masterAuthorizedNetworksConfig?.enabled,
          dns: cluster.networkConfig?.dnsConfig,
          gatewayApi: cluster.networkConfig?.gatewayApiConfig,
          multinetworking: cluster.networkConfig?.enableMultiNetworking,
        },
        security: {
          binaryAuthorization: cluster.binaryAuthorization,
          shieldedNodes: cluster.shieldedNodes?.enabled,
          confidentialNodes: cluster.confidentialNodes?.enabled,
          workloadIdentity: cluster.identityServiceConfig?.enabled,
          clientCertificate: cluster.masterAuth?.clientCertificate,
        },
        metadata: {
          tags: cluster.nodeConfig?.tags,
          labels: cluster.resourceLabels,
          logging: cluster.loggingConfig,
          prometheus: cluster.monitoringConfig?.managedPrometheusConfig?.enabled,
          cloudTpu: cluster.enableTpu,
          kubernetesAlpha: cluster.enableKubernetesAlpha,
          costAllocation: cluster.costManagementConfig,
          usageMetering: cluster.resourceUsageExportConfig,
          backupForGCP: cluster.addonsConfig?.gkeBackupAgentConfig?.enabled,
          configConnector: cluster.addonsConfig?.configConnectorConfig?.enabled,
          discCSIDriver: cluster.addonsConfig?.gcpFilestoreCsiDriverConfig?.enabled,
        },
      },
    }
  } catch (error: any) {
    return { itFailed: true, reason: error.message }
  }
}

/**
 * Waits until a cluster status is in final state
 */
export async function waitForClusterStatus({
  clusterId,
  currentStatus,
  clusterName,
  projectId,
  location,
  onClusterStatus,
}: ClusterStatus) {
  if (!CLUSTER_PROGRESS_STATUS.includes(currentStatus as string)) {
    return onClusterStatus(clusterId, currentStatus)
  }
  const [cluster] = await getCluster(clusterName, location, projectId)
  if (!cluster) {
    return onClusterStatus(clusterId, 'STOPPED')
  }
  return waitForClusterStatus({
    clusterId,
    currentStatus: cluster.status as string,
    clusterName,
    projectId,
    location,
    onClusterStatus,
  })
}
