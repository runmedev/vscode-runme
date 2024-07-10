import { window } from 'vscode'
import { fromIni } from '@aws-sdk/credential-providers'
import { AwsCredentialIdentityProvider } from '@smithy/types'

import { OutputType } from '../../constants'
import { AWSResolver, AWSSupportedView } from '../resolvers/awsResolver'
import { RunProgramOptions } from '../runner'
import { getAnnotations } from '../utils'

import { getEC2InstanceDetail, listEC2Instances } from './aws/ec2'
import { getCluster, listClusters } from './aws/eks'
import { resolveProgramOptionsScript } from './runner'

import { IKernelExecutor } from '.'

export const aws: IKernelExecutor = async (executor) => {
  const { cellText, exec, runner, runnerEnv, doc, outputs, context } = executor

  const annotations = getAnnotations(exec.cell)

  try {
    const cellId = annotations['id'] ?? ''
    const text = cellText ?? ''
    const awsResolver = new AWSResolver(text).get()
    if (!awsResolver?.data.region) {
      throw new Error('Could not resolve AWS resource')
    }

    let credentials: AwsCredentialIdentityProvider

    if (!runner) {
      throw new Error('Runner not found')
    }

    const programOptions: RunProgramOptions = await resolveProgramOptionsScript({
      exec,
      execKey: 'aws',
      runnerEnv,
      runningCell: doc,
      runner,
      cellId,
    })

    // todo(sebastian): move down into kernel?
    switch (programOptions.exec?.type) {
      case 'script':
        {
          programOptions.exec.script = 'echo $AWS_PROFILE'
        }
        break
    }

    const program = await runner.createProgramSession(programOptions)
    context.subscriptions.push(program)

    let execRes: string | undefined
    const onData = (data: string | Uint8Array) => {
      if (execRes === undefined) {
        execRes = ''
      }
      execRes += data.toString()
    }

    program.onDidWrite(onData)
    program.onDidErr(onData)
    program.run()

    const success = await new Promise<boolean>((resolve, reject) => {
      program.onDidClose(async (code) => {
        if (code !== 0) {
          return resolve(false)
        }
        return resolve(true)
      })

      program.onInternalErr((e) => {
        reject(e)
      })

      const exitReason = program.hasExited()

      // unexpected early return, likely an error
      if (exitReason) {
        switch (exitReason.type) {
          case 'error':
            {
              reject(exitReason.error)
            }
            break

          case 'exit':
            {
              resolve(exitReason.code === 0)
            }
            break

          default: {
            resolve(false)
          }
        }
      }
    })

    const profile = success ? execRes?.trim() : 'default'
    credentials = fromIni({ profile })

    switch (awsResolver.view) {
      case AWSSupportedView.EC2Instances: {
        const instances = await listEC2Instances(credentials, awsResolver.data.region)
        outputs.setState({
          type: OutputType.aws,
          state: {
            cellId: exec.cell.metadata['runme.dev/id'],
            view: awsResolver.view,
            region: awsResolver.data.region,
            instances,
          },
        })
        await outputs.showOutput(OutputType.aws)
        break
      }

      case AWSSupportedView.EC2InstanceDetails: {
        const instanceDetails = await getEC2InstanceDetail(
          credentials,
          awsResolver.data.region,
          awsResolver.data.instanceId!,
        )
        outputs.setState({
          type: OutputType.aws,
          state: {
            cellId: exec.cell.metadata['runme.dev/id'],
            view: awsResolver.view,
            region: awsResolver.data.region,
            instanceDetails,
          },
        })
        await outputs.showOutput(OutputType.aws)
        break
      }

      case AWSSupportedView.EKSClusters: {
        /**
         * EKS Details and Clusters shares the same URL.
         */
        if (awsResolver.data.cluster) {
          const cluster = await getCluster(
            credentials,
            awsResolver.data.region,
            awsResolver.data.cluster,
          )
          outputs.setState({
            type: OutputType.aws,
            state: {
              cellId: exec.cell.metadata['runme.dev/id'],
              view: awsResolver.view,
              region: awsResolver.data.region,
              cluster,
            },
          })
        } else {
          const clusters = await listClusters(credentials, awsResolver.data.region)
          outputs.setState({
            type: OutputType.aws,
            state: {
              cellId: exec.cell.metadata['runme.dev/id'],
              view: awsResolver.view,
              region: awsResolver.data.region,
              clusters,
            },
          })
        }

        await outputs.showOutput(OutputType.aws)
        break
      }
    }
    return true
  } catch (error: any) {
    window.showErrorMessage(`Failed to get AWS data, reason: ${error.message}`)
    return false
  }
}
