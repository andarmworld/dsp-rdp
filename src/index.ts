import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { applyNative } from '../server/native.mjs'
import type { NativeConfig } from '../server/native.mjs'

export const name = 'rdp-plugin'
export const inject = ['connection', 'storageDomain']
export type Config = NativeConfig
export const Config: schema<Config> = schema.object({
  guacamoleUrl: schema.string().default('http://127.0.0.1:18081/guacamole'),
  gatewayUser: schema.string().default('dshadmin'),
  adminUser: schema.string().default('guacadmin'),
  keyFile: schema.string(),
})
export function apply(context: Context, config: Config): Promise<void> {
  return applyNative(context, config)
}
