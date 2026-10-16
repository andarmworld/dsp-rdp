import type { CSSProperties } from 'react'
export const tokens = { border: '#8886', muted: .7, error: '#c0392b', success: '#238636', focus: '#2780e3', selected: '#2780e314', gap: 8, radius: 6 } as const
export const row: CSSProperties = { display: 'flex', gap: tokens.gap, alignItems: 'center', flexWrap: 'wrap' }
export const button: CSSProperties = { cursor: 'pointer', border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, padding: '8px 12px', background: 'transparent', color: 'inherit', font: 'inherit' }
export const input: CSSProperties = { border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, padding: 8, background: 'transparent', color: 'inherit', font: 'inherit', boxSizing: 'border-box', width: '100%', minWidth: 0 }
export const muted: CSSProperties = { opacity: tokens.muted, fontSize: 12 }
