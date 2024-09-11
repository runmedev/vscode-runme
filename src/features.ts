import { BehaviorSubject } from 'rxjs'
import { satisfies } from 'semver'

export const FEATURES_CONTEXT_STATE_KEY = 'features'

export type FeatureContext = {
  os?: string
  vsCodeVersion?: string
  runmeVersion?: string
  extensionVersion?: string
  githubAuth?: boolean // `true`, `false`, or `undefined`
  statefulAuth?: boolean // `true`, `false`, or `undefined`
  extensionId?: string
}

export type FeatureCondition = {
  os?: string
  vsCodeVersion?: string
  runmeVersion?: string
  extensionVersion?: string
  githubAuthRequired?: boolean
  statefulAuthRequired?: boolean
  allowedExtensions?: string[]
}

export type Feature = {
  name: string
  enabled: boolean
  activated: boolean
  conditions: FeatureCondition
}

export type FeatureState = {
  features: Feature[]
  context?: FeatureContext
}

export type FeatureObserver = BehaviorSubject<FeatureState>

function loadFeaturesFromPackageJson(packageJSON: any): Feature[] {
  const features = (packageJSON?.runme?.features || []) as Feature[]
  return features
}

export function loadFeaturesState(
  packageJSON: any,
  context?: FeatureContext,
  overrides: Map<string, boolean> = new Map(),
): FeatureObserver {
  const initialFeatures: Feature[] = loadFeaturesFromPackageJson(packageJSON)
  const state = new BehaviorSubject<FeatureState>({
    features: initialFeatures,
    context,
  })
  updateFeatureState(state, context, overrides)
  return state
}

function checkEnabled(enabled?: boolean, contextEnabled?: boolean): boolean {
  return enabled === true || contextEnabled === true
}

function checkOS(os?: string, contextOS?: string): boolean {
  return !os || os === 'All' || contextOS === os
}

function checkVersion(requiredVersion?: string, actualVersion?: string): boolean {
  if (!requiredVersion) {
    return true
  }

  if (!actualVersion) {
    return true
  }

  return satisfies(actualVersion, requiredVersion)
}

function checkAuth(required?: boolean, isAuthenticated?: boolean): boolean {
  if (!required) {
    return true
  }

  if (!isAuthenticated) {
    return false
  }

  return true
}

function checkExtensionId(allowedExtensions?: string[], extensionId?: string): boolean {
  if (!allowedExtensions?.length) {
    return true
  }

  if (!extensionId) {
    return false
  }

  return allowedExtensions.includes(extensionId)
}

function isActive(
  feature: Feature,
  context?: FeatureContext,
  overrides: Map<string, boolean> = new Map(),
): boolean {
  const {
    os,
    vsCodeVersion,
    runmeVersion,
    extensionVersion,
    githubAuthRequired,
    statefulAuthRequired,
    allowedExtensions,
  } = feature.conditions

  if (!checkEnabled(feature.enabled, overrides.get(feature.name) ?? false)) {
    console.log(`Feature "${feature.name}" is inactive due to checkEnabled.`)
    return false
  }

  if (!checkOS(os, context?.os)) {
    console.log(
      `Feature "${feature.name}" is inactive due to checkOS. Expected OS: ${os}, actual OS: ${context?.os}`,
    )
    return false
  }

  if (!checkVersion(vsCodeVersion, context?.vsCodeVersion)) {
    console.log(
      `Feature "${feature.name}" is inactive due to checkVersion (vsCodeVersion). Expected: ${vsCodeVersion}, actual: ${context?.vsCodeVersion}`,
    )
    return false
  }

  if (!checkVersion(runmeVersion, context?.runmeVersion)) {
    console.log(
      `Feature "${feature.name}" is inactive due to checkVersion (runmeVersion). Expected: ${runmeVersion}, actual: ${context?.runmeVersion}`,
    )
    return false
  }

  if (!checkVersion(extensionVersion, context?.extensionVersion)) {
    console.log(
      `Feature "${feature.name}" is inactive due to checkVersion (extensionVersion). Expected: ${extensionVersion}, actual: ${context?.extensionVersion}`,
    )
    return false
  }

  if (!checkAuth(githubAuthRequired, context?.githubAuth)) {
    console.log(
      `Feature "${feature.name}" is inactive due to checkAuth (githubAuth). Required: ${githubAuthRequired}, actual: ${context?.githubAuth}`,
    )
    return false
  }

  if (!checkAuth(statefulAuthRequired, context?.statefulAuth)) {
    console.log(
      `Feature "${feature.name}" is inactive due to checkAuth (statefulAuth). Required: ${statefulAuthRequired}, actual: ${context?.statefulAuth}`,
    )
    return false
  }

  if (!checkExtensionId(allowedExtensions, context?.extensionId)) {
    console.log(
      `Feature "${feature.name}" is inactive due to checkExtensionId. Expected: ${allowedExtensions}, actual: ${context?.extensionId}`,
    )
    return false
  }

  console.log(`Feature "${feature.name} is active`)
  return true
}

export function updateFeatureState(
  featureState$: FeatureObserver,
  context?: FeatureContext,
  overrides: Map<string, boolean> = new Map(),
) {
  const currentState = featureState$.getValue()
  const updatedFeatures = currentState.features.map((feature) => ({
    ...feature,
    activated: isActive(feature, context, overrides),
  }))
  featureState$.next({ features: updatedFeatures, context })
  return featureState$
}

export function updateFeatureContext<K extends keyof FeatureContext>(
  featureState$: FeatureObserver | undefined,
  key: K,
  value: FeatureContext[K],
  overrides: Map<string, boolean>,
) {
  if (!featureState$) {
    return
  }
  const currentState = featureState$.getValue()
  const newContext = { ...(currentState.context || {}), [key]: value }

  if (newContext[key] !== currentState?.context?.[key]) {
    updateFeatureState(featureState$, newContext, overrides)
  }
}

export function getFeatureSnapshot(featureState$: FeatureObserver | undefined): string {
  if (!featureState$) {
    return ''
  }

  return JSON.stringify(featureState$.getValue())
}

export function loadFeatureSnapshot(snapshot: string): FeatureObserver {
  const { features, context } = JSON.parse(snapshot)
  const featureState$ = new BehaviorSubject<FeatureState>({
    features,
    context,
  })

  featureState$.next({ features, context: featureState$.getValue().context })
  return featureState$
}

export function isFeatureActive(featureState$?: FeatureObserver, featureName?: string): boolean {
  if (!featureState$) {
    return false
  }

  if (!featureName) {
    return false
  }

  const feature = featureState$.getValue().features.find((f) => f.name === featureName)
  return feature ? feature.activated : false
}
