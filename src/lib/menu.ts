import type { Component } from 'svelte'

/** Item de menu de contexto, descrito como dado para o mesmo menu servir a qualquer elemento. */
export type MenuEntry =
  | {
      label: string
      icon?: Component<{ size?: number }>
      /** Bolinha de cor no lugar do ícone (cores de nota, categorias, paleta). */
      swatch?: string
      hint?: string
      checked?: boolean
      danger?: boolean
      disabled?: boolean
      onSelect: () => void
    }
  | { label: string; icon?: Component<{ size?: number }>; sub: MenuEntry[] }
  | { separator: true }

export const SEP: MenuEntry = { separator: true }
