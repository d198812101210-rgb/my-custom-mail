export interface ParsedAddress {
  address: string
  name: string | null
}

/** "Jane Doe <Jane@Example.com>" -> { address: "jane@example.com", name: "Jane Doe" } */
export function parseAddress(input: string): ParsedAddress {
  const trimmed = input.trim()
  const m = /^(.*)<([^<>]+)>\s*$/.exec(trimmed)
  if (!m) return { address: trimmed.toLowerCase(), name: null }
  const name = (m[1] ?? '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim()
  return { address: (m[2] ?? '').trim().toLowerCase(), name: name || null }
}

export function bareAddresses(
  list: readonly string[] | null | undefined,
): string[] {
  return [
    ...new Set(
      (list ?? []).map((a) => parseAddress(a).address).filter(Boolean),
    ),
  ]
}

export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1).toLowerCase()
}

/** Domain of a "Name <a@b.c>" or bare mailbox string. */
export function mailboxDomain(mailbox: string): string {
  return domainOf(parseAddress(mailbox).address)
}
