import {
  DuplexStreamingCall,
  RpcError,
  RpcOptions,
  RpcTransport,
  ServerStreamingCall,
  UnaryCall,
} from '@protobuf-ts/runtime-rpc'
// eslint-disable-next-line max-len
import { ParserServiceClient } from '@buf/runmedev_runme.community_timostamm-protobuf-ts/runme/parser/v1/parser_pb.client'
// eslint-disable-next-line max-len
import { RunnerServiceClient as RunnerServiceClientV1 } from '@buf/runmedev_runme.community_timostamm-protobuf-ts/runme/runner/v1/runner_pb.client'
// eslint-disable-next-line max-len
import { RunnerServiceClient as RunnerServiceClientV2 } from '@buf/runmedev_runme.community_timostamm-protobuf-ts/runme/runner/v2/runner_pb.client'
// eslint-disable-next-line max-len
import { ProjectServiceClient } from '@buf/runmedev_runme.community_timostamm-protobuf-ts/runme/project/v1/project_pb.client'
// eslint-disable-next-line max-len
import { ReporterServiceClient } from '@buf/runmedev_runme.community_timostamm-protobuf-ts/runme/reporter/v1alpha1/reporter_pb.client'
// eslint-disable-next-line max-len
import { NotebookServiceClient } from '@buf/runmedev_runme.community_timostamm-protobuf-ts/runme/notebook/v1alpha1/notebook_pb.client'
import { HealthClient } from '@buf/grpc_grpc.community_timostamm-protobuf-ts/grpc/health/v1/health_pb.client'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import {
  TransformRequest,
  TransformResponse,
} from '@buf/runmedev_runme.community_timostamm-protobuf-ts/runme/reporter/v1alpha1/reporter_pb'

import { getServerRunnerVersion } from '../../utils/configuration'

import {
  CreateSessionRequest,
  CreateSessionResponse,
  GetSessionRequest,
  GetSessionResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  UpdateSessionRequest,
  UpdateSessionResponse,
  DeleteSessionRequest,
  DeleteSessionResponse,
  MonitorEnvStoreRequest,
  MonitorEnvStoreResponse,
  ResolveProgramRequest,
  ResolveProgramResponse,
  ExecuteRequest,
  ExecuteResponse,
} from './runner/types'

interface IRunnerServiceClient {
  createSession(
    input: CreateSessionRequest,
    options?: RpcOptions,
  ): UnaryCall<CreateSessionRequest, CreateSessionResponse>

  getSession(
    input: GetSessionRequest,
    options?: RpcOptions,
  ): UnaryCall<GetSessionRequest, GetSessionResponse>

  listSessions(
    input: ListSessionsRequest,
    options?: RpcOptions,
  ): UnaryCall<ListSessionsRequest, ListSessionsResponse>

  updateSession?(
    input: UpdateSessionRequest,
    options?: RpcOptions,
  ): UnaryCall<UpdateSessionRequest, UpdateSessionResponse>

  deleteSession(
    input: DeleteSessionRequest,
    options?: RpcOptions,
  ): UnaryCall<DeleteSessionRequest, DeleteSessionResponse>

  monitorEnvStore(
    input: MonitorEnvStoreRequest,
    options?: RpcOptions,
  ): ServerStreamingCall<MonitorEnvStoreRequest, MonitorEnvStoreResponse>

  execute(options?: RpcOptions): DuplexStreamingCall<ExecuteRequest, ExecuteResponse>

  resolveProgram(
    input: ResolveProgramRequest,
    options?: RpcOptions,
  ): UnaryCall<ResolveProgramRequest, ResolveProgramResponse>
}

function initParserClient(transport: GrpcTransport): ParserServiceClient {
  return new ParserServiceClient(transport)
}

function initProjectClient(transport: GrpcTransport): ProjectServiceClient {
  return new ProjectServiceClient(transport)
}

function initReporterClient(transport: GrpcTransport): ReporterServiceClient {
  return new ReporterServiceClient(transport)
}

function initNotebookClient(transport: GrpcTransport): NotebookServiceClient {
  return new NotebookServiceClient(transport)
}

type ReadyPromise = Promise<void | Error>

function getRunnerServiceClient(transport: RpcTransport): IRunnerServiceClient {
  if (getServerRunnerVersion() === 'v1') {
    return new RunnerServiceClientV1(transport) as any
  }
  return new RunnerServiceClientV2(transport) as any
}

export {
  ParserServiceClient,
  IRunnerServiceClient,
  getRunnerServiceClient,
  ProjectServiceClient,
  initParserClient,
  initProjectClient,
  initReporterClient,
  initNotebookClient,
  NotebookServiceClient,
  HealthClient,
  ReadyPromise,
  RpcError,
  ReporterServiceClient,
  TransformRequest,
  TransformResponse,
}
