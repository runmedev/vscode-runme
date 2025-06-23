import { DuplexStreamingCall } from '@protobuf-ts/runtime-rpc'

import { getServerRunnerVersion } from '../../../utils/configuration'

import * as v2 from './v2'
import * as v1 from './v1'

export type ResolveProgramResponse_VarResult =
  | v1.ResolveProgramResponse_VarResult
  | v2.ResolveProgramResponse_VarResult

export type ResolveProgramRequest_Mode =
  | v1.ResolveProgramRequest_Mode
  | v2.ResolveProgramRequest_Mode

export const ResolveProgramRequest_ModeEnum = () => {
  if (v2.matches(getServerRunnerVersion())) {
    return v2.ResolveProgramRequest_Mode
  }
  return v1.ResolveProgramRequest_Mode
}

export type ResolveProgramRequest_Retention =
  | v1.ResolveProgramRequest_Retention
  | v2.ResolveProgramRequest_Retention

export const ResolveProgramRequest_RetentionEnum = () => {
  if (v2.matches(getServerRunnerVersion())) {
    return v2.ResolveProgramRequest_Retention
  }
  return v1.ResolveProgramRequest_Retention
}

export type CommandMode = v1.CommandMode | v2.progconf.CommandMode

export const CommandModeEnum = () => {
  if (v2.matches(getServerRunnerVersion())) {
    return {
      TEMP_FILE: v2.progconf.CommandMode.FILE,
      INLINE_SHELL: v2.progconf.CommandMode.INLINE,
      DAGGER: v2.progconf.CommandMode.UNSPECIFIED, // revisit impl in v2
      TERMINAL: v2.progconf.CommandMode.TERMINAL,
    }
  }
  return v1.CommandMode
}

export type ResolveProgramResponse_Status =
  | v1.ResolveProgramResponse_Status
  | v2.ResolveProgramResponse_Status

export const ResolveProgramResponse_StatusEnum = () => {
  if (v2.matches(getServerRunnerVersion())) {
    return v2.ResolveProgramResponse_Status
  }
  return v1.ResolveProgramResponse_Status
}

export type ExecuteRequest = v1.ExecuteRequest | v2.ExecuteRequest
export type ExecuteResponse = v1.ExecuteResponse | v2.ExecuteResponse

export type ExecuteDuplex = DuplexStreamingCall<ExecuteRequest, ExecuteResponse>

export type Session = v1.Session | v2.Session

export type ExecuteStop = v1.ExecuteStop | v2.ExecuteStop

export type CreateSessionRequest =
  | (v1.CreateSessionRequest & { env: string[] })
  | (v2.CreateSessionRequest & { envs: string[] })
export type CreateSessionResponse = v1.CreateSessionResponse | v2.CreateSessionResponse

export type GetSessionRequest = v1.GetSessionRequest | v2.GetSessionRequest
export type GetSessionResponse = v1.GetSessionResponse | v2.GetSessionResponse

export type ListSessionsRequest = v1.ListSessionsRequest | v2.ListSessionsRequest
export type ListSessionsResponse = v1.ListSessionsResponse | v2.ListSessionsResponse

export type UpdateSessionRequest = v2.UpdateSessionRequest
export type UpdateSessionResponse = v2.UpdateSessionResponse

export type DeleteSessionRequest = v1.DeleteSessionRequest | v2.DeleteSessionRequest
export type DeleteSessionResponse = v1.DeleteSessionResponse | v2.DeleteSessionResponse

export type MonitorEnvStoreRequest =
  | v1.MonitorEnvStoreRequest
  | (v2.MonitorEnvStoreRequest & { session: { envs: string[] } })
export type MonitorEnvStoreResponse = v1.MonitorEnvStoreResponse | v2.MonitorEnvStoreResponse

export type ResolveProgramRequest = v1.ResolveProgramRequest | v2.ResolveProgramRequest
export type ResolveProgramResponse = v1.ResolveProgramResponse | v2.ResolveProgramResponse

export type SessionEnvStoreType = v1.SessionEnvStoreType | v2.SessionEnvStoreType

export type Winsize = v1.Winsize | v2.Winsize

export const CreateSessionRequestImpl: () =>
  | typeof v1.CreateSessionRequest
  | typeof v2.CreateSessionRequest = () => {
  if (v2.matches(getServerRunnerVersion())) {
    return v2.CreateSessionRequest
  }
  return v1.CreateSessionRequest
}

export const SessionEnvStoreSeedingEnum = () => {
  return v2.CreateSessionRequest_Config_SessionEnvStoreSeeding
}

export const GetSessionRequestImpl: () =>
  | typeof v1.GetSessionRequest
  | typeof v2.GetSessionRequest = () => {
  if (v2.matches(getServerRunnerVersion())) {
    return v2.GetSessionRequest
  }
  return v1.GetSessionRequest
}

export const ExecuteRequestImpl: () => typeof v1.ExecuteRequest | typeof v2.ExecuteRequest = () => {
  if (v2.matches(getServerRunnerVersion())) {
    return v2.ExecuteRequest
  }
  return v1.ExecuteRequest
}

export const ExecuteStopEnum: () => typeof v1.ExecuteStop | typeof v2.ExecuteStop = () => {
  if (v2.matches(getServerRunnerVersion())) {
    return v2.ExecuteStop
  }
  return v1.ExecuteStop
}

export const WinsizeImpl: () => typeof v1.Winsize | typeof v2.Winsize = () => {
  if (v2.matches(getServerRunnerVersion())) {
    return v2.Winsize
  }
  return v1.Winsize
}

export const ResolveProgramRequestImpl: () =>
  | typeof v1.ResolveProgramRequest
  | typeof v2.ResolveProgramRequest = () => {
  if (v2.matches(getServerRunnerVersion())) {
    return v2.ResolveProgramRequest
  }
  return v1.ResolveProgramRequest
}
