import { DefaultTreeItem } from 'wdio-vscode-service'
import { Key } from 'webdriverio'

import {
  getRepoBasename,
  tryExecuteCommand,
  clearAllOutputs,
  getTerminalText,
  killAllTerminals,
} from '../helpers/index.js'
import { RunmeNotebook } from '../pageobjects/notebook.page.js'
import { OutputType, StatusBarElements } from '../pageobjects/cell.page.js'

describe('Runme VS Code Extension', async () => {
  let baseName = 'vscode-runme'
  before(async () => {
    baseName = await getRepoBasename()
  })
  it('should load successfully', async () => {
    const workbench = await browser.getWorkbench()
    const title = await workbench.getTitleBar().getTitle()
    expect(title).toContain(baseName)
  })

  it('should re-open Readme.md and validate that it loads as notebook', async () => {
    const workbench = await browser.getWorkbench()
    const sidebar = await workbench.getSideBar()
    const content = await sidebar.getContent()
    const section = await content.getSection(`${baseName.toLocaleUpperCase()}`)

    const filesAndDirs = (await section.getVisibleItems()) as DefaultTreeItem[]
    let readmeFile: DefaultTreeItem | undefined
    for (const file of filesAndDirs) {
      if ((await file.getLabel()) === 'README.md') {
        readmeFile = file
        break
      }
    }

    if (!readmeFile) {
      throw new Error('File with name "Readme.md" not found')
    }
    await readmeFile.select()

    await browser.waitUntil(async () => (await workbench.getAllWebviews()).length > 0, {
      timeoutMsg: "Notebook document didn't load",
    })
    const webview = (await workbench.getAllWebviews())[0]
    await webview.open()
    await expect($('body')).toHaveTextContaining('Runme Examples')
    await webview.close()
  })

  it('should provide a button to fork notebook into terminal', async () => {
    const rows = await $$('.cell-statusbar-container .cell-status-item')
    let row: WebdriverIO.Element | undefined
    for (const r of rows) {
      if ((await r.getText()).includes('Fork')) {
        row = r
      }
    }

    if (!row) {
      throw new Error('Could not find Fork button')
    }
  })

  describe('Runme examples', async () => {
    const notebook = new RunmeNotebook()
    before(async () => {
      await notebook.focusDocument()
      const workbench = await browser.getWorkbench()
      await workbench.executeCommand('clear all notifications')
    })

    beforeEach(async () => {
      const workbench = await browser.getWorkbench()
      await browser.pause(1500)
      await clearAllOutputs(workbench)
      await tryExecuteCommand(workbench, 'kill all terminals')
      await tryExecuteCommand(workbench, 'clear all notifications')
    })

    it('basic hello world, run twice back-to-back', async () => {
      const cell = await notebook.getCell('echo "Hello World!')

      // running 2x to avoid regression with terminal/process disposal
      await cell.run()
      await cell.run()

      expect(await cell.getCellOutput(OutputType.TerminalView)).toStrictEqual(['Hello World!'])
    })

    // TODO: enable this test after releasing shebang support on cli
    // it('basic hello world python execution', async () => {
    //   const cell = await notebook.getCell('print("Hello World")')

    //   await cell.run()

    //   expect(await cell.getCellOutput(OutputType.TerminalView)).toStrictEqual([
    //     'Hello World\n'
    //   ])
    // })

    // TODO: enable this test after releasing shebang support on cli
    // it('basic yaml example', async () => {
    //   const cell = await notebook.getCell('config:\n  nested:\n    para: true')

    //   await cell.run()

    //   await tryExecuteCommand(await browser.getWorkbench(), 'focus active cell output')

    //   expect(await cell.getCellOutput(OutputType.TerminalView)).toStrictEqual([
    //     'config:\nnested:\npara: true\n'
    //   ])
    // })

    it('more shell example', async () => {
      const cell = await notebook.getCell(
        'echo "Foo 👀"\nsleep 2\necho "Bar 🕺"\nsleep 2\necho "Loo 🚀"',
      )
      await cell.run()
      expect(await cell.getCellOutput(OutputType.ShellOutput)).toStrictEqual([
        'Foo 👀\nBar 🕺\nLoo 🚀',
      ])
    })

    it('shebang typescript example', async () => {
      const cell = await notebook.getCell(
        // eslint-disable-next-line max-len
        "function unnest({ message }: { message: string }): void {\n    console.log(message)\n}\nunnest({ message: 'Running typescript that outputs this message' })",
      )
      await cell.run()
      expect(await cell.getCellOutput(OutputType.TerminalView)).toStrictEqual([
        'Running typescript that outputs this message',
      ])
    })

    it('background task example', async () => {
      const cell = await notebook.getCell('sleep 100000')
      await cell.run()

      expect(await cell.getCellOutput(OutputType.TerminalView)).toStrictEqual([''])

      const stopTaskCmd = cell.getStatusBar().getCommand(StatusBarElements.StopTask)

      await stopTaskCmd.waitForExist()
      await stopTaskCmd.waitForClickable()

      await stopTaskCmd!.click()

      // TODO: check to ensure this works
    })

    it.skip('complex output', async () => {
      const cell = await notebook.getCell('npm i -g webdriverio')
      await cell.run()

      // await cell.openTerminal()

      const text = (await cell.getCellOutput(OutputType.TerminalView))[0]

      expect(text).toMatch(/(added|changed) \d+ packages/)
    })

    it.skip('stdin example', async () => {
      const cell = await notebook.getCell('node ./scripts/stdin.js')
      await cell.run(false)

      const workbench = await browser.getWorkbench()
      const bottomBar = workbench.getBottomBar()

      const answer1 = 'I love it, but there is deno'
      const answer2 = 'Great'

      {
        const terminalView = await bottomBar.openTerminalView()
        await terminalView.wait(1000)

        await browser.keys([answer1, Key.Enter, answer2, Key.Enter])
      }

      await cell.getStatusBar().waitForSuccess()

      {
        const text = await getTerminalText(workbench)

        expect(text.includes(`What do you think of Node.js? ${answer1}`)).toBe(true)
        expect(text.includes(`Thank you for your valuable feedback: ${answer1}`)).toBe(true)
        expect(text.includes(`Another question: how are you today? ${answer2}`)).toBe(true)
        expect(text.includes(`I am glad you are feeling: ${answer2}`)).toBe(true)
      }
    })

    // note: can be inconsistent
    it.skip('single line environment variable', async () => {
      {
        const cell = await notebook.getCell('export DENO_ACCESS_TOKEN="<insert-token-here>"')
        await cell.run(false)

        await browser.keys(['token', Key.Enter])

        await cell.focus()

        await cell.getStatusBar().waitForSuccess()
      }

      {
        const cell = await notebook.getCell('echo "DENO_ACCESS_TOKEN: $DENO_ACCESS_TOKEN"')
        await cell.run()

        const output = await cell.getCellOutput(OutputType.ShellOutput)
        expect(output).toHaveLength(1)
        expect(output[0]).toStrictEqual('DENO_ACCESS_TOKEN: token')
      }
    })

    // note: can be inconsistent
    it.skip('multiple lines environment variable', async () => {
      {
        const cell = await notebook.getCell(
          [
            'echo "Auth token for service foo"',
            'export SERVICE_FOO_TOKEN="foobar"',
            'echo "Auth token for service bar"',
            'export SERVICE_BAR_TOKEN="barfoo"',
          ].join('\n'),
        )

        await cell.run(false)

        await browser.pause(1000)
        await browser.keys(Key.Enter)

        await browser.pause(1000)
        await browser.keys(Key.Enter)

        await cell.getStatusBar().waitForSuccess()

        await cell.focus()
      }

      {
        const cell = await notebook.getCell('echo "SERVICE_FOO_TOKEN: $SERVICE_FOO_TOKEN"')

        await cell.run()

        const outputs = await cell.getCellOutput(OutputType.ShellOutput)
        expect(outputs).toHaveLength(1)
        expect(outputs[0]).toStrictEqual(
          ['SERVICE_FOO_TOKEN: foobar', 'SERVICE_BAR_TOKEN: barfoo'].join('\n'),
        )
      }
    })

    // note: can be inconsistent
    it('support changes to $PATH', async () => {
      const cell = await notebook.getCell('export PATH="/some/path:$PATH"\necho $PATH')
      await cell.run(false)
      await browser.pause(1000)
      await browser.keys(Key.Enter)
      await cell.focus()
      await cell.getStatusBar().waitForSuccess()
    })

    // TODO: fix in ci
    it.skip('supports piping content to an environment variable', async () => {
      {
        const cell = await notebook.getCell('export LICENSE=$(cat ../LICENSE)')
        await cell.run()

        await new Promise((cb) => setTimeout(cb, 2000))
      }

      // await clearAllOutputs(await browser.getWorkbench())

      {
        const cell = await notebook.getCell('echo "LICENSE: $LICENSE"')
        await cell.run()

        const outputs = await cell.getCellOutput(OutputType.ShellOutput)
        expect(outputs).toHaveLength(1)
        expect(outputs[0]).toMatch('Apache License')
      }
    })

    it.skip('support for multiline exports', async () => {
      const private_key = [
        '-----BEGIN RSA PRIVATE KEY-----',
        'MIIEpAIBAAKCAQEA04up8hoqzS1+',
        '...',
        'l48DlnUtMdMrWvBlRFPzU+hU9wDhb3F0CATQdvYo2mhzyUs8B1ZSQz2Vy==',
        '-----END RSA PRIVATE KEY-----',
      ].join('\n')

      {
        const cell = await notebook.getCell('export PRIVATE_KEY')
        await cell.run()
      }

      await clearAllOutputs(await browser.getWorkbench())

      {
        const cell = await notebook.getCell('echo "PRIVATE_KEY: $PRIVATE_KEY"')
        await cell.run()
        const outputs = await cell.getCellOutput(OutputType.ShellOutput)
        expect(outputs).toHaveLength(1)
        // console.log({ output: outputs[0] })
        expect(outputs[0]).toStrictEqual('PRIVATE_KEY: ' + private_key)
      }
    })

    it('openssl command', async () => {
      const cell = await notebook.getCell('openssl rand -base64 32')
      await cell.run()

      const regex = /(?:[A-Za-z0-9+\/]{4}\\n?)*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)/
      const outputs = await cell.getCellOutput(OutputType.ShellOutput)

      expect(outputs).toHaveLength(1)
      expect(outputs[0]).toMatch(regex)
    })

    it.skip('Curl an image', async () => {
      // eslint-disable-next-line max-len
      const cell = await notebook.getCell(
        // eslint-disable-next-line max-len
        'curl https://lever-client-logos.s3.us-west-2.amazonaws.com/a8ff9b1f-f313-4632-b90f-1f7ae7ee807f-1638388150933.png 2>/dev/null',
      )
      await cell.run()

      await browser.waitUntil(
        async () => {
          const imageRegex = new RegExp('<img src="blob:vscode-webview://(.)+">')

          const outputs = await cell.getCellOutput(OutputType.Display)

          if (outputs.length !== 1) {
            return false
          }

          return outputs[0].match(imageRegex)
        },
        { timeout: 15000 },
      )
    })

    it.skip('terminal dimensions', async () => {
      const workbench = await browser.getWorkbench()
      const cell = await notebook.getCell(
        'echo Rows: \\$(tput lines)\necho Columns: \\$(tput cols)',
      )

      await cell.run(true)
      const text = await getTerminalText(workbench)
      await killAllTerminals(workbench)

      const regex = /Rows:\s+(\d+)\s+Columns:\s+(\d+)/

      expect(text).toMatch(regex)
    })
  })
})
