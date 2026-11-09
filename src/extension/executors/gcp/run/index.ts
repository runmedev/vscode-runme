import { RevisionsClient, ServicesClient } from '@google-cloud/run'
import { google } from '@google-cloud/run/build/protos/protos'

import { GcpCloudRunService } from '../../../../types'
import { getActiveRegions } from '../utils'

import { CloudRunListRevisionsOptions, CloudRunListServiceOptions, Revision } from './types'

export function getIngressDisplayName(
  ingress:
    google.cloud.run.v2.IngressTraffic | keyof typeof google.cloud.run.v2.IngressTraffic | null,
): string {
  switch (ingress) {
    case 'INGRESS_TRAFFIC_ALL':
      return 'All'
    case 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER':
      return 'Load balancer (Internal)'
    case 'INGRESS_TRAFFIC_INTERNAL_ONLY':
      return 'Internal only'
    default:
      return 'Unspecified'
  }
}

export type OnServicesLoaded = (
  region: string,
  services: GcpCloudRunService[],
  hasError: boolean,
  error?: string | undefined,
) => void

export type OnAllServicesLoaded = (hasError: boolean, error?: string | undefined) => void

export async function listServices({
  project,
  onServicesLoaded,
  onAllServicesLoaded,
}: {
  project: string
  onServicesLoaded: OnServicesLoaded
  onAllServicesLoaded: OnAllServicesLoaded
}) {
  try {
    const regions = await getActiveRegions(project)
    if (!regions) {
      throw new Error(
        'Failed to get active regions, please try again or review Google Cloud Service Health',
      )
    }

    for await (const region of regions) {
      try {
        const locationServices = await listServicesByLocation({
          project,
          location: region,
        })

        onServicesLoaded(region, locationServices, false)
      } catch (error) {
        onServicesLoaded(region, [], true, (error as any).message)
      }
    }

    onAllServicesLoaded(false)
  } catch (error) {
    onAllServicesLoaded(true, (error as any).message)
  }
}

export async function listServicesByLocation({ project, location }: CloudRunListServiceOptions) {
  const client = new ServicesClient()
  const request = {
    parent: `projects/${project}/locations/${location}`,
    pageSize: 100,
  }
  const [services] = await client.listServices(request)

  return services.map((service) => {
    const serviceName = service.name?.split('/')
    return {
      creator: service.creator || 'unknown',
      lastModifier: service.lastModifier,
      name: service.name,
      uri: service.uri,
      updateTime: service.updateTime?.seconds,
      ingress: service.ingress,
      ingressDisplayName: service.ingress ? getIngressDisplayName(service.ingress) : 'unknown',
      serviceName: serviceName?.length ? serviceName.pop() : 'unknown',
      region: location,
      isHealthy: service.conditions?.some((condition) => condition.state !== 'CONDITION_SUCCEEDED')
        ? false
        : true,
    }
  }) as GcpCloudRunService[]
}

export function getArtifactRegistryUrl(image: string): URL {
  const imageParts = image.split('/')
  const region = imageParts[0].split('-')[0]
  const [container, hash] = imageParts[imageParts.length - 1].split('@')

  return new URL(
    `https://console.cloud.google.com/artifacts/docker/cloudrun/${region}/container/${container}/${hash}`,
  )
}

export async function listRevisions({
  project,
  service,
  location,
}: CloudRunListRevisionsOptions): Promise<Revision[]> {
  const revisionsClient = new RevisionsClient()
  const [revisions] = await revisionsClient.listRevisions({
    parent: `projects/${project}/locations/${location}/services/${service}`,
  })

  const result = revisions.map((revision) => {
    return {
      containers: revision.containers?.map((container) => {
        return {
          name: container.name || 'unknown',
          image: container.image || 'unknown',
          port: container.ports?.length ? container.ports[0].containerPort : undefined,
          startupCpuBoost: container.resources?.startupCpuBoost,
          cpu: container.resources?.limits?.cpu,
          memory: container.resources?.limits?.memory,
          env: container.env,
          artifactRegistryUrl: container.image
            ? getArtifactRegistryUrl(container.image).toString()
            : '',
        }
      }),
      createTime: revision.createTime?.seconds?.toString(),
      uuid: revision.uid,
      name: revision.name?.split('/').pop() || 'none',
      service: revision.service,
      concurrency: revision.maxInstanceRequestConcurrency,
      executionEnvironment:
        revision.executionEnvironment === 'EXECUTION_ENVIRONMENT_UNSPECIFIED'
          ? 'Default'
          : revision.executionEnvironment,
      autoScaling: {
        minInstances: revision.scaling?.minInstanceCount,
        maxInstances: revision.scaling?.maxInstanceCount,
      },
      logUri: revision.logUri,
      timeout: revision.timeout?.seconds?.toString(),
    }
  })

  return result
}
