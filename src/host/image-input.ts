import { acceptsImages, type CatalogModel, type ImagePolicy } from './catalog.js'
import { validateImageOverrides } from './settings.js'

type Modalities = NonNullable<CatalogModel['info']['inputModalities']>

/**
 * Effective input modalities of one catalog model under the saved policy.
 * Read-time only: the catalog keeps the gateway's own declaration untouched, so a
 * preference toggle never rewrites (or is mistaken for) real gateway data.
 */
export const imageModalities = (model: CatalogModel, policy: ImagePolicy): Modalities =>
  acceptsImages(model.declaredModalities ?? [], model.info.id, policy) ? ['text', 'image'] : ['text']
/** Catalog info with the saved image policy applied; the gateway's own declaration always wins. */
export function withImageInput(model: CatalogModel, policy: ImagePolicy): CatalogModel['info'] {
  return { ...model.info, inputModalities: imageModalities(model, policy) }
}
/** Whether the model accepts images under the saved policy. */
export const acceptsImagesFor = (model: CatalogModel, policy: ImagePolicy): boolean =>
  acceptsImages(model.declaredModalities ?? [], model.info.id, policy)
/** Whether the gateway itself declared input modalities; an empty declaration is silence, not a denial. */
export const hasDeclaredModalities = (model: CatalogModel): boolean => (model.declaredModalities?.length ?? 0) > 0

/**
 * Set or clear one model's exception. A value equal to the current default clears
 * the key instead of storing a no-op, and the model must exist in the current
 * catalog: a preference for a model the gateway no longer lists is never invented.
 */
export function updateImageModel(saved: Readonly<Record<string, boolean>>, input: unknown, catalog: CatalogModel[], imageDefault: boolean): Record<string, boolean> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['model', 'image'].includes(k))) throw new Error('Invalid imageModel')
  const { model, image } = input as { model?: unknown; image?: unknown }
  if (typeof model !== 'string' || !model || typeof image !== 'boolean') throw new Error('Invalid image input')
  if (!catalog.find(m => m.info.id === model)) throw new Error('Invalid image input model')
  const next = { ...saved }
  if (image === imageDefault) delete next[model]
  else next[model] = image
  // The write must obey the same capacity rule as the read: an over-long table is
  // rejected here, before it can make `imagePolicy` fall back to the default and
  // silently discard every saved preference.
  return validateImageOverrides(next)
}

/** Drop the exceptions a changed default already explains: they stop being exceptions. */
export const updateImageDefault = (imageDefault: boolean, overrides: Readonly<Record<string, boolean>>): Record<string, boolean> =>
  Object.fromEntries(Object.entries(overrides).filter(([, image]) => image !== imageDefault))
