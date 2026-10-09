/** Cores das categorias (D5: categoria é só cor). Funcionam no claro e no escuro, em qualquer tema. */
export const CATEGORY_COLORS = ['#C26A3D', '#B8901F', '#4F8A3E', '#3E8E7E', '#3D63D6', '#8A6BC4', '#C2557A', '#C0392B', '#8B5E3C', '#5F7380']

export const COLOR_NAMES: Record<string, string> = {
  '#C26A3D': 'Terracota', '#B8901F': 'Mostarda', '#4F8A3E': 'Verde', '#3E8E7E': 'Verde-água', '#3D63D6': 'Azul',
  '#8A6BC4': 'Roxo', '#C2557A': 'Rosa', '#C0392B': 'Vermelho', '#8B5E3C': 'Marrom', '#5F7380': 'Cinza',
}

/** Próxima cor para uma categoria nova: a primeira ainda não usada (ou a sequência, se todas já estão). */
export const nextCategoryColor = (used: string[]) =>
  CATEGORY_COLORS.find((c) => !used.some((u) => u.toLowerCase() === c.toLowerCase())) ?? CATEGORY_COLORS[used.length % CATEGORY_COLORS.length]
