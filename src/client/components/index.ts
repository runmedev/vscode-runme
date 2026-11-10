import { allComponents, provideVSCodeDesignSystem } from '@vscode/webview-ui-toolkit'

// Register explicitly so the toolkit's sideEffects: false cannot remove setup.
provideVSCodeDesignSystem().register(allComponents)

export * from './output'
export * from './outputItems'
export * from './configuration/annotations'
export * from './terminal'
export * from './github/workflowViewer'
export * from './gcp'
export * from './aws'
export * from './dagger'
