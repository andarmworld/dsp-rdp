import type { Context } from '@deepseek-ai/cordis';
export interface NativeConfig {
  readonly guacamoleUrl?: string;
  readonly gatewayUser?: string;
  readonly adminUser?: string;
  readonly keyFile?: string;
}
export function applyNative(context: Context, config: NativeConfig): Promise<void>;
