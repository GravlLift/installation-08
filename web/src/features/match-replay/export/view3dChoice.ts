// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** Default view choices and export options for the dialog. */
import type { Export3dOptions } from './export3dFrame'
import type { Replay3DExportEntry } from './replay3dExportStore'

/** The dialog's 3D view selection and settings. */
export interface View3dChoice extends Export3dOptions {
  on: boolean
}

/** Start with the current view and include the minimap. */
export function initialView3dChoice(entry: Replay3DExportEntry | null): View3dChoice {
  return {
    on: entry?.live ?? false,
    camera: entry?.camera ?? 'fp',
    pov: entry?.pov ?? null,
    minimap: true,
  }
}

/** Return null for 2D or when no 3D scene is loaded. */
export function view3dRunOptions(entry: Replay3DExportEntry | null, choice: View3dChoice): Export3dOptions | null {
  if (!entry || !choice.on) return null
  return { camera: choice.camera, pov: choice.pov, minimap: choice.minimap }
}
